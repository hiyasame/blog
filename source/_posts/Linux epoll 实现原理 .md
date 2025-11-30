---
title: 'Linux epoll 实现原理 '
urlname: Y8zQdAX1Poif9Xxib1JcmQBEn0f
date: '2025-11-30 21:28:21'
updated: '2025-11-30 21:30:41'
tags:
  - RTFSC
  - linux
---
> 本文参考的内核源码版本为 5.15

在 linux 内核项目中，epoll 机制的实现只用了一个文件 `fs/eventpull.c` ~~_不过这一个文件就有 2000+ 行代码_~~

先从我们熟知的 epoll 系统调用开始分析，看看它们到底都做了些什么：
## epoll_create
```c
/*
 * Open an eventpoll file descriptor.
 */
static int do_epoll_create(int flags)
{
    int error, fd;
    struct eventpoll *ep = NULL;
    struct file *file;

    /* Check the EPOLL_* constant for consistency.  */
    BUILD_BUG_ON(EPOLL_CLOEXEC != O_CLOEXEC);

    if (flags & ~EPOLL_CLOEXEC)
        return -EINVAL;
    /*
     * Create the internal data structure ("struct eventpoll").
     */
    error = ep_alloc(&ep);
    if (error < 0)
        return error;
    /*
     * Creates all the items needed to setup an eventpoll file. That is,
     * a file structure and a free file descriptor.
     */
    fd = get_unused_fd_flags(O_RDWR | (flags & O_CLOEXEC));
    if (fd < 0) {
        error = fd;
        goto out_free_ep;
    }
    file = anon_inode_getfile("[eventpoll]", &eventpoll_fops, ep,
                 O_RDWR | (flags & O_CLOEXEC));
    if (IS_ERR(file)) {
        error = PTR_ERR(file);
        goto out_free_fd;
    }
    ep->file = file;
    fd_install(fd, file);
    return fd;

out_free_fd:
    put_unused_fd(fd);
out_free_ep:
    ep_free(ep);
    return error;
}
```
代码不复杂：
1. 调用 ep_alloc 创建了一个 epoll 实例

1. 根据 flags alloc 一个 fd

1. 创建一个新的 struct file，这个 file 是绑定在一个匿名 inode 上的。（所有需要一个文件但不需要文件有实际内容的 api 都这么创建，比如 `/dev/pts` , pipe 这种文件）

1. 将这个 struct file 绑定给这个 fd

一言以蔽之，就是创建了一个绑定了 epoll 数据结构的 struct file，返回了其 fd。
## epoll_ctl
```c
int do_epoll_ctl(int epfd, int op, int fd, struct epoll_event *epds,
         bool nonblock)
{
    int error;
    int full_check = 0;
    struct fd f, tf;
    struct eventpoll *ep;
    struct epitem *epi;
    struct eventpoll *tep = NULL;

    error = -EBADF;
    f = fdget(epfd);
    if (!f.file)
        goto error_return;

    /* Get the "struct file *" for the target file */
    tf = fdget(fd);
    if (!tf.file)
        goto error_fput;

    /* The target file descriptor must support poll */
    error = -EPERM;
    if (!file_can_poll(tf.file))
        goto error_tgt_fput;

    /* Check if EPOLLWAKEUP is allowed */
    if (ep_op_has_event(op))
        ep_take_care_of_epollwakeup(epds);

    /*
     * We have to check that the file structure underneath the file descriptor
     * the user passed to us _is_ an eventpoll file. And also we do not permit
     * adding an epoll file descriptor inside itself.
     */
    error = -EINVAL;
    if (f.file == tf.file || !is_file_epoll(f.file))
        goto error_tgt_fput;

    /*
     * epoll adds to the wakeup queue at EPOLL_CTL_ADD time only,
     * so EPOLLEXCLUSIVE is not allowed for a EPOLL_CTL_MOD operation.
     * Also, we do not currently supported nested exclusive wakeups.
     */
    if (ep_op_has_event(op) && (epds->events & EPOLLEXCLUSIVE)) {
        if (op == EPOLL_CTL_MOD)
            goto error_tgt_fput;
        if (op == EPOLL_CTL_ADD && (is_file_epoll(tf.file) ||
                (epds->events & ~EPOLLEXCLUSIVE_OK_BITS)))
            goto error_tgt_fput;
    }

    /*
     * At this point it is safe to assume that the "private_data" contains
     * our own data structure.
     */
    ep = f.file->private_data;

    /*
     * When we insert an epoll file descriptor inside another epoll file
     * descriptor, there is the chance of creating closed loops, which are
     * better be handled here, than in more critical paths. While we are
     * checking for loops we also determine the list of files reachable
     * and hang them on the tfile_check_list, so we can check that we
     * haven't created too many possible wakeup paths.
     *
     * We do not need to take the global 'epumutex' on EPOLL_CTL_ADD when
     * the epoll file descriptor is attaching directly to a wakeup source,
     * unless the epoll file descriptor is nested. The purpose of taking the
     * 'epmutex' on add is to prevent complex toplogies such as loops and
     * deep wakeup paths from forming in parallel through multiple
     * EPOLL_CTL_ADD operations.
     */
    error = epoll_mutex_lock(&ep->mtx, 0, nonblock);
    if (error)
        goto error_tgt_fput;
    if (op == EPOLL_CTL_ADD) {
        if (READ_ONCE(f.file->f_ep) || ep->gen == loop_check_gen ||
            is_file_epoll(tf.file)) {
            mutex_unlock(&ep->mtx);
            error = epoll_mutex_lock(&epmutex, 0, nonblock);
            if (error)
                goto error_tgt_fput;
            loop_check_gen++;
            full_check = 1;
            if (is_file_epoll(tf.file)) {
                tep = tf.file->private_data;
                error = -ELOOP;
                if (ep_loop_check(ep, tep) != 0)
                    goto error_tgt_fput;
            }
            error = epoll_mutex_lock(&ep->mtx, 0, nonblock);
            if (error)
                goto error_tgt_fput;
        }
    }

    /*
     * Try to lookup the file inside our RB tree. Since we grabbed "mtx"
     * above, we can be sure to be able to use the item looked up by
     * ep_find() till we release the mutex.
     */
    epi = ep_find(ep, tf.file, fd);

    error = -EINVAL;
    switch (op) {
    case EPOLL_CTL_ADD:
        if (!epi) {
            epds->events |= EPOLLERR | EPOLLHUP;
            error = ep_insert(ep, epds, tf.file, fd, full_check);
        } else
            error = -EEXIST;
        break;
    case EPOLL_CTL_DEL:
        if (epi)
            error = ep_remove(ep, epi);
        else
            error = -ENOENT;
        break;
    case EPOLL_CTL_MOD:
        if (epi) {
            if (!(epi->event.events & EPOLLEXCLUSIVE)) {
                epds->events |= EPOLLERR | EPOLLHUP;
                error = ep_modify(ep, epi, epds);
            }
        } else
            error = -ENOENT;
        break;
    }
    mutex_unlock(&ep->mtx);

error_tgt_fput:
    if (full_check) {
        clear_tfile_check_list();
        loop_check_gen++;
        mutex_unlock(&epmutex);
    }

    fdput(tf);
error_fput:
    fdput(f);
error_return:

    return error;
}
```
我们知道 epoll_ctl 是用于注册/修改/注销多路等待的 fd，这个代码就比 epoll_create 复杂多了：
1. 解析 epfd 和参数中的 fd，拿到 epfd 对应的 eventpoll 结构体，拿到 fd 对应的 struct file。

1. 根据 operation (EPOLL_CTL_ADD / EPOLL_CTL_MOD / EPOLL_CTL_DEL) 做一些参数预检。如果 flags 中有 EPOLLEXCLUSIVE，epoll fd 不能被添加到另一个 epoll 队列，不支持嵌套。

1. 获取 epoll 结构体中的锁（自旋）

1. 在 EPOLL_CTL_ADD 时做一下循环检查，因为如果没有 EPOLLEXCLUSIVE flag，嵌套 epoll fd 到 epoll 中就是被允许的，这种情况下需要做循环检查避免 A -> B -> A 这种情况把内核卡死。

1. 从 epoll 结构体内部的红黑树结构找到 fd 对应的 node
	1. 对于 ADD，如果能找到，直接返回 EEXIST，反之则将 fd 插入红黑树。`ep_insert` 中除了将节点加入红黑树，还调用了 vfs 的 poll 接口 （file->f_op->poll），用于将 callback 注册到文件对应的设备上（驱动侧回调）。并且 poll 接口还会立刻返回当前设备的状态（有没有数据可读），如果处于 ready 状态，则会立刻 wakeup。
		1. 对于 DEL，能找到就直接将其从红黑树中删除，否则返回 ENOENT。并且会注销 vfs 的 wait queue。
		1. 对于 MOD，能找到才修改，没找到就不修改
	
1. 释放锁

## epoll_wait
```go
/*
 * Implement the event wait interface for the eventpoll file. It is the kernel
 * part of the user space epoll_wait(2).
 */
static int do_epoll_wait(int epfd, struct epoll_event __user *events,
             int maxevents, struct timespec64 *to)
{
    int error;
    struct fd f;
    struct eventpoll *ep;

    /* The maximum number of event must be greater than zero */
    if (maxevents <= 0 || maxevents > EP_MAX_EVENTS)
        return -EINVAL;

    /* Verify that the area passed by the user is writeable */
    if (!access_ok(events, maxevents * sizeof(struct epoll_event)))
        return -EFAULT;

    /* Get the "struct file *" for the eventpoll file */
    f = fdget(epfd);
    if (!f.file)
        return -EBADF;

    /*
     * We have to check that the file structure underneath the fd
     * the user passed to us _is_ an eventpoll file.
     */
    error = -EINVAL;
    if (!is_file_epoll(f.file))
        goto error_fput;

    /*
     * At this point it is safe to assume that the "private_data" contains
     * our own data structure.
     */
    ep = f.file->private_data;

    /* Time to fish for events ... */
    error = ep_poll(ep, events, maxevents, to);

error_fput:
    fdput(f);
    return error;
}
```
epoll_wait 经常用来在一条线程上同时 wait 很多个 fd，有点 Promise.race 那个意思：
1. 首先对参数做一些预检

1. 主要的逻辑都在 ep_poll 中：

```cpp
/**
 * ep_poll - Retrieves ready events, and delivers them to the caller-supplied
 *           event buffer.
 *
 * @ep: Pointer to the eventpoll context.
 * @events: Pointer to the userspace buffer where the ready events should be
 *          stored.
 * @maxevents: Size (in terms of number of events) of the caller event buffer.
 * @timeout: Maximum timeout for the ready events fetch operation, in
 *           timespec. If the timeout is zero, the function will not block,
 *           while if the @timeout ptr is NULL, the function will block
 *           until at least one event has been retrieved (or an error
 *           occurred).
 *
 * Return: the number of ready events which have been fetched, or an
 *          error code, in case of error.
 */
static int ep_poll(struct eventpoll *ep, struct epoll_event __user *events,
           int maxevents, struct timespec64 *timeout)
{
    int res, eavail, timed_out = 0;
    u64 slack = 0;
    wait_queue_entry_t wait;
    ktime_t expires, *to = NULL;

    lockdep_assert_irqs_enabled();

    if (timeout && (timeout->tv_sec | timeout->tv_nsec)) {
        slack = select_estimate_accuracy(timeout);
        to = &expires;
        *to = timespec64_to_ktime(*timeout);
    } else if (timeout) {
        /*
         * Avoid the unnecessary trip to the wait queue loop, if the
         * caller specified a non blocking operation.
         */
        timed_out = 1;
    }

    /*
     * This call is racy: We may or may not see events that are being added
     * to the ready list under the lock (e.g., in IRQ callbacks). For cases
     * with a non-zero timeout, this thread will check the ready list under
     * lock and will add to the wait queue.  For cases with a zero
     * timeout, the user by definition should not care and will have to
     * recheck again.
     */
    eavail = ep_events_available(ep);

    while (1) {
        if (eavail) {
            /*
             * Try to transfer events to user space. In case we get
             * 0 events and there's still timeout left over, we go
             * trying again in search of more luck.
             */
            res = ep_send_events(ep, events, maxevents);
            if (res)
                return res;
        }

        if (timed_out)
            return 0;

        eavail = ep_busy_loop(ep, timed_out);
        if (eavail)
            continue;

        if (signal_pending(current))
            return -EINTR;

        /*
         * Internally init_wait() uses autoremove_wake_function(),
         * thus wait entry is removed from the wait queue on each
         * wakeup. Why it is important? In case of several waiters
         * each new wakeup will hit the next waiter, giving it the
         * chance to harvest new event. Otherwise wakeup can be
         * lost. This is also good performance-wise, because on
         * normal wakeup path no need to call __remove_wait_queue()
         * explicitly, thus ep->lock is not taken, which halts the
         * event delivery.
         */
        init_wait(&wait);

        write_lock_irq(&ep->lock);
        /*
         * Barrierless variant, waitqueue_active() is called under
         * the same lock on wakeup ep_poll_callback() side, so it
         * is safe to avoid an explicit barrier.
         */
        __set_current_state(TASK_INTERRUPTIBLE);

        /*
         * Do the final check under the lock. ep_scan_ready_list()
         * plays with two lists (->rdllist and ->ovflist) and there
         * is always a race when both lists are empty for short
         * period of time although events are pending, so lock is
         * important.
         */
        eavail = ep_events_available(ep);
        if (!eavail)
            __add_wait_queue_exclusive(&ep->wq, &wait);

        write_unlock_irq(&ep->lock);

        if (!eavail)
            timed_out = !schedule_hrtimeout_range(to, slack,
                                  HRTIMER_MODE_ABS);
        __set_current_state(TASK_RUNNING);

        /*
         * We were woken up, thus go and try to harvest some events.
         * If timed out and still on the wait queue, recheck eavail
         * carefully under lock, below.
         */
        eavail = 1;

        if (!list_empty_careful(&wait.entry)) {
            write_lock_irq(&ep->lock);
            /*
             * If the thread timed out and is not on the wait queue,
             * it means that the thread was woken up after its
             * timeout expired before it could reacquire the lock.
             * Thus, when wait.entry is empty, it needs to harvest
             * events.
             */
            if (timed_out)
                eavail = list_empty(&wait.entry);
            __remove_wait_queue(&ep->wq, &wait);
            write_unlock_irq(&ep->lock);
        }
    }
}
```
1. 首先检查是否有事件到达，如果有事件到达则将事件发送到用户态，然后返回

1. 如果 timeout 时间已经到了则后续直接返回

1. 如果内核打开了忙轮询（busy loop），则一直轮询直到事件到达

1. 将线程状态设置为 INTERRUPTIBLE（可中断休眠），准备休眠

1. Double check 此时是否有事件到达，如果没有则将 wait 放入 epoll 的 wait queue

1. 如果之前没有事件到达则通过 schedule_hrtimeout_range 进入超时等待，在中间也可能被 epoll 事件到达主动 wake up

1. 如果有事件到达或超时则正常返回

## 总结
所以其实 epoll 跟 android 消息机制其实实现上也是挺像的，~~_虽然消息机制也是靠 epoll 来等待的_~~ 

不过 epoll 提供了一种在内核层面暂停进程超时等待的机制，也可以通过写 fd 手动 wake up，挺方便的，并且重中之重在于其可以在一条线程上多路复用多个 fd，而且实际上也不占用 cpu 资源，全靠硬件驱动侧来通知，妙哉！

这样看内核源码其实也不复杂，甚至可以说相比于业务代码的屎山非常的精炼好读。

> 也许很多伟大的事物其实并不像我们想象中的那么复杂和困难，无知者之所以无知只是因为缺乏勇气去打破那层轻薄的障壁。



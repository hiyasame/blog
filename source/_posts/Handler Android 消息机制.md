---
title: Handler Android 消息机制
urlname: N8Ald4KgDobdVPxjhhHc76zRnVg
date: 2023-07-04T20:49:55.000Z
updated: '2024-01-18 17:31:46'
tags:
  - android
  - 八股
---
## **解析**


handler 源码也算是老生常谈了，之前也简单研究过源码。首先列出比较重要的几个类


- Handler

- MessageQueue

- Message

- Looper



那么我们就从 Handler 最经典的用法开始分析


```kotlin
class MainActivity : AppCompatActivity() {

    private val handler = object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(msg: Message) {
            Toast.makeText(this@MainActivity, "处理消息", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
            setContentView(R.layout.activity_main)
            handler.sendEmptyMessage(0)
    }
}
```


这里就有两个入口可以分析 `Handler#sendMessage`, `Handler#handleMessage`


### **Handler#sendMessage**

```java
// 具体实现看sendMessageDelay
public final boolean sendMessage(@NonNull Message msg) {
    return sendMessageDelayed(msg, 0);
}

// 具体实现看 sendMessageAtTime
public final boolean sendMessageDelayed(@NonNull Message msg, long delayMillis) {
    if (delayMillis < 0) {
        delayMillis = 0;
    }
    return sendMessageAtTime(msg, SystemClock.uptimeMillis() + delayMillis);
}

// 拿到字段里的 MessageQueue，然后 enqueueMessage
// 这个名字很容易猜到这是消息入队的操作
public boolean sendMessageAtTime(@NonNull Message msg, long uptimeMillis) {
    MessageQueue queue = mQueue;
    if (queue == null) {
        RuntimeException e = new RuntimeException(
                this + " sendMessageAtTime() called with no mQueue");
        Log.w("Looper", e.getMessage(), e);
        return false;
    }
    return enqueueMessage(queue, msg, uptimeMillis);
}

private boolean enqueueMessage(@NonNull MessageQueue queue, @NonNull Message msg,
        long uptimeMillis) {
    // 将 msg 的 target 设置为 handler 自身，方便出队后拿到消息的发送者回调 handleMessage
    msg.target = this;
    // 设置 workSourceUid
    msg.workSourceUid = ThreadLocalWorkSource.getUid();

    // 在new Handler的时候可以设置为异步，这样这个handler发送的消息都是异步消息
    if (mAsynchronous) {
        msg.setAsynchronous(true);
    }
    return queue.enqueueMessage(msg, uptimeMillis);
}
```


然后我们就进入了 `MessageQueue#enqueueMessage`


### **MessageQueue#enqueueMessage**

```java
boolean enqueueMessage(Message msg, long when) {
    if (msg.target == null) {
        throw new IllegalArgumentException("Message must have a target.");
    }

    // 上锁，保证没有两条消息同时进行入队操作产生并发问题
    synchronized (this) {
        // 如果这个 messgae 正在队列中，当然不能再次入队
        // 说一点小小的感悟吧，rust语言的移动语义可以让多次入队成为不可能，而在java中为了防范这种边界情况要写大量的检查代码。移动语义这个设计确实高明
        if (msg.isInUse()) {
            throw new IllegalStateException(msg + " This message is already in use.");
        }

        // 如果这个线程正在退出，当然不能给一条死掉的线程上的handler发消息
        if (mQuitting) {
            IllegalStateException e = new IllegalStateException(
                    msg.target + " sending message to a Handler on a dead thread");
            Log.w(TAG, e.getMessage(), e);
            msg.recycle();
            return false;
        }

        // 标记这个消息正在使用
        msg.markInUse();
        // 设置这条信息应当从队列取出时的时间
        msg.when = when;
        // 拿到消息队列的头节点，没错，消息队列是一个链表结构
        Message p = mMessages;
        boolean needWake;
        // 如果头节点为空 或者 when == 0 （意味着这个消息必须放置在头节点）或者 新插入的消息出队时间比头节点早
        // 就将插入的消息设置为新的头节点
        // 这里可以看出消息队列是一个优先队列
        if (p == null || when == 0 || when < p.when) {
            // New head, wake up the event queue if blocked.
            msg.next = p;
            mMessages = msg;
            // 如果事件队列现在正处于等待状态就之后唤醒他 （其实就是唤醒epoll等待的事件线程）
            needWake = mBlocked;
        } else {
            // Inserted within the middle of the queue.  Usually we don't have to wake
            // up the event queue unless there is a barrier at the head of the queue
            // and the message is the earliest asynchronous message in the queue.
            // 在队列的中间插入。通常我们不会唤醒这个事件队列除非队列的头部有一个同步屏障
            // 且这条消息是队列中最早的异步消息

            // 正在阻塞 且 p.target == null 且 是异步消息
            // 如果 p.target == null 则说明队列的头部是一条屏障消息
            needWake = mBlocked && p.target == null && msg.isAsynchronous();
            // 经典算法题，双指针遍历链表
            Message prev;
            for (;;) {
                prev = p;
                p = p.next;
                // 遍历到尾部或遍历到了自己应该待的地方 break 出去
                if (p == null || when < p.when) {
                    break;
                }
                // 如果触发这一行，说明这条消息不是最早的异步消息，那么就不需要唤醒了
                if (needWake && p.isAsynchronous()) {
                    needWake = false;
                }
            }
            // 插入
            msg.next = p; // invariant: p == prev.next
            prev.next = msg;
        }

        // We can assume mPtr != 0 because mQuitting is false.
        // 如果需要唤醒就调用 nativeWake 进到 native 层对事件循环进行唤醒
        if (needWake) {
            nativeWake(mPtr);
        }
    }
    return true;
}
```


激动人心的 native 之旅就要启程啦～


```java
private native static void nativeWake(long ptr);
```

### **native NativeMessageQueue#wake**


前往 [AOSPXRef](http://aospxref.com) 查看源码


```cpp
static void android_os_MessageQueue_nativeWake(JNIEnv* env, jclass clazz, jlong ptr) {
    NativeMessageQueue* nativeMessageQueue = reinterpret_cast<NativeMessageQueue*>(ptr);
    nativeMessageQueue->wake();
}

void NativeMessageQueue::wake() {
    mLooper->wake();
}
```


这里可以看出 java 层传入的 mPtr 其实就是 native 层的 MessageQueue 的指针。并且 wake 方法实际上是调用了 `Looper#wake`


```cpp
void Looper::wake() {
#if DEBUG_POLL_AND_WAKE
    ALOGD("%p ~ wake", this);
#endif
    uint64_t inc = 1;
    // TEMP_FAILURE_RETRY 这个宏用于在系统调用失败时重试
    // 对 wakeEventFd 这个文件描述符写入唤醒信号 (1)，epoll IO 多路复用机制便会唤醒线程
    ssize_t nWrite = TEMP_FAILURE_RETRY(write(mWakeEventFd.get(), &inc, sizeof(uint64_t)));
    // 写入失败对应的异常处理
    if (nWrite != sizeof(uint64_t)) {
        if (errno != EAGAIN) {
            LOG_ALWAYS_FATAL("Could not write wake signal to fd %d (returned %zd): %s", mWakeEventFd.get(), nWrite, strerror(errno));
        }
    }
}
```


可以看到我们向 mWakeEventFd 写入了唤醒信号，Looper 所对应线程上的 epoll 机制会停止等待唤醒信号，对线程进行唤醒。



我们知道 epoll 是需要事先注册文件描述符的，找出这部分代码，我们继续分析


```cpp
void Looper::rebuildEpollLocked() {
    // Close old epoll instance if we have one.
    if (mEpollFd >= 0) {
#if DEBUG_CALLBACKS
        ALOGD("%p ~ rebuildEpollLocked - rebuilding epoll set", this);
#endif
        mEpollFd.reset();
    }

    // Allocate the new epoll instance and register the WakeEventFd.
    // 分配新的 epoll instance 并且注册 WakeEventFd
    mEpollFd.reset(epoll_create1(EPOLL_CLOEXEC));
    LOG_ALWAYS_FATAL_IF(mEpollFd < 0, "Could not create epoll instance: %s", strerror(errno));

    // 创建 epoll 事件 wakeEvent
    epoll_event wakeEvent = createEpollEvent(EPOLLIN, WAKE_EVENT_FD_SEQ);
    // 注册文件描述符
    int result = epoll_ctl(mEpollFd.get(), EPOLL_CTL_ADD, mWakeEventFd.get(), &wakeEvent);
    LOG_ALWAYS_FATAL_IF(result != 0, "Could not add wake event fd to epoll instance: %s",
            strerror(errno));

    // 注册其他 epoll 事件：比如屏幕触摸事件，触摸屏幕时需要唤醒线程并在主线程回调 onTouch
    for (const auto& [seq, request] : mRequests) {
        epoll_event eventItem = createEpollEvent(request.getEpollEvents(), seq);

        int epollResult = epoll_ctl(mEpollFd.get(), EPOLL_CTL_ADD, request.fd, &eventItem);
        if (epollResult < 0) {
            ALOGE("Error adding epoll events for fd %d while rebuilding epoll set: %s",
                    request.fd, strerror(errno));
        }
    }
}
```


注册了之后，问题是在哪里进行 `epoll_wait` 等待呢？在这里先按下不表，我们从 `Handler#handleMessage` 开始分析。


### **Handler#handleMessage**

```java
// Handler#dispatchMessage
public void dispatchMessage(@NonNull Message msg) {
    if (msg.callback != null) {
        handleCallback(msg);
    } else {
        if (mCallback != null) {
            if (mCallback.handleMessage(msg)) {
                return;
            }
        }
        handleMessage(msg);
    }
}
```

### **Looper#loopOnce**

```java
// Looper#loopOnce
private static boolean loopOnce(final Looper me,
        final long ident, final int thresholdOverride) {

    // 重要步骤，从队列中取出消息
    Message msg = me.mQueue.next(); // might block
    if (msg == null) {
        // No message indicates that the message queue is quitting.
        return false;
    }

    // This must be in a local variable, in case a UI event sets the logger
    final Printer logging = me.mLogging;
    if (logging != null) {
        logging.println(">>>>> Dispatching to " + msg.target + " "
                + msg.callback + ": " + msg.what);
    }
    // Make sure the observer won't change while processing a transaction.
    // 这个 Observer 可以在消息处理前和消息处理后做一些事情
    final Observer observer = sObserver;

    final long traceTag = me.mTraceTag;
    long slowDispatchThresholdMs = me.mSlowDispatchThresholdMs;
    long slowDeliveryThresholdMs = me.mSlowDeliveryThresholdMs;
    if (thresholdOverride > 0) {
        slowDispatchThresholdMs = thresholdOverride;
        slowDeliveryThresholdMs = thresholdOverride;
    }
    final boolean logSlowDelivery = (slowDeliveryThresholdMs > 0) && (msg.when > 0);
    final boolean logSlowDispatch = (slowDispatchThresholdMs > 0);

    final boolean needStartTime = logSlowDelivery || logSlowDispatch;
    final boolean needEndTime = logSlowDispatch;

    if (traceTag != 0 && Trace.isTagEnabled(traceTag)) {
        Trace.traceBegin(traceTag, msg.target.getTraceName(msg));
    }

    final long dispatchStart = needStartTime ? SystemClock.uptimeMillis() : 0;
    final long dispatchEnd;
    Object token = null;
    if (observer != null) {
        token = observer.messageDispatchStarting();
    }
    long origWorkSource = ThreadLocalWorkSource.setUid(msg.workSourceUid);
    try {
        // 在这里把消息发给 Handler
        msg.target.dispatchMessage(msg);
        if (observer != null) {
            observer.messageDispatched(token, msg);
        }
        dispatchEnd = needEndTime ? SystemClock.uptimeMillis() : 0;
    } catch (Exception exception) {
        if (observer != null) {
            observer.dispatchingThrewException(token, msg, exception);
        }
        throw exception;
    } finally {
        ThreadLocalWorkSource.restore(origWorkSource);
        if (traceTag != 0) {
            Trace.traceEnd(traceTag);
        }
    }
    if (logSlowDelivery) {
        if (me.mSlowDeliveryDetected) {
            if ((dispatchStart - msg.when) <= 10) {
                Slog.w(TAG, "Drained");
                me.mSlowDeliveryDetected = false;
            }
        } else {
            if (showSlowLog(slowDeliveryThresholdMs, msg.when, dispatchStart, "delivery",
                        msg)) {
                // Once we write a slow delivery log, suppress until the queue drains.
                me.mSlowDeliveryDetected = true;
            }
        }
    }
    if (logSlowDispatch) {
        showSlowLog(slowDispatchThresholdMs, dispatchStart, dispatchEnd, "dispatch", msg);
    }

    if (logging != null) {
        logging.println("<<<<< Finished to " + msg.target + " " + msg.callback);
    }

    // Make sure that during the course of dispatching the
    // identity of the thread wasn't corrupted.
    final long newIdent = Binder.clearCallingIdentity();
    if (ident != newIdent) {
        Log.wtf(TAG, "Thread identity changed from 0x"
                + Long.toHexString(ident) + " to 0x"
                + Long.toHexString(newIdent) + " while dispatching to "
                + msg.target.getClass().getName() + " "
                + msg.callback + " what=" + msg.what);
    }

    // 消息已经用完了，清除状态放入实例池
    msg.recycleUnchecked();

    return true;
}
```


别看上面一大堆代码，其实核心逻辑就是 `MessageQueue#next` 取出消息并把它分发给 `Handler`。其他的代码基本上就是单个消息处理太慢的警告机制。


### **Looper#loop**

```java
public static void loop() {
    final Looper me = myLooper();
    if (me == null) {
        throw new RuntimeException("No Looper; Looper.prepare() wasn't called on this thread.");
    }
    if (me.mInLoop) {
        Slog.w(TAG, "Loop again would have the queued messages be executed"
                + " before this one completed.");
    }

    me.mInLoop = true;

    // Make sure the identity of this thread is that of the local process,
    // and keep track of what that identity token actually is.
    Binder.clearCallingIdentity();
    final long ident = Binder.clearCallingIdentity();

    // Allow overriding a threshold with a system prop. e.g.
    // adb shell 'setprop log.looper.1000.main.slow 1 && stop && start'
    final int thresholdOverride =
        SystemProperties.getInt("log.looper."
                + Process.myUid() + "."
                + Thread.currentThread().getName()
                + ".slow", 0);

    me.mSlowDeliveryDetected = false;

    for (;;) {
        if (!loopOnce(me, ident, thresholdOverride)) {
            return;
        }
    }
}
```


重要代码也就是最后的死循环，这个死循环只会在 MessageQueue 正在退出的时候返回。


### **MessageQueue#next**


重头戏来了


```java
Message next() {
    // Return here if the message loop has already quit and been disposed.
    // This can happen if the application tries to restart a looper after quit
    // which is not supported.
    final long ptr = mPtr;
    if (ptr == 0) {
        return null;
    }

    // 这里出现了 IdleHandler 的字眼
    int pendingIdleHandlerCount = -1; // -1 only during first iteration
    int nextPollTimeoutMillis = 0;
    for (;;) {
        if (nextPollTimeoutMillis != 0) {
            Binder.flushPendingCommands();
        }

        // pollOnce 其实就是一个设置了超时时间的 epoll_wait
        nativePollOnce(ptr, nextPollTimeoutMillis);

        synchronized (this) {
            // Try to retrieve the next message.  Return if found.
            final long now = SystemClock.uptimeMillis();
            Message prevMsg = null;
            Message msg = mMessages;

            // 消息队列的头部有同步屏障
            if (msg != null && msg.target == null) {
                // Stalled by a barrier.  Find the next asynchronous message in the queue.
                // 找出队列中的首个异步消息
                do {
                    prevMsg = msg;
                    msg = msg.next;
                } while (msg != null && !msg.isAsynchronous());
            }
            // 如果有消息
            if (msg != null) {
                // 这个消息还没有到时间，设置一下下轮循环执行的 pollOnce 的超时时间
                if (now < msg.when) {
                    // Next message is not ready.  Set a timeout to wake up when it is ready.
                    nextPollTimeoutMillis = (int) Math.min(msg.when - now, Integer.MAX_VALUE);
                } else {
                    // 这个消息已经到时间了，从消息队列中取出返回
                    // Got a message.
                    mBlocked = false;
                    if (prevMsg != null) {
                        prevMsg.next = msg.next;
                    } else {
                        mMessages = msg.next;
                    }
                    msg.next = null;
                    if (DEBUG) Log.v(TAG, "Returning message: " + msg);
                    msg.markInUse();
                    return msg;
                }
            } else {
                // 队列空了，进入无限期的 epoll_wait 等待
                // No more messages.
                nextPollTimeoutMillis = -1;
            }

            // Process the quit message now that all pending messages have been handled.
            if (mQuitting) {
                dispose();
                return null;
            }

            // 这里是 IdleHandler 相关的内容，先去看看 IdleHandler 这个东西怎么用
            // If first time idle, then get the number of idlers to run.
            // Idle handles only run if the queue is empty or if the first message
            // in the queue (possibly a barrier) is due to be handled in the future.
            // 第一次空闲的时候，记录要运行的 idlehandler 的数量。
            // 空闲处理只在队列为空或第一条消息需要等待一段时间的时候执行
            // 说白了就是在 pollOnce 之前执行
            if (pendingIdleHandlerCount < 0
                    && (mMessages == null || now < mMessages.when)) {
                pendingIdleHandlerCount = mIdleHandlers.size();
            }
            if (pendingIdleHandlerCount <= 0) {
                // 没有 IdleHandler 的情况下单次循环在这里结束
                // No idle handlers to run.  Loop and wait some more.
                mBlocked = true;
                continue;
            }

            // 最大只会执行4个 IdleHandler
            if (mPendingIdleHandlers == null) {
                mPendingIdleHandlers = new IdleHandler[Math.max(pendingIdleHandlerCount, 4)];
            }
            mPendingIdleHandlers = mIdleHandlers.toArray(mPendingIdleHandlers);
        }

        // Run the idle handlers.
        // We only ever reach this code block during the first iteration.
        for (int i = 0; i < pendingIdleHandlerCount; i++) {
            final IdleHandler idler = mPendingIdleHandlers[i];
            mPendingIdleHandlers[i] = null; // release the reference to the handler

            boolean keep = false;
            // 执行
            try {
                keep = idler.queueIdle();
            } catch (Throwable t) {
                Log.wtf(TAG, "IdleHandler threw exception", t);
            }
            // 不保留就删掉
            if (!keep) {
                synchronized (this) {
                    mIdleHandlers.remove(idler);
                }
            }
        }

        // 重制数量
        // Reset the idle handler count to 0 so we do not run them again.
        pendingIdleHandlerCount = 0;

        // 执行了idleHandler就不等待了，因为可能在idleHandler中已经发送了新的消息，重走一遍流程
        // While calling an idle handler, a new message could have been delivered
        // so go back and look again for a pending message without waiting.
        nextPollTimeoutMillis = 0;
    }
}
```

### **native Looper#pollOnce**

```cpp
int Looper::pollOnce(int timeoutMillis, int* outFd, int* outEvents, void** outData) {
    int result = 0;
    for (;;) {
        while (mResponseIndex < mResponses.size()) {
            const Response& response = mResponses.itemAt(mResponseIndex++);
            int ident = response.request.ident;
            if (ident >= 0) {
                int fd = response.request.fd;
                int events = response.events;
                void* data = response.request.data;
#if DEBUG_POLL_AND_WAKE
                ALOGD("%p ~ pollOnce - returning signalled identifier %d: "
                        "fd=%d, events=0x%x, data=%p",
                        this, ident, fd, events, data);
#endif
                if (outFd != nullptr) *outFd = fd;
                if (outEvents != nullptr) *outEvents = events;
                if (outData != nullptr) *outData = data;
                return ident;
            }
        }

        // result != 0 时可以退出
        if (result != 0) {
#if DEBUG_POLL_AND_WAKE
            ALOGD("%p ~ pollOnce - returning result %d", this, result);
#endif
            if (outFd != nullptr) *outFd = 0;
            if (outEvents != nullptr) *outEvents = 0;
            if (outData != nullptr) *outData = nullptr;
            return result;
        }

        // 这里如果返回0的话就要一直跑这个方法，不过我们知道pollInner实际上是不会返回的 (epoll_wait)
        // 所以在这里猜测正常情况下返回就退出循环，只有在某些情况下需要重试?
        result = pollInner(timeoutMillis);
    }
}
```


接下来看看 pollInner，东西真多，我们只关注重点代码


```cpp
int Looper::pollInner(int timeoutMillis) {
#if DEBUG_POLL_AND_WAKE
    ALOGD("%p ~ pollOnce - waiting: timeoutMillis=%d", this, timeoutMillis);
#endif

    // Adjust the timeout based on when the next message is due.
    if (timeoutMillis != 0 && mNextMessageUptime != LLONG_MAX) {
        nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
        int messageTimeoutMillis = toMillisecondTimeoutDelay(now, mNextMessageUptime);
        if (messageTimeoutMillis >= 0
                && (timeoutMillis < 0 || messageTimeoutMillis < timeoutMillis)) {
            timeoutMillis = messageTimeoutMillis;
        }
#if DEBUG_POLL_AND_WAKE
        ALOGD("%p ~ pollOnce - next message in %" PRId64 "ns, adjusted timeout: timeoutMillis=%d",
                this, mNextMessageUptime - now, timeoutMillis);
#endif
    }

    // Poll.
    // result的取值有四种: POLL_WAKE = -1 POLL_CALLBACK = -2 POLL_TIMEOUT = -3 POLL_ERROR = -4
    int result = POLL_WAKE;
    mResponses.clear();
    mResponseIndex = 0;

    // We are about to idle.
    mPolling = true;

    // 创建事件集合eventItems，EPOLL_MAX_EVENTS=16
    struct epoll_event eventItems[EPOLL_MAX_EVENTS];
    // 调用epoll_wait()来等待事件，如果有事件，就放入事件集合eventItems中，并返回事件数量，如果没有，就一直等，超时时间为我们传入的timeoutMillis
    int eventCount = epoll_wait(mEpollFd.get(), eventItems, EPOLL_MAX_EVENTS, timeoutMillis);

    // No longer idling.
    mPolling = false;

    // Acquire lock.
    // 加锁
    mLock.lock();

    // Rebuild epoll set if needed.
    if (mEpollRebuildRequired) {
        mEpollRebuildRequired = false;
        rebuildEpollLocked();
        goto Done;
    }

    // Check for poll error.
    // 如果发生的事件小于0，说明 epoll_wait 出异常了，设置 result 为 POLL_ERROR 后跳转到 Done
    if (eventCount < 0) {
        if (errno == EINTR) {
            goto Done;
        }
        ALOGW("Poll failed with an unexpected error: %s", strerror(errno));
        result = POLL_ERROR;
        goto Done;
    }

    // Check for poll timeout.
    // epoll_wait 超时返回，跳转到 Done
    if (eventCount == 0) {
#if DEBUG_POLL_AND_WAKE
        ALOGD("%p ~ pollOnce - timeout", this);
#endif
        result = POLL_TIMEOUT;
        goto Done;
    }

    // Handle all events.
#if DEBUG_POLL_AND_WAKE
    ALOGD("%p ~ pollOnce - handling events from %d fds", this, eventCount);
#endif

    // 走到这里说明有事件
    for (int i = 0; i < eventCount; i++) {
        // 挨个取出事件进行响应
        const SequenceNumber seq = eventItems[i].data.u64;
        uint32_t epollEvents = eventItems[i].events;
        // 是 wake event
        if (seq == WAKE_EVENT_FD_SEQ) {
            if (epollEvents & EPOLLIN) {
                // 清除 wakeEventFd 的事件循环计数器，以便接收下一次事件
                // 事件文件描述符（如 eventfd）被设置为边缘触发（ET）模式。
                // 这意味着只有在状态发生变化时，epoll 才会返回这个文件描述符的事件。
                // 如果你不读取这个事件，状态就不会改变，所以 epoll 可能不会再次返回这个事件，即使有新的唤醒事件发生。
                awoken();
            } else {
                ALOGW("Ignoring unexpected epoll events 0x%x on wake event fd.", epollEvents);
            }
        } else {
            // 响应其他事件
            const auto& request_it = mRequests.find(seq);
            if (request_it != mRequests.end()) {
                const auto& request = request_it->second;
                int events = 0;
                if (epollEvents & EPOLLIN) events |= EVENT_INPUT;
                if (epollEvents & EPOLLOUT) events |= EVENT_OUTPUT;
                if (epollEvents & EPOLLERR) events |= EVENT_ERROR;
                if (epollEvents & EPOLLHUP) events |= EVENT_HANGUP;
                mResponses.push({.seq = seq, .events = events, .request = request});
            } else {
                ALOGW("Ignoring unexpected epoll events 0x%x for sequence number %" PRIu64
                        " that is no longer registered.",
                        epollEvents, seq);
            }
        }
    }
Done: ;

      // Invoke pending message callbacks.
      // 这里就是处理 native 层的消息，跟 java 层 handler 的逻辑差不多
      // native 层的消息是用 vector 存的
      mNextMessageUptime = LLONG_MAX;
      while (mMessageEnvelopes.size() != 0) {
          nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
          const MessageEnvelope& messageEnvelope = mMessageEnvelopes.itemAt(0);
          // 消息到期
          if (messageEnvelope.uptime <= now) {
              // Remove the envelope from the list.
              // We keep a strong reference to the handler until the call to handleMessage
              // finishes.  Then we drop it so that the handler can be deleted *before*
              // we reacquire our lock.
              { // obtain handler
                  sp<MessageHandler> handler = messageEnvelope.handler;
                  Message message = messageEnvelope.message;
                  mMessageEnvelopes.removeAt(0);
                  mSendingMessage = true;
                  mLock.unlock();

#if DEBUG_POLL_AND_WAKE || DEBUG_CALLBACKS
                  ALOGD("%p ~ pollOnce - sending message: handler=%p, what=%d",
                          this, handler.get(), message.what);
#endif
                  // 回调 native 层 handler 的 handleMessage
                  handler->handleMessage(message);
              } // release handler

              mLock.lock();
              mSendingMessage = false;
              // 这里 result 就是把message回调给了handler
              result = POLL_CALLBACK;
          } else {
              // The last message left at the head of the queue determines the next wakeup time.
              // 设置下条消息到期的时间 并跳出循环等待Java层的下一次轮询
              mNextMessageUptime = messageEnvelope.uptime;
              break;
          }
      }

      // Release lock.
      mLock.unlock();

      // Invoke all response callbacks.
      for (size_t i = 0; i < mResponses.size(); i++) {
          Response& response = mResponses.editItemAt(i);
          if (response.request.ident == POLL_CALLBACK) {
              int fd = response.request.fd;
              int events = response.events;
              void* data = response.request.data;
#if DEBUG_POLL_AND_WAKE || DEBUG_CALLBACKS
              ALOGD("%p ~ pollOnce - invoking fd event callback %p: fd=%d, events=0x%x, data=%p",
                      this, response.request.callback.get(), fd, events, data);
#endif
              // Invoke the callback.  Note that the file descriptor may be closed by
              // the callback (and potentially even reused) before the function returns so
              // we need to be a little careful when removing the file descriptor afterwards.
              int callbackResult = response.request.callback->handleEvent(fd, events, data);
              if (callbackResult == 0) {
                  AutoMutex _l(mLock);
                  removeSequenceNumberLocked(response.seq);
              }

              // Clear the callback reference in the response structure promptly because we
              // will not clear the response vector itself until the next poll.
              response.request.callback.clear();
              result = POLL_CALLBACK;
          }
      }
      return result;
}
```


总体流程其实就是 epoll_wait 拿到事件，处理事件并让 native 层的消息队列取一次消息。


## **面试题**


> 来自蔷神


### **handler大致运转过程**


`Handler#sendMessage` -> `MessageQueue#enqueueMessage` 消息入队 -> 如果消息入队时处于头部，或头部有同步屏障且插入的消息为最早的异步消息则唤醒 Looper `NativeMessageQueue#wake`



Looper 被唤醒后轮询取消息，取到消息后看消息是否过期，如果没有过期就 pollOnce 等待至过期，过期了就出队发给 Handler，直到没有更多消息时 pollOnce 的过期时间被设置为 -1，无限期等待直到有新消息插入。


### **handler消息类型以及每个类型的区别**


同步消息，异步消息，同步屏障


### **同步消息屏障的意义是什么? 通常用来干嘛?**


其实比较类似一些异步任务调度机制的任务偷取（好像内核态的任务调度也有偷取这个机制？）



在消息过多处理不过来的情况下优先处理异步消息，异步消息的异步其实指的就是不按消息队列中消息的顺序执行（毕竟在遇到屏障的时候只处理异步事件，不处理同步事件）



同步屏障用完要记得撤销，不然就再也接收不到同步消息了


### **如果我要发送handler消息，是直接new嘛? 为什么不这样？这样会造成什么影响?**


那肯定不new，使用 `Message.obtain` 从对象池中拿取。如果发送消息都直接new的话会对堆内存造成较大负担，所以才有对象复用机制。


### **idlehandler是什么**


idlehandler 就是在消息队列取空或下一个消息需要等待时即将进入 pollOnce 等待之前回调的一个接口。


```java
public static interface IdleHandler {
    // 返回 false 就会在回调一次后移除
    // 返回 true 则会一直保留
    boolean queueIdle(); 
}
```

### **idlehandler可以用来做哪一类任务**


执行优先级足够低的任务


### **如果我频繁添加idlehandler是否发生anr**


只要 idlehandler 中的处理没有耗时逻辑就不会，每次空闲执行的 idlehandler 不会超过4个。


### **looper的loop是死循环会造成anr嘛？为什么**


不会，因为 loop 进去有消息的时候会处理消息，没有消息的时候会进入 epoll 等待，anr 的原因在于没有及时处理消息。


###  **ANR 的原因**
 - **系统进程(system_server)** 调度，设置定时监控（即埋下炸弹）

 - system_server 进程将任务派发到**应用进程**完成对消息的实际处理(执行任务)

 - 最后，执行任务时间过长，在定时器超时前 system_server 还**未收到任务完成的通知**，触发 ANR（炸弹爆炸）



没有及时处理 system_server 派发的任务，system_server 没有收到任务完成的通知，就触发了 ANR。


### **handler looper messagequeue是怎么个关系一对一还是一对多，多对多**


Looper 跟 MessageQueue 是一对一的关系。MessageQueue 跟 Handler 是一对多的关系。


### **looper和thread是一对一的关系是如何实现的**


使用 ThreadLocal 保存 Looper 实例


### **threadlocal是什么，有用过吗**


ThreadLocal 本质上是保存在 Thread 上面的一张 HashMap，不同之处在与它的键使用 WeakReference 存储，在 set 时会清理 key == null 的键值对。但用完的时候最好手动 remove，不然还是会内存泄漏。使用弱引用只是让 ThreadLocalMap 持有的 ThreadLocal 不会内存泄漏，ThreadLocal 对应的值还是会内存泄漏。


### **messagequeue是什么数据结构**


链表实现的优先队列


### **延迟消息是如何实现的**


消息队列是一个优先队列，插入时进行排序。插入时如果消息处于头部，且事件队列处于等待状态就唤醒它，Looper 拿了头部的消息就会 `pollOnce` 等待这个消息需要等待的时间后再将消息出队传递给 Handler。如果有队列顶部有同步屏障的话，最早的异步消息将会进行唤醒处理。



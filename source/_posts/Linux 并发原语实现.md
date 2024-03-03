---
title: Linux 并发原语实现
urlname: QJR7dadPhoMef5xUVacc8mVqnGg
date: 2024-03-03T10:49:16.000Z
updated: '2024-03-03 10:50:00'
tags:
  - linux
  - libc
  - xv6
  - 并发
categories: 笔记
---
## 起因
之前听到群里有人在问条件变量的实现，发现自己对这方面一无所知。
![image](images/OYlxbkXGfo4geHxkLPicyw8Wnke.jpeg)
## 先复习一下 xv6
内核中用到了两种锁，自旋锁和睡眠锁。
### 自旋锁
先看看实现
```c
// Acquire the lock.
// Loops (spins) until the lock is acquired.
void
acquire(struct spinlock *lk)
{
  push_off(); // disable interrupts to avoid deadlock.
  if(holding(lk))
    panic("acquire");

  // On RISC-V, sync_lock_test_and_set turns into an atomic swap:
  //   a5 = 1
  //   s1 = &lk->locked
  //   amoswap.w.aq a5, a5, (s1)
  while(__sync_lock_test_and_set(&lk->locked, 1) != 0)
    ;

  // Tell the C compiler and the processor to not move loads or stores
  // past this point, to ensure that the critical section's memory
  // references happen strictly after the lock is acquired.
  // On RISC-V, this emits a fence instruction.
  __sync_synchronize();

  // Record info about lock acquisition for holding() and debugging.
  lk->cpu = mycpu();
}

// Release the lock.
void
release(struct spinlock *lk)
{
  if(!holding(lk))
    panic("release");

  lk->cpu = 0;

  // Tell the C compiler and the CPU to not move loads or stores
  // past this point, to ensure that all the stores in the critical
  // section are visible to other CPUs before the lock is released,
  // and that loads in the critical section occur strictly before
  // the lock is released.
  // On RISC-V, this emits a fence instruction.
  __sync_synchronize();

  // Release the lock, equivalent to lk->locked = 0.
  // This code doesn't use a C assignment, since the C standard
  // implies that an assignment might be implemented with
  // multiple store instructions.
  // On RISC-V, sync_lock_release turns into an atomic swap:
  //   s1 = &lk->locked
  //   amoswap.w zero, zero, (s1)
  __sync_lock_release(&lk->locked);

  pop_off();
}
```
可以看出自旋锁是基于指令集提供的原子 compare and swap 操作实现的，如果存在锁竞争的情况，没有获取到锁的一侧会自旋等到锁的释放。
### 睡眠锁
```c
void
acquiresleep(struct sleeplock *lk)
{
  acquire(&lk->lk);
  while (lk->locked) {
    sleep(lk, &lk->lk);
  }
  lk->locked = 1;
  lk->pid = myproc()->pid;
  release(&lk->lk);
}

void
releasesleep(struct sleeplock *lk)
{
  acquire(&lk->lk);
  lk->locked = 0;
  lk->pid = 0;
  wakeup(lk);
  release(&lk->lk);
}

// Atomically release lock and sleep on chan.
// Reacquires lock when awakened.
void
sleep(void *chan, struct spinlock *lk)
{
  struct proc *p = myproc();
  
  // Must acquire p->lock in order to
  // change p->state and then call sched.
  // Once we hold p->lock, we can be
  // guaranteed that we won't miss any wakeup
  // (wakeup locks p->lock),
  // so it's okay to release lk.

  acquire(&p->lock);  //DOC: sleeplock1
  release(lk);

  // Go to sleep.
  p->chan = chan;
  p->state = SLEEPING;

  sched();

  // Tidy up.
  p->chan = 0;

  // Reacquire original lock.
  release(&p->lock);
  acquire(lk);
}

// Wake up all processes sleeping on chan.
// Must be called without any p->lock.
void
wakeup(void *chan)
{
  struct proc *p;

  for(p = proc; p < &proc[NPROC]; p++) {
    if(p != myproc()){
      acquire(&p->lock);
      if(p->state == SLEEPING && p->chan == chan) {
        p->state = RUNNABLE;
      }
      release(&p->lock);
    }
  }
}
```
也很简单，通过自旋锁确保修改锁状态操作的原子性。发现存在竞争就直接 sleep，拿到锁的 routine 在释放锁时会修改同一条 channel 上（就是在等待同一把睡眠锁的进程）的进程的 pcb 状态到 runnable 等待内核调度。

可以看出这里的实现相当类似于 condition variable。
## Mutex 实现
我们看看 musl 中 pthread mutex api 的实现
### pthread_mutex_lock
这里我只研究默认情况下的链路 `PTHREAD_MUTEX_NORMAL`
```c
int __pthread_mutex_lock(pthread_mutex_t *m)
{
    if ((m->_m_type&15) == PTHREAD_MUTEX_NORMAL
        && !a_cas(&m->_m_lock, 0, EBUSY))
        return 0;

    return __pthread_mutex_timedlock(m, 0);
}

int __pthread_mutex_timedlock(pthread_mutex_t *restrict m, const struct timespec *restrict at)
{
    if ((m->_m_type&15) == PTHREAD_MUTEX_NORMAL
        && !a_cas(&m->_m_lock, 0, EBUSY))
        return 0;

    int type = m->_m_type;
    int r, t, priv = (type & 128) ^ 128;

    r = __pthread_mutex_trylock(m);
    if (r != EBUSY) return r;

    if (type&8) return pthread_mutex_timedlock_pi(m, at);
    
    int spins = 100;
    while (spins-- && m->_m_lock && !m->_m_waiters) a_spin();

    while ((r=__pthread_mutex_trylock(m)) == EBUSY) {
        r = m->_m_lock;
        int own = r & 0x3fffffff;
        if (!own && (!r || (type&4)))
            continue;
        if ((type&3) == PTHREAD_MUTEX_ERRORCHECK
            && own == __pthread_self()->tid)
            return EDEADLK;

        a_inc(&m->_m_waiters);
        t = r | 0x80000000;
        a_cas(&m->_m_lock, r, t);
        r = __timedwait(&m->_m_lock, t, CLOCK_REALTIME, at, priv);
        a_dec(&m->_m_waiters);
        if (r && r != EINTR) break;
    }
    return r;
}
```
就是维护了一个 waiter list，跟 xv6 睡眠锁的实现其实并没有很大区别
## Condition Variable 实现
比较古早的实现是每个条件变量维护一个 waiter list，利用信号唤醒进程（linuxthreads）

Musl 的实现是直接使用 [futex](https://man7.org/linux/man-pages/man2/futex.2.html) 系统调用，使用信号唤醒线程的开销不可谓不大，将实现移到内核中再封装成系统调用会好不少。
![image](images/FckhbLAWmoLDFoxJqrrcp0QYnIg.png)
![image](images/QnT9bKtwBoM6xuxERfac2lmjnvf.png)


---
title: Chain Replication & CRAQ
urlname: Y8eRda3eJocn3TxUGMIcCz4unXb
date: '2025-07-26 23:10:31'
updated: '2025-07-26 23:11:39'
mathjax: true
tags:
  - 分布式系统
  - 论文阅读
---
## Chain Replication
论文原文：https://pdos.csail.mit.edu/6.824/papers/cr-osdi04.pdf

译文：https://zhuanlan.zhihu.com/p/533384629
![image](images/LB2ybEoP0osyYpx9YfGc2Hrtn4b.png)
## CRAQ (Chain Replication with Apportioned Queries)
论文原文：http://nil.csail.mit.edu/6.824/2020/papers/craq.pdf

译文：https://zhuanlan.zhihu.com/p/539352802

Chain Replication 存在以下问题:
- Chain tail节点容易成为热点，虽然可以采用多链分区复制方式，减小热点问题的影响，但在极端情况下，比如：频繁访问某个object，热点问题仍然存在。

- 不适用于跨数据中心复制的应用场景。

CRAQ 主要解决的问题：
- 优化链式复制办法，允许从任意chain node读取数据，且保证强一致性。

- 在以下场景中提供最终一致性保证：i）在写冲突期间保证低时延读，ii）在[网络分区](https://zhida.zhihu.com/search?content_id=207989631&content_type=Article&match_order=1&q=%E7%BD%91%E7%BB%9C%E5%88%86%E5%8C%BA&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NTM1ODIzNzksInEiOiLnvZHnu5zliIbljLoiLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjoyMDc5ODk2MzEsImNvbnRlbnRfdHlwZSI6IkFydGljbGUiLCJtYXRjaF9vcmRlciI6MSwiemRfdG9rZW4iOm51bGx9.m8K-hkS3eTarLrTUJVVol0zk4Ci9c73TJ1MP0pb2TFs&zhida_source=entity)期间降级为只读，允许应用程序指定最大可接受的过期时间。

- 构建geo-replicated CRAQ，支持跨地域复制，提供地域属性，[读操作](https://zhida.zhihu.com/search?content_id=207989631&content_type=Article&match_order=1&q=%E8%AF%BB%E6%93%8D%E4%BD%9C&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3NTM1ODIzNzksInEiOiLor7vmk43kvZwiLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjoyMDc5ODk2MzEsImNvbnRlbnRfdHlwZSI6IkFydGljbGUiLCJtYXRjaF9vcmRlciI6MSwiemRfdG9rZW4iOm51bGx9.Jqsf6Th6z7cwrp8wQH1oRgiLbf8C0keVc-zY5VEVYq8&zhida_source=entity)由本地集群处理。

![image](images/KI32bn357oVI1SxVvpocgy2Jnwd.png)
### Extension
#### Mini-transcation
> 单 key 操作
- Prepend/Append：在object的头部/尾部添加数据

- Increment/Decrement：递增/递减数据

- Test-and-set：只有在目标版本等于指定版本时才执行更新操作

对于 Prepend/Append/Increment/Decrement，可以基于HEAD的最新版本稍作修改后沿链传递，如果此类请求比较频繁，可以做一下 batching。

Test-and-set 则针对单个 key 的修改保证原子性，如果版本不同则拒绝，相比 Two-Phase Commit 实现的事务要更加轻量。

> 单 chain 操作

> Mini-transaction提供一种轻量级办法，用于支持单chain内的多keys事务操作。一个mini-transaction定义为compare/read/write操作序列，compare操作比较目标值是否等于给定的值，若相等则执行read和write操作。该办法主要是针对低写入冲突应用场景而设计，因此，mini-transaction采用乐观的2PC协议。Prepare阶段尝试获取所有目标的锁，只有成功锁定，才可以执行事务commit，否则释放锁并延后重试。  
> CRAQ在支持mini-transaction方面有着特殊优势，应用程序可以将多个相关的objects保存在同个chain中_（局部性）_。具有相同chainid的objects保存在同个chain中，只涉及单个HEAD节点，因此，2PC可以减少到只需一次交互_（prepare阶段只需向HEAD节点获取锁即可）_。CRAQ的独特之处在于，mini-transaction只涉及单chain，可以HEAD节点作为协调者，协调事务过程。该机制对于写入吞吐量有一定影响，HEAD节点需要等待事务完成并释放锁（破坏pipeline执行方式）。

> 多 chain 操作  
> 在跨多个chain的多object事务中，2PC也只需要各个chain的HEAD节点参与，不涉及chain中其他节点。  
> 尽量避免多chain事务操作_（最好限制在单chain内）_，该操作会破坏CRAQ的pipeline机制，严重降低写入吞吐量。
#### Multicast
写入请求和 ack 可以不顺着链条传递，而是多播，这样就提高了写入后的读性能（强一致的情况下），在链条长或写入的 object 很大的情况下这个优化非常有用。

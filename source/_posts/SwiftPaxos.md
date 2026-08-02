---
title: SwiftPaxos
urlname: MWEdduYzeoflbWxVqSkcz5IjnId
date: '2025-12-04 01:38:27'
updated: '2026-08-03 00:13:44'
tags:
  - 分布式系统
  - 论文阅读
  - 笔记
---
[SwiftPaxos Fast Geo-Replicated State Machines](https://octochords.com/posts/swiftpaxos/)
## 算法细节
![image](images/Ekrcb5oG9oYBNax1gKpcXdEanch.png)
- Client 向所有节点广播 Cmd，这里注意，Client 本身也是一个节点

- 单个节点收到 Cmd 后会向其他节点广播 FastAck，其中包含自己收到 Cmd 的依赖路径
	- 比如图一，我发送了一条指令 z，对于节点 p1，p2 ，xy 都在 z 的前面，所以 p1，p2 中 z 的依赖路径都是 `{x, z}, {y, z}`。但是对于 p3 节点来说依赖路径只有 `{y, z}`，所以在 fast path 节点 client3 并不难达成共识，因为没有达到 Fast Quorum (2/3 < 3/4)
		- 在 SwiftPaxos 中，依赖关系保证不成环
	
- Leader 节点收到 Cmd 后也会向其他节点广播 FastAck，这条 FastAck 同时也是 Leader 的 SlowAck，收到这条消息的节点会跟从 Leader 广播跟 Leader 相同的 SlowAck

- 客户端如果收到了 Fast Quorum （3/4）个相同的 FastAck，且其中包含来自 Leader 的 FastAck，则可以提交这条消息（Fast Path，只需 Cmd FastAck 两条消息的延迟即可达成共识）

- 如果客户端收到了 Slow Quorum（1/2）个相同的 SlowAck，则可以提交这条消息（Slow Path，需要 Cmd FastAck SlowAck 三条消息的延迟才能达成共识）

- Slow path 不一定比 Fast path 慢，因为 Slow path 要求的 Quorum 数量更小，这样在部分节点通信延迟很高的情况下有可能比 Fast path 更快

## Addition
- Slow path 需要 3 次 RPC 的延迟，而经典 Paxos 算法需要 4 次，这保证了 SwiftPaxos 的下限——至少比经典 Paxos 快，事实上如果只看 Slow path 这就是 Paxos 的一种广为人知的变种。

- 论文原文也介绍了各种 Paxos 的衍生算法和它们的实现思路，比如 EPaxos，FastPaxos。可以通过阅读这篇论文来了解改进 Paxos 算法的历史沿革，非常值得一看。



---
title: CS242笔记 - Algebraic data types
urlname: SgTTdZLKIoPYfVxfp3tc11BLnsb
date: '2026-08-03 00:10:06'
updated: '2026-08-03 00:12:27'
tags:
  - 笔记
  - PL
---
## ADT theory
> “代数数据类型（ADT）是在简单类型 λ-演算（或系统 F）的基础上，通过引入积类型（Product）与和类型（Sum）的组合，并允许递归定义（µ），从而构造出结构化数据的一种类型系统扩展。它本质上是范畴论中的初始代数（Initial Algebra），对应逻辑学中的归纳类型。”
### Product types
比如 pair 类型，本质上是把两个类型做了乘积。比如类型 L 包含 n 种值，而类型 R 包含 m 种值，则 pair (L, R) 则包含 n * m 种值，所以 pair / struct 被称作值类型。

下图给出了 Pair 语法的定义，访问 pair 中元素的操作被称作 projection（投影）。
![image](images/WNypb6YTNoBVCtxTeNJcpulSnjh.png)
比如：
![image](images/Xq5qbfzMDoq8lmxrjOlcdRCTnYb.png)
静态语义和动态语义的定义如下图：
![image](images/PbDOb7ZJ9omfVIxmj4rcup92nof.png)
![image](images/X8owbu7oKodMoOxKWQsci3DFnTN.png)
### Sum types
比如枚举类型，既可能是类型 A，又可能是类型 B。至于为什么叫他和类型也很好理解，假如 A 类型有 A 种值，B 类型有 B 种值，则 A + B 类型有 A + B 种值。

下面给出了类似 rust enum match 语法的语法定义：
![image](images/B82abym1VoIr10x0RyLcJg96nIg.png)
比如：
![image](images/ZYZibuX4BoYbM5xFRW5cl0Mcntc.png)
静态语义和动态语义定义如下：
![image](images/ABEAbU18TojUOexDE8scNLOEn3f.png)
![image](images/Zdr9boZBxo48Iqx5j2RcNRmGnIK.png)
## Algebra of ADTs
和类型和积类型具有跟普通整数类似的代数性质，即可以进行加法运算和乘法运算。

那么为了充分发展这一代数体系，我们需要引入 “0” 和 “1”，即包含 0 种类型的类型 “void” 和只包含 1 种类型的类型 “unit”:
![image](images/FP0KbllRioQ1GzxQNSgcwUVqncg.png)
所以任意类型乘以 unit 等于这个类型本身，任意类型加上 void 也等于这个类型本身：
![image](images/NnEWbtMj1owzO8xslR3cJs2vn2X.png)
同时，和类型与积类型的运算符也跟整数运算一样，遵循交换律，结合律和分布律：
![image](images/EfV0bWCzToMAeTxtkoLcK8jNnic.png)


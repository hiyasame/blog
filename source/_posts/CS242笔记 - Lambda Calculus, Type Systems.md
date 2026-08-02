---
title: 'CS242笔记 - Lambda Calculus, Type Systems'
urlname: XIsZdSA4Sosxe6xutoLc9Jdknqc
date: '2026-08-03 00:09:49'
updated: '2026-08-03 00:12:01'
tags:
  - 笔记
  - PL
---
https://stanford-cs242.github.io/f19/
## Lambda Calculus
- 自由变量 (Free Variables): 外层 lamdba 函数没有声明的变量

- Closed Term / Conbinator: 没有自由变量的 term

- Alpha Conversion: 参数别名的修改，例如 `λx. x` 等价于 `λy. y`

- Beta Reduction: apply 参数时将参数代入到 function body 中
	- 例如 `(λx. t12) t2 → [x → t2] t12`，其中 `[x → t2] t12` 表示把 t12 中所有的 x 替换成 t2
	
- 替换 (Substitution) 必须避免自由变量捕获
	- 如果函数内存在和参数同名的变量，则需要先对 function 做 alpha conversion 来避免冲突
		- 例：`[x → y] (λy. x)` → 先重命名 `λz. x → λz. y`（正确）。如果直接替换得 `λy. y` 就错了
	
- [Church Encoding](https://en.wikipedia.org/wiki/Church_encoding)

- Currying：即通过单参数函数嵌套返回的形式编码多参数函数，例如 `λx. λy. x y`

- 求值策略
	- 完全β-规约（Full Beta-Reduction）：任何位置的 redex 都可以先归约，无顺序限制
		- 标准化归约（Normal Order）：总是归约最左、最外的 redex——保证找到范式（如果存在的话）
		- 传名调用（Call-by-Name, CBN）：参数在被使用时才求值（不先求参数）。`(λx. t) t2` 直接替换，t2 不先求值
		- 传值调用（Call-by-Value, CBV）：先求值参数到值，再替换。`(λx. t) v2` 只允许 v2 为值时替换。这是大多数编程语言和本书使用的策略
	
- 递归与不动点
	- [Y Combinator](https://blog.coldrain.ink/2024/09/18/YL0xd3o8NoQWRpxm7aNcKzocn8b/)
	
## Type Systems
类型系统是一种在运行前自动检查代码中某些 invariant 是否永远成立的机制
### Simply Typed Lambda Calculus
![image](images/QHHfbGHvLoCD3cxoOO5cpxI6nhg.png)
![image](images/KOnnbyAkMonBcdxkq0lcMfNLnPe.png)
如何进行类型推导？下面以整数的加减运算为例，定义一套规则：
![image](images/TJx7bZiQZoEEAfxBWbKcsTl7ngh.png)
![image](images/V7eybjMTYoBzkAx1fBcczPYjnrc.png)
下面将上面这套范式推广到 typed lambda calculus：
![image](images/PoW8bLhNFojTESxua1dcEe8NnQg.png)
![image](images/QtThblDcoo0z7Dx4Ft0cY6Nynxe.png)
### Type Safety
类型系统的目标是提供一种 "well-defined" 的判定准则，使得我们能在不执行程序的情况下证明其是否 "well-defined"。如果说一个 expression 有类型，则说明它是 "well-defined" 的。

所以我们可以尝试将 type safety 写成以下定理：

> _Type safety (strict):_ for all expressions e, if e:τ, then ∃e′ such that e↦∗e′ and e′ val.

并且我们可以进一步把这个定理拆解成两个定理：
1. Progress: if e:τ then either e val or there exists e′ such that e↦e′. 即一定能推导出一个具体的类型

1. Preservation: if e:τ and e↦e′, then e′:τ. 即推导过程中类型不会发生改变，比如 int + int 不会算出来一个 long

如果只有 progress，不保证 preservation：能一直推导下去，但是中途类型会发生改变，比如算一个整数运算表达式，最后得出来/加上去了一个 bool，这个肯定是不允许的

如果只有 preservation，不保证 progress：可能直接推导不出来类型，卡在中间状态
#### Proving Type Safety
用归纳法分别证明 Process 和 Preservation 即可，即分别证明下面的每一条规则满足 Process 和 Preservation：
![image](images/LR0KbqEp0okDzfxtkMoc7pkFnUg.png)
每条规则可以做归纳假设，可以先假定 P(n) 成立，再用 P(n) 成立这个假设去证 P(n+1) 成立，这样就可以证明 P(n) 成立。
![image](images/VjThb9AdWo0D97x8EFxcY2UinAe.png)
![image](images/ZzLCbji8Lo2K4bxa5CLcPgBBnnd.png)


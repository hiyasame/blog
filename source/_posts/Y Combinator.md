---
title: Y Combinator
urlname: YL0xd3o8NoQWRpxm7aNcKzocn8b
date: '2024-09-18 13:34:32'
updated: '2024-09-18 13:39:21'
tags:
  - fp
  - lisp
  - lambda calculus
---
**TL;DR**
- combinator 函数必须不含自由变量，combinator 之间可以组合

- Y combinator 解决了匿名函数不能递归调用自身的问题 （在不能给函数命名的 lambda caculus 中也可以递归了）

## What is Combinator?
> A combinator is just a lambda expressions with no free variables.
```lisp
(lambda (x) x) ✅
(lambda (x) y) ❌
(lambda (x) (lambda (y) x)) ✅
(lambda (x) (lambda (y) (x y))) ✅
(x (lambda (y) y)) ❌
((lambda (x) x) y) ❌
```
所以一般的递归函数都不是 combinator
```lisp
 (define factorial
    (lambda (n)
        (if(= n 0)
        1
        (* n (factorial (- n 1)))))
```
factorial 是自由变量，那么如何解决这个问题？只要再套一层 lambda 把这个 factorial 给变成参数就可以了，一种很自然的想法
```lisp
(define almost-factorial
    (lambda (f) 
        (lambda (n) 
            (if (= n 0)
            1
            (* n (f (- n 1))))))
```
虽然它变成了一个 combinator，但是应当传入什么函数作为 f ？应当传入这个匿名 lambda 函数自身，但这似乎是做不到的。这个时候我们就需要一个算子 Y 来帮助我们做到这件事
```lisp
(define factorial (Y almost-factorial))
```
## Fixed Point
首先我们观察一下下面的优先次数递归的递归函数
```lisp
(define identity (lambda (x) x))
(define factorial0 (almost-factorial identity))
```
$$factorial0(0) = 0$$


$$factorial0(1) = 0$$


显然参数传入 1 时答案是不对的，我们再套一层：
```lisp
(define factorial1 (almost-factorial factorial0))
=>
(define factorial1 
    (almost-factorial 
        (almost-factorial identity)))
```
$$factorial(0) = 0$$


$$factorial(1) = 1$$


$$factorial(2) = 0$$


这时虽然 1 的答案对了，但是对于 1 以上的答案仍然不对。keep going:
```lisp
(define factorial2 (almost-factorial factorial1))
(define factorial3 (almost-factorial factorial2))
(define factorial4 (almost-factorial factorial3))
(define factorial5 (almost-factorial factorial4))
etc.
```
可以观察到 `almost-factorial` 吃掉一个不那么完美的 factorial 函数，吐出了一个更好的 factorial 函数。

只要我们可以拥有一个无限嵌套下去的 `factorial♾️` 函数，它就等价于常规的递归函数 factorial，that's what we want. 有一种说法是 factorial 就是 almost-factorial 的 fixed point (不动点)。

**什么是 fixed point**

$$y = f(x)$$


$$y = f(f(x))$$


$$y = f(f(f(f(f(x)))))$$


...

最后函数一定会收敛到一个不动点，此时 $$y = f(y)$$


fixed point 也可以是函数本身
## What is Y?
> Y is also known as fixed point combinator

那么了解了 fixed point 是什么之后，我们再回头来看 Y 是一个什么东西
```lisp
(define factorial (Y almost-factorial))
```
Y 吃掉了一个函数，并且吐出了这个函数的 fixed point（也是一个函数）。
## Y implementation
既然我们已经明确了 Y 是一个不定点求值器，在不强求 combinator 定义的情况下我们可以轻松的用递归实现：
```lisp
(define Y 
    (lambda (f)
        (f Y (f))))
        
(define factorial (Y almost-factorial))
```
按我的想法来说只要无限递归就可以了，但是因为不是 lazy evaluation，所以会无限递归爆栈，所以这个实现需要稍微修改一下：
```lisp
(define Y
    (lambda (f) 
        (f (lambda (x) ((Y f) x)))))
        
(define factorial (Y almost-factorial))
=>
(define factorial
    (lambda (f) (f (lambda (x) ((Y almost-factorial) x))) almost-factorial))
=>
(define factorial
    (almost-factorial (lambda (x) ((Y almost-factorial) x))))
=>
(define factorial
    (lambda (n) 
        (if (= n 0)
            1
            (* n ((lambda (x) ((Y almost-factorial) x)) (- n 1))))))
```
使用 lambda 函数来延迟计算即可。

在 applicative-order 的程序中可以利用 lambda 函数实现延迟展开

`(lambda (x) ((Y almost-factorial) x))` 等价于 `(Y almost-factorial)`，只是求值的时机被延后了。
## Y combinator implemention
> Note that Y in this definition is free; it isn't the bound variable of any lambda expression. So this is not a combinator.

所以我们需要一个没有自由变量的 combinator 版本 Y。

回想一下之前提到的 factorial 的例子，不显式的使用递归实现的一种方法是直接将函数自身作为参数传入
```lisp
(define (part-factorial self n) 
    (if (= n 0)
        1
        (* n (self self (- n 1)))))
        
 (part-factorial part-factorial 5) ==> 120
```
这样的写法的确符合一个 combinator 的标准，虽然这样的做法不适用于 lambda calculus（lambda calculus 没有命名）

稍微改写一下，让其更加接近原本的写法
```lisp
(define (part-factorial self)
    (lambda (n)
      (if (= n 0)
          1
          (* n ((self self) (- n 1))))))

  ;; ((part-factorial part-factorial) 5) ==> 120
  ;; (define factorial (part-factorial part-factorial))
  ;; (factorial 5) ==> 120
  
(define (part-factorial self)
    (lambda (f) 
        (lambda (n) 
            (if (= n 0)
                1
                (* n (f (- n 1))))) (self self)))
                
  ;; 到这里发现 almost-factorial 的实现内嵌在 part-factorial 内部              
  (define almost-factorial
    (lambda (f)
      (lambda (n)
        (if (= n 0)
            1
            (* n (f (- n 1)))))))

  (define (part-factorial self)
    (almost-factorial
      (self self)))
      
(define factorial
    (let ((part-factorial (lambda (self) 
                            (almost-factorial 
                              (self self)))))
      (part-factorial part-factorial)))
 
;; (factorial 5) ==> 120
```
最终化简形式
```lisp
  (define almost-factorial
    (lambda (f)
      (lambda (n)
        (if (= n 0)
            1
            (* n (f (- n 1)))))))

  (define factorial
    ((lambda (x) (x x))
     (lambda (x) 
       (almost-factorial (x x)))))

  ;; (factorial 5) ==> 120
```
然后发现实现递归的这段逻辑是可以抽出来的，不需要与 almost-factorial 耦合
```lisp
  (define almost-factorial
    (lambda (f)
      (lambda (n)
        (if (= n 0)
            1
            (* n (f (- n 1)))))))

  (define (make-recursive f)
    ((lambda (x) (x x))
     (lambda (x) (f (x x)))))

  (define factorial (make-recursive almost-factorial))

;;  (factorial 5) ==> 120
```
容易发现 make-recursive 实际就是 Y combinator
```lisp
 (define Y 
    (lambda (f)
      ((lambda (x) (x x))
       (lambda (x) (f (x x))))))
```
接下来化简证明一下
```lisp
;; 证明这个式子就说明这是一个有效的 Y Combinator
;; (Y f) = (f (Y f))
  (Y f)

  = ((lambda (x) (f (x x)))
     (lambda (x) (f (x x))))
     
  = (f ((lambda (x) (f (x x)))
        (lambda (x) (f (x x)))))

  = (f (Y f))
```
接下来我们需要加上惰性求值使得其可以在 applicative-order 生效
```lisp
  (define Y 
    (lambda (f)
      ((lambda (x) (x x))
       (lambda (x) (f (lambda (y) ((x x) y)))))))
```
于是我们就得到了一个 Y combinator，自此在 lambda calculus 中也可以递归了。再结合 [Church encoding](https://en.wikipedia.org/wiki/Church_encoding) 便可以做很多事情了，以至于可以用 lambda calculus 模拟 turing machine 以此来证明二者的计算能力等价，图灵完备！

$$Y = \lambda f.\left((\lambda x.f (x\ x))\ (\lambda x.f (x\ x))\right)$$

## 参考
[[计算本质] Y Combinator_哔哩哔哩_bilibili](https://www.bilibili.com/video/BV1Wp4y1m7Ny/?vd_source=b9b273d25c653eeef7109b91cd195e71)

[The Y Combinator (Slight Return)](https://mvanier.livejournal.com/2897.html)

[不动点组合子 - wikipedia](https://en.wikipedia.org/wiki/Fixed-point_combinator)



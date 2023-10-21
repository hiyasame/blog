---
title: 解决 bear 在 MacOS 中生成空 compile_commands.json
date: 2023-10-21 17:50:29
tags: [xv6, 编译]
---

在做到 xv6 的最后一个 lab 时，我终于忍受不了满屏的爆红，着手开始配置代码高亮。参考  https://zhuanlan.zhihu.com/p/501901665 配置 Intellisense，然后我遇到了一个问题：

> make clean && bear — make qemu 生成空 compile_commands.json

我 google 查了一下，目前没有中文博客提到这个问题。我在 Bear 的 issue 下发现[这个问题](https://github.com/rizsotto/Bear/issues/463)已经老生常谈了，因为 linux 和 macos 下 bear 的工作原理不同：

> For your problem, here is a little background information... Bear works differently on Linux and Mac. On Linux it intercept the process executions with a preloaded shared object. This trick does not work on Mac. Instead it use compiler wrapper, which reports the process executions... The compiler wrapper interposing only works with builds, which are open to override the compiler.

所以其实在 mac 上，bear 预先准备了一系列常用编译器的wrapper。

![1](https://persecution-1301196908.cos.ap-chongqing.myqcloud.com/image_bed1.png)

因为 xv6 使用的编译器是 `riscv-unknown-elf-gcc` , 没有预置它的 wrapper。所以我们需要手动创建它：

```bash
ln -s /opt/homebrew/Cellar/bear/3.1.3_7/lib/bear/wrapper \\
/opt/homebrew/Cellar/bear/3.1.3_7/lib/bear/wrapper.d/riscv-unknown-elf-gcc
```

然后 bear 就可以正常工作了:D

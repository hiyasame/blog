---
title: Android 搞机常用工具原理
urlname: AXWndCl5UoLMFmxCZkZcdfIqngg
date: '2026-01-27 21:54:26'
updated: '2026-01-27 21:55:46'
tags:
  - Magisk
  - KernelSU
  - Zygisk
  - Lsposed
  - Android
  - 搞机
---
## Magisk
![image](images/S417bujKVohaT8x8s5PcjrzcnKe.png)
Magisk 获取 root 权限是纯用户态实现的：通过修改 boot.img，替换 init 文件为自己的 magiskinit。magiskinit 会启动 magiskd，由于 magiskd 由 init 进程启动，所以它继承了 init 进程的 root 权限。并且由于 init 负责对 selinux policy 进行加载，所以替换 init 文件可以对其进行挟持，使其对特定的域放行（magisk域）。

Magisk 中 `/system/bin/su` 是一个确实的文件，app 调用 su 后并不会把 app 的域进行提升，而是会由 magiskd 来启动一个 magisk 域的 shell，将其输入输出通过 socket 转发给 app。

Magisk 默认所有 app 都能看到 su 文件。虽然 app 可能不在 allow list 里，无法提权，但是可以通过这种简单的手段就检测出来 magisk 的痕迹。于是 magisk 有了 denylist，在 denylist 中的 app 启动时将 `/system/bin/su` unmount 以瞒过检测（使用 mount namespace，app 使用独立的挂载表，其他进程看不到这次 unmount 操作）。然而这还是黑名单，需要用户手动去调整 denylist，所以还是不安全。

由于 Magisk 框架设计之初并没有考虑隐藏的需求，所以后面有了很多用于隐藏 root 痕迹的模块，目前最常用的 Shamiko。出于安全攻防原因这个模块并没有开源，并且只在开发者们的 telegram 小群中分发。

Magisk 同时也能加载第三方模块，添加/覆盖/删除 `/system/` 文件夹下的系统文件。在 magiskinit 执行 init 之前执行所谓的 magic mount：其实就是 `mount --bind` 来将第三方模块中的文件挂载到指定的文件夹下（一般是 `/system/` 目录下的文件）。
## KernelSU
![image](images/NC05bhWKyoXbDMxaeylc6UiNnFf.png)
KernelSU 顾名思义，它是通过修改内核态代码来方便 app 获取 root 权限的，方法跟 magisk 一样是修改 boot.img，但是修改的部分是内核。原理就是修改内核代码接管了 execve 系统调用和 fstat 系统调用，这样就能控制白名单中 app 可以看到并访问 `/system/bin/su` ，但实际这个文件是不存在的。

执行 `/system/bin/su` 后，如果应用在白名单中，则通过修改内核中的结构体 `cred` 将 uid 修改为 1，并且修改 selinux context 为 `su`。并且将 `/system/bin/su` 路径替换为 ksud 的文件路径（这个 ksud 文件路径需要 root 权限才能访问），ksud 启动一个 shell，而此时 app 已经有了 root 权限，所以这是一个 root shell。

跟 Magisk 一样，KernelSU 也能加载第三方模块，来添加/覆盖/删除 `/system/` 目录下的文件。原理是 linux 的 OverlayFS，它可以将文件夹进行合并。并且 KernelSU 可以在内核层控制，让非白名单进程在 fork 出来时，直接处于一个没有挂载 OverlayFS 的 Mount Namespace 中。这样非白名单进程就看不见模块那一层（layer），app 看见的就是干净的 `/system/` 文件夹。

KernelSU 客户端跟内核通信的方式是挟持 reboot 系统调用，然后约定了一个魔数，如果能对上的话会写回一个 fd。之后就可以通过 ioctl 这个 fd 通信了。感觉这里是一个比较薄弱的地方，因为开源版本的魔数是写死的，所以可以通过这个方法检测是否安装了 KernelSU。

由于核心流程都在内核中完成，所以 KernelSU 的特征相较于 Magisk 较少。如果只装 KernelSU 的话，白名单以外的app 几乎没什么办法检测到 KernelSU 的特征，这也是 KernelSU 相较于 Magisk 的先进之处。
## Zygisk

不同于前面两个 root 框架，Zygisk 是 Magisk 内置的 hook 框架，提供 Zygote fork 操作的回调，使得开发者可以在 app 开始执行之前做一些事情（比如前面提到的对在黑名单中的应用 unmount su）。

Magisk 官方内置的 Zygisk 版本中，Zygisk 是通过 magiskd 修改 `ro.dalvik.vm.native.bridge` 为 `libzygisk.so` 然后在 Zygote 进程启动时被加载的。（通过修改 init.rc，使其监听自定义 property 变化，发生变化时重启 zygote，来保证 zygote 一定在 magiskd 之后加载，也保证了 zygisk 一定被加载）。

Zygisk 被加载后会在 Zygote 进程 PLT hook 几个 libc 函数，这样 zygote fork 出来的所有进程都会被 hook：
```cpp
void HookContext::hook_plt() {
    ino_t android_runtime_inode = 0;
    dev_t android_runtime_dev = 0;
    ino_t native_bridge_inode = 0;
    dev_t native_bridge_dev = 0;

    for (auto &map : lsplt::MapInfo::Scan()) {
        if (map.path.ends_with("/libandroid_runtime.so")) {
            android_runtime_inode = map.inode;
            android_runtime_dev = map.dev;
        } else if (map.path.ends_with("/libnativebridge.so")) {
            native_bridge_inode = map.inode;
            native_bridge_dev = map.dev;
        }
    }

    PLT_HOOK_REGISTER(native_bridge_dev, native_bridge_inode, dlclose);
    PLT_HOOK_REGISTER(android_runtime_dev, android_runtime_inode, fork);
    PLT_HOOK_REGISTER(android_runtime_dev, android_runtime_inode, unshare);
    PLT_HOOK_REGISTER(android_runtime_dev, android_runtime_inode, selinux_android_setcontext);
    PLT_HOOK_REGISTER(android_runtime_dev, android_runtime_inode, strdup);
    PLT_HOOK_REGISTER_SYM(android_runtime_dev, android_runtime_inode, "__android_log_close", android_log_close);

    if (!lsplt::CommitHook())
        ZLOGE("plt_hook failed\n");

    // Remove unhooked methods
    std::erase_if(plt_backup, [](auto &t) { return *std::get<3>(t) == nullptr; });
}
```
- `dlclose`: 拦截 native bridge 卸载，获取 Runtime Callbacks

- `strdup`: 检测 "ZygoteInit" 字符串，触发 JNI Hook

- `fork`: 拦截进程 fork，允许在 fork 前后执行自定义代码

- `unshare`: 拦截命名空间隔离，执行 unmount 操作

- `selinux_android_setcontext`: SELinux 上下文切换前的最后时机

在 strdup 触发后，进行 JNI Hook：
```cpp
void HookContext::hook_zygote_jni() {
    using method_sig = jint(*)(JavaVM **, jsize, jsize *);
    auto get_created_vms = reinterpret_cast<method_sig>(
            dlsym(RTLD_DEFAULT, "JNI_GetCreatedJavaVMs"));
    // ... 省略获取 JVM 的代码 ...

    JNINativeMethod missing_method{};
    bool replaced_fork_app = false;
    bool replaced_specialize_app = false;
    bool replaced_fork_server = false;

    jclass clazz = env->FindClass(kZygote);
    auto [ptr, count] = get_jni_methods(env, clazz);
    for (const auto methods = span(ptr.get(), count); const auto &method : methods) {
        if (strcmp(method.name, kForkApp) == 0) {
            if (hook_jni_methods(env, clazz, fork_app_methods) == 0) {
                missing_method = method;
                break;
            }
            replaced_fork_app = true;
        } else if (strcmp(method.name, kSpecializeApp) == 0) {
            if (hook_jni_methods(env, clazz, specialize_app_methods) == 0) {
                missing_method = method;
                break;
            }
            replaced_specialize_app = true;
        } else if (strcmp(method.name, kForkServer) == 0) {
            if (hook_jni_methods(env, clazz, fork_server_methods) == 0) {
                missing_method = method;
                break;
            }
            replaced_fork_server = true;
        }
    }
}
```
Hook 的三个方法：
- `nativeForkAndSpecialize`: 应用进程 fork + specialization

- `nativeSpecializeAppProcess`: 应用进程 specialization（无 fork）

- `nativeForkSystemServer`: system_server fork

这三个 hook 其实都是为了拿到进程孵化的回调 preFork/postFork，只是根据进程类型不同而区分了三个 hook 点罢了。fork 完成之后跟 magiskd 通信拿到要加载的模块并进行加载。

hook JVM 初始化线程时调用的 `pthread_attr_destroy`，在这时卸载 zygisk，并 unhook 之前 hook 的函数。
## ZygiskNext
![image](images/LZWebYlrDo7ARfx4grlcPJQOnCd.png)
ZygiskNext 是兼容 KernelSU 的 Zygisk 实现，有了它就可以在 KernelSU 设备上使用 LSPosed 等 Zygisk 模块了。似乎开源版本在三年前就停止维护了，现在在他们的 telegram 频道分发闭源版本。

ZygiskNext 使用 ptrace 跟踪 init 进程，这样便也可以自动跟踪 fork 出的所有子进程。在 KernelSU 模块的 post-fs-data.sh 钩子启动 zygote ptrace64 monitor，monitor ptrace init 进程。之后 init 进程 fork 的时候便可以感知到，在 zygote 进程 fork 出来时 monitor 收到回调，进行 ptrace 注入 libzygisk.so。具体做法是修改 `AT_ENTRY` 为无效地址，这样便可以在 linker 初始化完成点发生 `SIGSEGV` signal，通过 ptrace 可以感知这个 signal，在此处通过 ptrace 远程调用 dlopen 加载 libzygisk.so，再通过远程 dlsym 获取到 entry 函数的地址并手动调用，最后再手动恢复 `AT_ENTRY` 和之前的寄存器状态，detach ptrace。

再之后的流程就跟 Magisk 官方的 Zygisk 一样了。
## Lsposed
说到最出名最常用的 Zygisk 模块那必须聊到 Xposed 了，Xposed 是一个 Hook 框架，不同于其他 Hook 框架的是它通过接入 Zygisk 而可以针对任何 App，甚至是 `system_server` —— 随意替换方法的实现，可以做到多少神奇的事情想必不用我多说。

既然 Zygisk 提供了 Zygote Fork 的回调点，那么替换方法实现这件事又是怎么实现的呢？其实主要就是对 ARTMethod 结构体进行修改，原理听起来简单，但对于这件事来说魔鬼真的都在细节中:
- 不同的安卓版本，不同的厂商，framework 的实现都不一样，尤其是厂商的系统，源码对我们来说完全是黑盒。

- 而 ART 解释器的逻辑本身也很复杂，比如 ART 有两套 dalvik 字节码解释器，一套是 C++ switch case 编写的字节码解释器，一套是完全用汇编指令实现的 nterp 解释器，你两套都要兼容。

- 你还要考虑 JIT/AOT 的情况，如果代码都被 JIT/AOT 成机器码了，那肯定就不好 hook 了。

- 你还要考虑对 ARTMethod 结构修改的并发问题，GC 随时都有可能发生，完全有可能在 hook 的时候 ARTMethod 就被 GC 干掉了...

- 而上面若干 case，你只要有任意一个微小 case 没有考虑到，就会直接 native crash，兜底都兜不住的那种。所以这种技术除非实现得十分可靠，否则是不可能被互联网大厂采用的。

还有很多恶心至极的细节，LSPosed 团队采用的基于 ARTMethod 的 Hook 的实现被放到了另外一个仓库：[LSPlant](https://github.com/LSPosed/LSPlant)，也许我之后会单开一篇文章进行解析，这都是后话了。

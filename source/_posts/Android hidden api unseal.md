---
title: Android hidden api unseal
urlname: KWlXdqMkEo764nx4BBLcZFoenae
date: '2025-04-26 15:13:58'
updated: '2025-04-26 15:16:52'
tags:
  - ART
  - android
---
> 注: 本文中出现的 aosp 源码版本为 android15-qpr2-release
## 拦截原理
首先先梳理下 android 对 hidden api 的拦截原理，我们从 getDeclaredMethod 开始分析
![image](images/WH71bsFkYoiIn3xAwW8cyOWznZd.png)
![image](images/N5GmbUbUUoQKiHxaf6qcmD6FnOf.png)
![image](images/Vw53bkxrEofrEjxQcLtct2Adnye.png)
最后会走到 native 方法 getDeclaredMethodInternal，然后发现有一段 ShouldDenyAccessToMember 的逻辑，返回false 就会让 getDeclaredMethodInternal 返回 null，想必这就是 hidden api 隐藏逻辑了。
![image](images/PGMqb9yReoX7uTxndrvc6tYwnGh.png)
可以发现有一个豁免列表 `runtime->GetHiddenApiExemptions`，只要签名前缀匹配上任何一条豁免，就直接不拦截。
![image](images/A8TPbigR0oatwxxnB5WcPcoDndh.png)
![image](images/SlMibBwYKoplUTxeKChchehKnQb.png)
所以我们只要想办法修改 runtime 的这个字段就可以了。
## unsealByDex
我们发现 setHiddenApiExemptions 这个方法其实暴露到了 java 层 `VRRuntime::setHiddenApiExemptions` 
![image](images/Oq6sbgvMBod11JxrJyxcZnLAnSY.png)
但它也是一个 hidden api，要调用它的话也需要先想办法绕过 hidden api 的限制。这就变成了一个鸡生蛋蛋生鸡的问题，那我们就只能想一个别的办法来绕过这个限制，我们看下 ShouldDenyAccessToMember 中的其他条件。
![image](images/FGb9b6TAXoMTRbxnkITcJ6EDnZd.png)
发现还有另外一个条件，我们看看 CanAlwaysAccess 方法内部：
![image](images/KuTmbIGGDoSVIKxDkCXcffuOnqe.png)
![image](images/G0V6b0FE8oDxHoxNWj9cbtLDnPh.png)
其实就是比较 caller 和 callee 的谁的 domain 比较高，caller 的 domain 高于 callee 的情况下就可以直接放行。

那么我们只要想办法让 caller 处在最高的 domain `kCorePlatform` ，也就是让 caller 所在 class 被最上层的 BootstrapClassLoader 加载即可。

那么我们可以使用 DexFile#loadClass 加载类，这个 api 允许传入一个 null 作为 classloader，也就是用 BootstrapClassLoader 加载。
```undefined
private static final String DEX = /** 省略 **/

private static boolean unsealByDexFile(Context context) {
    byte[] bytes = Base64.decode(DEX, Base64.NO_WRAP);
    File codeCacheDir = getCodeCacheDir(context);
    if (codeCacheDir == null) {
        return false;
    }
    File code = new File(codeCacheDir, System.currentTimeMillis() + ".dex");
    try {

        try (FileOutputStream fos = new FileOutputStream(code)) {
            fos.write(bytes);
        }

        // Support target Android U.
        // https://developer.android.com/about/versions/14/behavior-changes-14#safer-dynamic-code-loading
        try {
            //noinspection ResultOfMethodCallIgnored
            code.setReadOnly();
        } catch (Throwable ignore) {
        }

        DexFile dexFile = new DexFile(code);
        // This class is hardcoded in the dex, Don't use BootstrapClass.class to reference it
        // it maybe obfuscated!!
        Class<?> bootstrapClass = dexFile.loadClass("me.weishu.reflection.BootstrapClass", null);
        Method exemptAll = bootstrapClass.getDeclaredMethod("exemptAll");
        return (boolean) exemptAll.invoke(null);
    } catch (Throwable e) {
        e.printStackTrace();
        return false;
    } finally {
        if (code.exists()) {
            //noinspection ResultOfMethodCallIgnored
            code.delete();
        }
    }
}
```
通过 DexFile 加载的 class 便可以调用 `VRRuntime::setHiddenApiExemptions` ，将其设置为 `["L"]` 即可豁免全部 hidden api。
## unsealNative
当然其实也不是一定要调用 `VRRuntime::setHiddenApiExemptions`。既然 `hidden_api_exemptions_` 是 native 层结构体的字段，那自然可以在 native 层想怎么改怎么改。甚至我们也不太需要修改这个字段了，直接一劳永逸的修改 `EnforcementPolicy` 把 hidden api 这个功能关掉即可。

不过这个方法的坏处就是一旦系统更新结构体发生改变，就需要修改适配定位字段的逻辑。
## 附录
[一种绕过Android P对非SDK接口限制的简单方法](https://weishu.me/2018/06/07/free-reflection-above-android-p/)

[另一种绕过 Android P以上非公开API限制的办法](https://weishu.me/2019/03/16/another-free-reflection-above-android-p/)

https://github.com/tiann/FreeReflection

上面两篇文章至少讲了四种绕过 hidden api block 的方法。不过本文我们主要分析 FreeReflection 项目中采用的实现。这也是美团在用的方法，截止目前最新版本（android 15）仍然有效。

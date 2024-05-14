---
title: 实现一个 crepl
urlname: KEXzdAOJSo1UjlxaR0bcc6m5njT
date: '2024-05-14 17:01:24'
updated: '2024-05-14 17:16:51'
tags:
  - jyy
  - os
  - lab
---
https://jyywiki.cn/OS/2024/labs/M4.md

今年在追番蒋炎岩老师的 NJU OS 2024spring。因为之前已经做过不少 os lab，所以这次不打算做 os lab，但是发现 jyy 的非 OS lab 设计得都非常有意思，所以决定做一下。

以前我从来没有思考过 crepl 要怎么实现，没想到利用 gcc 就可以如此容易的实现一个 crepl，以前没怎么接触过的 so 库的用法和其本质也逐渐熟悉起来了。

虽说出于学术诚信上的考量 jyy 并不希望我们公开 lab 代码，但是这个 lab 确实没什么难的地方，相信不会有南大学子上网搜代码抄的。并且我因为偷懒直接使用了 `system` ，直接抄我的也得老老实实改成 `fork` & `execve` 实现:D
```c
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <dlfcn.h>

int wrapper_count = 0;

int main(int argc, char *argv[]) {
    static char line[4096];
    char cmd[4096];
    char temp_so_path[] = "/tmp/crepl_so.XXXXXX";
    char temp_src_path[] = "/tmp/crepl_src.XXXXXX";

    // 分配临时文件
    int fd = mkstemp(temp_so_path);
    if (fd == -1) {
        perror("mkstemp failed");
        return EXIT_FAILURE;
    }
    fd = mkstemp(temp_src_path);
    if (fd == -1) {
        perror("mkstemp failed");
        return EXIT_FAILURE;
    }

    // -Wno-implicit-function-declaration   
    // 用于绕过在调用其他函数场景下的隐式函数定义的检查
    sprintf(cmd,
            "gcc -Wno-implicit-function-declaration -xc "
            "-shared -o %s %s",
            temp_so_path, temp_src_path);

    while (1) {
        printf("crepl> ");
        fflush(stdout);

        if (!fgets(line, sizeof(line), stdin)) {
            break;
        }

        // To be implemented.
        // printf("Got %zu chars.\n", strlen(line));

        int is_function = strncmp(line, "int ", strlen("int ")) == 0;
        char func_name[256];
        char func[4096];

        if (is_function) {
            strcpy(func, line);
        } else {
            sprintf(func_name, "__expr_wrapper_%d", wrapper_count++);
            sprintf(func, "int %s() { return %s; }", func_name, line);
        }

        // 将函数写入临时文件
        // 如果是表达式，就编译成 so 然后 dlopen 执行 expr wrapper
        FILE* file = fopen(temp_src_path, "a");
        if (file == NULL) {
            perror("Failed to open file");
            return EXIT_FAILURE;
        }
        fprintf(file, "%s\n", func);
        fflush(file);
        fclose(file);

        // 只是添加函数定义的话不需要编译
        if (is_function) {
            printf("OK.\n");
            continue;
        }

        // 编译成 so
        system(cmd);

        void *handle;
        int (*function)(void);
        char *error;
        int eval_result;

        // 加载共享库
        handle = dlopen(temp_so_path, RTLD_LAZY);
        if (!handle) {
            fprintf(stderr, "%s\n", dlerror());
            return 1;
        }

        // 清除现有的错误
        dlerror();
        
        *(void **) (&function) = dlsym(handle, func_name);
        if ((error = dlerror()) != NULL)  {
            fprintf(stderr, "%s\n", error);
            dlclose(handle);
            return 1;
        }

        // 调用函数
        eval_result = function();

        // 关闭共享库
        dlclose(handle);

        printf("= %d.\n", eval_result);
    }
}
```

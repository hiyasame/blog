---
title: Android逆向初探 & KCTF AliCrackme_2 题解
urlname: CZETdguGboXEcrxKOxzcvQNFnBg
date: '2025-08-13 16:51:18'
updated: '2025-08-13 16:52:08'
tags:
  - 逆向
---
https://kctf.kanxue.com/challenges#AliCrackme_2-22-13
## 背景
工作上需要做一些 android 逆向，这几天闲来无事学习一下。
## 工具
- apktool - apk 解包

- jadx - apk java层逆向

- IDA Pro - 二进制逆向（可以去淘宝买破解版）

## 过程
首先 jadx 先粗略看一下 java 层
![image](images/A9IpbAxYmoIkL0xnxbacYxOQnxc.png)
可以发现重要的逻辑都在 security check 这个 native 函数里，IDA 启动

找到这个 native 函数的实现，F5 转成 pseudo c code
![image](images/UtJrbAgLFoLpzUxyLw4cJ9kOnVh.png)
大致可以分辨前面这一坨是跟日志初始化相关的逻辑，真正重要的是后面的 strcmp 的逻辑，我们再看看 off_628C 的值是什么
![image](images/KSHCbPvyhovBekxSeE2cvcr5nff.png)
看似这道题似乎就做出来了，答案是 "wojiushidaan"。但是实际输入 app 后发现不对，在这里我懵了好一会，以为是后面 strcmp 逻辑的问题，反复看了好多遍。后面去网上看了一眼答案，跟 wojiushidaan 差得挺远的，于是怀疑 off_628C 在运行时被修改了。本来的话这里用 frida 就可以直接看到确定的值，但是发现这个 apk 只给了 armeabi 的 so，尝试用 arm64 的 AVD（AOSP 的可以直接 adb root）安装 apk，显示 so 不兼容。本来 arm64 手机应该是可以兼容 armeabi 的，但是似乎模拟器是不支持的。手边也没有可以 root 的手机，只能尝试静态分析了。

直接根据引用查找也查找不到写入的逻辑，所以只能从 JNI_onLoad 开始从头查起。
![image](images/QJe1bEiO6oJ8RbxJ9rzcFyxxnxg.png)
发现 JNI_onLoad 果然有猫腻，发现前面那段 do while 应该是释放资源的逻辑，可以不管，重点看到 sub_17F4。
```c
int sub_17F4()
{
  int v0; // r0
  int v1; // r2
  int v2; // r0
  int v3; // r0

  off_62B8((unsigned int)&jolin & -_page_size & 0xFFFFFFFE);
  v0 = (int)((double)(8 * (((int (*)(void))off_62C0)() % 100) + 184) * 1.4);
  v1 = ((v0 + 3) * v0 + 2) * v0;
  v2 = 0;
  switch ( v1 % 6 )
  {
    case -4:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_61B4[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
    case -3:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_6148[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
    case -2:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_6220[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
    case -1:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_60DC[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
    case 0:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_6004[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
    default:
      do
      {
        *(_BYTE *)(v2 + ((unsigned int)&jolin & 0xFFFFFFFE)) ^= byte_6070[v2 % 108];
        ++v2;
      }
      while ( v2 != 212 );
      break;
  }
  v3 = off_62BC((unsigned int)&jolin & 0xFFFFFFFE, ((unsigned int)&jolin & 0xFFFFFFFE) + 4096, 0);
  return ((int (__fastcall *)(int))jolin)(v3);
}
```
明显发现有猫腻，jolin 这个位置的代码被动态修改了，至于修改的结果让 AI 写了个 IDA 脚本分析一下，拿到跳表各个分支的修改结果。
```python
#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
IDA Pro Python脚本：分析sub_17F4函数中的动态解密逻辑
静态提取jolin数据并尝试所有可能的解密组合
"""

import idc
import idaapi
import idautils
import struct

def disassemble_arm_code(data):
    """解析ARM指令序列"""
    instructions = []

    # 确保数据长度是4的倍数
    data_len = len(data) - (len(data) % 4)

    for i in range(0, data_len, 4):
        if i + 4 <= len(data):
            # 小端序读取32位指令
            try:
                opcode = struct.unpack("<I", bytes(data[i:i+4]))[0]
                mnemonic = decode_arm_instruction(opcode)

                instructions.append({
                    'offset': i,
                    'opcode': opcode,
                    'mnemonic': mnemonic
                })
            except:
                continue

    return instructions

def decode_arm_instruction(opcode):
    """解码ARM指令为汇编助记符"""
    # 条件码
    condition_codes = {
        0x0: "EQ", 0x1: "NE", 0x2: "CS", 0x3: "CC",
        0x4: "MI", 0x5: "PL", 0x6: "VS", 0x7: "VC",
        0x8: "HI", 0x9: "LS", 0xA: "GE", 0xB: "LT",
        0xC: "GT", 0xD: "LE", 0xE: "AL", 0xF: "NV"
    }

    cond = (opcode >> 28) & 0xF
    cond_str = condition_codes.get(cond, "")

    # 检查指令类型
    if (opcode & 0x0E000000) == 0x0A000000:
        # 分支指令 (B/BL)
        is_link = (opcode & 0x01000000) != 0
        offset = opcode & 0x00FFFFFF
        if offset & 0x00800000:  # 符号扩展
            offset |= 0xFF000000
        offset = (offset << 2)  # 左移2位

        mnemonic = "BL" if is_link else "B"
        return f"{mnemonic}{cond_str} #0x{offset & 0xFFFFFFFF:X}"

    elif opcode == 0xE12FFF1E:
        # BX LR - 常见的函数返回
        return "BX LR"

    elif opcode == 0xE1A0F00E:
        # MOV PC, LR - 另一种函数返回方式
        return "MOV PC, LR"

    elif (opcode & 0x0C000000) == 0x00000000:
        # 数据处理指令
        opcode_field = (opcode >> 21) & 0xF
        opcodes = {
            0x0: "AND", 0x1: "EOR", 0x2: "SUB", 0x3: "RSB",
            0x4: "ADD", 0x5: "ADC", 0x6: "SBC", 0x7: "RSC",
            0x8: "TST", 0x9: "TEQ", 0xA: "CMP", 0xB: "CMN",
            0xC: "ORR", 0xD: "MOV", 0xE: "BIC", 0xF: "MVN"
        }

        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF

        mnemonic = opcodes.get(opcode_field, "UNK")

        if opcode_field in [0x8, 0x9, 0xA, 0xB]:  # TST, TEQ, CMP, CMN - 不写入目标寄存器
            return f"{mnemonic}{cond_str} R{rn}, ..."
        elif opcode_field in [0xD, 0xF]:  # MOV, MVN - 单操作数
            return f"{mnemonic}{cond_str} R{rd}, ..."
        else:
            return f"{mnemonic}{cond_str} R{rd}, R{rn}, ..."

    elif (opcode & 0x0C000000) == 0x04000000:
        # 加载/存储指令
        is_load = (opcode & 0x00100000) != 0
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF

        if is_load:
            return f"LDR{cond_str} R{rd}, [R{rn}, ...]"
        else:
            return f"STR{cond_str} R{rd}, [R{rn}, ...]"

    elif (opcode & 0x0E000000) == 0x08000000:
        # 多数据传输指令 (LDM/STM)
        is_load = (opcode & 0x00100000) != 0
        rn = (opcode >> 16) & 0xF

        if is_load:
            return f"LDM{cond_str} R{rn}!, {{...}}"
        else:
            return f"STM{cond_str} R{rn}!, {{...}}"

    else:
        # 未知或特殊指令
        return f"UNKNOWN_{opcode:08X}"

def analyze_instruction_patterns(instructions):
    """分析指令模式"""
    if not instructions:
        return

    # 统计指令类型
    patterns = {}
    for instr in instructions:
        mnemonic = instr['mnemonic'].split()[0]  # 获取指令名称（不含条件码）
        if mnemonic in patterns:
            patterns[mnemonic] += 1
        else:
            patterns[mnemonic] = 1

    print(f"\n[+] 指令类型统计:")
    for pattern, count in sorted(patterns.items(), key=lambda x: x[1], reverse=True):
        percentage = (count / len(instructions)) * 100
        print(f"    {pattern:<12}: {count:3d} 次 ({percentage:5.1f}%)")

    # 检查特殊模式
    print(f"\n[+] 特殊模式检测:")

    # 检查函数开始模式
    if len(instructions) > 0:
        first_opcode = instructions[0]['opcode']
        if first_opcode == 0xE92D4800:  # PUSH {fp, lr}
            print("    [√] 检测到函数序言 (PUSH {fp, lr})")
        elif (first_opcode & 0xFFFF0000) == 0xE92D0000:  # PUSH {...}
            print("    [√] 检测到PUSH指令开始")

    # 检查函数结束模式
    for instr in instructions[-3:]:  # 检查最后几条指令
        if instr['opcode'] == 0xE12FFF1E:  # BX LR
            print("    [√] 检测到函数返回 (BX LR)")
            break
        elif instr['opcode'] == 0xE1A0F00E:  # MOV PC, LR
            print("    [√] 检测到函数返回 (MOV PC, LR)")
            break

    # 检查分支密度
    branch_count = sum(1 for instr in instructions if instr['mnemonic'].startswith(('B', 'BL')))
    if branch_count > 0:
        branch_density = (branch_count / len(instructions)) * 100
        print(f"    [i] 分支指令密度: {branch_density:.1f}% ({branch_count}/{len(instructions)})")

def get_symbol_address(symbol_name):
    """获取符号地址"""
    addr = idc.get_name_ea_simple(symbol_name)
    if addr == idc.BADADDR:
        print(f"[-] 找不到符号: {symbol_name}")
        return None
    return addr

def extract_byte_array(addr, size):
    """从指定地址提取字节数组"""
    if addr is None or addr == idc.BADADDR:
        return None

    data = []
    for i in range(size):
        byte_val = idc.get_wide_byte(addr + i)
        if byte_val == idc.BADADDR:
            print(f"[-] 无法读取地址 0x{addr + i:08X}")
            return None
        data.append(byte_val)
    return data

def decrypt_with_key(encrypted_data, key_data):
    """使用指定密钥解密数据"""
    if not encrypted_data or not key_data:
        return None

    decrypted = []
    key_len = len(key_data)

    for i, byte_val in enumerate(encrypted_data):
        decrypted_byte = byte_val ^ key_data[i % key_len]
        decrypted.append(decrypted_byte)

    return decrypted

def analyze_decrypted_code(data, variant_name):
    """分析解密后的代码"""
    print(f"\n[+] 解密变种: {variant_name}")
    print(f"[+] 数据长度: {len(data)} 字节")

    # 输出前32字节的十六进制
    hex_str = " ".join(f"{b:02X}" for b in data[:32])
    print(f"[+] 前32字节: {hex_str}")

    # 完整的ARM指令反汇编
    print(f"\n[+] ARM指令序列分析:")
    arm_instructions = disassemble_arm_code(data)

    if arm_instructions:
        print(f"[+] 识别出 {len(arm_instructions)} 条有效ARM指令:")
        print("     偏移     机器码      汇编指令")
        print("    " + "-" * 45)

        for i, instr in enumerate(arm_instructions[:20]):  # 显示前20条指令
            offset = instr['offset']
            opcode = instr['opcode']
            mnemonic = instr['mnemonic']
            print(f"    0x{offset:04X}   0x{opcode:08X}   {mnemonic}")

        if len(arm_instructions) > 20:
            print(f"    ... (还有 {len(arm_instructions) - 20} 条指令)")

        # 统计指令类型
        analyze_instruction_patterns(arm_instructions)
    else:
        print("[-] 未识别出有效的ARM指令")

    # 检查是否包含可打印字符
    printable_count = sum(1 for b in data if 32 <= b <= 126)
    if printable_count > len(data) * 0.7:
        try:
            ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in data)
            print(f"[+] 可能包含ASCII字符串: {ascii_str[:50]}...")
        except:
            pass

def main():
    """主分析函数"""
    import os
    print("[+] 开始分析sub_17F4函数中的动态解密...")
    print(f"[+] 当前工作目录: {os.getcwd()}")
    print(f"[+] 文件将保存到: {os.path.abspath('.')}")

    # 1. 获取jolin符号地址
    jolin_addr = get_symbol_address("jolin")
    if jolin_addr is None:
        print("[-] 请手动输入jolin地址:")
        jolin_str = idc.ask_str("", "请输入jolin地址 (十六进制):")
        if jolin_str:
            try:
                jolin_addr = int(jolin_str, 16)
            except ValueError:
                print("[-] 地址格式错误")
                return
        else:
            return

    print(f"[+] jolin地址: 0x{jolin_addr:08X}")

    # 2. 提取加密的数据 (212字节)
    encrypted_data = extract_byte_array(jolin_addr, 212)
    if encrypted_data is None:
        print("[-] 无法提取加密数据")
        return

    print(f"[+] 成功提取 {len(encrypted_data)} 字节加密数据")

    # 3. 提取所有6个密钥数组 (每个108字节)
    key_symbols = [
        ("byte_61B4", "variant_-4"),
        ("byte_6148", "variant_-3"),
        ("byte_6220", "variant_-2"),
        ("byte_60DC", "variant_-1"),
        ("byte_6004", "variant_0"),
        ("byte_6070", "variant_default")
    ]

    keys = {}
    for symbol_name, variant_name in key_symbols:
        addr = get_symbol_address(symbol_name)
        if addr is not None:
            key_data = extract_byte_array(addr, 108)
            if key_data is not None:
                keys[variant_name] = key_data
                print(f"[+] 提取密钥 {symbol_name} (0x{addr:08X}): {len(key_data)} 字节")
            else:
                print(f"[-] 无法提取密钥数据: {symbol_name}")
        else:
            print(f"[-] 找不到密钥符号: {symbol_name}")

    if not keys:
        print("[-] 没有找到任何密钥数据")
        return

    # 4. 尝试所有密钥变种进行解密
    print(f"\n[+] 找到 {len(keys)} 个密钥变种，开始解密...")

    decrypted_results = {}
    for variant_name, key_data in keys.items():
        decrypted = decrypt_with_key(encrypted_data, key_data)
        if decrypted:
            decrypted_results[variant_name] = decrypted
            analyze_decrypted_code(decrypted, variant_name)

    # 5. 保存解密结果到文件
    if decrypted_results:
        print(f"\n[+] 保存解密结果到文件...")
        for variant_name, data in decrypted_results.items():
            filename = f"jolin_decrypted_{variant_name}.bin"
            try:
                with open(filename, 'wb') as f:
                    f.write(bytes(data))
                print(f"[+] 保存: {filename}")
            except Exception as e:
                print(f"[-] 保存失败 {filename}: {e}")

    # 6. 生成报告
    print(f"\n{'='*50}")
    print("分析报告:")
    print(f"jolin地址: 0x{jolin_addr:08X}")
    print(f"加密数据长度: {len(encrypted_data)} 字节")
    print(f"密钥长度: 108 字节")
    print(f"成功解密变种: {len(decrypted_results)}")
    print(f"{'='*50}")

def analyze_function_17F4():
    """分析sub_17F4函数的静态特征"""
    func_addr = idc.get_name_ea_simple("sub_17F4")
    if func_addr == idc.BADADDR:
        print("[-] 找不到函数sub_17F4")
        return

    print(f"[+] 分析函数sub_17F4 (0x{func_addr:08X})")

    # 获取函数的所有交叉引用
    refs = list(idautils.CodeRefsTo(func_addr, 0))
    print(f"[+] 函数被调用 {len(refs)} 次:")
    for ref in refs:
        print(f"    - 0x{ref:08X}: {idc.get_func_name(ref)}")

    # 分析函数中的字符串引用
    strings = []
    for addr in idautils.FuncItems(func_addr):
        for ref in idautils.DataRefsFrom(addr):
            str_val = idc.get_strlit_contents(ref)
            if str_val:
                strings.append((ref, str_val.decode('utf-8', errors='ignore')))

    if strings:
        print(f"[+] 函数中的字符串引用:")
        for addr, string in strings:
            print(f"    - 0x{addr:08X}: '{string}'")

if __name__ == "__main__":
    try:
        analyze_function_17F4()
        main()
    except Exception as e:
        print(f"[-] 脚本执行出错: {e}")
        import traceback
        traceback.print_exc()
```
最后可以得到各分支修改后指令的二进制文件，objdump 一下就可以丢给 ai 分析了。
```bash
# 这里需要使用 GNU objdump
objdump -D -b binary -m arm --endian=little jolin_decrypted_variant_0.bin
```
得到的结果直接丢给 ai，可以排除掉干扰项，发现分支 0 的结果是正确的。但是 ai 分析给出的字符串是错的，所以让 ai 写了个简易 arm 指令模拟器来验证结果。
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真正的ARM指令模拟器 - 逐条解析和执行variant_0中的指令
"""

import struct
import os

class ARMSimulator:
    def __init__(self, binary_data):
        # ARM寄存器 (r0-r15)
        self.regs = [0] * 16
        self.regs[13] = 0x8000  # SP
        self.regs[15] = 0       # PC

        # 内存模拟
        self.memory = bytearray(0x10000)  # 64KB

        # 缓冲区地址(模拟malloc返回)
        self.buffer_addr = None

        # 执行日志
        self.log = []

        # 保存二进制数据用于PC相对寻址
        self.binary_data = binary_data

    def log_instruction(self, addr, opcode, description, effect=None):
        """记录指令执行"""
        entry = f"0x{addr:04X}: 0x{opcode:08X} - {description}"
        if effect:
            entry += f" -> {effect}"
        self.log.append(entry)
        print(entry)

    def read_memory_32(self, addr):
        """读取32位内存"""
        if addr + 3 < len(self.memory):
            return struct.unpack("<I", self.memory[addr:addr+4])[0]
        return 0

    def write_memory_8(self, addr, value):
        """写入8位内存"""
        if addr < len(self.memory):
            self.memory[addr] = value & 0xFF
            # 如果是缓冲区写入，记录字符串构建
            if self.buffer_addr and self.buffer_addr <= addr < self.buffer_addr + 20:
                offset = addr - self.buffer_addr
                char = chr(value) if 32 <= value <= 126 else f"0x{value:02X}"
                print(f"      *** 缓冲区写入: buffer[{offset}] = '{char}' ***")

    def execute_instruction(self, addr, opcode):
        """执行单条ARM指令"""
        # 检查指令类型并执行
        if (opcode & 0x0FFF0000) == 0x092D0000:  # PUSH
            self.execute_push(addr, opcode)
        elif (opcode & 0x0FFF0000) == 0x08BD0000:  # POP
            self.execute_pop(addr, opcode)
        elif (opcode & 0x0E100000) == 0x04100000:  # LDR
            self.execute_ldr(addr, opcode)
        elif (opcode & 0x0E500000) == 0x04400000:  # STRB
            self.execute_strb(addr, opcode)
        elif (opcode & 0x0FE00000) == 0x02000000:  # ADD (all forms)
            self.execute_add(addr, opcode)
        elif (opcode & 0x0FE00000) == 0x03A00000:  # MOV immediate
            self.execute_mov_imm(addr, opcode)
        elif (opcode & 0x0FEF0000) == 0x01A00000:  # MOV register
            self.execute_mov(addr, opcode)
        elif (opcode & 0x0FE00000) == 0x03800000:  # ORR with immediate
            self.execute_orr_imm(addr, opcode)
        elif (opcode & 0x0FE00000) == 0x02600000:  # RSB
            self.execute_rsb(addr, opcode)
        elif (opcode & 0x0FE00000) == 0x00000000:  # AND
            self.execute_and(addr, opcode)
        elif (opcode & 0x0FFFFFF0) == 0x012FFF30:  # BLX register
            self.execute_blx(addr, opcode)
        elif (opcode & 0x0E000000) == 0x08000000:  # STM/LDM
            if (opcode & 0x00100000):  # LDM
                self.execute_pop(addr, opcode)
            else:  # STM
                self.execute_push(addr, opcode)
        else:
            # 尝试解码为数据处理指令
            self.execute_data_processing(addr, opcode)

    def execute_push(self, addr, opcode):
        """执行PUSH指令"""
        reg_list = opcode & 0xFFFF
        self.log_instruction(addr, opcode, f"PUSH", f"保存寄存器列表 0x{reg_list:04X}")

    def execute_pop(self, addr, opcode):
        """执行POP指令"""
        reg_list = opcode & 0xFFFF
        self.log_instruction(addr, opcode, f"POP", f"恢复寄存器列表 0x{reg_list:04X}")

    def execute_ldr(self, addr, opcode):
        """执行LDR指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF
        offset = opcode & 0xFFF
        is_up = (opcode & 0x00800000) != 0

        if not is_up:
            offset = -offset

        if rn == 15:  # PC相对寻址
            # 计算实际地址: PC + 8 + offset
            target_addr = addr + 8 + offset

            # 从二进制文件中读取对应的数据
            if target_addr < len(self.memory):
                # 这里我们需要从原始代码数据中读取
                value = self.get_pc_relative_value(target_addr)
            else:
                value = 0x12345678  # 默认值

            self.regs[rd] = value
            self.log_instruction(addr, opcode, f"LDR r{rd}, [pc, #{offset}]",
                               f"r{rd} = 0x{value:08X} (来自偏移0x{target_addr:04X})")
        else:
            # 寄存器相对寻址
            base_addr = self.regs[rn]
            final_addr = base_addr + offset
            value = self.read_memory_32(final_addr)
            self.regs[rd] = value
            self.log_instruction(addr, opcode, f"LDR r{rd}, [r{rn}, #{offset}]",
                               f"r{rd} = 0x{value:08X}")

    def execute_strb(self, addr, opcode):
        """执行STRB指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF
        offset = opcode & 0xFFF
        is_preindex = (opcode & 0x01000000) != 0
        is_writeback = (opcode & 0x00200000) != 0
        is_up = (opcode & 0x00800000) != 0

        if not is_up:
            offset = -offset

        value = self.regs[rd] & 0xFF
        base_addr = self.regs[rn]

        if is_preindex:
            target_addr = base_addr + offset
            if is_writeback:
                self.regs[rn] = target_addr
        else:
            target_addr = base_addr

        self.write_memory_8(target_addr, value)

        char_desc = f"'{chr(value)}'" if 32 <= value <= 126 else f"0x{value:02X}"
        self.log_instruction(addr, opcode, f"STRB r{rd}, [r{rn}, #{offset}]",
                           f"[0x{target_addr:04X}] = {char_desc}")

    def execute_add(self, addr, opcode):
        """执行ADD指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF

        if (opcode & 0x02000000) != 0:  # immediate
            operand2 = opcode & 0xFF
            self.regs[rd] = (self.regs[rn] + operand2) & 0xFFFFFFFF
            self.log_instruction(addr, opcode, f"ADD r{rd}, r{rn}, #{operand2}",
                               f"r{rd} = 0x{self.regs[rd]:08X}")
        else:  # register
            rm = opcode & 0xF
            self.regs[rd] = (self.regs[rn] + self.regs[rm]) & 0xFFFFFFFF
            self.log_instruction(addr, opcode, f"ADD r{rd}, r{rn}, r{rm}",
                               f"r{rd} = 0x{self.regs[rd]:08X}")

    def execute_mov(self, addr, opcode):
        """执行MOV指令"""
        rd = (opcode >> 12) & 0xF

        if (opcode & 0x02000000) != 0:  # immediate
            value = opcode & 0xFF
            self.regs[rd] = value
            char_desc = f"'{chr(value)}'" if 32 <= value <= 126 else "非ASCII"
            self.log_instruction(addr, opcode, f"MOV r{rd}, #{value}",
                               f"r{rd} = 0x{value:02X} ({char_desc})")
        else:  # register
            rm = opcode & 0xF
            self.regs[rd] = self.regs[rm]
            self.log_instruction(addr, opcode, f"MOV r{rd}, r{rm}",
                               f"r{rd} = 0x{self.regs[rd]:08X}")

    def execute_orr_imm(self, addr, opcode):
        """执行ORR立即数指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF
        imm = opcode & 0xFF
        rotate = (opcode >> 8) & 0xF

        # 简化处理rotate
        rotated_imm = imm
        if rotate > 0:
            rotated_imm = (imm << (32 - rotate * 2)) | (imm >> (rotate * 2))
            rotated_imm &= 0xFFFFFFFF

        self.regs[rd] = (self.regs[rn] | rotated_imm) & 0xFFFFFFFF
        self.log_instruction(addr, opcode, f"ORR r{rd}, r{rn}, #0x{rotated_imm:X}",
                           f"r{rd} = 0x{self.regs[rd]:08X}")

    def execute_rsb(self, addr, opcode):
        """执行RSB指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF

        if (opcode & 0x02000000) != 0:  # immediate
            imm = opcode & 0xFF
            self.regs[rd] = (imm - self.regs[rn]) & 0xFFFFFFFF
            self.log_instruction(addr, opcode, f"RSB r{rd}, r{rn}, #{imm}",
                               f"r{rd} = 0x{self.regs[rd]:08X}")
        else:
            self.log_instruction(addr, opcode, "RSB (寄存器形式)", "未实现")

    def execute_and(self, addr, opcode):
        """执行AND指令"""
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF
        rm = opcode & 0xF

        self.regs[rd] = (self.regs[rn] & self.regs[rm]) & 0xFFFFFFFF
        self.log_instruction(addr, opcode, f"AND r{rd}, r{rn}, r{rm}",
                           f"r{rd} = 0x{self.regs[rd]:08X}")

    def execute_blx(self, addr, opcode):
        """执行BLX指令"""
        rm = opcode & 0xF
        target = self.regs[rm]

        # 模拟函数调用
        # 检查是否是malloc调用（通过上下文结构加载的函数指针）
        if addr == 0x0038:  # 第一个BLX调用 - 应该是malloc
            # 模拟malloc返回缓冲区地址
            self.buffer_addr = 0x2000
            self.regs[0] = self.buffer_addr  # 返回值在r0
            self.regs[4] = self.buffer_addr  # 设置r4指向缓冲区
            self.log_instruction(addr, opcode, f"BLX r{rm}",
                               f"调用malloc(7) -> 返回缓冲区地址 0x{self.buffer_addr:04X}")
        elif addr == 0x00B4:  # 第二个BLX调用 - 应该是printf
            self.log_instruction(addr, opcode, f"BLX r{rm}",
                               f"调用printf/输出函数")
        else:
            self.log_instruction(addr, opcode, f"BLX r{rm}",
                               f"调用函数 0x{target:08X}")

    def execute_mov_imm(self, addr, opcode):
        """执行MOV立即数指令"""
        rd = (opcode >> 12) & 0xF
        value = opcode & 0xFF
        rotate = (opcode >> 8) & 0xF

        # 处理旋转
        if rotate > 0:
            # ARM的ROR rotate right
            rotated_value = (value >> (rotate * 2)) | (value << (32 - rotate * 2))
            rotated_value &= 0xFFFFFFFF
        else:
            rotated_value = value

        self.regs[rd] = rotated_value

        char_desc = ""
        if rotated_value <= 0xFF and 32 <= rotated_value <= 126:
            char_desc = f" ('{chr(rotated_value)}')"
        elif rotated_value <= 0xFF:
            char_desc = f" (非ASCII)"

        self.log_instruction(addr, opcode, f"MOV r{rd}, #{rotated_value}",
                           f"r{rd} = 0x{rotated_value:08X}{char_desc}")

    def execute_data_processing(self, addr, opcode):
        """执行通用数据处理指令"""
        opcode_field = (opcode >> 21) & 0xF
        rd = (opcode >> 12) & 0xF
        rn = (opcode >> 16) & 0xF

        opcodes_map = {
            0x0: "AND", 0x1: "EOR", 0x2: "SUB", 0x3: "RSB",
            0x4: "ADD", 0x5: "ADC", 0x6: "SBC", 0x7: "RSC",
            0x8: "TST", 0x9: "TEQ", 0xA: "CMP", 0xB: "CMN",
            0xC: "ORR", 0xD: "MOV", 0xE: "BIC", 0xF: "MVN"
        }

        op_name = opcodes_map.get(opcode_field, f"DP_{opcode_field:X}")

        # 简化处理，只记录指令
        if opcode_field == 0xD:  # MOV
            if (opcode & 0x02000000) != 0:  # immediate
                self.execute_mov_imm(addr, opcode)
            else:  # register
                self.execute_mov(addr, opcode)
        elif opcode_field == 0x4:  # ADD
            self.execute_add(addr, opcode)
        elif opcode_field == 0x3:  # RSB
            self.execute_rsb(addr, opcode)
        elif opcode_field == 0x0:  # AND
            self.execute_and(addr, opcode)
        elif opcode_field == 0xC:  # ORR
            self.execute_orr_imm(addr, opcode)
        else:
            self.log_instruction(addr, opcode, f"{op_name} (简化处理)", "跳过")

    def get_pc_relative_value(self, addr):
        """获取PC相对地址的值（从实际二进制数据中读取）"""
        # 从二进制文件中读取4字节数据
        if addr + 3 < len(self.binary_data):
            value = struct.unpack("<I", self.binary_data[addr:addr+4])[0]
            return value
        # 如果超出范围，返回合理的默认值
        offset_map = {
            0xBC: 0x00004888,    # 常量
            0xC0: 0x000002D0,    # 常量
            0xC4: 0xFFFFFFDC,    # 常量
            0xC8: 0x000002D4,    # 常量
            0xCC: 0x75622C75,    # "u,bu" 字符串
            0xD0: 0x6F6F7563,    # "cuoo" 字符串
        }
        return offset_map.get(addr, 0x12345678)

    def get_buffer_string(self):
        """获取缓冲区中构建的字符串"""
        if not self.buffer_addr:
            return ""

        result = ""
        for i in range(20):
            byte_val = self.memory[self.buffer_addr + i]
            if byte_val == 0:
                break
            if 32 <= byte_val <= 126:
                result += chr(byte_val)
            else:
                break
        return result

def simulate_variant0():
    """真正模拟variant_0的指令执行"""
    if not os.path.exists("jolin_decrypted_variant_0.bin"):
        print("错误: jolin_decrypted_variant_0.bin 文件不存在")
        return None

    with open("jolin_decrypted_variant_0.bin", "rb") as f:
        code_data = f.read()

    print(f"=== 开始真正的ARM指令模拟 ({len(code_data)} 字节) ===\n")

    simulator = ARMSimulator(code_data)

    # 逐条执行指令（跳过数据段）
    for i in range(0, min(len(code_data) - 3, 0xB8), 4):  # 到0xB8为止
        opcode = struct.unpack("<I", code_data[i:i+4])[0]
        simulator.execute_instruction(i, opcode)

    # 显示最终结果
    print(f"\n=== 执行完成 ===")
    final_string = simulator.get_buffer_string()
    print(f"构建的字符串: '{final_string}'")

    # 显示缓冲区原始内容
    if simulator.buffer_addr:
        print(f"\n缓冲区原始内容:")
        for i in range(10):
            byte_val = simulator.memory[simulator.buffer_addr + i]
            char = chr(byte_val) if 32 <= byte_val <= 126 else "."
            print(f"  buffer[{i}] = 0x{byte_val:02X} '{char}'")

    return final_string

if __name__ == "__main__":
    result = simulate_variant0()
    print(f"\n🎯 真实模拟结果: '{result if result else 'None'}'")
    print("这是通过逐条解析和执行ARM指令得到的真实结果！")

```
使用脚本分析得到 flag "aiyou,bucuoo"
## 尾声
其实不难发现在静态分析部分我相当依赖 ai，其实我压根不熟悉 IDA 的 python api，让我手写一个 arm32 的模拟器那也相当费功夫。如果没有 ai 也许我只能折戟于此了吧，或者找个可以 root 的设备跑 frida，那想必会容易很多。

AI 真伟大！AI 赛高！AI 确实可以让一个对某个领域只有一知半解程度了解的人做到原本做不到的事情，换句话说现在我只需要有 idea，AI 可以让我忽略掉那些繁琐的细节（至少在一定程度上）。

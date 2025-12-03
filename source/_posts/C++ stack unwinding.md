---
title: C++ stack unwinding
urlname: JGovdEiMao12nKx50rlclssinGb
date: '2025-12-03 09:00:54'
updated: '2025-12-03 17:56:12'
tags:
  - RTFSC
  - C++
---
其实在此之前我就大概知道，stack unwinding 是反向回溯栈的一种机制，在 throw 了什么东西后一层层回溯栈，一层层析构掉这些栈上的 RAII 对象，直到找到 try catch 块后跳转到 catch 块。

但是问题是这种事情是怎样实现的？多说无益，我们直接从 throw 的源码入手分析。

首先我们编写一段示例代码:
```c
#include <iostream>
#include <string>

void func2();

void func1() {
    std::cout << "Hello" << std::endl;
    func2();
}

void func2() {
    std::cout << "World" << std::endl;
    throw std::string("C++");
}

int main() {
    try {
        std::string s1 = "Hello";

        {
            std::string s2 = "World";
        }

        std::string s3 = "Stack Unwinding";
        
        func1();
    } catch (const std::string& e) {
        std::cout << e << std::endl;
    }
    return 0;
}
```
编译后使用 objdump -d 看 func2 的内容，发现 throw 被编译成了 __cxa_throw 调用：
![image](images/IXXeb4vsnor5nXxkrcCcLMdenPf.png)
## __cxa_throw
__cxa_throw 位于 llvm 的 libcxxabi 子项目中：
```cpp
void
#ifdef __wasm__
// In Wasm, a destructor returns its argument
__cxa_throw(void *thrown_object, std::type_info *tinfo, void *(_LIBCXXABI_DTOR_FUNC *dest)(void *)) {
#else
__cxa_throw(void *thrown_object, std::type_info *tinfo, void (_LIBCXXABI_DTOR_FUNC *dest)(void *)) {
#endif
  __cxa_eh_globals* globals = __cxa_get_globals();
  globals->uncaughtExceptions += 1; // Not atomically, since globals are thread-local

  __cxa_exception* exception_header = __cxa_init_primary_exception(thrown_object, tinfo, dest);
  exception_header->referenceCount = 1; // This is a newly allocated exception, no need for thread safety.

#if __has_feature(address_sanitizer)
  // Inform the ASan runtime that now might be a good time to clean stuff up.
  __asan_handle_no_return();
#endif

#ifdef __USING_SJLJ_EXCEPTIONS__
    _Unwind_SjLj_RaiseException(&exception_header->unwindHeader);
#else
    _Unwind_RaiseException(&exception_header->unwindHeader);
#endif
    //  This only happens when there is no handler, or some unexpected unwinding
    //     error happens.
    failed_throw(exception_header);
}
```
能看出来其核心实现在 `_Unwind_RaiseException` 
## _Unwind_RaiseException
在 libunwind 子项目中找到其实现：
```cpp
/// Called by __cxa_throw.  Only returns if there is a fatal error.
_LIBUNWIND_EXPORT _Unwind_Reason_Code
_Unwind_RaiseException(_Unwind_Exception *exception_object) {
  _LIBUNWIND_TRACE_API("_Unwind_RaiseException(ex_obj=%p)",
                       (void *)exception_object);
  unw_context_t uc;
  unw_cursor_t cursor;
  __unw_getcontext(&uc);

  // Mark that this is a non-forced unwind, so _Unwind_Resume()
  // can do the right thing.
  exception_object->private_1 = 0;
  exception_object->private_2 = 0;

  // phase 1: the search phase
  _Unwind_Reason_Code phase1 = unwind_phase1(&uc, &cursor, exception_object);
  if (phase1 != _URC_NO_REASON)
    return phase1;

  // phase 2: the clean up phase
  return unwind_phase2(&uc, &cursor, exception_object);
}

```
这里我们可以发现有两个 phase：
### search phase
```c
static _Unwind_Reason_Code
unwind_phase1(unw_context_t *uc, unw_cursor_t *cursor, _Unwind_Exception *exception_object) {
  __unw_init_local(cursor, uc);

  // Walk each frame looking for a place to stop.
  while (true) {
    // Ask libunwind to get next frame (skip over first which is
    // _Unwind_RaiseException).
    int stepResult = __unw_step(cursor);
    if (stepResult == 0) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase1(ex_obj=%p): __unw_step() reached "
          "bottom => _URC_END_OF_STACK",
          (void *)exception_object);
      return _URC_END_OF_STACK;
    } else if (stepResult < 0) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase1(ex_obj=%p): __unw_step failed => "
          "_URC_FATAL_PHASE1_ERROR",
          (void *)exception_object);
      return _URC_FATAL_PHASE1_ERROR;
    }

    // See if frame has code to run (has personality routine).
    unw_proc_info_t frameInfo;
    unw_word_t sp;
    if (__unw_get_proc_info(cursor, &frameInfo) != UNW_ESUCCESS) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase1(ex_obj=%p): __unw_get_proc_info "
          "failed => _URC_FATAL_PHASE1_ERROR",
          (void *)exception_object);
      return _URC_FATAL_PHASE1_ERROR;
    }

#ifndef NDEBUG
    // When tracing, print state information.
    if (_LIBUNWIND_TRACING_UNWINDING) {
      char functionBuf[512];
      const char *functionName = functionBuf;
      unw_word_t offset;
      if ((__unw_get_proc_name(cursor, functionBuf, sizeof(functionBuf),
                               &offset) != UNW_ESUCCESS) ||
          (frameInfo.start_ip + offset > frameInfo.end_ip))
        functionName = ".anonymous.";
      unw_word_t pc;
      __unw_get_reg(cursor, UNW_REG_IP, &pc);
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase1(ex_obj=%p): pc=0x%" PRIxPTR ", start_ip=0x%" PRIxPTR
          ", func=%s, lsda=0x%" PRIxPTR ", personality=0x%" PRIxPTR "",
          (void *)exception_object, pc, frameInfo.start_ip, functionName,
          frameInfo.lsda, frameInfo.handler);
    }
#endif

    // If there is a personality routine, ask it if it will want to stop at
    // this frame.
    if (frameInfo.handler != 0) {
      _Unwind_Personality_Fn p = get_handler_function(&frameInfo);
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase1(ex_obj=%p): calling personality function %p",
          (void *)exception_object, (void *)(uintptr_t)p);
      _Unwind_Reason_Code personalityResult =
          (*p)(1, _UA_SEARCH_PHASE, exception_object->exception_class,
               exception_object, (struct _Unwind_Context *)(cursor));
      switch (personalityResult) {
      case _URC_HANDLER_FOUND:
        // found a catch clause or locals that need destructing in this frame
        // stop search and remember stack pointer at the frame
        __unw_get_reg(cursor, UNW_REG_SP, &sp);
        exception_object->private_2 = (uintptr_t)sp;
        _LIBUNWIND_TRACE_UNWINDING(
            "unwind_phase1(ex_obj=%p): _URC_HANDLER_FOUND",
            (void *)exception_object);
        return _URC_NO_REASON;

      case _URC_CONTINUE_UNWIND:
        _LIBUNWIND_TRACE_UNWINDING(
            "unwind_phase1(ex_obj=%p): _URC_CONTINUE_UNWIND",
            (void *)exception_object);
        // continue unwinding
        break;

      default:
        // something went wrong
        _LIBUNWIND_TRACE_UNWINDING(
            "unwind_phase1(ex_obj=%p): _URC_FATAL_PHASE1_ERROR",
            (void *)exception_object);
        return _URC_FATAL_PHASE1_ERROR;
      }
    }
  }
  return _URC_NO_REASON;
}
```
- 向下找一个栈帧

- 通过查表(`.eh_frame_hdr`)获取这个栈帧的 FDE 头

search phase 比较好理解，一次只往下找一个栈，如果找到了 catch clause 或者需要析构的 RAII 对象，则会返回 `_URC_NO_REASON`，只有 search phase 返回 `_URC_NO_REASON` 才会继续向下走到 clean up phase。
#### __unw_step
```cpp
/// Move cursor to next frame.
_LIBUNWIND_HIDDEN int __unw_step(unw_cursor_t *cursor) {
  _LIBUNWIND_TRACE_API("__unw_step(cursor=%p)", static_cast<void *>(cursor));
  AbstractUnwindCursor *co = (AbstractUnwindCursor *)cursor;
  return co->step();
}
_LIBUNWIND_WEAK_ALIAS(__unw_step, unw_step)

template <typename A, typename R> int UnwindCursor<A, R>::step(bool stage2) {
  (void)stage2;
  // Bottom of stack is defined is when unwind info cannot be found.
  if (_unwindInfoMissing)
    return UNW_STEP_END;

  // Use unwinding info to modify register set as if function returned.
  int result;
#if defined(_LIBUNWIND_CHECK_LINUX_SIGRETURN) ||                               \
    defined(_LIBUNWIND_CHECK_HAIKU_SIGRETURN)
  if (_isSigReturn) {
    result = this->stepThroughSigReturn();
  } else
#endif
  {
#if defined(_LIBUNWIND_SUPPORT_COMPACT_UNWIND)
    result = this->stepWithCompactEncoding(stage2);
#elif defined(_LIBUNWIND_SUPPORT_SEH_UNWIND)
    result = this->stepWithSEHData();
#elif defined(_LIBUNWIND_SUPPORT_TBTAB_UNWIND)
    result = this->stepWithTBTableData();
#elif defined(_LIBUNWIND_SUPPORT_DWARF_UNWIND)
    result = this->stepWithDwarfFDE(stage2);
#elif defined(_LIBUNWIND_ARM_EHABI)
    result = this->stepWithEHABI();
#else
  #error Need _LIBUNWIND_SUPPORT_COMPACT_UNWIND or \
              _LIBUNWIND_SUPPORT_SEH_UNWIND or \
              _LIBUNWIND_SUPPORT_DWARF_UNWIND or \
              _LIBUNWIND_ARM_EHABI
#endif
  }

  // update info based on new PC
  if (result == UNW_STEP_SUCCESS) {
    this->setInfoBasedOnIPRegister(true);
    if (_unwindInfoMissing)
      return UNW_STEP_END;
  }

  return result;
}

// linux 标准
#if defined(_LIBUNWIND_SUPPORT_DWARF_UNWIND)
  bool getInfoFromFdeCie(const typename CFI_Parser<A>::FDE_Info &fdeInfo,
                         const typename CFI_Parser<A>::CIE_Info &cieInfo,
                         pint_t pc, uintptr_t dso_base);
  bool getInfoFromDwarfSection(const typename R::link_reg_t &pc,
                               const UnwindInfoSections &sects,
                               uint32_t fdeSectionOffsetHint = 0);
  int stepWithDwarfFDE(bool stage2) {
#if defined(_LIBUNWIND_TARGET_AARCH64_AUTHENTICATED_UNWINDING)
    typename R::reg_t rawPC = this->getReg(UNW_REG_IP);
    typename R::link_reg_t pc;
    _registers.loadAndAuthenticateLinkRegister(rawPC, &pc);
#else
    typename R::link_reg_t pc = this->getReg(UNW_REG_IP);
#endif
    return DwarfInstructions<A, R>::stepWithDwarf(
        _addressSpace, pc, (pint_t)_info.unwind_info, _registers,
        _isSignalFrame, stage2);
  }
#endif
```
_unw_step 这个函数的实际逻辑最后定位到了 libunwind 的 stepWithDwarfFDE（这是 linux 上的实现）。
- 首先会从栈帧上拿到保存的 ip (instruction pointer，即函数的返回地址)

- 然后调用 DwarfInstructions::stepWithDwarf:

```cpp
template <typename A, typename R>
int DwarfInstructions<A, R>::stepWithDwarf(A &addressSpace,
                                           const typename R::link_reg_t &pc,
                                           pint_t fdeStart, R &registers,
                                           bool &isSignalFrame, bool stage2) {
  FDE_Info fdeInfo;
  CIE_Info cieInfo;
  if (CFI_Parser<A>::decodeFDE(addressSpace, fdeStart, &fdeInfo,
                               &cieInfo) == NULL) {
    PrologInfo prolog;
    if (CFI_Parser<A>::parseFDEInstructions(addressSpace, fdeInfo, cieInfo, pc,
                                            R::getArch(), &prolog)) {
      // get pointer to cfa (architecture specific)
      pint_t cfa = getCFA(addressSpace, prolog, registers);

      (void)stage2;
      // __unw_step_stage2 is not used for cross unwinding, so we use
      // __aarch64__ rather than LIBUNWIND_TARGET_AARCH64 to make sure we are
      // building for AArch64 natively.
#if defined(__aarch64__)
      if (stage2 && cieInfo.mteTaggedFrame) {
        pint_t sp = registers.getSP();
        pint_t p = sp;
        // AArch64 doesn't require the value of SP to be 16-byte aligned at
        // all times, only at memory accesses and public interfaces [1]. Thus,
        // a signal could arrive at a point where SP is not aligned properly.
        // In that case, the kernel fixes up [2] the signal frame, but we
        // still have a misaligned SP in the previous frame. If that signal
        // handler caused stack unwinding, we would have an unaligned SP.
        // We do not need to fix up the CFA, as that is the SP at a "public
        // interface".
        // [1]:
        // https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst#622the-stack
        // [2]:
        // https://github.com/torvalds/linux/blob/1930a6e739c4b4a654a69164dbe39e554d228915/arch/arm64/kernel/signal.c#L718
        p &= ~0xfULL;
        // CFA is the bottom of the current stack frame.
        for (; p < cfa; p += 16) {
          __asm__ __volatile__(".arch armv8.5-a\n"
                               ".arch_extension memtag\n"
                               "stg %[Ptr], [%[Ptr]]\n"
                               :
                               : [Ptr] "r"(p)
                               : "memory");
        }
      }
#endif
      // restore registers that DWARF says were saved
      R newRegisters = registers;

      // Typically, the CFA is the stack pointer at the call site in
      // the previous frame. However, there are scenarios in which this is not
      // true. For example, if we switched to a new stack. In that case, the
      // value of the previous SP might be indicated by a CFI directive.
      //
      // We set the SP here to the CFA, allowing for it to be overridden
      // by a CFI directive later on.
      newRegisters.setSP(cfa);

      typename R::reg_t returnAddress = 0;
      constexpr int lastReg = R::lastDwarfRegNum();
      static_assert(static_cast<int>(CFI_Parser<A>::kMaxRegisterNumber) >=
                        lastReg,
                    "register range too large");
      assert(lastReg >= (int)cieInfo.returnAddressRegister &&
             "register range does not contain return address register");
      for (int i = 0; i <= lastReg; ++i) {
        if (prolog.savedRegisters[i].location !=
            CFI_Parser<A>::kRegisterUnused) {
          if (registers.validFloatRegister(i))
            newRegisters.setFloatRegister(
                i, getSavedFloatRegister(addressSpace, registers, cfa,
                                         prolog.savedRegisters[i]));
          else if (registers.validVectorRegister(i))
            newRegisters.setVectorRegister(
                i, getSavedVectorRegister(addressSpace, registers, cfa,
                                          prolog.savedRegisters[i]));
          else if (i == (int)cieInfo.returnAddressRegister)
            returnAddress = getSavedRegister(addressSpace, registers, cfa,
                                             prolog.savedRegisters[i]);
          else if (registers.validRegister(i))
            newRegisters.setRegister(
                i, getSavedRegister(addressSpace, registers, cfa,
                                    prolog.savedRegisters[i]));
          else
            return UNW_EBADREG;
        } else if (i == (int)cieInfo.returnAddressRegister) {
            // Leaf function keeps the return address in register and there is no
            // explicit instructions how to restore it.
            returnAddress = registers.getRegister(cieInfo.returnAddressRegister);
        }
      }

      isSignalFrame = cieInfo.isSignalFrame;

#if defined(_LIBUNWIND_TARGET_AARCH64) &&                                      \
    !defined(_LIBUNWIND_TARGET_AARCH64_AUTHENTICATED_UNWINDING)
      // There are two ways of return address signing: pac-ret (enabled via
      // -mbranch-protection=pac-ret) and ptrauth-returns (enabled as part of
      // Apple's arm64e or experimental pauthtest ABI on Linux). The code
      // below handles signed RA for pac-ret, while ptrauth-returns uses
      // different logic.
      // TODO: unify logic for both cases, see
      // https://github.com/llvm/llvm-project/issues/160110
      //
      // If the target is aarch64 then the return address may have been signed
      // using the v8.3 pointer authentication extensions. The original
      // return address needs to be authenticated before the return address is
      // restored. autia1716 is used instead of autia as autia1716 assembles
      // to a NOP on pre-v8.3a architectures.
      if ((R::getArch() == REGISTERS_ARM64) &&
          isReturnAddressSigned(addressSpace, registers, cfa, prolog) &&
          returnAddress != 0) {
#if !defined(_LIBUNWIND_IS_NATIVE_ONLY)
        return UNW_ECROSSRASIGNING;
#else
        register unsigned long long x17 __asm("x17") = returnAddress;
        register unsigned long long x16 __asm("x16") = cfa;

        // We use the hint versions of the authentication instructions below to
        // ensure they're assembled by the compiler even for targets with no
        // FEAT_PAuth/FEAT_PAuth_LR support.
        if (isReturnAddressSignedWithPC(addressSpace, registers, cfa, prolog)) {
          register unsigned long long x15 __asm("x15") =
              prolog.ptrAuthDiversifier;
          if (cieInfo.addressesSignedWithBKey) {
            asm("hint 0x27\n\t" // pacm
                "hint 0xe"
                : "+r"(x17)
                : "r"(x16), "r"(x15)); // autib1716
          } else {
            asm("hint 0x27\n\t" // pacm
                "hint 0xc"
                : "+r"(x17)
                : "r"(x16), "r"(x15)); // autia1716
          }
        } else {
          if (cieInfo.addressesSignedWithBKey)
            asm("hint 0xe" : "+r"(x17) : "r"(x16)); // autib1716
          else
            asm("hint 0xc" : "+r"(x17) : "r"(x16)); // autia1716
        }
        returnAddress = x17;
#endif
      }
#endif

#if defined(_LIBUNWIND_IS_NATIVE_ONLY) && defined(_LIBUNWIND_TARGET_ARM) &&    \
    defined(__ARM_FEATURE_PAUTH)
      if ((R::getArch() == REGISTERS_ARM) &&
          prolog.savedRegisters[UNW_ARM_RA_AUTH_CODE].value) {
        pint_t pac =
            getSavedRegister(addressSpace, registers, cfa,
                             prolog.savedRegisters[UNW_ARM_RA_AUTH_CODE]);
        __asm__ __volatile__("autg %0, %1, %2"
                             :
                             : "r"(pac), "r"(returnAddress), "r"(cfa)
                             :);
      }
#endif

#if defined(_LIBUNWIND_TARGET_SPARC)
      if (R::getArch() == REGISTERS_SPARC) {
        // Skip call site instruction and delay slot
        returnAddress += 8;
        // Skip unimp instruction if function returns a struct
        if ((addressSpace.get32(returnAddress) & 0xC1C00000) == 0)
          returnAddress += 4;
      }
#endif

#if defined(_LIBUNWIND_TARGET_SPARC64)
      // Skip call site instruction and delay slot.
      if (R::getArch() == REGISTERS_SPARC64)
        returnAddress += 8;
#endif

#if defined(_LIBUNWIND_TARGET_PPC64)
#define PPC64_ELFV1_R2_LOAD_INST_ENCODING 0xe8410028u // ld r2,40(r1)
#define PPC64_ELFV1_R2_OFFSET 40
#define PPC64_ELFV2_R2_LOAD_INST_ENCODING 0xe8410018u // ld r2,24(r1)
#define PPC64_ELFV2_R2_OFFSET 24
      // If the instruction at return address is a TOC (r2) restore,
      // then r2 was saved and needs to be restored.
      // ELFv2 ABI specifies that the TOC Pointer must be saved at SP + 24,
      // while in ELFv1 ABI it is saved at SP + 40.
      if (R::getArch() == REGISTERS_PPC64 && returnAddress != 0) {
        pint_t sp = newRegisters.getRegister(UNW_REG_SP);
        pint_t r2 = 0;
        switch (addressSpace.get32(returnAddress)) {
        case PPC64_ELFV1_R2_LOAD_INST_ENCODING:
          r2 = addressSpace.get64(sp + PPC64_ELFV1_R2_OFFSET);
          break;
        case PPC64_ELFV2_R2_LOAD_INST_ENCODING:
          r2 = addressSpace.get64(sp + PPC64_ELFV2_R2_OFFSET);
          break;
        }
        if (r2)
          newRegisters.setRegister(UNW_PPC64_R2, r2);
      }
#endif

      // Return address is address after call site instruction, so setting IP to
      // that does simulates a return.
      newRegisters.setIP(returnAddress);

      // Simulate the step by replacing the register set with the new ones.
      registers = newRegisters;

      return UNW_STEP_SUCCESS;
    }
  }
  return UNW_EBADFRAME;
}
```
看着虽然长，但有很多是在抹平指令集的平台差异，实际的逻辑还算比较清晰：
- `decodeFDE / parseFDEInstructions` 读 FDE （Frame Description Entry），解释执行 FDE 中的 DWARF 字节码，得到指定 PC 位置对应栈上保存的值的位置偏移量表
	![image](images/FHd2bbkXiot74ux7xVrcjHpAnGf.png)
- 拿到栈底基准地址

- 根据位置偏移量表获取到栈上保存的寄存器的所有值，恢复到拷贝的寄存器状态中

- 设置 IP 为 returnAddress（跳到上一层函数）

- 切换寄存器状态 register 为 newRegisters

#### __unw_get_proc_info
```cpp
/// Get unwind info at cursor position in stack frame.
_LIBUNWIND_HIDDEN int __unw_get_proc_info(unw_cursor_t *cursor,
                                          unw_proc_info_t *info) {
  _LIBUNWIND_TRACE_API("__unw_get_proc_info(cursor=%p, &info=%p)",
                       static_cast<void *>(cursor), static_cast<void *>(info));
  AbstractUnwindCursor *co = (AbstractUnwindCursor *)cursor;
  co->getInfo(info);
  if (info->end_ip == 0)
    return UNW_ENOINFO;
  return UNW_ESUCCESS;
}
_LIBUNWIND_WEAK_ALIAS(__unw_get_proc_info, unw_get_proc_info)

template <typename A, typename R>
bool UnwindCursor<A, R>::getInfoFromDwarfSection(
    const typename R::link_reg_t &pc, const UnwindInfoSections &sects,
    uint32_t fdeSectionOffsetHint) {
  typename CFI_Parser<A>::FDE_Info fdeInfo;
  typename CFI_Parser<A>::CIE_Info cieInfo;
  bool foundFDE = false;
  bool foundInCache = false;
  // If compact encoding table gave offset into dwarf section, go directly there
  if (fdeSectionOffsetHint != 0) {
    foundFDE = CFI_Parser<A>::findFDE(_addressSpace, pc, sects.dwarf_section,
                                    sects.dwarf_section_length,
                                    sects.dwarf_section + fdeSectionOffsetHint,
                                    &fdeInfo, &cieInfo);
  }
#if defined(_LIBUNWIND_SUPPORT_DWARF_INDEX)
  if (!foundFDE && (sects.dwarf_index_section != 0)) {
    foundFDE = EHHeaderParser<A>::findFDE(
        _addressSpace, pc, sects.dwarf_index_section,
        (uint32_t)sects.dwarf_index_section_length, &fdeInfo, &cieInfo);
  }
#endif
  if (!foundFDE) {
    // otherwise, search cache of previously found FDEs.
    pint_t cachedFDE = DwarfFDECache<A>::findFDE(sects.dso_base, pc);
    if (cachedFDE != 0) {
      foundFDE =
          CFI_Parser<A>::findFDE(_addressSpace, pc, sects.dwarf_section,
                                 sects.dwarf_section_length,
                                 cachedFDE, &fdeInfo, &cieInfo);
      foundInCache = foundFDE;
    }
  }
  if (!foundFDE) {
    // Still not found, do full scan of __eh_frame section.
    foundFDE = CFI_Parser<A>::findFDE(_addressSpace, pc, sects.dwarf_section,
                                      sects.dwarf_section_length, 0,
                                      &fdeInfo, &cieInfo);
  }
  if (foundFDE) {
    if (getInfoFromFdeCie(fdeInfo, cieInfo, pc, sects.dso_base)) {
      // Add to cache (to make next lookup faster) if we had no hint
      // and there was no index.
      if (!foundInCache && (fdeSectionOffsetHint == 0)) {
  #if defined(_LIBUNWIND_SUPPORT_DWARF_INDEX)
        if (sects.dwarf_index_section == 0)
  #endif
        DwarfFDECache<A>::add(sects.dso_base, fdeInfo.pcStart, fdeInfo.pcEnd,
                              fdeInfo.fdeStart);
      }
      return true;
    }
  }
  //_LIBUNWIND_DEBUG_LOG("can't find/use FDE for pc=0x%llX", (uint64_t)pc);
  return false;
}
```
这段代码主要是在查找 FDE 头：
- 如果有 `fdeSectionOffsetHint`，直接根据 `fdeSectionOffsetHint` 查找

- 如果没有，利用 `.eh_frame_hdr` 查找

- 如果没有，则从缓存中查找，如果这个函数之前 unwind 过，则会被 libunwind 在内存中记录下来

- 如果缓存中仍然找不到，则全量扫描一遍 `.eh_frame`

- 拿到后解析信息并将结果设置到缓存

#### get_handler_function
```c
struct unw_proc_info_t {
  unw_word_t __ptrauth_unwind_upi_startip start_ip; /* start address of function */
  unw_word_t __ptrauth_unwind_upi_endip end_ip;     /* address after end of function */
  unw_word_t __ptrauth_unwind_upi_lsda lsda;        /* address of language specific data area, */
                                                    /* or zero if not used */

  unw_word_t __ptrauth_unwind_upi_handler_intptr handler;
  unw_word_t  gp;                                   /* not used */
  unw_word_t __ptrauth_unwind_upi_flags flags;      /* not used */
  uint32_t   format;                                /* compact unwind encoding, or zero if none */
  uint32_t   unwind_info_size;                      /* size of DWARF unwind info, or zero if none */
  unw_word_t __ptrauth_unwind_upi_info unwind_info; /* address of DWARF unwind info, or zero */
  unw_word_t __ptrauth_unwind_upi_extra extra;      /* mach_header of mach-o image containing func */
};

static _Unwind_Personality_Fn get_handler_function(unw_proc_info_t *frameInfo) {
  uintptr_t __unwind_ptrauth_restricted_intptr(ptrauth_key_function_pointer,
                                               0,
                                               ptrauth_function_pointer_type_discriminator(_Unwind_Personality_Fn))
    reauthenticatedIntegerHandler = frameInfo->handler;
  _Unwind_Personality_Fn handler;
  memmove(&handler, (void *)&reauthenticatedIntegerHandler,
          sizeof(_Unwind_Personality_Fn));
  return handler;
}
```
从 FDE 头中拿到 handler 代码段，将其拷贝并返回，看起来 handler 代码段应该是固定长度，可以 alloc 在栈上。
### clean up phase
```cpp
static _Unwind_Reason_Code
unwind_phase2(unw_context_t *uc, unw_cursor_t *cursor,
              _Unwind_Exception *exception_object) {
  __unw_init_local(cursor, uc);

  _LIBUNWIND_TRACE_UNWINDING("unwind_phase2(ex_obj=%p)",
                             (void *)exception_object);

  // uc is initialized by __unw_getcontext in the parent frame. The first stack
  // frame walked is unwind_phase2.
  unsigned framesWalked = 1;
#if defined(_LIBUNWIND_USE_CET)
  unsigned long shadowStackTop = _get_ssp();
#elif defined(_LIBUNWIND_USE_GCS)
  unsigned long shadowStackTop = 0;
  if (__chkfeat(_CHKFEAT_GCS))
    shadowStackTop = (unsigned long)__gcspr();
#endif
  // Walk each frame until we reach where search phase said to stop.
  while (true) {

    // Ask libunwind to get next frame (skip over first which is
    // _Unwind_RaiseException).
    int stepResult = __unw_step_stage2(cursor);
    if (stepResult == 0) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase2(ex_obj=%p): __unw_step_stage2() reached "
          "bottom => _URC_END_OF_STACK",
          (void *)exception_object);
      return _URC_END_OF_STACK;
    } else if (stepResult < 0) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase2(ex_obj=%p): __unw_step_stage2 failed => "
          "_URC_FATAL_PHASE1_ERROR",
          (void *)exception_object);
      return _URC_FATAL_PHASE2_ERROR;
    }

    // Get info about this frame.
    unw_word_t sp;
    unw_proc_info_t frameInfo;
    __unw_get_reg(cursor, UNW_REG_SP, &sp);
    if (__unw_get_proc_info(cursor, &frameInfo) != UNW_ESUCCESS) {
      _LIBUNWIND_TRACE_UNWINDING(
          "unwind_phase2(ex_obj=%p): __unw_get_proc_info "
          "failed => _URC_FATAL_PHASE1_ERROR",
          (void *)exception_object);
      return _URC_FATAL_PHASE2_ERROR;
    }

#ifndef NDEBUG
    // When tracing, print state information.
    if (_LIBUNWIND_TRACING_UNWINDING) {
      char functionBuf[512];
      const char *functionName = functionBuf;
      unw_word_t offset;
      if ((__unw_get_proc_name(cursor, functionBuf, sizeof(functionBuf),
                               &offset) != UNW_ESUCCESS) ||
          (frameInfo.start_ip + offset > frameInfo.end_ip))
        functionName = ".anonymous.";
      _LIBUNWIND_TRACE_UNWINDING("unwind_phase2(ex_obj=%p): start_ip=0x%" PRIxPTR
                                 ", func=%s, sp=0x%" PRIxPTR ", lsda=0x%" PRIxPTR
                                 ", personality=0x%" PRIxPTR,
                                 (void *)exception_object, frameInfo.start_ip,
                                 functionName, sp, frameInfo.lsda,
                                 frameInfo.handler);
    }
#endif

// In shadow stack enabled environment, we check return address stored in normal
// stack against return address stored in shadow stack, if the 2 addresses don't
// match, it means return address in normal stack has been corrupted, we return
// _URC_FATAL_PHASE2_ERROR.
#if defined(_LIBUNWIND_USE_CET) || defined(_LIBUNWIND_USE_GCS)
    if (shadowStackTop != 0) {
      unw_word_t retInNormalStack;
      __unw_get_reg(cursor, UNW_REG_IP, &retInNormalStack);
      unsigned long retInShadowStack =
          *(unsigned long *)(shadowStackTop + __shstk_step_size * framesWalked);
      if (retInNormalStack != retInShadowStack)
        return _URC_FATAL_PHASE2_ERROR;
    }
#endif
    ++framesWalked;
    // If there is a personality routine, tell it we are unwinding.
    if (frameInfo.handler != 0) {
      _Unwind_Personality_Fn p = get_handler_function(&frameInfo);
      _Unwind_Action action = _UA_CLEANUP_PHASE;
      if (sp == exception_object->private_2) {
        // Tell personality this was the frame it marked in phase 1.
        action = (_Unwind_Action)(_UA_CLEANUP_PHASE | _UA_HANDLER_FRAME);
      }
       _Unwind_Reason_Code personalityResult =
          (*p)(1, action, exception_object->exception_class, exception_object,
               (struct _Unwind_Context *)(cursor));
      switch (personalityResult) {
      case _URC_CONTINUE_UNWIND:
        // Continue unwinding
        _LIBUNWIND_TRACE_UNWINDING(
            "unwind_phase2(ex_obj=%p): _URC_CONTINUE_UNWIND",
            (void *)exception_object);
        if (sp == exception_object->private_2) {
          // Phase 1 said we would stop at this frame, but we did not...
          _LIBUNWIND_ABORT("during phase1 personality function said it would "
                           "stop here, but now in phase2 it did not stop here");
        }
        break;
      case _URC_INSTALL_CONTEXT:
        _LIBUNWIND_TRACE_UNWINDING(
            "unwind_phase2(ex_obj=%p): _URC_INSTALL_CONTEXT",
            (void *)exception_object);
        // Personality routine says to transfer control to landing pad.
        // We may get control back if landing pad calls _Unwind_Resume().
        if (_LIBUNWIND_TRACING_UNWINDING) {
          unw_word_t pc;
          __unw_get_reg(cursor, UNW_REG_IP, &pc);
          __unw_get_reg(cursor, UNW_REG_SP, &sp);
          _LIBUNWIND_TRACE_UNWINDING("unwind_phase2(ex_obj=%p): re-entering "
                                     "user code with ip=0x%" PRIxPTR
                                     ", sp=0x%" PRIxPTR,
                                     (void *)exception_object, pc, sp);
        }

        __unw_phase2_resume(cursor, framesWalked);
        // __unw_phase2_resume() only returns if there was an error.
        return _URC_FATAL_PHASE2_ERROR;
      default:
        // Personality routine returned an unknown result code.
        _LIBUNWIND_DEBUG_LOG("personality function returned unknown result %d",
                             personalityResult);
        return _URC_FATAL_PHASE2_ERROR;
      }
    }
  }

  // Clean up phase did not resume at the frame that the search phase
  // said it would...
  return _URC_FATAL_PHASE2_ERROR;
}
```
- 向下遍历栈帧

- 获取当前栈帧信息 (`__unw_get_proc_info`)

- 如果当前栈帧有 handler（即有 catch clause 或需要析构的 RAII 对象），则执行这个 handler

- 如果是 catch 代码块，会直接通过修改 IP 跳转到 catch 块，所以函数不会返回。

- 如果是析构 RAII object，也会通过 `__unw_phase2_resume` 跳转到 landing pad，执行析构函数后调用 `_Unwind_Resume` 跳回 Unwinder。

#### __unw_step_stage2
跟前面 `_unw_step` 其实是一样的，只是 arm64 架构会有特殊处理。
#### __unw_phase2_resume
```java
#define __unw_phase2_resume(cursor, payload)                                   \
  do {                                                                         \
    _LIBUNWIND_POP_SHSTK_SSP((payload));                                       \
    void *shstkRegContext = __libunwind_shstk_get_registers((cursor));         \
    void *shstkJumpAddress = __libunwind_shstk_get_jump_target();              \
    __asm__ volatile("mov x0, %0\n\t"                                          \
                     "mov x1, #0\n\t"                                         \
                     "br %1\n\t"                                               \
                     :                                                         \
                     : "r"(shstkRegContext), "r"(shstkJumpAddress)             \
                     : "x0", "x1");                                            \
  } while (0)
#endif
```
`__unw_phase2_resume` 是一个宏，会跳到一个 trampoline，trampoline 会把 x0 中保存的寄存器状态（即 shstkRegContext）恢复到寄存器（包括 ip），此时就算成功跳转到 Landing Pad 了。
## Landing pad
Landing pad 中执行完析构函数后，会调用 `_Unwind_Resume` 跳转回 unwind 逻辑。
```cpp
_LIBUNWIND_EXPORT void
_Unwind_Resume(_Unwind_Exception *exception_object) {
  _LIBUNWIND_TRACE_API("_Unwind_Resume(ex_obj=%p)", (void *)exception_object);
  unw_context_t uc;
  unw_cursor_t cursor;
  __unw_getcontext(&uc);

  if (exception_object->private_1 != 0)
    unwind_phase2_forced(&uc, &cursor, exception_object,
                         (_Unwind_Stop_Fn) exception_object->private_1,
                         (void *)exception_object->private_2);
  else
    unwind_phase2(&uc, &cursor, exception_object);

  // Clients assume _Unwind_Resume() does not return, so all we can do is abort.
  _LIBUNWIND_ABORT("_Unwind_Resume() can't return");
}
```
其实就是重新调用了一下 `unwind_phase2` ，因为 `unwind_phase2` 里面是一个死循环的结构，所以恢复只需要再次调用就可以了，~~_想到了 Kotlin 协程，思路挺像的。_~~

至于参数就获取当前的寄存器快照就可以了，当前的sp其实就在当前 Landing pad 对应栈帧的下面一个栈帧，是 Landing pad 这个函数自己开辟的。

将这个寄存器快照传给 `unwind_phase2`，它所做的第一件事就是往上找一层，就找到了当前 Landing pad 对应的栈帧。

`unwind_phase2` 是通过 IP 来查找对应的 handler 的，当从 Landing pad 调用 `unwind_phase2` 时，IP 已经位于函数的末尾（Landing pad 就位于函数的末尾），所以会直接放行，不会查到第一次进入时 handler。
## AI 生成的流程图
![image](images/S711blWa9ol9ZlxmmlhcgUUJnvV.png)

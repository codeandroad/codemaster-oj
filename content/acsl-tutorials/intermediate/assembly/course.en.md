---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 12 — Assembly Language
description: Three original lessons trace the ACSL accumulator, labeled memory, arithmetic, branches and input-driven loops. Complete instruction tables separate stored values, the current ACC and printed output. Twelve original self-checks include worked traces. No prior machine-specific assembly knowledge is needed.
category: ACSL · Intermediate
estimatedMinutes: 100
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 12 — Assembly Language

## 章节：01. Separate the accumulator, memory and output

### 学习目标

- Distinguish a labeled memory value from immediate data written with `=`.
- Track exactly which instructions change ACC, memory, input position and output.
- Apply signed integer division without reversing operands or rounding down.

### 正文

#### Use the ACSL machine, not a particular processor

ACSL defines its own assembly language. This course follows its official Assembly Language Programming reference, not x86 or ARM. There is one accumulator, `ACC`, initially 0. A line has an optional `LABEL`, an uppercase `OPCODE`, and an operand `LOC` when required. Labels are case-sensitive names beginning with a letter; they identify memory words or instruction destinations. Uppercase opcode names are reserved. Indentation separates an unlabeled instruction from a label in the first column.

Execution starts at the first line and normally proceeds to the next line. `END` stops the program and has no operand. The line numbers in our trace tables are reading aids, not extra instructions. A dash means a memory value has not yet been supplied; it is not an assumed zero. All examples and self-checks are original; the associated contest programs remain separate practice activities.

#### Resolve the operand, then update the destination

Let $a$ be the old ACC and $v$ the operand value.

| Instruction | Change |
| --- | --- |
| `LOAD LOC` | Replace ACC by $v$; leave the source unchanged. |
| `STORE NAME` | Copy ACC into `NAME`; leave ACC unchanged. |
| `ADD LOC` | Put $a+v$ in ACC. |
| `SUB LOC` | Put $a-v$ in ACC. |
| `MULT LOC` | Put $av$ in ACC. |
| `DIV LOC` | Put the signed integer part of $a/v$ in ACC. |
| `READ NAME` | Consume the next input integer into `NAME`; do not change ACC. |
| `PRINT NAME` | Append the stored value of `NAME` to output; do not change ACC or memory. |
| `NAME DC n` | Define that memory word with constant $n$; do not change ACC. |

`LOAD X` reads the current contents of memory `X`; `LOAD =5` reads the literal number 5. The official immediate forms apply to `LOAD`, `ADD`, `SUB`, `MULT` and `DIV`. Use named locations for `STORE`, `READ` and `PRINT`; `STORE =5` is not “store into a variable named 5.” The reference does not define indirect-address syntax for these exercises. A value stored in `X` is data, not another address to follow.

The official arithmetic and input rules specify modulus 1,000,000 for `ADD`, `SUB`, `MULT` and `READ`. For example, the nonnegative sum $999998+5$ leaves 3. Our programs keep magnitudes below that boundary, so ordinary signed arithmetic is enough; they do not depend on an unspecified negative-overflow representation or a machine's two's-complement word size. Negative values such as $-6$ stay negative. Division keeps the signed integer part: $-17/5$ gives $-3$, not $-4$; $17/(-5)$ gives $-3$. Division by zero has no valid result in these exercises.

#### Worked program: a stored value survives a later LOAD

```text
X DC 14
Y DC -3
    LOAD X
    ADD =4
    DIV Y
    STORE T
    LOAD =5
    SUB Y
    MULT T
    STORE X
    PRINT T
    PRINT X
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `X DC 14` | 0 | `X=14; Y=—; T=—` | 2 | `[]` |
| 2 | 2 | `Y DC -3` | 0 | `X=14; Y=-3; T=—` | 3 | `[]` |
| 3 | 3 | `LOAD X` | 14 | `X=14; Y=-3; T=—` | 4 | `[]` |
| 4 | 4 | `ADD =4` | 18 | `X=14; Y=-3; T=—` | 5 | `[]` |
| 5 | 5 | `DIV Y` | -6 | `X=14; Y=-3; T=—` | 6 | `[]` |
| 6 | 6 | `STORE T` | -6 | `X=14; Y=-3; T=-6` | 7 | `[]` |
| 7 | 7 | `LOAD =5` | 5 | `X=14; Y=-3; T=-6` | 8 | `[]` |
| 8 | 8 | `SUB Y` | 8 | `X=14; Y=-3; T=-6` | 9 | `[]` |
| 9 | 9 | `MULT T` | -48 | `X=14; Y=-3; T=-6` | 10 | `[]` |
| 10 | 10 | `STORE X` | -48 | `X=-48; Y=-3; T=-6` | 11 | `[]` |
| 11 | 11 | `PRINT T` | -48 | `X=-48; Y=-3; T=-6` | 12 | `[-6]` |
| 12 | 12 | `PRINT X` | -48 | `X=-48; Y=-3; T=-6` | 13 | `[-6, -48]` |
| 13 | 13 | `END` | -48 | `X=-48; Y=-3; T=-6` | END | `[-6, -48]` |

After `DIV Y`, ACC is $18/(-3)=-6$. `STORE T` copies that value into `T`. Later, `LOAD =5` replaces only ACC; `T` remains -6. `SUB Y` computes $5-(-3)=8$, and `MULT T` computes $8(-6)=-48$. The output sequence is `[-6, -48]`, because each `PRINT` reads its named memory word, not an implicit ACC value.

#### READ does not secretly perform LOAD

Use input `12`:

```text
P DC 8
    LOAD =7
    READ P
    PRINT P
    ADD =2
    STORE P
    PRINT P
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `P DC 8` | 0 | `P=8` | 2 | `[]` |
| 2 | 2 | `LOAD =7` | 7 | `P=8` | 3 | `[]` |
| 3 | 3 | `READ P` | 7 | `P=12` | 4 | `[]` |
| 4 | 4 | `PRINT P` | 7 | `P=12` | 5 | `[12]` |
| 5 | 5 | `ADD =2` | 9 | `P=12` | 6 | `[12]` |
| 6 | 6 | `STORE P` | 9 | `P=9` | 7 | `[12]` |
| 7 | 7 | `PRINT P` | 9 | `P=9` | 8 | `[12, 9]` |
| 8 | 8 | `END` | 9 | `P=9` | END | `[12, 9]` |

`READ P` changes `P` to 12 while ACC stays 7. Therefore `ADD =2` makes ACC 9, not 14. Only the later `STORE P` changes `P` again. Output is `[12, 9]`. `DC`, `READ`, `STORE` and `PRINT` have different destinations even when they appear next to each other.

### 检查点

**1.** Trace this program. What is printed, and what are the final values of ACC, `A` and `B`?

```text
A DC 9
    LOAD A
    ADD =2
    STORE B
    LOAD =2
    PRINT B
    END
```

**2.** For four independent two-instruction fragments, use `LOAD` followed by `DIV`. Find the final ACC for `LOAD =-17; DIV =5`, `LOAD =17; DIV =-5`, `LOAD =-17; DIV =-5`, and `LOAD =17; DIV =5`. Semicolons here separate instructions on consecutive lines. Why is the first result not -4? What if the divisor is zero?

**3.** Determine every printed value. Does `ADD` update `X` automatically?

```text
X DC 4
    LOAD X
    ADD =6
    PRINT X
    STORE X
    PRINT X
    END
```

**4.** Trace the program with input `6, 11, 20`. Which input remains unread?

```text
    LOAD =4
    READ A
    READ B
    ADD A
    STORE C
    PRINT B
    PRINT C
    END
```

Completion standard: keep ACC and every written memory location separate; record output only at PRINT and input consumption only at READ.

### 参考答案

**1.** Output is `[11]`; final `ACC = 2`, `A = 9`, `B = 11`. Loading the immediate 2 does not erase the saved value of `B`.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `A DC 9` | 0 | `A=9; B=—` | 2 | `[]` |
| 2 | 2 | `LOAD A` | 9 | `A=9; B=—` | 3 | `[]` |
| 3 | 3 | `ADD =2` | 11 | `A=9; B=—` | 4 | `[]` |
| 4 | 4 | `STORE B` | 11 | `A=9; B=11` | 5 | `[]` |
| 5 | 5 | `LOAD =2` | 2 | `A=9; B=11` | 6 | `[]` |
| 6 | 6 | `PRINT B` | 2 | `A=9; B=11` | 7 | `[11]` |
| 7 | 7 | `END` | 2 | `A=9; B=11` | END | `[11]` |

**2.** The fragments are independent, so each starts with its own LOAD.

| Fragment | After LOAD | After DIV |
| --- | --- | --- |
| `LOAD =-17; DIV =5` | -17 | -3 |
| `LOAD =17; DIV =-5` | 17 | -3 |
| `LOAD =-17; DIV =-5` | -17 | 3 |
| `LOAD =17; DIV =5` | 17 | 3 |

Discard the fractional part while preserving the quotient's sign: $-3.4$ becomes $-3$. Rounding down would incorrectly produce -4. A zero divisor is invalid; do not invent zero, infinity or a successful continuation.

**3.** Output is `[4, 10]`. The first PRINT still sees `X = 4`; the ADD changed only ACC. STORE then copies 10 into `X`, so the second PRINT sees 10.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `X DC 4` | 0 | `X=4` | 2 | `[]` |
| 2 | 2 | `LOAD X` | 4 | `X=4` | 3 | `[]` |
| 3 | 3 | `ADD =6` | 10 | `X=4` | 4 | `[]` |
| 4 | 4 | `PRINT X` | 10 | `X=4` | 5 | `[4]` |
| 5 | 5 | `STORE X` | 10 | `X=10` | 6 | `[4]` |
| 6 | 6 | `PRINT X` | 10 | `X=10` | 7 | `[4, 10]` |
| 7 | 7 | `END` | 10 | `X=10` | END | `[4, 10]` |

**4.** Output is `[11, 10]`; `A = 6`, `B = 11`, `C = 10`, and `ACC = 10`. The two READs leave ACC at 4; `ADD A` then gives $4+6=10$. Only two input values are consumed, so `20` remains unread.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `LOAD =4` | 4 | `A=—; B=—; C=—` | 2 | `[]` |
| 2 | 2 | `READ A` | 4 | `A=6; B=—; C=—` | 3 | `[]` |
| 3 | 3 | `READ B` | 4 | `A=6; B=11; C=—` | 4 | `[]` |
| 4 | 4 | `ADD A` | 10 | `A=6; B=11; C=—` | 5 | `[]` |
| 5 | 5 | `STORE C` | 10 | `A=6; B=11; C=10` | 6 | `[]` |
| 6 | 6 | `PRINT B` | 10 | `A=6; B=11; C=10` | 7 | `[11]` |
| 7 | 7 | `PRINT C` | 10 | `A=6; B=11; C=10` | 8 | `[11, 10]` |
| 8 | 8 | `END` | 10 | `A=6; B=11; C=10` | END | `[11, 10]` |

### 关联题目

[]

## 章节：02. Branch using the current ACC

### 学习目标

- Distinguish `BG`, `BE`, `BL` and `BU`, including the equality boundary.
- Compare two values by subtraction and preserve the comparison result until its branch.
- Follow a loop's actual next instruction and separate printed values from loop counts.

### 正文

#### A branch reads ACC now

| Opcode | Take the branch when | Otherwise |
| --- | --- | --- |
| `BG LABEL` | ACC is greater than 0 | Continue at the next line |
| `BE LABEL` | ACC equals 0 | Continue at the next line |
| `BL LABEL` | ACC is less than 0 | Continue at the next line |
| `BU LABEL` | Always | No fall-through case |

A branch changes only the next instruction. It does not change ACC or memory, print anything, or return automatically after the target instruction. The operand names an **instruction label**, not a stored value to compare against. There is no separate saved comparison flag in this ACSL model.

To compare `N` with 3, `LOAD N; SUB =3` leaves $N-3$ in ACC. A positive result means $N>3$, zero means equality, and a negative result means $N<3$. Any intervening LOAD or arithmetic instruction can replace that result before the branch. STORE and PRINT do not replace it.

#### Three outcomes with a shared STORE

For input `5`, this program prints 1. Other inputs will be checked in the self-check.

```text
    READ N
    LOAD N
    SUB =3
    BL LOW
    BE SAME
    LOAD =1
    BU SAVE
LOW LOAD =-1
    BU SAVE
SAME LOAD =0
SAVE STORE R
    PRINT R
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `READ N` | 0 | `N=5; R=—` | 2 | `[]` |
| 2 | 2 | `LOAD N` | 5 | `N=5; R=—` | 3 | `[]` |
| 3 | 3 | `SUB =3` | 2 | `N=5; R=—` | 4 | `[]` |
| 4 | 4 | `BL LOW` | 2 | `N=5; R=—` | 5 | `[]` |
| 5 | 5 | `BE SAME` | 2 | `N=5; R=—` | 6 | `[]` |
| 6 | 6 | `LOAD =1` | 1 | `N=5; R=—` | 7 | `[]` |
| 7 | 7 | `BU SAVE` | 1 | `N=5; R=—` | 11 | `[]` |
| 8 | 11 | `SAVE STORE R` | 1 | `N=5; R=1` | 12 | `[]` |
| 9 | 12 | `PRINT R` | 1 | `N=5; R=1` | 13 | `[1]` |
| 10 | 13 | `END` | 1 | `N=5; R=1` | END | `[1]` |

The two conditional branches are not taken because ACC is 2. `LOAD =1` prepares the result, and `BU SAVE` skips the other result-setting blocks. At `SAVE`, the same STORE and PRINT serve all paths. Without the unconditional jump, execution could fall through into another block and overwrite the intended result.

#### A countdown: test after updating memory

```text
N DC 2
TOP LOAD N
    PRINT N
    SUB =1
    STORE N
    BG TOP
    PRINT N
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `N DC 2` | 0 | `N=2` | 2 | `[]` |
| 2 | 2 | `TOP LOAD N` | 2 | `N=2` | 3 | `[]` |
| 3 | 3 | `PRINT N` | 2 | `N=2` | 4 | `[2]` |
| 4 | 4 | `SUB =1` | 1 | `N=2` | 5 | `[2]` |
| 5 | 5 | `STORE N` | 1 | `N=1` | 6 | `[2]` |
| 6 | 6 | `BG TOP` | 1 | `N=1` | 2 | `[2]` |
| 7 | 2 | `TOP LOAD N` | 1 | `N=1` | 3 | `[2]` |
| 8 | 3 | `PRINT N` | 1 | `N=1` | 4 | `[2, 1]` |
| 9 | 4 | `SUB =1` | 0 | `N=1` | 5 | `[2, 1]` |
| 10 | 5 | `STORE N` | 0 | `N=0` | 6 | `[2, 1]` |
| 11 | 6 | `BG TOP` | 0 | `N=0` | 7 | `[2, 1]` |
| 12 | 7 | `PRINT N` | 0 | `N=0` | 8 | `[2, 1, 0]` |
| 13 | 8 | `END` | 0 | `N=0` | END | `[2, 1, 0]` |

Output is `[2, 1, 0]`. Each pass first prints the old `N`, then subtracts 1 and stores the new value. At `BG TOP`, ACC is the new `N`: 1 on the first visit, 0 on the second. Zero is **not greater than zero**, so the second visit falls through to the final PRINT. The loop body executes twice, yet three values are printed. Count PRINT executions rather than counting iterations alone.

### 检查点

**1.** Run the three-outcome program separately with input `0`, `3` and `7`. Give each output and the executed line sequence. What does the equality case skip?

**2.** What does this program print? Explain which instruction determines the ACC tested by `BE ZERO`. What changes if `LOAD =1` is removed?

```text
X DC 5
    LOAD X
    SUB =5
    LOAD =1
    BE ZERO
    PRINT X
ZERO END
```

**3.** For ACC values -2, 0 and 2, mark whether each of BG, BE, BL and BU takes its branch. Do any of the four instructions change ACC?

**4.** In the countdown program, replace only `BG TOP` with `BE TOP`, keeping `N DC 2`. Trace the changed program. Why does it no longer print the same sequence?

Completion standard: record only executed instructions, show the ACC used at every branch, and explain the zero boundary and every PRINT.

### 参考答案

**1.** Input 0 prints `[-1]`: the difference is -3 and BL jumps to LOW. Input 3 prints `[0]`: BL falls through, then BE jumps to SAME. Input 7 prints `[1]`: the difference is 4, so both conditional branches fall through. In the equality case, execution skips both the positive-result and negative-result blocks.

Input `0`:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `READ N` | 0 | `N=0; R=—` | 2 | `[]` |
| 2 | 2 | `LOAD N` | 0 | `N=0; R=—` | 3 | `[]` |
| 3 | 3 | `SUB =3` | -3 | `N=0; R=—` | 4 | `[]` |
| 4 | 4 | `BL LOW` | -3 | `N=0; R=—` | 8 | `[]` |
| 5 | 8 | `LOW LOAD =-1` | -1 | `N=0; R=—` | 9 | `[]` |
| 6 | 9 | `BU SAVE` | -1 | `N=0; R=—` | 11 | `[]` |
| 7 | 11 | `SAVE STORE R` | -1 | `N=0; R=-1` | 12 | `[]` |
| 8 | 12 | `PRINT R` | -1 | `N=0; R=-1` | 13 | `[-1]` |
| 9 | 13 | `END` | -1 | `N=0; R=-1` | END | `[-1]` |

Input `3`:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `READ N` | 0 | `N=3; R=—` | 2 | `[]` |
| 2 | 2 | `LOAD N` | 3 | `N=3; R=—` | 3 | `[]` |
| 3 | 3 | `SUB =3` | 0 | `N=3; R=—` | 4 | `[]` |
| 4 | 4 | `BL LOW` | 0 | `N=3; R=—` | 5 | `[]` |
| 5 | 5 | `BE SAME` | 0 | `N=3; R=—` | 10 | `[]` |
| 6 | 10 | `SAME LOAD =0` | 0 | `N=3; R=—` | 11 | `[]` |
| 7 | 11 | `SAVE STORE R` | 0 | `N=3; R=0` | 12 | `[]` |
| 8 | 12 | `PRINT R` | 0 | `N=3; R=0` | 13 | `[0]` |
| 9 | 13 | `END` | 0 | `N=3; R=0` | END | `[0]` |

Input `7`:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `READ N` | 0 | `N=7; R=—` | 2 | `[]` |
| 2 | 2 | `LOAD N` | 7 | `N=7; R=—` | 3 | `[]` |
| 3 | 3 | `SUB =3` | 4 | `N=7; R=—` | 4 | `[]` |
| 4 | 4 | `BL LOW` | 4 | `N=7; R=—` | 5 | `[]` |
| 5 | 5 | `BE SAME` | 4 | `N=7; R=—` | 6 | `[]` |
| 6 | 6 | `LOAD =1` | 1 | `N=7; R=—` | 7 | `[]` |
| 7 | 7 | `BU SAVE` | 1 | `N=7; R=—` | 11 | `[]` |
| 8 | 11 | `SAVE STORE R` | 1 | `N=7; R=1` | 12 | `[]` |
| 9 | 12 | `PRINT R` | 1 | `N=7; R=1` | 13 | `[1]` |
| 10 | 13 | `END` | 1 | `N=7; R=1` | END | `[1]` |

**2.** It prints `[5]`. SUB first produces zero, but the following LOAD replaces ACC by 1. BE therefore does not jump; PRINT executes before reaching END.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `X DC 5` | 0 | `X=5` | 2 | `[]` |
| 2 | 2 | `LOAD X` | 5 | `X=5` | 3 | `[]` |
| 3 | 3 | `SUB =5` | 0 | `X=5` | 4 | `[]` |
| 4 | 4 | `LOAD =1` | 1 | `X=5` | 5 | `[]` |
| 5 | 5 | `BE ZERO` | 1 | `X=5` | 6 | `[]` |
| 6 | 6 | `PRINT X` | 1 | `X=5` | 7 | `[5]` |
| 7 | 7 | `ZERO END` | 1 | `X=5` | END | `[5]` |

Removing `LOAD =1` leaves the subtraction's zero intact, so BE jumps directly to `ZERO END` and output is `[]`. A branch tests the current ACC, not the last subtraction remembered elsewhere.

**3.** In this table `T` means taken, `F` means fall through. The ACC column is unchanged by the branch.

| ACC | BG | BE | BL | BU |
| --- | --- | --- | --- | --- |
| -2 | F | F | T | T |
| 0 | F | T | F | T |
| 2 | T | F | F | T |

All four leave ACC unchanged. BU has no condition; BE has exactly the zero case.

**4.** The changed program prints `[2, 1]`. After the first subtraction and STORE, ACC and `N` are 1. BE is false, so execution falls through immediately to the final PRINT and END. There is no second loop-body visit.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `N DC 2` | 0 | `N=2` | 2 | `[]` |
| 2 | 2 | `TOP LOAD N` | 2 | `N=2` | 3 | `[]` |
| 3 | 3 | `PRINT N` | 2 | `N=2` | 4 | `[2]` |
| 4 | 4 | `SUB =1` | 1 | `N=2` | 5 | `[2]` |
| 5 | 5 | `STORE N` | 1 | `N=1` | 6 | `[2]` |
| 6 | 6 | `BE TOP` | 1 | `N=1` | 7 | `[2]` |
| 7 | 7 | `PRINT N` | 1 | `N=1` | 8 | `[2, 1]` |
| 8 | 8 | `END` | 1 | `N=1` | END | `[2, 1]` |

### 关联题目

[]

## 章节：03. Account for every loop visit and every input value

### 学习目标

- Identify the loop entry, stopping test, update and back edge.
- Track a sentinel without counting it as data or reading beyond termination.
- Derive a loop invariant and use it to check a full instruction trace.

### 正文

#### A zero sentinel ends input processing

A sentinel is a value used to signal termination. This program sums all integers before the first zero, including negative integers. Use input `4, -1, 0, 9`.

```text
SUM DC 0
TOP READ X
    LOAD X
    BE DONE
    ADD SUM
    STORE SUM
    BU TOP
DONE PRINT SUM
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `SUM DC 0` | 0 | `SUM=0; X=—` | 2 | `[]` |
| 2 | 2 | `TOP READ X` | 0 | `SUM=0; X=4` | 3 | `[]` |
| 3 | 3 | `LOAD X` | 4 | `SUM=0; X=4` | 4 | `[]` |
| 4 | 4 | `BE DONE` | 4 | `SUM=0; X=4` | 5 | `[]` |
| 5 | 5 | `ADD SUM` | 4 | `SUM=0; X=4` | 6 | `[]` |
| 6 | 6 | `STORE SUM` | 4 | `SUM=4; X=4` | 7 | `[]` |
| 7 | 7 | `BU TOP` | 4 | `SUM=4; X=4` | 2 | `[]` |
| 8 | 2 | `TOP READ X` | 4 | `SUM=4; X=-1` | 3 | `[]` |
| 9 | 3 | `LOAD X` | -1 | `SUM=4; X=-1` | 4 | `[]` |
| 10 | 4 | `BE DONE` | -1 | `SUM=4; X=-1` | 5 | `[]` |
| 11 | 5 | `ADD SUM` | 3 | `SUM=4; X=-1` | 6 | `[]` |
| 12 | 6 | `STORE SUM` | 3 | `SUM=3; X=-1` | 7 | `[]` |
| 13 | 7 | `BU TOP` | 3 | `SUM=3; X=-1` | 2 | `[]` |
| 14 | 2 | `TOP READ X` | 3 | `SUM=3; X=0` | 3 | `[]` |
| 15 | 3 | `LOAD X` | 0 | `SUM=3; X=0` | 4 | `[]` |
| 16 | 4 | `BE DONE` | 0 | `SUM=3; X=0` | 8 | `[]` |
| 17 | 8 | `DONE PRINT SUM` | 0 | `SUM=3; X=0` | 9 | `[3]` |
| 18 | 9 | `END` | 0 | `SUM=3; X=0` | END | `[3]` |

Output is `[3]`. Before each READ, `SUM` equals the sum of the nonzero values already processed. READ stores the next value in `X`; LOAD makes it the tested ACC. When `X = 0`, BE reaches DONE **before** ADD, STORE and the back edge. Three READs occur, only two additions occur, and `9` remains unread. A negative value is ordinary data here because BE tests equality, not negativity.

`READ X` alone would not put the newly read value in ACC. Removing `LOAD X` could make the stopping decision use an old sum. Nor should an exhausted input list be treated as if it supplied an extra zero: the program has not successfully reached END unless the trace actually does so.

#### A known number of iterations: test before the body

This second program adds a descending counter into TOTAL. Start with the shown counter 2.

```text
COUNT DC 2
TOTAL DC 0
TOP LOAD COUNT
    BE STOP
    ADD TOTAL
    STORE TOTAL
    LOAD COUNT
    SUB =1
    STORE COUNT
    BU TOP
STOP PRINT TOTAL
    END
```

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `COUNT DC 2` | 0 | `COUNT=2; TOTAL=—` | 2 | `[]` |
| 2 | 2 | `TOTAL DC 0` | 0 | `COUNT=2; TOTAL=0` | 3 | `[]` |
| 3 | 3 | `TOP LOAD COUNT` | 2 | `COUNT=2; TOTAL=0` | 4 | `[]` |
| 4 | 4 | `BE STOP` | 2 | `COUNT=2; TOTAL=0` | 5 | `[]` |
| 5 | 5 | `ADD TOTAL` | 2 | `COUNT=2; TOTAL=0` | 6 | `[]` |
| 6 | 6 | `STORE TOTAL` | 2 | `COUNT=2; TOTAL=2` | 7 | `[]` |
| 7 | 7 | `LOAD COUNT` | 2 | `COUNT=2; TOTAL=2` | 8 | `[]` |
| 8 | 8 | `SUB =1` | 1 | `COUNT=2; TOTAL=2` | 9 | `[]` |
| 9 | 9 | `STORE COUNT` | 1 | `COUNT=1; TOTAL=2` | 10 | `[]` |
| 10 | 10 | `BU TOP` | 1 | `COUNT=1; TOTAL=2` | 3 | `[]` |
| 11 | 3 | `TOP LOAD COUNT` | 1 | `COUNT=1; TOTAL=2` | 4 | `[]` |
| 12 | 4 | `BE STOP` | 1 | `COUNT=1; TOTAL=2` | 5 | `[]` |
| 13 | 5 | `ADD TOTAL` | 3 | `COUNT=1; TOTAL=2` | 6 | `[]` |
| 14 | 6 | `STORE TOTAL` | 3 | `COUNT=1; TOTAL=3` | 7 | `[]` |
| 15 | 7 | `LOAD COUNT` | 1 | `COUNT=1; TOTAL=3` | 8 | `[]` |
| 16 | 8 | `SUB =1` | 0 | `COUNT=1; TOTAL=3` | 9 | `[]` |
| 17 | 9 | `STORE COUNT` | 0 | `COUNT=0; TOTAL=3` | 10 | `[]` |
| 18 | 10 | `BU TOP` | 0 | `COUNT=0; TOTAL=3` | 3 | `[]` |
| 19 | 3 | `TOP LOAD COUNT` | 0 | `COUNT=0; TOTAL=3` | 4 | `[]` |
| 20 | 4 | `BE STOP` | 0 | `COUNT=0; TOTAL=3` | 11 | `[]` |
| 21 | 11 | `STOP PRINT TOTAL` | 0 | `COUNT=0; TOTAL=3` | 12 | `[3]` |
| 22 | 12 | `END` | 0 | `COUNT=0; TOTAL=3` | END | `[3]` |

Output is `[3]`. The body adds 2, then 1. The test at `BE STOP` is visited a third time with zero, but that visit does not execute the addition. `STORE COUNT` is essential: it changes the value reloaded at the next TOP. Updating ACC alone would not reduce the stored counter.

For initial counter $k\ge0$ small enough to avoid overflow, at TOP the invariant is: `TOTAL` contains the values already added, and `COUNT` is the next value to add. If COUNT is zero, stop; otherwise add it and decrease the stored counter by one. Thus the final total is $k(k+1)/2$, with $k$ body executions, $k+1$ zero tests and one PRINT. Check these counts against instruction visits, not source-line counts.

#### Termination needs a changing condition

A branch back to TOP is not evidence that a loop eventually ends. This program has a fixed positive stored value:

```text
X DC 1
TOP LOAD X
    BG TOP
    END
```

After initialization, lines 2 and 3 repeat. LOAD always reads 1 and BG always jumps back; END is unreachable. A checker must stop after a bounded number of steps, but the mathematical reason for nontermination is the invariant `X = 1`, not merely that a short simulation ran for a long time.

### 检查点

**1.** Run the sentinel program with input `2, 5, 0, -4`. Give the output, number of READs, number of additions, and unused input.

**2.** Run the sentinel program with input `0, 8`. Then consider input containing only `2, 5`, with no further value available. Is either case allowed to assume another zero?

**3.** Run the counter-sum program with initial COUNT 0 and 1. Give the output and body/test counts. For initial COUNT 2, what goes wrong if `STORE COUNT` is removed while the other lines are retained?

**4.** Trace the following halving program. Give the sequence of stored `N` values, output, and number of visits to `BE DONE`. Why are those counts different?

```text
N DC 13
C DC 0
TOP LOAD N
    BE DONE
    DIV =2
    STORE N
    LOAD C
    ADD =1
    STORE C
    BU TOP
DONE PRINT C
    END
```

Completion standard: identify the loop invariant, count body and test visits separately, and account for consumed and unread input without inventing a termination value.

### 参考答案

**1.** Output is `[7]`. Three READs consume `2`, `5`, `0`; two ADDs process the nonzero values. Input `-4` remains unread. The complete trace is:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `SUM DC 0` | 0 | `SUM=0; X=—` | 2 | `[]` |
| 2 | 2 | `TOP READ X` | 0 | `SUM=0; X=2` | 3 | `[]` |
| 3 | 3 | `LOAD X` | 2 | `SUM=0; X=2` | 4 | `[]` |
| 4 | 4 | `BE DONE` | 2 | `SUM=0; X=2` | 5 | `[]` |
| 5 | 5 | `ADD SUM` | 2 | `SUM=0; X=2` | 6 | `[]` |
| 6 | 6 | `STORE SUM` | 2 | `SUM=2; X=2` | 7 | `[]` |
| 7 | 7 | `BU TOP` | 2 | `SUM=2; X=2` | 2 | `[]` |
| 8 | 2 | `TOP READ X` | 2 | `SUM=2; X=5` | 3 | `[]` |
| 9 | 3 | `LOAD X` | 5 | `SUM=2; X=5` | 4 | `[]` |
| 10 | 4 | `BE DONE` | 5 | `SUM=2; X=5` | 5 | `[]` |
| 11 | 5 | `ADD SUM` | 7 | `SUM=2; X=5` | 6 | `[]` |
| 12 | 6 | `STORE SUM` | 7 | `SUM=7; X=5` | 7 | `[]` |
| 13 | 7 | `BU TOP` | 7 | `SUM=7; X=5` | 2 | `[]` |
| 14 | 2 | `TOP READ X` | 7 | `SUM=7; X=0` | 3 | `[]` |
| 15 | 3 | `LOAD X` | 0 | `SUM=7; X=0` | 4 | `[]` |
| 16 | 4 | `BE DONE` | 0 | `SUM=7; X=0` | 8 | `[]` |
| 17 | 8 | `DONE PRINT SUM` | 0 | `SUM=7; X=0` | 9 | `[7]` |
| 18 | 9 | `END` | 0 | `SUM=7; X=0` | END | `[7]` |

**2.** With `0, 8`, the first READ supplies the sentinel; output is `[0]`, no addition executes, and `8` remains unread.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `SUM DC 0` | 0 | `SUM=0; X=—` | 2 | `[]` |
| 2 | 2 | `TOP READ X` | 0 | `SUM=0; X=0` | 3 | `[]` |
| 3 | 3 | `LOAD X` | 0 | `SUM=0; X=0` | 4 | `[]` |
| 4 | 4 | `BE DONE` | 0 | `SUM=0; X=0` | 8 | `[]` |
| 5 | 8 | `DONE PRINT SUM` | 0 | `SUM=0; X=0` | 9 | `[0]` |
| 6 | 9 | `END` | 0 | `SUM=0; X=0` | END | `[0]` |

With only `2, 5`, SUM becomes 7 and the machine returns to TOP for a third READ. No input is available there. It has printed nothing and has not reached END: the trace is incomplete due to exhausted input, not a successful run with output 7. In neither case may we manufacture another input value.

**3.** Starting at 0 prints `[0]`: zero body executions and one zero test. Starting at 1 prints `[1]`: one body execution and two zero tests.

Initial COUNT `0`:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `COUNT DC 0` | 0 | `COUNT=0; TOTAL=—` | 2 | `[]` |
| 2 | 2 | `TOTAL DC 0` | 0 | `COUNT=0; TOTAL=0` | 3 | `[]` |
| 3 | 3 | `TOP LOAD COUNT` | 0 | `COUNT=0; TOTAL=0` | 4 | `[]` |
| 4 | 4 | `BE STOP` | 0 | `COUNT=0; TOTAL=0` | 11 | `[]` |
| 5 | 11 | `STOP PRINT TOTAL` | 0 | `COUNT=0; TOTAL=0` | 12 | `[0]` |
| 6 | 12 | `END` | 0 | `COUNT=0; TOTAL=0` | END | `[0]` |

Initial COUNT `1`:

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `COUNT DC 1` | 0 | `COUNT=1; TOTAL=—` | 2 | `[]` |
| 2 | 2 | `TOTAL DC 0` | 0 | `COUNT=1; TOTAL=0` | 3 | `[]` |
| 3 | 3 | `TOP LOAD COUNT` | 1 | `COUNT=1; TOTAL=0` | 4 | `[]` |
| 4 | 4 | `BE STOP` | 1 | `COUNT=1; TOTAL=0` | 5 | `[]` |
| 5 | 5 | `ADD TOTAL` | 1 | `COUNT=1; TOTAL=0` | 6 | `[]` |
| 6 | 6 | `STORE TOTAL` | 1 | `COUNT=1; TOTAL=1` | 7 | `[]` |
| 7 | 7 | `LOAD COUNT` | 1 | `COUNT=1; TOTAL=1` | 8 | `[]` |
| 8 | 8 | `SUB =1` | 0 | `COUNT=1; TOTAL=1` | 9 | `[]` |
| 9 | 9 | `STORE COUNT` | 0 | `COUNT=0; TOTAL=1` | 10 | `[]` |
| 10 | 10 | `BU TOP` | 0 | `COUNT=0; TOTAL=1` | 3 | `[]` |
| 11 | 3 | `TOP LOAD COUNT` | 0 | `COUNT=0; TOTAL=1` | 4 | `[]` |
| 12 | 4 | `BE STOP` | 0 | `COUNT=0; TOTAL=1` | 11 | `[]` |
| 13 | 11 | `STOP PRINT TOTAL` | 0 | `COUNT=0; TOTAL=1` | 12 | `[1]` |
| 14 | 12 | `END` | 0 | `COUNT=0; TOTAL=1` | END | `[1]` |

If `STORE COUNT` is removed with initial COUNT 2, memory COUNT stays 2. Each TOP reloads that 2, so BE never sees zero; the final PRINT is unreachable. TOTAL changes, but it is not the stopping variable. The stored-counter invariant, not a limit on simulation steps, proves the defect.

**4.** Stored `N` follows `13 → 6 → 3 → 1 → 0`; DIV keeps the integer part at each halving. `C` counts the four divisions, so output is `[4]`. BE is visited five times, including the final visit that observes zero and performs no division. The initial `N DC 13` is an initialization, not a fifth division.

| Step | Line | Instruction | ACC | Memory | Next line | Output so far |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | `N DC 13` | 0 | `N=13; C=—` | 2 | `[]` |
| 2 | 2 | `C DC 0` | 0 | `N=13; C=0` | 3 | `[]` |
| 3 | 3 | `TOP LOAD N` | 13 | `N=13; C=0` | 4 | `[]` |
| 4 | 4 | `BE DONE` | 13 | `N=13; C=0` | 5 | `[]` |
| 5 | 5 | `DIV =2` | 6 | `N=13; C=0` | 6 | `[]` |
| 6 | 6 | `STORE N` | 6 | `N=6; C=0` | 7 | `[]` |
| 7 | 7 | `LOAD C` | 0 | `N=6; C=0` | 8 | `[]` |
| 8 | 8 | `ADD =1` | 1 | `N=6; C=0` | 9 | `[]` |
| 9 | 9 | `STORE C` | 1 | `N=6; C=1` | 10 | `[]` |
| 10 | 10 | `BU TOP` | 1 | `N=6; C=1` | 3 | `[]` |
| 11 | 3 | `TOP LOAD N` | 6 | `N=6; C=1` | 4 | `[]` |
| 12 | 4 | `BE DONE` | 6 | `N=6; C=1` | 5 | `[]` |
| 13 | 5 | `DIV =2` | 3 | `N=6; C=1` | 6 | `[]` |
| 14 | 6 | `STORE N` | 3 | `N=3; C=1` | 7 | `[]` |
| 15 | 7 | `LOAD C` | 1 | `N=3; C=1` | 8 | `[]` |
| 16 | 8 | `ADD =1` | 2 | `N=3; C=1` | 9 | `[]` |
| 17 | 9 | `STORE C` | 2 | `N=3; C=2` | 10 | `[]` |
| 18 | 10 | `BU TOP` | 2 | `N=3; C=2` | 3 | `[]` |
| 19 | 3 | `TOP LOAD N` | 3 | `N=3; C=2` | 4 | `[]` |
| 20 | 4 | `BE DONE` | 3 | `N=3; C=2` | 5 | `[]` |
| 21 | 5 | `DIV =2` | 1 | `N=3; C=2` | 6 | `[]` |
| 22 | 6 | `STORE N` | 1 | `N=1; C=2` | 7 | `[]` |
| 23 | 7 | `LOAD C` | 2 | `N=1; C=2` | 8 | `[]` |
| 24 | 8 | `ADD =1` | 3 | `N=1; C=2` | 9 | `[]` |
| 25 | 9 | `STORE C` | 3 | `N=1; C=3` | 10 | `[]` |
| 26 | 10 | `BU TOP` | 3 | `N=1; C=3` | 3 | `[]` |
| 27 | 3 | `TOP LOAD N` | 1 | `N=1; C=3` | 4 | `[]` |
| 28 | 4 | `BE DONE` | 1 | `N=1; C=3` | 5 | `[]` |
| 29 | 5 | `DIV =2` | 0 | `N=1; C=3` | 6 | `[]` |
| 30 | 6 | `STORE N` | 0 | `N=0; C=3` | 7 | `[]` |
| 31 | 7 | `LOAD C` | 3 | `N=0; C=3` | 8 | `[]` |
| 32 | 8 | `ADD =1` | 4 | `N=0; C=3` | 9 | `[]` |
| 33 | 9 | `STORE C` | 4 | `N=0; C=4` | 10 | `[]` |
| 34 | 10 | `BU TOP` | 4 | `N=0; C=4` | 3 | `[]` |
| 35 | 3 | `TOP LOAD N` | 0 | `N=0; C=4` | 4 | `[]` |
| 36 | 4 | `BE DONE` | 0 | `N=0; C=4` | 11 | `[]` |
| 37 | 11 | `DONE PRINT C` | 0 | `N=0; C=4` | 12 | `[4]` |
| 38 | 12 | `END` | 0 | `N=0; C=4` | END | `[4]` |

### 关联题目

[]

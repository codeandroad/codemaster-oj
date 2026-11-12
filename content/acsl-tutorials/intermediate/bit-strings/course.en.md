---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 5 — Bit-String Operations
description: Three original lessons on fixed-width bitwise logic, shifts and circular rotations, and equations with unknown bits. Keep intermediate states visible, distinguish lost information from reversible operations, and check solution counts independently.
category: ACSL · Intermediate
estimatedMinutes: 75
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 5 — Bit-String Operations

## 章节：01. Keep the width and work one column at a time

### 学习目标

- Preserve every bit position, including leading zeros, and align operands to a common width.
- Apply NOT, AND, OR, and XOR using a one-bit truth table.
- Evaluate a mixed expression in the stated precedence order and check intermediate results.

### 正文

#### Prerequisite check: a bit string has positions

A bit is either 0 or 1. In a six-bit string, `001011` has six positions even though the first two are zero. Do not erase those positions when performing an operation. Reading a string as a binary integer can help check a calculation, but the operation must still return the required number of bits.

For a binary bitwise operation, line up equal-width operands. When no other width is stated, ACSL pads shorter operands with zeros on the left to the common width. For example, `10101 AND 110` is evaluated as `10101 AND 00110`, giving `00100`. Padding on the right would change the positions and produce a different operation. The following worked examples use six bits; each self-check states its own operands or width.

#### One-bit rules explain every column

NOT uses one input and flips that bit. AND returns 1 only when both inputs are 1. OR returns 1 when at least one input is 1. XOR returns 1 when the inputs differ; two 1s give 0.

| a | b | NOT a | a AND b | a OR b | a XOR b |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 0 | 1 | 1 |
| 1 | 1 | 0 | 1 | 1 | 0 |

These are separate operations on each aligned column. There is no carry between columns: XOR is not ordinary binary addition. OR is inclusive; it does not require exactly one input to be 1.

#### Worked example: align before combining

Let `A = 101001` and `B = 011110`. Number positions from the left only to keep the table readable.

| String | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 1 | 0 | 1 | 0 | 0 | 1 |
| B | 0 | 1 | 1 | 1 | 1 | 0 |
| A AND B | 0 | 0 | 1 | 0 | 0 | 0 |
| A OR B | 1 | 1 | 1 | 1 | 1 | 1 |
| A XOR B | 1 | 1 | 0 | 1 | 1 | 1 |
| NOT A | 0 | 1 | 0 | 1 | 1 | 0 |

Thus the four results are `001000`, `111111`, `110111`, and `010110`. Check AND by asking whether its only 1 occurs where both inputs have 1. Check XOR by comparing equal versus different columns. Applying NOT again to `010110` must recover `101001`.

A **mask** is simply another bit string chosen to control positions. An AND mask with 0 clears that output position; with 1 it copies the input. An OR mask with 1 forces that output position to 1; with 0 it copies the input. An XOR mask with 1 flips the input; with 0 it leaves it unchanged.

#### Worked example: precedence is not left-to-right scanning

Among the operators introduced here, evaluate NOT, then AND, then XOR, then OR, unless parentheses specify a different grouping. Operators at the same binary precedence level are evaluated left to right. The next chapter adds shifts and rotations.

Evaluate `100010 OR 011011 AND 110101 XOR 001100` by making the grouping visible:

`100010 OR ((011011 AND 110101) XOR 001100)`

| Step | Operation | Result |
| --- | --- | --- |
| 1 | `011011 AND 110101` | `010001` |
| 2 | `010001 XOR 001100` | `011101` |
| 3 | `100010 OR 011101` | `111111` |

An incorrect left-to-right evaluation starts with OR and obtains `111101` at the end. That is a different parenthesized expression. A correct single-column truth table cannot repair an incorrect grouping of whole operations.

#### Common errors and a quick check

Before accepting a result, check its width and then one column that distinguishes the operations. For two input 1s, AND and OR give 1 while XOR gives 0. Do not discard leading zeros, pad the right end, or carry a 1 into the next column.

### 检查点

**1.** For six-bit `A = 010110` and `B = 101100`, find `NOT A`, `A AND B`, `A OR B`, and `A XOR B`. Explain one column where OR and XOR differ.

**2.** Evaluate `11011 AND 101`. Write the padded operands and explain why the answer still has five bits.

**3.** Evaluate `010000 OR 100101 AND 001111 XOR 000011`. Add parentheses that show the precedence, then give the three intermediate results.

Completion standard: preserve the width, justify at least one column, and show the order of operations rather than giving only a final string.

### 参考答案

**1.** The results, in the requested order, are `101001`, `000100`, `111110`, and `111010`. Position 4 from the left has two 1s: OR returns 1 there, while XOR returns 0. Each answer has six bits.

**2.** Pad the shorter operand on the left: `11011 AND 00101 = 00001`. There are five aligned columns, so retain all four leading zeros in the result.

**3.** The grouping is `010000 OR ((100101 AND 001111) XOR 000011)`. First `100101 AND 001111 = 000101`; then `000101 XOR 000011 = 000110`; finally `010000 OR 000110 = 010110`. Starting with OR would instead give `000110`, losing a 1 that should survive to the final OR.

### 关联题目

[]

## 章节：02. Follow bits through shifts and circular rotations

### 学习目标

- Distinguish zero-filled logical shifts from circular rotations that retain every bit.
- Use a state table to evaluate nested operations from the inside outward.
- Handle zero, full-width, and larger rotation counts, and explain why opposite shifts need not undo each other.

### 正文

#### Move positions without changing the width

Keep the width at six bits in the worked examples. `LSHIFT-k` moves bits left by k positions, discards bits leaving the left end, and fills the right end with zeros. `RSHIFT-k` moves right, discards bits leaving the right end, and fills the left end with zeros. These are logical shifts: there is no sign bit to copy into the new positions.

`LCIRC-k` and `RCIRC-k` rotate left and right. Bits that leave one end re-enter the other end in the same relative order. No bits are lost or replaced. For a symbolic six-position string `abcdef`:

| Operation | Position pattern |
| --- | --- |
| `LSHIFT-2` | `cdef00` |
| `RSHIFT-2` | `00abcd` |
| `LCIRC-2` | `cdefab` |
| `RCIRC-2` | `efabcd` |

The letters mark positions, not additional allowed bit values. Actual bit strings still contain only 0 and 1.

#### Worked example: the same input, four different operations

Take `101101` and move by two positions. For a left rotation, split `10 | 1101` and move the initial `10` to the end. For a right rotation, split `1011 | 01` and move the final `01` to the front.

| Operation | Result |
| --- | --- |
| `LSHIFT-2 101101` | `110100` |
| `RSHIFT-2 101101` | `001011` |
| `LCIRC-2 101101` | `110110` |
| `RCIRC-2 101101` | `011011` |

All four results still have six bits. Rotations preserve the number of 1s. Shifts may reduce it, because the bits that leave are discarded.

#### Worked example: name each intermediate state

Evaluate `(RCIRC-2 (LSHIFT-1 (NOT 001011)))`.

| Step | Operation | Result |
| --- | --- | --- |
| 1 | `NOT 001011` | `110100` |
| 2 | `LSHIFT-1 110100` | `101000` |
| 3 | `RCIRC-2 101000` | `001010` |

Parentheses make the dependencies explicit: the outer rotation cannot start until the inner shift has produced its operand. Do not rotate the original input by mistake.

The complete ACSL precedence list is NOT, then SHIFT/CIRC, then AND, then XOR, then OR. Prefix unary operators bind from right to left; equally ranked binary operators are evaluated left to right. Explicit parentheses determine the grouping first. Writing a nested unary expression with full parentheses avoids confusing an operator's position on the page with the order in which its input becomes available.

#### Operation order can change the answer

Compare two expressions using the same input:

| Expression | First result | Final result |
| --- | --- | --- |
| `LCIRC-2 (RSHIFT-1 101101)` | `010110` | `011001` |
| `RSHIFT-1 (LCIRC-2 101101)` | `110110` | `011011` |

The shift discards a different bit depending on when it occurs. Rotations alone can be undone by rotating in the opposite direction. Once a shift has discarded a bit, a later operation cannot infer its original value.

#### Boundary counts are part of the operation

For a width of six, a rotation by six restores the original string; a rotation by eight has the same effect as a rotation by two. More generally, reduce a rotation count modulo the width. A shift by six or more discards every original bit and gives `000000`; do not reduce a shift count modulo the width. A count of zero leaves the input unchanged for either operation.

For example, `LSHIFT-6 101101 = 000000`, `LCIRC-6 101101 = 101101`, and `LCIRC-8 101101 = 110110`.

### 检查点

**1.** Use a width of seven. Find `LSHIFT-3 0110101` and `RCIRC-3 0110101`, showing the part discarded or moved to the other end.

**2.** Use a width of six. Evaluate `(LCIRC-1 (RSHIFT-2 (NOT 110010)))` with one row for each operation.

**3.** A learner says, “A left shift followed by the same right shift always restores the input.” Test the claim with `RSHIFT-2 (LSHIFT-2 110101)`. Then compare a left shift by six, a left rotation by six, and a left rotation by eight on `101101`.

Completion standard: label the width, keep the exact intermediate strings, and identify whether each operation loses or preserves information.

### 参考答案

**1.** Left shift: discard the initial `011`, keep `0101`, and append `000`, giving `0101000`. Right rotation: split `0110 | 101` and move `101` to the front, giving `1010110`. Both results have seven positions.

**2.** `NOT 110010 = 001101`; `RSHIFT-2 001101 = 000011`; `LCIRC-1 000011 = 000110`. The intermediate zeros are part of the six-bit states.

**3.** `LSHIFT-2 110101 = 010100`, then `RSHIFT-2 010100 = 000101`. The original first two bits were discarded; the following right shift inserts zeros rather than reconstructing them. For the boundary comparison, the results are `000000`, `101101`, and `110110`, respectively. Only circular counts repeat modulo the width.

### 关联题目

[]

## 章节：03. Solve for unknown bits without inventing lost information

### 学习目标

- Translate a bit equation into one constraint per position, distinguishing forced bits, free bits, and contradictions.
- Undo reversible operations in reverse order while treating shifts as information loss.
- Count independent free bits and verify a proposed solution pattern by substitution or bounded enumeration.

### 正文

#### A mask can force an output without fixing its input

For one unknown bit x, `x AND 0` is always 0 and `x OR 1` is always 1. In each case x is still free. In contrast, `x AND 1` and `x OR 0` copy x, so a required output fixes x. `x XOR 0` copies x and `x XOR 1` flips it.

A free position is written `*`, meaning that either 0 or 1 may be chosen there. This notation describes a set of ordinary bit strings; `*` is not a third bit value. Independent choices in m free positions give $2^m$ strings. First check that the constraints are consistent: a contradiction gives no solutions, regardless of how many other positions appear free.

#### Worked example: constrain only the positions that survive

For six-bit X, solve `(X AND 101100) OR 000010 = 100110`. Let `X = abcdef`.

| Step | Position pattern |
| --- | --- |
| Original X | `abcdef` |
| After AND with `101100` | `a0cd00` |
| After OR with `000010` | `a0cd10` |
| Required output | `100110` |

Comparing columns gives `a = 1`, `c = 0`, and `d = 1`. The output never depends on b, e, or f. Thus X has pattern `1*01**`, with $2^3=8$ solutions.

The eight strings are `100100`, `100101`, `100110`, `100111`, `110100`, `110101`, `110110`, and `110111`. Substitute any of them into the original equation; changing a free bit must not change the output. Conversely, changing a required bit violates its matching column. This checks both inclusion of the listed strings and exclusion of all others.

#### Worked example: reverse the reversible steps first

Solve the six-bit equation `(RCIRC-1 (LSHIFT-2 X)) XOR 001101 = 011011`.

XOR with a known mask is reversible: applying the same mask twice restores the original string. Undo the last operation first, then undo the rotation:

| Reverse step | Recovered state |
| --- | --- |
| `011011 XOR 001101` | `010110` |
| `LCIRC-1 010110` | `101100` |

The recovered state must equal `LSHIFT-2 X`. For `X = abcdef`, that state is `cdef00`, so `cdef = 1011`, while a and b were lost. The pattern is `**1011`, giving $2^2=4$ solutions: `001011`, `011011`, `101011`, and `111011`.

Check one solution forward: `001011` becomes `101100`, then `010110`, then `011011`. The other three differ only in the first two bits that the shift discards.

Do not claim that applying a right shift recovers a unique original X. It produces only one possible assignment for the lost positions. Also check the inserted zeros: a proposed output of `LSHIFT-2` must end in `00`. If reverse reasoning produces anything else, the equation has no solution.

#### A reliable workflow

First keep the width fixed and simplify known constant subexpressions. Then either carry position labels forward or undo reversible outer steps backward. Record each required bit, each free bit, and any impossible output. Count only independent free positions after all constraints are satisfied. Finally substitute a representative string and check that varying a free bit really leaves the output unchanged.

The truth tables, fixed-width shifts, circulates, and precedence follow the ACSL category description. The worked examples and self-checks here are original teaching exercises. Linked contest questions are separate practice.

### 检查点

**1.** Can a six-bit X satisfy `X AND 001100 = 100000`? Explain using a single decisive position rather than guessing strings.

**2.** Solve `X XOR 101011 = 010101` for six-bit X. How many solutions are there, and how can you verify the result?

**3.** Solve `X OR 101010 = 111011` for six-bit X. Give the pattern, the number of solutions, and two different valid strings.

**4.** Change only the target in the worked inverse example: `(RCIRC-1 (LSHIFT-2 X)) XOR 001101 = 010110`. Determine whether a solution exists. Show the reverse states or identify a forced output bit that contradicts the target.

Completion standard: give a complete pattern or a reason for no solution, count independent choices, and explain what information each operation preserves or destroys.

### 参考答案

**1.** No solutions. The leftmost bit of the AND mask is 0, so that output bit must be 0 for every X. The target requires 1 there, a contradiction.

**2.** XOR both sides with the same mask: `010101 XOR 101011 = 111110`. Hence `X = 111110`, uniquely. Forward substitution gives `111110 XOR 101011 = 010101`; each bit is determined because XOR with a known mask is reversible.

**3.** The mask's 1 positions leave the corresponding input bits free. Its 0 positions copy the input, forcing positions 2, 4, and 6 to be 1, 0, and 1. The pattern is `*1*0*1`, with $2^3=8$ solutions. For example, both `010001` and `111011` give `111011` after OR with `101010`.

**4.** Undo XOR: `010110 XOR 001101 = 011011`. Undo the right rotation: `LCIRC-1 011011 = 110110`. That cannot be a left-shift-by-two output because it ends in `10`, not `00`. There are no solutions. Equivalently, before XOR the last bit is always 0; the mask's final 1 forces the final output bit to 1, whereas the target ends in 0.

### 关联题目

[]

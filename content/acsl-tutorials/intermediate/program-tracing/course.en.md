---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 3 — Program Tracing
description: Follow assignments, branches, and loops through three original lessons. Use state tables, boundary cases, and independent checks to explain what a program does. Prerequisites are integer arithmetic, comparisons, and the meaning of a remainder; no programming language installation is needed.
category: ACSL · Intermediate
estimatedMinutes: 75
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 3 — Program Tracing

## 章节：01. One statement at a time: state and arithmetic

### 学习目标

- Evaluate a right-hand expression using the current state before replacing the variable on the left.
- Distinguish ordinary division, integer conversion, remainder, and exponentiation in the stated pseudocode.
- Record intermediate values and distinguish the final state from all values ever stored.

### 正文

#### Before tracing: write down the rules

A variable is a named storage location. Its current value can change. In these lessons, `a = a + 1` means “read the current value of a, add 1, then store the result in a.” It is an assignment, not an equation to solve. A comparison uses `==`.

Prerequisite check: if `a` is 6, what does `a = a + 1` store? It stores 7. This one step is the basis of every table below.

Our pseudocode uses `^` for powers, `*` for multiplication, `/` for ordinary division, and `%` for the remainder. Powers precede multiplication, division, and remainder, which precede addition and subtraction. Within the multiplication/division/remainder group and within the addition/subtraction group used here, work left to right. Use parentheses rather than guessing how an unfamiliar chain of powers is grouped. Parentheses override that order. Do not import a programming language's meaning of a symbol: for example, Python's `^` is not exponentiation.

All division and remainder inputs in these examples are nonnegative, and divisors are positive. The ACSL function `int(x)` is the greatest integer less than or equal to x: it rounds down. For nonnegative inputs, this is the same as discarding the fractional part, so `int(7.75)` is 7. Thus `31 / 4` is 7.75, `int(31 / 4)` is 7, and `31 % 4` is 3. Check the quotient and remainder together: $31=4\cdot7+3$, with $0\le3<4$. For a negative boundary, ACSL `int(-1.5)` is -2, whereas Python `int(-1.5)` is -1. Do not substitute the language function for the pseudocode function. These conventions follow the [ACSL pseudocode reference](https://www.categories.acsl.org/wiki/index.php?title=What_Does_This_Program_Do%3F); all lesson examples and self-checks are original.

#### Example 1A: update only the variable on the left

```text
a = 9
b = 4
a = a - b
b = a + 2 * b
a = b % a
output a, b
```

Start the table after both initial assignments. Each later row records the state after the indicated assignment. Unchanged values stay in their columns.

| State | a | b |
| --- | ---: | ---: |
| After initialization | 9 | 4 |
| After `a = a - b` | 5 | 4 |
| After `b = a + 2 * b` | 5 | 13 |
| After `a = b % a` | 3 | 13 |

**Output:** `3, 13`

The second calculation uses the updated `a = 5` and the current `b = 4`: $5+2\cdot4=13$. For the next assignment, compute $13\bmod5=3$ before replacing a. Reusing the initial 9 at either point would trace a different program.

The different values stored in either variable are $\{3,4,5,9,13\}$: five values in total. The intermediate multiplication $2\cdot4=8$ does not add 8 to this set, because neither variable stores 8. Repeated occurrences of 4 count once. Initial values count; the final output alone does not contain the whole history.

#### A practical tracing routine

Copy the variable names into columns. For each executed assignment, read the current row, calculate the entire right side, then change exactly the left-hand column. Keep a separate output list: printing a value does not normally change a variable. If asked about different values ever stored, maintain a set alongside the state table.

Before continuing to branching, be able to explain why swapping two assignment lines can change the result. Their right sides may depend on values produced by earlier lines.

### 检查点

**1.** Trace the original program, then trace the reordered program. Explain why the outputs differ.

Original order:

```text
a = 7
b = 2
a = a + b
b = a - b
output a, b
```

Reordered assignments:

```text
a = 7
b = 2
b = a - b
a = a + b
output a, b
```

**2.** Find the output and check it with a quotient–remainder identity.

```text
n = 31
q = int(n / 4)
r = n % 4
output q, r
```

**3.** In the original-order program from question 1, how many different values are stored in a or b during execution? Include initialization; do not count a value twice.

Completion standard: produce the state rows before checking the answers, and explain which current value each right side reads.

### 参考答案

**1.** In the original order, the second update uses a = 9.

| State | a | b |
| --- | ---: | ---: |
| Initialized | 7 | 2 |
| First update | 9 | 2 |
| Second update | 9 | 7 |

**Output:** `9, 7`

In the reordered program, b becomes 5 before a is updated.

| State | a | b |
| --- | ---: | ---: |
| Initialized | 7 | 2 |
| First update | 7 | 5 |
| Second update | 12 | 5 |

**Output:** `12, 5`

These assignments are sequential, not simultaneous. Replacing both right sides with initial values would miss the dependency.

**2.** Ordinary division gives 7.75; `int` keeps 7, and the remainder is 3.

| n | q | r |
| ---: | ---: | ---: |
| 31 | 7 | 3 |

**Output:** `7, 3`

The independent check is $31=4\cdot7+3$ with $0\le3<4$.

**3.** The set is $\{2,7,9\}$. The initial 7 and the later value 7 are the same member of the set.

**Output:** `3`

### 关联题目

[]

## 章节：02. Choose a path: branches, boundaries, and counterexamples

### 学习目标

- Distinguish one `if / else if / else` chain from several independent `if` statements.
- Evaluate nested conditions using the state that exists at that point in execution.
- Work backward from required output and use exact boundary inputs to disprove an incorrect rule.

### 正文

#### A condition is a decision at a particular moment

In an `if / else if / else` chain, take the first true branch and skip the remaining branches in that chain. A later, separate `if` is a new decision; it may read values changed by the earlier branch. Indentation and matching `end if` lines show which statements belong together.

`and` requires both comparisons to be true; `or` requires at least one. Use parentheses to make the comparisons visible. A skipped assignment does not change the state and contributes no new stored value to the history from lesson 1.

#### Example 2A: a later condition sees the updated state

```text
score = 7
bonus = 2
if score < 6 then
    bonus = bonus + 4
else if score < 9 then
    score = score + bonus
else
    bonus = 0
end if
if (score % 3 == 0) and (bonus > 0) then
    score = score - 1
end if
output score, bonus
```

| State | score | bonus |
| --- | ---: | ---: |
| Initialized | 7 | 2 |
| After the first chain | 9 | 2 |
| After the separate if | 8 | 2 |

**Output:** `8, 2`

First, `7 < 6` is false and `7 < 9` is true, so score becomes 9. Do not return to the top of the chain because the value changed. In the separate `if`, both `9 % 3 == 0` and `2 > 0` are true, so score becomes 8. The unused `bonus = 0` line never runs.

#### Example 2B: two independent tests

```text
x = 4
if x < 5 then
    x = x + 2
end if
if x > 5 then
    x = x * 3
end if
output x
```

| State | x |
| --- | ---: |
| Initialized | 4 |
| After the first if | 6 |
| After the second if | 18 |

**Output:** `18`

The second test runs, and it sees 6 rather than 4.

#### Example 2C: a single chain

```text
x = 4
if x < 5 then
    x = x + 2
else if x > 5 then
    x = x * 3
end if
output x
```

| State | x |
| --- | ---: |
| Initialized | 4 |
| After the selected branch | 6 |

**Output:** `6`

The first branch is selected. The `else if` is skipped even though the updated value is now greater than 5. This small change in structure is enough to change the result.

#### From a requirement to a test input

To obtain a required output, identify the conditions on its execution path, then test a candidate from initialization. Reaching one desired print statement is not enough if the program also prints an unwanted message.

For a numeric boundary k, test k itself and values just below and above it, if those values are allowed inputs. This reveals `<` versus `<=` mistakes. A single failing input disproves “correct for every allowed input.” Several successful samples do not prove that claim: also account for all branches and how their intervals fit together.

For a tiered charge, distinguish “the rate for every item” from “the rate for only the items beyond a boundary.” The following original checkpoint uses only two tiers, so you can see exactly which quantity belongs to each rate.

### 检查点

**1.** Trace this program and name the state used by the second condition.

```text
x = 6
y = 3
if x % 2 == 0 then
    x = x + y
else
    y = y + 2
end if
if (x > 8) and (y == 3) then
    y = x - y
end if
output x, y
```

**2.** Which candidate prints exactly `LARGE` followed by `READY`? Inputs are integers. A: (0, 3); B: (4, 1); C: (5, 0); D: (6, 2). Trace every candidate, including the rejected ones.

```text
input n, token
if n < 1 then
    output "INVALID"
else
    if n <= 4 then
        output "SMALL"
    else
        output "LARGE"
    end if
    if token > 0 then
        output "READY"
    end if
end if
```

**3.** A printer charges 3 tokens per page for the first two pages, then 1 token per extra page. The positive integer number of pages is p. Someone proposes $6+p$ for every $p>2$. Give a counterexample, replace that expression, and calculate the charges for p = 1, 2, 3, and 5.

Completion standard: show the executed path, distinguish a skipped branch from a false later test, and explain why your boundary counterexample is sufficient to reject the proposed formula.

### 参考答案

**1.** Six is even, so the first branch changes x to 9. The second condition then reads x = 9 and y = 3; both comparisons are true.

| State | x | y |
| --- | ---: | ---: |
| Initialized | 6 | 3 |
| After the first if | 9 | 3 |
| After the second if | 9 | 6 |

**Output:** `9, 6`

**2.** To print the requested pair, the outer valid-input branch must run, n must exceed 4, and token must exceed 0.

| Candidate | n | token | Printed sequence |
| --- | ---: | ---: | --- |
| A | 0 | 3 | INVALID |
| B | 4 | 1 | SMALL, READY |
| C | 5 | 0 | LARGE |
| D | 6 | 2 | LARGE, READY |

**Output:** `D`

Candidate A does not reach the nested READY test at all. Candidate B is exactly on the SMALL branch boundary. Candidate C reaches LARGE but fails the separate READY condition.

**3.** For p = 3, the correct charge is $3+3+1=7$, while $6+p$ gives 9. The expression counts the first two pages again. For p > 2, use $6+(p-2)$; for $1\le p\le2$, use $3p$.

| p | Charge |
| ---: | ---: |
| 1 | 3 |
| 2 | 6 |
| 3 | 7 |
| 5 | 9 |

**Output:** `3, 6, 7, 9`

This rule covers all positive integers: the first interval includes 2, and the second begins at 3. Each extra page after the first two adds exactly one token.

### 关联题目

[]

## 章节：03. Repeat in order: loops and stopping conditions

### 学习目标

- List the values that enter a `for` loop, including positive and negative steps and reachable endpoints.
- Distinguish the value at a `while` test from the state after its body, including a loop that runs zero times.
- Preserve an old value when later assignments need it, and explain why a loop terminates.

### 正文

#### Count executions before doing arithmetic

In this lesson's `for k = start to end step s`, a positive step enters the body while k is at most end; a negative step enters while k is at least end. The endpoint is included only if the steps reach it. Thus `2 to 8 step 3` enters with 2, 5, 8. Its next candidate is 11, which does not enter. We do not use the control variable after the loop; different languages can leave it in different states.

A `while` loop checks its condition before every execution of its body. If the first check is false, the body runs zero times. Each assignment inside the body is still sequential: a loop does not turn its lines into a simultaneous update.

#### Example 3A: carry the accumulator into the next loop

```text
total = 1
for k = 2 to 8 step 3
    total = total + k
next k
for k = 6 to 2 step -2
    total = total - k / 2
next k
output total
```

| Body execution | k | total afterward |
| ---: | ---: | ---: |
| 1 | 2 | 3 |
| 2 | 5 | 8 |
| 3 | 8 | 16 |
| 4 | 6 | 13 |
| 5 | 4 | 11 |
| 6 | 2 | 10 |

**Output:** `10`

There is no second `total = 1`, so the second loop starts from 16. Check independently by grouping all changes:

$$
1+(2+5+8)-(6/2+4/2+2/2)=1+15-6=10.
$$

Do not treat the range as an iteration count. The first loop has three body executions, not eight.

#### Example 3B: check first, update, then check again

```text
n = 23
ones = 0
turns = 0
while n > 0
    bit = n % 2
    ones = ones + bit
    n = int(n / 2)
    turns = turns + 1
end while
output ones, turns
```

| n before body | bit | ones afterward | n afterward | turns |
| ---: | ---: | ---: | ---: | ---: |
| 23 | 1 | 1 | 11 | 1 |
| 11 | 1 | 2 | 5 | 2 |
| 5 | 1 | 3 | 2 | 3 |
| 2 | 0 | 3 | 1 | 4 |
| 1 | 1 | 4 | 0 | 5 |

**Output:** `4, 5`

After the fifth body execution, n is zero. The next condition check is false; it does not create a sixth execution. Each positive n is replaced by a smaller nonnegative integer, so the loop reaches zero. As an independent check, $23_{10}=10111_2$: five binary digits contain four ones. The remainders were produced from the lowest digit upward, so their order is reversed, but counting ones is unaffected.

If the initial n were zero, this program would output `0, 0`. That is the program's behavior; it is not a claim that the written numeral 0 has no digit. Always separate the question being computed from a similar mathematical description.

#### Save a value before overwriting it

If two new values both depend on the old a, save `old = a` before changing a. A later `b = a` reads the new a, whereas `b = old` reads the saved one. A useful check is an invariant: a relationship that remains true after every complete body execution. Verify it from the updates; do not assume it merely because the first row happens to satisfy it.

### 检查点

**1.** Find the output. Then change only the final bound from 3 to 4 and find the new output. List the values of k that actually enter each loop.

```text
total = 0
for k = 9 to 3 step -3
    total = total + k
next k
output total
```

**2.** Trace the program for the displayed initial n = 10. Then give the output if only the initialization is changed to n = 1 or n = 0.

```text
n = 10
count = 0
while n > 1
    n = int(n / 2)
    count = count + 1
end while
output n, count
```

**3.** Trace this update process. Explain why `old` is necessary, and check the difference between a and b after every body execution.

```text
a = 3
b = 1
turns = 0
while a < 15
    old = a
    a = 2 * a - b
    b = old
    turns = turns + 1
end while
output a, b, turns
```

Completion standard: show which states are tested, count body executions rather than tests, and justify the stopping point without running an extra iteration.

### 参考答案

**1.** The entered values are 9, 6, 3.

| k | total afterward |
| ---: | ---: |
| 9 | 9 |
| 6 | 15 |
| 3 | 18 |

**Output:** `18`

With bound 4, only 9 and 6 enter; the next candidate 3 is already below 4.

| k | total afterward |
| ---: | ---: |
| 9 | 9 |
| 6 | 15 |

**Output:** `15`

**2.** For n = 10, the body changes n through 5, 2, and 1.

| n afterward | count |
| ---: | ---: |
| 5 | 1 |
| 2 | 2 |
| 1 | 3 |

**Output:** `1, 3`

For either boundary input, the very first `n > 1` test is false.

| Initial n | Final n | Final count |
| ---: | ---: | ---: |
| 1 | 1 | 0 |
| 0 | 0 | 0 |

**3.** Each row is after the whole body, including the counter update.

| a | b | turns |
| ---: | ---: | ---: |
| 5 | 3 | 1 |
| 7 | 5 | 2 |
| 9 | 7 | 3 |
| 11 | 9 | 4 |
| 13 | 11 | 5 |
| 15 | 13 | 6 |

**Output:** `15, 13, 6`

Initially $a-b=2$. The new difference is $(2a-b)-a=a-b$, so it stays 2. Consequently a increases by 2 per execution: $3+2\cdot6=15$. The next condition is false. Replacing `b = old` with `b = a` would instead set b equal to the newly updated a; the first row would become (5, 5), breaking the invariant and causing the subsequent a updates to stay at 5. The stated loop would then fail to terminate. Saving the old value is part of the algorithm, not an optional presentation detail.

### 关联题目

[]

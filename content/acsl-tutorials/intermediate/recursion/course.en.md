---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 2 — Recursive Functions
description: Three original lessons on base cases, returning through calls, call trees, composition, multiple parameters, and floor operations. Trace each step with tables and independent self-checks. Prerequisites are integer arithmetic, function notation, and conditional reasoning.
category: ACSL · Intermediate
estimatedMinutes: 75
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 2 — Recursive Functions

## 章节：01. Reach a base case, then bring the result back

### 学习目标

- Distinguish a function's input, return value, and recursive rule, and identify a base case that makes no further self-call.
- Expand dependencies first, then work back from the base case while preserving every pending operation.
- Use the stated domain to explain termination, and distinguish stage numbers from call counts.

### 正文

#### Prerequisite check: the value in parentheses is an input

If $g(x)=3x+1$, then $g(2)=7$. A function name is not a number multiplied by its parentheses: $g(2)$ means the value obtained by applying the rule to input 2. A recursive rule may refer to the same function again, but its stated conditions still determine what happens.

#### Build a recursive rule from batches of cards

A table initially holds 3 cards. Batch $n$ adds $2n$ cards. Let $A(n)$ be the total after the first $n$ batches. The input $n$ is a nonnegative integer; before any batch is added, the stage number is 0:

$$
A(n)=\begin{cases}
3 & n=0,\\
A(n-1)+2n & n\ge1.
\end{cases}
$$

$A(0)=3$ is a **base case**: it gives a value directly without calling $A$ again. For $n\ge1$, find the previous total and then add this batch's $2n$ cards.

#### Find A(3): keep unfinished operations while expanding

| Current call | Next dependency | Operation waiting for the result |
| --- | --- | --- |
| $A(3)$ | $A(2)$ | Add 6 |
| $A(2)$ | $A(1)$ | Add 4 |
| $A(1)$ | $A(0)$ | Add 2 |
| $A(0)$ | None | Return 3 directly |

The input chain is $3\to2\to1\to0$. Once the base case is reached, work back through the dependencies:

$$
\begin{aligned}
A(0)&=3,\\
A(1)&=3+2=5,\\
A(2)&=5+4=9,\\
A(3)&=9+6=15.
\end{aligned}
$$

Check directly from the story: start with 3 cards and add batches of 2, 4, and 6, giving $3+2+4+6=15$. This separate calculation needs no recursive calls and helps detect a missing operation during substitution.

#### Why the calls stop

Each call decreases the nonnegative integer $n$ by 1, eventually reaching 0, where the base case makes no further call. Seeing $n-1$ alone does not prove termination for every possible input: the domain and base-case condition matter too. Negative inputs are outside this example's domain.

Finding $A(3)$ involves 4 calls, including $A(0)$, but only 3 recursive transitions and 3 added batches. The initial state is stage 0, not the first batch.

#### Common errors: stopping too soon or using the child's parameter

Finding $A(0)$ only reaches the end of the chain; the waiting additions still need to be performed. Another error is writing $A(2)=A(1)+2\cdot1$. The outer call still has input 2, so it is waiting to add $2\cdot2$. The child call's input 1 does not overwrite its caller's parameter.

### 检查点

1. Find $A(4)$. List the values from the base case back to the result, and check using “initial cards plus every added batch.”
2. Does finding $A(0)$ require calling $A(-1)$? How many calls and recursive transitions are involved in finding $A(3)$? State what you count.
3. A learner writes $A(2)=A(1)+2\cdot1=7$. Identify the first incorrect step and give the correct equation.

Completion standard: give the value, identify the base case, show the return order, and explain which call's parameter supplies each pending operation.

### 参考答案

**1.** The values are $A(0)=3$, $A(1)=5$, $A(2)=9$, $A(3)=15$, and $A(4)=23$. The final step is $A(4)=A(3)+8=15+8=23$. Independently check $3+2+4+6+8=23$.

**2.** $A(0)=3$ already satisfies the base case, so it does not call $A(-1)$. For $A(3)$, the inputs are 3, 2, 1, and 0: 4 calls and 3 recursive transitions. The last call returns directly.

**3.** The error replaces the current input 2 with the child call's input 1. The correct equation is $A(2)=A(1)+2\cdot2=5+4=9$.

### 关联题目

[]

## 章节：02. From a call chain to trees and composition

### 学习目标

- Read a definition with several child calls and evaluate it in dependency order.
- Distinguish repeated calls from distinct inputs, retaining every term when reusing a known value.
- Evaluate composition from the inside out and distinguish function calls, multiplication, and the scope of parentheses.

### 正文

#### Two base cases and two dependencies

Define $B$ on the nonnegative integers:

$$
B(n)=\begin{cases}
1 & n=0,\\
2 & n=1,\\
B(n-1)+B(n-2)+1 & n\ge2.
\end{cases}
$$

For $n\ge2$, both child inputs are smaller than the current input and remain nonnegative. They eventually reach 0 or 1. Each non-base call needs both child values and must then add the final 1 in its rule.

#### A call tree shows which results are needed

Here is the full expansion of $B(4)$. The `+1` at each non-base node belongs to that particular call. Indentation shows dependencies, not multiplication.

```text
B(4) [+1]
├─ B(3) [+1]
│  ├─ B(2) [+1]
│  │  ├─ B(1) = 2
│  │  └─ B(0) = 1
│  └─ B(1) = 2
└─ B(2) [+1]
   ├─ B(1) = 2
   └─ B(0) = 1
```

Work upward from the leaves:

$$
\begin{aligned}
B(2)&=2+1+1=4,\\
B(3)&=4+2+1=7,\\
B(4)&=7+4+1=12.
\end{aligned}
$$

Filling a table in increasing input order also ensures that every required value is already available:

| $n$ | 0 | 1 | 2 | 3 | 4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| $B(n)$ | 1 | 2 | 4 | 7 | 12 |

The tree contains 9 calls but only five distinct inputs: 0, 1, 2, 3, and 4. Once $B(2)=4$ is recorded, it can be looked up instead of recalculated. That does not permit removing the $B(2)$ term from $B(4)=B(3)+B(2)+1$. **Avoiding a repeated calculation does not remove a required contribution to the result.**

#### Composition: an inner result becomes an outer input

To find $B(B(2))$, evaluate the inner call first, then apply the rule again to its result:

$$
B(B(2))=B(4)=12.
$$

This differs from $2B(2)=8$ and from $[B(2)]^2=16$. The outer input comes from the inner result, not from counting layers of parentheses.

#### Common errors: dropping a branch or assuming a pattern too soon

The recursive part has two child terms, so neither branch may be discarded. Each non-base call also adds its own 1; it is not a single addition for the whole tree.

Some recurrences produce repeated values. If a rule depends on two previous terms, seeing one value again does not establish that all later values repeat. Check the complete state that determines the next step, such as an ordered pair of consecutive values, and the same recurrence rule. This example needs no assumption of periodicity.

### 检查点

1. Find $B(5)$, identifying the two smaller inputs and their values.
2. Evaluate $B(B(1)+1)$ and $B(B(1))+1$ separately. First identify the outermost function's input in each expression.
3. In the displayed tree for $B(4)$, count the occurrences of $B(0)$, $B(1)$, $B(2)$, $B(3)$, and $B(4)$. After looking up $B(2)=4$, a learner uses $B(4)=B(3)+1$. Explain why that is incorrect.

Completion standard: use the tree or table to obtain the values, and distinguish call counts, distinct input counts, and required expression terms. Preserve parentheses in compositions.

### 参考答案

**1.** The smaller inputs are 4 and 3. Since $B(4)=12$ and $B(3)=7$, $B(5)=12+7+1=20$.

**2.** In the first expression, $B(1)=2$ and the outer input is $2+1=3$, so $B(B(1)+1)=B(3)=7$. In the second expression, the outer function's input is 2: first find $B(B(1))=B(2)=4$, then add the 1 outside the parentheses to obtain 5.

**3.** Occurrence counts for inputs 0 through 4 are 2, 3, 2, 1, and 1, totaling 9. Looking up $B(2)$ avoids expanding it again, but the outer call still needs its value 4. Thus $B(4)=7+4+1=12$; dropping that term would incorrectly give 8.

### 关联题目

[]

## 章节：03. Each call keeps its own parameters

### 学习目标

- Record the complete ordered state of a multiple-parameter call and choose a branch again at every level.
- Distinguish caller parameters from child parameters and preserve the correct pending additions and subtractions.
- Apply floor exactly where specified, continue with the resulting integer input, and explain termination.

### 正文

#### Two parameters: record the state before choosing a branch

Define $M(x,y)$, where $x$ is a nonnegative integer and $y$ may be any integer. The conditions do not overlap. When $x=0$, return directly rather than using the positive-even branch.

$$
M(x,y)=\begin{cases}
y+2 & x=0,\\
M(x-1,y+2)+x & x>0\text{ and }x\text{ is even},\\
M(x-1,y-1)-y & x\text{ is odd}.
\end{cases}
$$

To find $M(3,5)$, record the child's input separately from the operation waiting in the current call:

| Current state $(x,y)$ | Condition | Child state | Pending operation |
| --- | --- | --- | --- |
| $(3,5)$ | $x$ is odd | $(2,4)$ | Subtract 5 |
| $(2,4)$ | $x$ is positive and even | $(1,6)$ | Add 2 |
| $(1,6)$ | $x$ is odd | $(0,5)$ | Subtract 6 |
| $(0,5)$ | $x=0$ | None | Return $5+2=7$ |

The first row's `−5` uses its own $y=5$, not the child's $y=4$. The second row's `+2` uses its own $x=2$, not the child's $x=1$. A child call has its own parameters; it does not overwrite the operation its caller is waiting to perform.

#### Restore each pending operation on the way back

$$
\begin{aligned}
M(0,5)&=7,\\
M(1,6)&=7-6=1,\\
M(2,4)&=1+2=3,\\
M(3,5)&=3-5=-2.
\end{aligned}
$$

As a separate check, start at the base value 7 and apply the operations in return order: $7-6+2-5=-2$. Each row in the table contributes its pending operation.

Here $y$ sometimes increases and sometimes decreases. The calls still terminate because the nonnegative integer $x$ decreases by 1 each time until it reaches 0. Every parameter need not decrease; identify a quantity that guarantees progress toward the base case.

#### Apply floor at the specified position

Consider another function on nonnegative integers:

$$
J(n)=\begin{cases}
1 & n=0,\\
J\!\left(\left\lfloor n/2\right\rfloor\right)+n & n\ge1.
\end{cases}
$$

$\lfloor t\rfloor$ is the greatest integer no larger than $t$. Here floor is applied to the **child input**, not to the complete return value. For $J(7)$:

| Current input | Child input $\lfloor n/2\rfloor$ | Add on return |
| ---: | ---: | ---: |
| 7 | 3 | 7 |
| 3 | 1 | 3 |
| 1 | 0 | 1 |
| 0 | None | Return 1 directly |

Therefore:

$$
\begin{aligned}
J(0)&=1,\\
J(1)&=1+1=2,\\
J(3)&=2+3=5,\\
J(7)&=5+7=12.
\end{aligned}
$$

For a positive integer $n$, $0\le\lfloor n/2\rfloor<n$, so the calls reach 0. As another check, input 8 gives the chain $8\to4\to2\to1\to0$. Returning produces 1, 2, 4, 8, and 16, so $J(8)=16$.

#### Common errors: rounding to nearest or borrowing another problem's notation

$\lfloor7/2\rfloor=3$, not 4. Inputs here are nonnegative, so removing the fractional part happens to agree with floor. That shortcut does not always work for negative values: for example, $\lfloor-3/2\rfloor=-2$. Follow the problem's stated meaning of brackets, integer division, or rounding.

A recursive function need not return a positive value. The result $M(3,5)=-2$ does not mean the calls failed to terminate. Termination concerns completing the calls; the sign concerns the value they return.

### 检查点

1. Find $M(2,3)$. List every ordered input state, then work back from the base case.
2. Find $M(4,2)$. Every pending addition or subtraction must use the current row's parameters.
3. Find $J(9)$, listing the floored inputs and the return values. Explain why the next call is not $J(4.5)$.
4. Find $M(1,-2)$. First check that the input belongs to the domain, then explain the subtraction of a negative value on return.

Completion standard: record complete states, choose the right branch, and do not mix parameters from different calls. Apply floor where defined and explain why these calls terminate.

### 参考答案

**1.** The states are $(2,3)\to(1,5)\to(0,4)$. The base case returns $M(0,4)=6$. Then $M(1,5)=6-5=1$ and finally $M(2,3)=1+2=3$.

**2.** The states are $(4,2)\to(3,4)\to(2,3)\to(1,5)\to(0,4)$. The return values are $6\to1\to3\to-1\to3$. In particular, $M(3,4)=M(2,3)-4=3-4=-1$, so $M(4,2)=M(3,4)+4=-1+4=3$.

**3.** The input chain is $9\to4\to2\to1\to0$; the return values are $1\to2\to4\to8\to17$. Hence $J(9)=17$. The definition first applies $\lfloor9/2\rfloor=4$, so the child input must be that integer, not 4.5.

**4.** The input is valid: $x=1$ is a nonnegative integer and $y=-2$ is an integer. The odd branch gives $M(1,-2)=M(0,-3)-(-2)$. The base case is $M(0,-3)=-1$, so the result is $-1+2=1$.

### 关联题目

[]

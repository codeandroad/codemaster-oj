---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 4 — Prefix, Infix and Postfix
description: Three original lessons on expression structure, evaluation with stacks, and conversions that preserve every operand and operation. Use expression trees, complete state tables, and independent checks. Prerequisites are arithmetic, parentheses, and the idea of a last-in, first-out stack.
category: ACSL · Intermediate
estimatedMinutes: 75
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 4 — Prefix, Infix and Postfix

## 章节：01. Read the structure before moving an operator

### 学习目标

- Identify an operator's two complete operands, including operands that are themselves expressions.
- Use parentheses and an ordered expression tree to preserve grouping and left/right order.
- Read prefix, infix, and postfix as three representations of the same structure.

### 正文

#### Prerequisite check: an operand can contain an operation

In $(7+5)(9-4)$, the multiplication has two operands: the whole sum $7+5$ and the whole difference $9-4$. Its operands are not simply the closest two numbers. To make multiplication explicit, write `(7 + 5) * (9 - 4)`.

In this course, `+`, `-`, `*`, `/`, and `^` are **binary operators**: each needs a left operand and a right operand. Here `^` means exponentiation, not the meaning it has in every programming language. `/` means ordinary division, with no automatic rounding. All numeric tokens are separated by spaces: `12` is one number, whereas `1 2` is two tokens. If a problem explicitly says all numbers are single digits, apply that problem's rule when reading a compact expression.

For infix expressions, parentheses determine grouping first; exponentiation has precedence over multiplication/division, which have precedence over addition/subtraction. Within the multiplication/division group and within the addition/subtraction group, work from left to right. This grouping rule is not the algebraic claim that subtraction or division is associative. We always parenthesize chains of powers in this course: $(2^3)^2=64$, whereas $2^{(3^2)}=512$. Do not guess the grouping of an unfamiliar unparenthesized chain of powers.

The notation and conversion method follow the ACSL expression category description. The examples and self-checks here are original.

#### One tree, three written forms

The root is the last operation needed to obtain the value of the entire expression. An operator's first indented child is its left operand; its second is its right operand. Each number is a leaf.

```text
*
├─ +
│  ├─ 7
│  └─ 5
└─ -
   ├─ 9
   └─ 4
```

This tree has 4 operand leaves and 3 binary-operator nodes. The left subtree returns $7+5=12$, the right returns $9-4=5$, and the root returns $12\cdot5=60$.

| Complete part | Prefix: operator, left, right | Fully parenthesized infix | Postfix: left, right, operator |
| --- | --- | --- | --- |
| Left subtree | `+ 7 5` | `(7 + 5)` | `7 5 +` |
| Right subtree | `- 9 4` | `(9 - 4)` | `9 4 -` |
| Whole tree | `* + 7 5 - 9 4` | `((7 + 5) * (9 - 4))` | `7 5 + 9 4 - *` |

Read prefix by recording each operator **before** its two subtrees. Read postfix by recording it **after** both subtrees. Infix places the operator **between** them; the parentheses show the grouping. None of these traversals swaps the children.

In prefix and postfix, fixed operator arity and token order already determine the structure. Do not apply infix precedence again to decide which operator to move or evaluate first. For example, the final `*` in `7 5 + 9 4 - *` combines the two already complete results.

#### Parentheses change the structure, not just its appearance

The expressions below contain the same numbers and subtraction symbols, but the second subtraction has different operands:

$$
\begin{aligned}
12-5-1&=(12-5)-1=7-1=6,\\
12-(5-1)&=12-4=8.
\end{aligned}
$$

In the first expression, the root subtracts 1 from the result of $12-5$. In the second, it subtracts the result of $5-1$ from 12. Converting the notation must preserve that distinction.

#### A useful count, with a limitation

A complete binary expression with $k$ operators has $k+1$ operand leaves. Each operator combines two subexpressions into one. This count is a quick necessary check, but it does not prove that a token sequence is valid: `+ 4` is missing an operand, while `4 + 2` has the right totals but is not a valid postfix expression. The next lesson checks availability at each step.

### 检查点

**1.** Fully parenthesize `6 + 3 * 4`. Give its prefix and postfix forms and its value. What changes in `(6 + 3) * 4`?

**2.** Give the prefix forms of `12 - 5 - 1` and `12 - (5 - 1)`. Identify the root operation's two operands in each case, and check both values.

**3.** Convert `8 / (2 + 2)` and `8 / 2 + 2` to postfix. Evaluate them and explain which operation is the root in each.

Completion standard: preserve every operand and its order, show the grouping, and explain why a change in parentheses can change the result.

### 参考答案

**1.** The grouping is `(6 + (3 * 4))`. Prefix is `+ 6 * 3 4`; postfix is `6 3 4 * +`. The value is $6+3\cdot4=6+12=18$. For `((6 + 3) * 4)`, prefix is `* + 6 3 4`, postfix is `6 3 + 4 *`, and $(6+3)\cdot4=9\cdot4=36$. The first tree's root is addition; the second's is multiplication.

**2.** The first prefix form is `- - 12 5 1`: the root's left operand is `12 - 5`, and its right operand is 1. Thus $(12-5)-1=6$. The second is `- 12 - 5 1`: the root's left operand is 12, and its right operand is `5 - 1`. Thus $12-(5-1)=8$.

**3.** `8 / (2 + 2)` becomes `8 2 2 + /`, with division at the root; $8/(2+2)=8/4=2$. `8 / 2 + 2` becomes `8 2 / 2 +`, with addition at the root; $8/2+2=4+2=6$. Keeping the tokens in order is not enough: the placement of the final operator records which operation combines the complete parts.

### 关联题目

[]

## 章节：02. Evaluate with a stack without reversing the operands

### 学习目标

- Track every stack state while evaluating postfix from left to right or prefix from right to left.
- Distinguish the order of popping from the left/right order of an operation.
- Handle negative values and ordinary division, and reject missing or extra operands.

### 正文

#### A stack holds complete results

A stack is last-in, first-out: push adds an item at the top, and pop removes the top item. In every table below, the stack is shown **bottom to top, from left to right**. An empty stack is `[]`. Each stored value represents one complete subexpression, even if that value needed several earlier operations.

For postfix, scan left to right. Push a number when you encounter it. At a binary operator, first pop the **right** operand $r$, then the **left** operand $l$, compute $l\mathbin{\mathrm{op}}r$, and push the result. Stop with an error if there are fewer than two values available.

#### Worked postfix example: show every token

Evaluate `9 4 - 6 2 + * 5 /`.

| Token read | Operation at this step | Stack after the step |
| --- | --- | --- |
| `9` | Push 9 | `[9]` |
| `4` | Push 4 | `[9, 4]` |
| `-` | $l=9$, $r=4$: $9-4=5$ | `[5]` |
| `6` | Push 6 | `[5, 6]` |
| `2` | Push 2 | `[5, 6, 2]` |
| `+` | $l=6$, $r=2$: $6+2=8$ | `[5, 8]` |
| `*` | $l=5$, $r=8$: $5\cdot8=40$ | `[40]` |
| `5` | Push 5 | `[40, 5]` |
| `/` | $l=40$, $r=5$: $40/5=8$ | `[8]` |

Exactly one value remains, so the result is 8. Independently recover the grouped infix expression:

$$
\frac{(9-4)(6+2)}5=\frac{5\cdot8}{5}=8.
$$

At the last step, the first pop returns 5, but the operation is $40/5$, not $5/40$. Addition may hide this mistake because swapping its operands leaves the sum unchanged. Subtraction, division, and exponentiation generally do not.

#### Prefix: reverse the scan, then check the pop order again

The same tree has prefix form `/ * - 9 4 + 6 2 5`. Scan it **right to left**. At an operator, the first popped value is now the **left** operand $l$; the next is the **right** operand $r$.

| Token read, from the right | Operation at this step | Stack after the step |
| --- | --- | --- |
| `5` | Push 5 | `[5]` |
| `2` | Push 2 | `[5, 2]` |
| `6` | Push 6 | `[5, 2, 6]` |
| `+` | $l=6$, $r=2$: $6+2=8$ | `[5, 8]` |
| `4` | Push 4 | `[5, 8, 4]` |
| `9` | Push 9 | `[5, 8, 4, 9]` |
| `-` | $l=9$, $r=4$: $9-4=5$ | `[5, 8, 5]` |
| `*` | $l=5$, $r=8$: $5\cdot8=40$ | `[5, 40]` |
| `/` | $l=40$, $r=5$: $40/5=8$ | `[8]` |

Both methods evaluate the same ordered tree. A different scan direction changes which operand is popped first; it does not change the meaning of subtraction or division.

#### Values, tokens, and validity

Our `/` denotes ordinary division: $7/2=3.5$, not 3. Do not introduce integer truncation just because the input tokens are integers. ACSL's pseudocode description explicitly distinguishes real division from integer conversion; this course states the same ordinary-division convention for its original arithmetic examples. Follow any different convention explicitly specified by a particular problem.

A variable is one operand even when its assigned value is negative. In `u v -`, the token `-` is a binary subtraction operator. If $u=-3$ and $v=2$, the operation is $(-3)-2=-5$. The negative sign in the value of $u$ does not create an extra operator in the original token sequence.

Before applying an operator, require two complete stack items. After consuming the entire expression, require exactly one item. Never repair an invalid expression by silently discarding an item. Division by zero is a separate arithmetic error: a sequence may be structurally complete yet have no defined value for particular inputs.

### 检查点

**1.** Evaluate `8 3 - 2 ^ 6 +`. Record the stack after every token and identify the base and exponent at `^`.

**2.** Evaluate prefix `- / 18 3 + 2 1` by scanning from the right. Show the operand order at the final subtraction. Here `18` is one token.

**3.** Evaluate postfix `u v - u *` for $u=-3$ and $v=2$. Show the intermediate negative result and explain why no extra subtraction token is needed.

**4.** Examine these postfix sequences separately: `7 2 / 3 +`, `4 + 2`, and `4 2`. Give a value when valid; otherwise identify the first failure or the final invalid state.

Completion standard: show stack states, preserve left/right operand order, keep noninteger results when necessary, and distinguish structural validity from arithmetic validity.

### 参考答案

**1.** The successive stacks are:

| Token | Stack after the step |
| --- | --- |
| `8` | `[8]` |
| `3` | `[8, 3]` |
| `-` | `[5]` |
| `2` | `[5, 2]` |
| `^` | `[25]` |
| `6` | `[25, 6]` |
| `+` | `[31]` |

At `^`, pop exponent 2 first, then base 5. Thus $(8-3)^2+6=25+6=31$, not $2^5+6$.

**2.** The scan order is `1 2 + 3 18 / -`. Successive stacks are `[1]`, `[1, 2]`, `[3]`, `[3, 3]`, `[3, 3, 18]`, `[3, 6]`, and `[3]`. At the final `-`, the first pop is the left operand 6 and the second is the right operand 3. The result is $18/3-(2+1)=6-3=3$.

**3.** The stacks are `[-3]`, `[-3, 2]`, `[-5]`, `[-5, -3]`, and `[15]`. The grouped expression is $(u-v)u=(-3-2)(-3)=15$. Each occurrence of `u` supplies the single value −3; the only binary subtraction is the token between the two variable occurrences in the postfix sequence `u v - u *`.

**4.** `7 2 / 3 +` is valid. Its stacks are `[7]`, `[7, 2]`, `[3.5]`, `[3.5, 3]`, and `[6.5]`, giving $7/2+3=6.5$. In `4 + 2`, `+` is reached with only `[4]`; it lacks a second operand, so evaluation fails there. In `4 2`, no operator combines the two values: the final stack is `[4, 2]`, not one result.

### 关联题目

[]

## 章节：03. Convert complete subexpressions and verify the result

### 学习目标

- Convert between notations by preserving the ordered expression tree rather than rearranging characters.
- Make implicit multiplication explicit, preserve fraction grouping and exponents, and include assignment when the whole formula is requested.
- Use reconstruction and structural checks to verify a conversion, recognizing the limits of a numerical spot check.

### 正文

#### Conversion keeps the tree; only the visit order changes

To convert infix, first insert the grouping that precedence and parentheses require. Replace implicit multiplication by `*`. For a tree with left subtree $L$, right subtree $R$, and operator `op`, write `op L R` for prefix and `L R op` for postfix, recursively converting each subtree. Do not swap children or simplify away an operation.

When converting postfix, a stack can hold **expression fragments**, not just numbers. Push an operand as a fragment. At an operator, pop the right fragment, then the left fragment, and combine the whole fragments. To recover infix, place parentheses around `(left op right)`. To produce prefix, use `op left right`. Replacing a complete fragment by a number would lose the original symbols and operations required by a conversion question.

#### A fraction and its assignment

Convert the entire formula

$$
R=\frac{u-v}{(w+2)^2}.
$$

The fraction bar groups the whole numerator and denominator. The denominator is the square of the sum, not $w+2^2$. First write `R = ((u - v) / ((w + 2) ^ 2))`.

For this formula, `=` is an assignment with a variable target on the left and a value-producing expression on the right. It is included only because we are converting the **entire formula**. It is not an equality comparison to evaluate as true or false. Its tree is:

```text
=
├─ R
└─ /
   ├─ -
   │  ├─ u
   │  └─ v
   └─ ^
      ├─ +
      │  ├─ w
      │  └─ 2
      └─ 2
```

The two leaves labeled 2 are separate occurrences: one is added to $w$; the other is the exponent. This tree has 6 leaves and 5 binary-operator nodes, including assignment.

| Complete part | Prefix | Postfix |
| --- | --- | --- |
| Numerator | `- u v` | `u v -` |
| Sum in denominator | `+ w 2` | `w 2 +` |
| Whole denominator | `^ + w 2 2` | `w 2 + 2 ^` |
| Right-hand side | `/ - u v ^ + w 2 2` | `u v - w 2 + 2 ^ /` |
| Entire formula | `= R / - u v ^ + w 2 2` | `R u v - w 2 + 2 ^ / =` |

With $u=14$, $v=5$, and $w=1$, the numerator is $14-5=9$, the denominator is $(1+2)^2=9$, and the assigned value is $R=9/9=1$. This checks the arithmetic for one input; the ordered tree verifies the conversion itself. When $w=-2$, the denominator is zero, so this formula does not define a value for $R$ at that input.

#### Reconstructing is stronger than counting

For postfix `u v - w 2 + 2 ^ /`, keep complete infix fragments on the stack. The operator steps are:

| Operator just read | Stack of complete fragments, bottom to top |
| --- | --- |
| `-` | `[(u - v)]` |
| `+` | `[(u - v), (w + 2)]` |
| `^` | `[(u - v), ((w + 2) ^ 2)]` |
| `/` | `[((u - v) / ((w + 2) ^ 2))]` |

The reconstructed grouping matches the original right-hand side. The operand order, operation symbols, and subtree boundaries all agree. A count of 5 right-hand-side leaves and 4 operators alone would not detect a misplaced operator.

#### Do not use one equal result as a proof

The expressions $(a+b)c$ and $a+bc$ are different trees. At $a=0$, $b=3$, $c=4$, both give 12; that accidental agreement does not make them the same conversion. Use the tree or a fully parenthesized reconstruction to establish structural agreement. A numerical check with deliberately unequal operands is useful for catching mistakes, but cannot replace that check.

### 检查点

**1.** Convert prefix `- * a + b c / d e` into fully parenthesized infix and postfix. Check the result with $a=3$, $b=2$, $c=5$, $d=18$, and $e=6$.

**2.** Convert the entire formula $S=3t+1$ into prefix and postfix, making the implied multiplication explicit. Then find the assigned value when $t=4$. Explain what would be missing if the target and assignment operator were omitted.

**3.** A learner converts $(a+b)c$ to prefix `+ a * b c`, because both expressions give 12 at $a=0$, $b=3$, $c=4$. Reconstruct the proposed expression, find the correct prefix and postfix forms, and use $a=2$, $b=3$, $c=4$ to expose the mismatch.

Completion standard: preserve the complete tree and every occurrence of an operand, reconstruct to verify grouping, and include assignment only when the requested formula includes it.

### 参考答案

**1.** The outermost operator is subtraction. Its left operand is `* a + b c`, and its right is `/ d e`. Fully parenthesized infix is `((a * (b + c)) - (d / e))`; postfix is `a b c + * d e / -`. Substitution gives $3(2+5)-18/6=21-3=18$. The denominator $e$ belongs only to $d/e$, not to the whole difference.

**2.** First write `S = ((3 * t) + 1)`. Prefix is `= S + * 3 t 1`; postfix is `S 3 t * 1 + =`. At $t=4$, $S=3\cdot4+1=13$. Omitting `S` and `=` would convert only the right-hand expression, not the entire assignment formula.

**3.** The proposed prefix reconstructs to `(a + (b * c))`, whose root is addition. The original grouping is `((a + b) * c)`, whose root is multiplication. Its correct prefix is `* + a b c`, and its postfix is `a b + c *`. At the new input, $(2+3)4=20$ but $2+3\cdot4=14$. The equality at the first input was only a spot check, not proof of structural equivalence.

### 关联题目

[]

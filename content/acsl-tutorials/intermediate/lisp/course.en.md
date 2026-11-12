---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 6 — LISP
description: Three original lessons on list structure, quotation, CAR and CDR, nested evaluation, REVERSE, CONS, and prefix arithmetic. Trace every intermediate value before trying the linked questions. Short extensions introduce ATOM, composite selectors, SETQ, and EVAL.
category: ACSL · Intermediate
estimatedMinutes: 90
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 6 — LISP

## 章节：01. See the list before taking it apart

### 学习目标

- Identify the top-level elements of a list without flattening its sublists.
- Distinguish an atom, a one-element list, and the empty list.
- Apply CAR and CDR to quoted lists and preserve the exact shape of the result.

### 正文

#### Prerequisite: match pairs of parentheses

You need no previous LISP programming experience. Begin by matching each opening parenthesis with its closing parenthesis. A complete parenthesized group can occupy one position in a larger list, even when it contains several items of its own.

The conventions in this unit follow the official ACSL LISP description. All worked examples and self-checks below are original. The linked past-paper questions remain separate practice activities.

#### Count at one level at a time

Consider this quoted list:

```lisp
'(NORTH (EAST WEST) SOUTH ())
```

The leading apostrophe says to treat the following expression as data. It is not an extra list element and is not part of the returned value. We use straight apostrophes in code and uppercase symbols consistently.

This list has **4 top-level elements**. Do not count symbols inside a sublist as additional outer entries. Its structure is:

```text
outer list
├─ NORTH
├─ (EAST WEST)
│  ├─ EAST
│  └─ WEST
├─ SOUTH
└─ ()
```

| Position in the outer list | Complete element | Shape |
| --- | --- | --- |
| 1 | `NORTH` | Atom |
| 2 | `(EAST WEST)` | List with two elements |
| 3 | `SOUTH` | Atom |
| 4 | `()` | Empty list |

An **atom** is a single item such as a number or symbol. `(EAST WEST)` is one element of the outer list, even though it has two elements at its own level. The empty list `()` is also written `NIL`. NIL is the special case that is both an atom and a list; it also represents false in the predicates used here.

#### CAR takes one element; CDR keeps the remaining list

For a nonempty list, CAR returns its first element. That element may itself be a list. CDR removes the first element and returns the list of all remaining elements. **CDR does not mean “the second element.”**

| Expression | Returned value |
| --- | --- |
| `(CAR '(NORTH (EAST WEST) SOUTH ()))` | `NORTH` |
| `(CDR '(NORTH (EAST WEST) SOUTH ()))` | `((EAST WEST) SOUTH ())` |
| `(CAR (CDR '(NORTH (EAST WEST) SOUTH ())))` | `(EAST WEST)` |

For the third row, first replace the inner CDR call with its complete result. Then CAR takes the first element of that result:

```text
(CAR (CDR '(NORTH (EAST WEST) SOUTH ())))
CDR result: ((EAST WEST) SOUTH ())
CAR result: (EAST WEST)
```

The final value still has parentheses. Removing them would change a list into separate atoms. Also, displayed result lists are values, not new function calls: when substituting one as literal input in executable LISP, quote it again.

#### One element is enough for CDR to leave nothing

```text
(CDR '(NORTH))       => NIL
(CAR '((NORTH)))     => (NORTH)
```

The first input contains one atom, so removing it leaves the empty list. The second input contains one sublist; CAR returns that entire sublist. Do not erase a pair of parentheses merely because there is only one element inside.

CAR and CDR expect lists. An expression such as `(CAR 'NORTH)` supplies an ordinary symbol, not a list, so it is outside the operation's allowed input. Adding parentheses around the symbol changes its shape and therefore changes the problem.

#### Extension: use ATOM to check a result's shape

The recent linked questions mainly need CAR and CDR. ATOM is an additional official operation that helps test the distinction you have just learned. It returns `true` for an atom and `NIL` otherwise. Here we write the successful predicate value as `true`, following the ACSL description.

| Expression | Returned value | Reason |
| --- | --- | --- |
| `(ATOM 'NORTH)` | `true` | A quoted symbol is an atom. |
| `(ATOM '(NORTH))` | `NIL` | A nonempty list is not an atom. |
| `(ATOM NIL)` | `true` | NIL is the special empty-list/atom case. |

#### A reliable habit

Before evaluating a call, mark its complete input and decide whether it is an atom or a list. After evaluating it, write the entire output with all remaining parentheses. The next operation uses that output, not the original input.

### 检查点

**1.** For `'((RED BLUE) GREEN (GOLD) WHITE)`, list the top-level elements in order. Give the number of those elements and the results of CAR and CDR.

**2.** Evaluate `(ATOM 'RED)`, `(ATOM '(RED))`, and `(CDR '(RED))`. Explain why `(CAR 'RED)` is not the same task as `(CAR '(RED))`.

**3.** Evaluate `(CDR '((FOX OWL)))` and `(CAR '((FOX OWL)))`. Explain why one result is empty but the other contains two atoms.

**4.** Evaluate `(CAR '(() EAST))` and `(CDR '(() EAST))`. Does the empty first element disappear when counting the original list's top-level elements?

Completion standard: give the value and its shape. Use `NIL` or `()` for an empty result; retain the parentheses of every nonempty list.

### 参考答案

**1.** There are **4 top-level elements**: `(RED BLUE)`, `GREEN`, `(GOLD)`, and `WHITE`. CAR returns `(RED BLUE)`. CDR returns `(GREEN (GOLD) WHITE)`. The inner words RED and BLUE do not occupy separate positions in the outer list.

**2.** In the stated order, the results are `true`, `NIL`, and `NIL`. `'RED` supplies an atom; `'(RED)` supplies a one-element list. `(CAR 'RED)` has an invalid input shape, whereas `(CAR '(RED))` returns `RED`.

**3.** The original list has one top-level element, namely `(FOX OWL)`. Removing that whole element with CDR returns `NIL`. Taking that whole element with CAR returns `(FOX OWL)`. The two atoms belong to the returned sublist's level.

**4.** CAR returns `NIL`; CDR returns `(EAST)`. The original list has **2 top-level elements**: the empty list and the atom EAST. An empty element still occupies one position; an empty outer list would have no positions at all.

### 关联题目

[]

## 章节：02. Trace nested calls without losing a level

### 学习目标

- Evaluate nested list operations from the innermost dependency outward, recording each complete intermediate value.
- Reverse only the current list's top-level order and distinguish this from reversing its sublists.
- Use CONS and composite CAR/CDR names while checking the resulting list structure.

### 正文

#### Start with the input of the innermost operation

Evaluate this original expression:

```lisp
(CAR (REVERSE (CDR (CAR '((MAP (KEY COIN) PEN) (CUP BOOK) HAT)))))
```

Its operations are applied in this order: **CAR, CDR, REVERSE, CAR**. This is the dependency order from the innermost call outward, not the order in which the function names appear when read left to right.

| Step | Operation on the current value | Complete result |
| --- | --- | --- |
| 1 | CAR of the original list | `(MAP (KEY COIN) PEN)` |
| 2 | CDR of step 1 | `((KEY COIN) PEN)` |
| 3 | REVERSE of step 2 | `(PEN (KEY COIN))` |
| 4 | CAR of step 3 | `PEN` |

Step 2 has two elements: the sublist `(KEY COIN)` and the atom PEN. REVERSE exchanges their positions but leaves KEY before COIN inside their sublist. The last CAR returns the atom PEN, so the final answer has no surrounding list parentheses.

#### REVERSE works on one list level

Compare these separately quoted inputs:

```text
(REVERSE '((MAP (KEY COIN) PEN) (CUP BOOK) HAT))
=> (HAT (CUP BOOK) (MAP (KEY COIN) PEN))

(REVERSE '(KEY COIN))
=> (COIN KEY)
```

The first call reverses three outer elements. It does not change `(CUP BOOK)` to `(BOOK CUP)`. The second call explicitly supplies the two-element sublist as its input, so it reverses that level. The operation has not changed; its input has.

#### Extension: CONS inserts one complete element

CONS takes a first argument to insert and a second argument that is a list. It creates a list with the first argument as one new first element. It does not flatten the first argument when that argument is itself a list.

| Expression | Returned value |
| --- | --- |
| `(CONS 'KEY '(COIN PEN))` | `(KEY COIN PEN)` |
| `(CONS '(KEY COIN) '(PEN))` | `((KEY COIN) PEN)` |
| `(CONS '(KEY COIN) NIL)` | `((KEY COIN))` |

The third row is a one-element outer list. Its sole element is a two-element inner list. CONS adds exactly one outer element in each row. The form `(CONS 'KEY 'COIN)` does not meet the list-input convention used in this course: its second argument is an ordinary atom. We do not introduce dotted-pair notation here.

#### Extension: read composite selectors from right to left

The letters between C and R abbreviate a chain of CAR and CDR calls. Read those middle letters **from right to left** to find the execution order: A means CAR and D means CDR.

```text
(CADR x)  = (CAR (CDR x))
(CADAR x) = (CAR (CDR (CAR x)))
```

For CADAR, perform A, then D, then A: CAR, CDR, CAR. Here is an original example:

```text
(CADAR '((NOTE (PAGE LINE) TAB) DESK))
CAR result: (NOTE (PAGE LINE) TAB)
CDR result: ((PAGE LINE) TAB)
CAR result: (PAGE LINE)
```

The abbreviated name does not license skipping the intermediate shape checks. In particular, the final CAR returns a list in this example, not the atom PAGE.

#### Common error: retaining the value but changing its shape

If your trace ends in `(PAGE LINE)`, writing `PAGE LINE` loses the fact that the answer is one list. Conversely, writing `(PEN)` instead of `PEN` adds a list level. Both mistakes can look plausible when answer choices contain similar symbols. Compare the entire result, including parentheses, only after finishing the trace.

### 检查点

**1.** Evaluate `(CAR (CDR '(LAMP (KEY RING) DESK)))`. Write both intermediate results and the equivalent composite selector name.

**2.** Evaluate `(CDR (REVERSE '((RED BLUE) GREEN (GOLD WHITE))))`. Show the result immediately after REVERSE and then after CDR. Do either of the original sublists reverse internally?

**3.** Compare `(CONS '(RED BLUE) '(GREEN))` and `(CONS 'RED '(BLUE GREEN))`. Give both results and count the top-level elements in each.

**4.** Evaluate `(CAR (CDR (CAR '((INK (PEN PAPER) CLIP) CUP))))`. A learner reports `PEN`. Identify the missing list structure and explain which extra operation would be needed to obtain PEN instead.

Completion standard: show one row for every operation, with the full output used as the next input. Treat a sublist as one complete element until an operation explicitly enters it.

### 参考答案

**1.** CDR first returns `((KEY RING) DESK)`. CAR then returns `(KEY RING)`. The abbreviation is `(CADR '(LAMP (KEY RING) DESK))`: the D operation runs before the A operation.

**2.** REVERSE returns `((GOLD WHITE) GREEN (RED BLUE))`. CDR removes the whole first sublist and returns `(GREEN (RED BLUE))`. Neither sublist reverses internally; RED remains before BLUE, and GOLD remains before WHITE.

**3.** The first result is `((RED BLUE) GREEN)`, with **2 top-level elements**. The second is `(RED BLUE GREEN)`, with **3 top-level elements**. Inserting the list `(RED BLUE)` adds one element, not two.

**4.** The trace is `(INK (PEN PAPER) CLIP)`, then `((PEN PAPER) CLIP)`, then `(PEN PAPER)`. The result is the two-element list `(PEN PAPER)`, not the atom PEN. An additional CAR applied to that final value would return `PEN`; that extra call is absent from the given expression.

### 关联题目

[]

## 章节：03. Separate arithmetic, quoted data, and evaluation

### 学习目标

- Evaluate prefix arithmetic by resolving argument expressions before their enclosing call.
- Preserve the order of SUB and DIV arguments and allow noninteger division results.
- Explain how quotation changes an expression into data, and trace a small SETQ/EVAL sequence without changing a stored list accidentally.

### 正文

#### A function name comes before its arguments

In `(ADD 3 7)`, ADD is the operation and 3 and 7 are its arguments. Parentheses delimit the call. They do not mean multiplication, and a function name is not an extra numeric argument. For the arithmetic used in this lesson:

| Function | Meaning in this course |
| --- | --- |
| ADD | Sum its numeric arguments. |
| MULT | Multiply its numeric arguments. |
| `(SUB a b)` | Subtract the second value from the first: $a-b$. |
| `(DIV a b)` | Divide the first value by the second: $a/b$, with a nonzero second argument. |

ADD and MULT can accept more than two arguments. We use the two-argument forms of SUB and DIV specified in the ACSL description. The symbols `+`, `*`, `-`, and `/` can stand for these four names. This does not make the named ACSL functions built-in commands in every Lisp implementation.

#### A complete arithmetic trace

```lisp
(ADD (MULT 3 7) (SUB 14 5) (DIV 15 2) 4)
```

The outer ADD needs three inner results and the literal 4:

| Inner call | Calculation | Returned value |
| --- | --- | --- |
| `(MULT 3 7)` | $3\cdot7$ | 21 |
| `(SUB 14 5)` | $14-5$ | 9 |
| `(DIV 15 2)` | $15/2$ | 7.5 |

```text
(ADD (MULT 3 7) (SUB 14 5) (DIV 15 2) 4)
=> (ADD 21 9 7.5 4)
=> 41.5
```

Check the result using fractions: $21+9+15/2+4=83/2=41.5$. DIV does not silently discard the fractional part. There is no conversion to an integer in this expression.

The equivalent symbolic form is:

```lisp
(+ (* 3 7) (- 14 5) (/ 15 2) 4)
```

Swapping the SUB arguments would give `(SUB 5 14)` with value $-9$, not 9. Preserve the given order even if the outer operation is ADD. Unlike an infix expression, the nested parentheses already specify the dependencies; there is no reason to invent a left-to-right flat calculation across them.

#### Quoting the same text changes its role

```text
(ADD 4 (MULT 2 6))   => 16
'(ADD 4 (MULT 2 6))  => (ADD 4 (MULT 2 6))
```

The unquoted call performs arithmetic. The quoted expression supplies a list with three top-level elements: ADD, 4, and `(MULT 2 6)`. The inner MULT call is data too; it is not evaluated through the surrounding quote. This is the same quotation principle that allowed lists of direction names in lesson 1.

#### Extension: give quoted data a name, then evaluate it deliberately

SETQ assigns a value to a variable. Its first argument names the variable without a leading apostrophe; its second argument supplies the value. Read the following calls in order:

```lisp
(SETQ FORM '(ADD 4 (MULT 2 6)))
(ATOM 'FORM)
(ATOM FORM)
(EVAL 'FORM)
(EVAL FORM)
```

| Statement | Returned value | Value still stored in FORM afterward |
| --- | --- | --- |
| `(SETQ FORM '(ADD 4 (MULT 2 6)))` | `(ADD 4 (MULT 2 6))` | `(ADD 4 (MULT 2 6))` |
| `(ATOM 'FORM)` | `true` | `(ADD 4 (MULT 2 6))` |
| `(ATOM FORM)` | `NIL` | `(ADD 4 (MULT 2 6))` |
| `(EVAL 'FORM)` | `(ADD 4 (MULT 2 6))` | `(ADD 4 (MULT 2 6))` |
| `(EVAL FORM)` | `16` | `(ADD 4 (MULT 2 6))` |

`'FORM` supplies the symbol FORM. EVAL then resolves that symbol to the stored list, so `(EVAL 'FORM)` returns the list. In `(EVAL FORM)`, the unquoted argument FORM first supplies its stored list; EVAL then evaluates that list as an expression, giving 16. Returning 16 does not assign 16 back to FORM. Only a later assignment would change its stored value.

If these two EVAL calls seem interchangeable, write down the argument value supplied to EVAL first: the symbol FORM in one case, the stored list in the other. Then write the result of evaluating that value.

#### Scope beyond these linked questions

The official description also introduces SET, SQUARE, EXP, EQ, POS, NEG, and user-defined functions with DEF or DEFUN. Those belong to the broader topic; these three lessons concentrate on the list operations and arithmetic needed by the eight linked questions, with the extensions clearly marked. LIST, APPEND, LENGTH, and NULL are not assumed prerequisites here. Do not transfer implementation-specific behavior from a general Lisp interpreter without checking the question's conventions.

### 检查点

**1.** Evaluate the expression below. Record all three inner values before multiplying them.

```lisp
(MULT (ADD 3 4 1) (SUB 11 6) (DIV 9 2))
```

**2.** Compare `'(SUB 12 5)` and `(SUB 12 5)`. Give the returned value and the result of applying ATOM to that value in each case.

**3.** Start with the assignment below. Give the results of `(EVAL 'P)`, `(EVAL P)`, and `(ATOM P)`, in that order. What is stored in P after all three calls?

```lisp
(SETQ P '(MULT 3 (ADD 2 4)))
```

**4.** A learner evaluates `(ADD (DIV 5 2) (SUB 3 8))` by replacing DIV with 2 and SUB with 5, then reports 7. Identify both incorrect replacements and give the correct result.

Completion standard: resolve the inner dependencies, preserve argument order, and distinguish a returned number from a stored expression list. After finishing these original self-checks, use the linked past-paper questions for independent practice.

### 参考答案

**1.** ADD returns 8, SUB returns 5, and DIV returns 4.5. The remaining call is `(MULT 8 5 4.5)`, with value $8\cdot5\cdot4.5=180$. As an exact check, $8\cdot5\cdot9/2=180$.

**2.** The quoted expression returns the three-element list `(SUB 12 5)`; ATOM of that value returns `NIL`. The unquoted call returns the number `7`; ATOM of that value returns `true`. The symbol SUB is data in the first case and an operation in the second.

**3.** `(EVAL 'P)` returns `(MULT 3 (ADD 2 4))`. `(EVAL P)` evaluates ADD to 6 and then MULT to $3\cdot6=18$, returning `18`. `(ATOM P)` returns `NIL`. P still stores `(MULT 3 (ADD 2 4))`: none of the three calls reassigns it.

**4.** `(DIV 5 2)` returns 2.5, not 2. `(SUB 3 8)` returns $3-8=-5$, not 5. Thus the remaining call is `(ADD 2.5 -5)`, and its result is $-2.5$. The two errors are truncating division and reversing the subtraction order.

### 关联题目

[]

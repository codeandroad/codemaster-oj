---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 7 — Boolean Algebra
description: Three original lessons on reading Boolean expressions, using truth tables and identities, and proving equivalence or counting satisfying inputs. Follow complement bars carefully, justify each algebraic step, and verify results by complete enumeration. Prerequisites are the values 0 and 1 and the basic idea of AND, OR and NOT.
category: ACSL · Intermediate
estimatedMinutes: 85
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 7 — Boolean Algebra

## 章节：01. Read the logic, then build every truth-table row

### 学习目标

- Interpret Boolean constants and operators without treating OR as ordinary addition.
- Identify exactly what each complement bar covers and apply the correct grouping.
- Enumerate ordered inputs systematically and count true or false rows.

### 正文

#### Prerequisite check: a Boolean value has only two possibilities

Use 0 for false and 1 for true. Each variable in this lesson is one Boolean value, not an arbitrary integer or a whole bit string. $PQ$ and $P\cdot Q$ both mean AND; $P+Q$ means inclusive OR; $\overline P$ means NOT. Inclusive OR accepts either input or both: $1+1=1$ in Boolean algebra. It does not produce the arithmetic number 2, and it does not mean “exactly one”.

XOR, written $P\oplus Q$, is true when the two inputs differ. XNOR, written $P\odot Q$, is true when they agree. The table separates these operations instead of relying on their names.

| $P$ | $Q$ | $\overline P$ | $PQ$ | $P+Q$ | $P\oplus Q$ | $P\odot Q$ |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 0 | 1 | 1 | 0 | 1 | 1 | 0 |
| 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| 1 | 1 | 0 | 1 | 1 | 0 | 1 |

For the notation and precedence used by ACSL, see its official Boolean Algebra category description. Grouped expressions are evaluated inside their boundaries; NOT precedes AND, followed by XOR/XNOR, then OR. Same-level operators are evaluated left to right. This course mainly uses NOT, AND and OR; parentheses make any mixed example unambiguous. All worked examples and self-checks below are original.

#### A complement bar is also a grouping boundary

$\overline{PQ}$ negates the result of the whole AND. By contrast, $\overline P\,\overline Q$ negates each input separately and then ANDs the results. At $(P,Q)=(0,1)$:

$$
\overline{PQ}=\overline{0\cdot1}=\overline0=1,
\qquad
\overline P\,\overline Q=1\cdot0=0.
$$

The expressions are not interchangeable. To read $\overline{P+Q}R$, first compute $P+Q$, negate that entire result, and then AND with $R$. The bar does not cover $R$. A longer bar or nested bars can change the expression even if all letters stay in the same places.

A reliable first pass is to name an inner group: for $\overline{P+Q}R$, let $T=P+Q$, then compute $\overline T R$. Naming a group does not change its meaning; it prevents a short bar from being mistaken for a long one.

#### Worked truth table: retain the intermediate columns

Find every ordered triple $(P,Q,R)$ making

$$
F=(P+\overline Q)R
$$

true. There are $2^3=8$ triples. List them in binary order from 000 through 111, keeping the column order $P,Q,R$ fixed. Here $R$ changes every row, $Q$ every two rows and $P$ every four rows. Compute $\overline Q$, then the parenthesized OR, then the final AND.

| $P$ | $Q$ | $R$ | $\overline Q$ | $P+\overline Q$ | $F$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 1 | 1 | 0 |
| 0 | 0 | 1 | 1 | 1 | 1 |
| 0 | 1 | 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 | 0 | 0 |
| 1 | 0 | 0 | 1 | 1 | 0 |
| 1 | 0 | 1 | 1 | 1 | 1 |
| 1 | 1 | 0 | 0 | 1 | 0 |
| 1 | 1 | 1 | 0 | 1 | 1 |

The true triples are `(0,0,1)`, `(1,0,1)` and `(1,1,1)`: 3 true rows and $8-3=5$ false rows. Counting the ones in an intermediate column would answer a different question. The condition $R=1$ is necessary, but it is not sufficient: `(0,1,1)` still makes the parenthesized part zero.

#### Free inputs still count as distinct ordered inputs

In a pattern such as `(1,*,0)`, `*` means either 0 or 1 independently. It abbreviates the two triples `(1,0,0)` and `(1,1,0)`; it is not multiplication. An expression that does not depend on $Q$ still receives two different inputs when only $Q$ changes. The question's requested variable list determines what is being counted.

Do not drop a row because a variable seems irrelevant, change the order of the variables halfway through a table, or report true rows when the question asks for false rows. A complete table is small enough for three variables to make all three errors visible.

### 检查点

**1.** At $(P,Q,R)=(0,1,1)$, evaluate $\overline P+QR$ and $\overline{P+Q}R$ separately. Show the grouped part before applying each NOT.

**2.** Build the full eight-row table for $G=P\overline Q+QR$. Include columns for both product terms, list the true triples, and give the number of false triples.

**3.** An expression is $H=P\oplus Q$, but the requested inputs are ordered triples $(P,Q,R)$. Give all true triples using `*` patterns and explain how many they represent.

**4.** A learner reads $P+QR$ as $(P+Q)R$. Evaluate both at `(1,0,0)`. Explain which operation should be performed first in the expression without parentheses.

Completion standard: preserve bar boundaries and variable order, show all eight rows when a full table is requested, and count only the final result column.

### 参考答案

**1.** In the first expression, only $P$ is negated: $\overline P=1$, $QR=1\cdot1=1$, so $\overline P+QR=1+1=1$. In the second, the grouped OR is $P+Q=0+1=1$; its complement is 0, and $\overline{P+Q}R=0\cdot1=0$. Changing the length of the bar changes which result is negated.

**2.** The two product terms are computed independently, then combined by OR:

| $P$ | $Q$ | $R$ | $P\overline Q$ | $QR$ | $G$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 0 | 0 | 0 |
| 0 | 1 | 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 0 | 1 |
| 1 | 0 | 1 | 1 | 0 | 1 |
| 1 | 1 | 0 | 0 | 0 | 0 |
| 1 | 1 | 1 | 0 | 1 | 1 |

The true triples are `(0,1,1)`, `(1,0,0)`, `(1,0,1)` and `(1,1,1)`. There are 4 true rows and $8-4=4$ false rows. At `(1,1,1)`, $P\overline Q=0$, but $QR=1$ is enough to make the OR true.

**3.** XOR requires different first and second inputs: `(0,1,*)` and `(1,0,*)`. Each pattern represents two choices for $R$, so the number of true triples is $2+2=4$. The concrete triples are `(0,1,0)`, `(0,1,1)`, `(1,0,0)` and `(1,0,1)`. No choice of $R$ can make equal $P,Q$ satisfy XOR.

**4.** AND has precedence over OR: $P+QR=1+(0\cdot0)=1$. The altered grouping gives $(P+Q)R=(1+0)\cdot0=0$. This input is a counterexample, so the two forms cannot be treated as the same expression.

### 关联题目

[]

## 章节：02. Simplify with justified identities and exact bar boundaries

### 学习目标

- Apply Boolean identities to complete expressions, not just isolated letters.
- Use De Morgan's laws one bar at a time and explain every change of operator.
- Build an equality chain and detect invalid arithmetic-style cancellation.

### 正文

#### Keep a small set of laws you can explain

In the following identities, $X,Y,Z$ may themselves be complete Boolean expressions. A law is valid for every possible input, not only the one currently being tested.

| Purpose | OR form or first form | AND form or second form |
| --- | --- | --- |
| Identity | $X+0=X$ | $X\cdot1=X$ |
| Domination | $X+1=1$ | $X\cdot0=0$ |
| Idempotence | $X+X=X$ | $XX=X$ |
| Complement | $X+\overline X=1$ | $X\overline X=0$ |
| Absorption | $X+XY=X$ | $X(X+Y)=X$ |
| Distribution | $X(Y+Z)=XY+XZ$ | $(X+Y)(X+Z)=X+YZ$ |
| De Morgan | $\overline{X+Y}=\overline X\,\overline Y$ | $\overline{XY}=\overline X+\overline Y$ |
| Double complement | $\overline{\overline X}=X$ | $\overline0=1$, $\overline1=0$ |

Commutativity lets us exchange the two operands of OR or AND. Associativity lets us regroup a chain of the same operation. Neither law allows an AND to be exchanged with an OR without a valid distribution step.

For example, $X+\overline X Y=X+Y$ follows by distribution and the complement law:

$$
X+\overline X Y=(X+\overline X)(X+Y)=1\cdot(X+Y)=X+Y.
$$

This identity is useful, but the equality chain explains why it works. Boolean algebra has two distributive forms; ordinary arithmetic intuition alone does not justify them.

#### Worked example: push a complement through one complete group

Simplify

$$
K=\overline{\overline P+Q\overline R}.
$$

The outermost bar covers an OR. De Morgan changes that OR into an AND and complements its two **complete** operands:

$$
\begin{aligned}
K&=\overline{\overline P}\,\overline{Q\overline R}\\
 &=P(\overline Q+\overline{\overline R})\\
 &=P(\overline Q+R).
\end{aligned}
$$

The first step does not turn $Q\overline R$ into two unrelated terms. The second applies De Morgan to that product, while the double complements on $P$ and $R$ cancel. The parentheses around $\overline Q+R$ must remain because it is the right operand of an AND.

Check a boundary input: at `(1,1,0)`, the original inner expression is $0+1\cdot1=1$, so its complement is 0; the simplified expression gives $1(0+0)=0$. At `(1,0,0)`, both forms give 1. These checks help find a transcription error, while the identities justify the result for every input.

#### Worked example: factor before expanding everything

Consider

$$
E=P\overline Q+PQ+\overline P Q.
$$

The first two terms have a common factor $P$:

$$
\begin{aligned}
E&=P(\overline Q+Q)+\overline P Q\\
 &=P+\overline P Q\\
 &=(P+\overline P)(P+Q)\\
 &=P+Q.
\end{aligned}
$$

The middle step uses the identity just proved, not ordinary cancellation. The result is true when at least one of $P,Q$ is true. Keeping a separate label for each equality makes a lost bar or extra term easier to locate.

#### “Cancel the same factor” is not a Boolean rule

From $PQ=PR$, you cannot generally conclude $Q=R$. Set $P=0,Q=0,R=1$: both products are 0 even though $Q\ne R$. Similarly, $P+Q=P+R$ need not imply $Q=R$; with $P=1$, both OR results are already 1.

Avoid dividing by a variable, interpreting $X+X$ as $2X$, or moving a bar across only one factor of a product. Instead, name the law, apply it to the entire matching group, and retain any parentheses still needed for precedence. A shorter formula is not automatically an equivalent one.

### 检查点

**1.** Simplify $\overline{P+\overline Q R}$. Show the outer De Morgan step and the inner product's complement separately.

**2.** Simplify $(P+Q)(P+\overline Q)$. Explain why the result has no remaining dependence on $Q$.

**3.** Simplify $Q(P+R)+Q\overline P\,\overline R$. Identify one complete expression and its complement after factoring.

**4.** A learner claims $\overline{PQ+R}=\overline P\,\overline Q+\overline R$. Give the correct expression and use `(1,1,0)` to show the error.

Completion standard: give an equality chain with a reason for each step. Do not claim two expressions are equivalent only because one input agrees.

### 参考答案

**1.** First complement the two complete operands of the outer OR; then complement the product:

$$
\begin{aligned}
\overline{P+\overline Q R}
 &=\overline P\,\overline{\overline Q R}\\
 &=\overline P(\overline{\overline Q}+\overline R)\\
 &=\overline P(Q+\overline R).
\end{aligned}
$$

The AND inside the second operand changes to OR. Omitting those parentheses would change which terms are ANDed with $\overline P$.

**2.** Apply $(X+Y)(X+Z)=X+YZ$ with $X=P,Y=Q,Z=\overline Q$:

$$
(P+Q)(P+\overline Q)=P+Q\overline Q=P+0=P.
$$

If $P=1$, both parenthesized terms are true. If $P=0$, the result would require both $Q$ and $\overline Q$ to be true, which is impossible. Thus either value of $Q$ leaves the result equal to $P$.

**3.** Factor $Q$, then recognize $\overline P\,\overline R=\overline{P+R}$:

$$
\begin{aligned}
Q(P+R)+Q\overline P\,\overline R
 &=Q\bigl[(P+R)+\overline P\,\overline R\bigr]\\
 &=Q\bigl[(P+R)+\overline{P+R}\bigr]\\
 &=Q\cdot1=Q.
\end{aligned}
$$

The complemented object is the whole expression $P+R$. No assumption about particular values of $P$ or $R$ was needed.

**4.** The correct form is

$$
\overline{PQ+R}=\overline{PQ}\,\overline R=(\overline P+\overline Q)\overline R.
$$

At `(1,1,0)`, the original gives $\overline{1\cdot1+0}=0$. The proposed incorrect form gives $0\cdot0+1=1$. Its first error is keeping an OR at the outer level; the outer complemented OR must become an AND. The product's complement must also become an OR, not an AND of two complements.

### 关联题目

[]

## 章节：03. Prove equivalence and count inputs without double counting

### 学习目标

- Distinguish an equivalence proof, a counterexample, and an accidental agreement.
- Partition inputs into disjoint cases and account for irrelevant variables.
- Count unions correctly, using complete truth tables to check overlapping terms.

### 正文

#### Equivalence means agreement on every row

Two expressions in the same input variables are equivalent only if their final outputs agree on every possible input. One differing row disproves equivalence. One agreeing row does not prove it, and even the same total number of true rows is insufficient.

For example, $P$ and $Q$ are each true on 4 of the 8 triples $(P,Q,R)$, but at `(1,0,0)` their values are 1 and 0. When comparing expressions by truth table, align the input rows first and compare the outputs row by row; do not compare only the totals.

For three Boolean variables, an exhaustive eight-row comparison is a proof because it covers the complete input domain. An equality chain using valid identities is another proof. Use whichever method makes the structure and the requested result easier to check.

#### Worked counting example: split on one variable

Let

$$
M=\overline P Q+PR.
$$

Choose cases $P=0$ and $P=1$. Every triple belongs to exactly one case, so their counts can be added without overlap.

| Fixed input | Reduced expression | Condition for true | True triples |
| --- | --- | --- | --- |
| $P=0$ | $Q$ | $Q=1$, $R$ free | `(0,1,0)`, `(0,1,1)` |
| $P=1$ | $R$ | $R=1$, $Q$ free | `(1,0,1)`, `(1,1,1)` |

There are $2+2=4$ true triples. The shorthand patterns are `(0,1,*)` and `(1,*,1)`. Fixing $P$ did not remove it from the ordered triple; it created two disjoint parts of the original eight-row domain.

#### Worked overlap example: OR is a union, not arithmetic addition

Now consider

$$
N=PQ+QR+RP.
$$

Each product term is true on two triples. Adding $2+2+2$ would count `(1,1,1)` three times. OR only asks whether at least one term is true.

| $P$ | $Q$ | $R$ | $PQ$ | $QR$ | $RP$ | $N$ |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 | 1 | 0 | 1 |
| 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 1 | 0 | 0 | 1 | 1 |
| 1 | 1 | 0 | 1 | 0 | 0 | 1 |
| 1 | 1 | 1 | 1 | 1 | 1 | 1 |

There are 4 true triples: `(0,1,1)`, `(1,0,1)`, `(1,1,0)` and `(1,1,1)`. Another disjoint split fixes $Q$: when $Q=0$, only $PR$ remains, giving one triple `(1,0,1)`; when $Q=1$, the expression becomes $P+R$, giving three triples. The total is $1+3=4$.

This example and $M$ both have four true rows, but they differ at `(0,1,0)`: $M=1$ and $N=0$. Equal counts do not establish equivalence.

#### Use independence and complements carefully

If the result does not depend on one of the requested input variables, each satisfying assignment of the remaining variables expands into two inputs. For instance, an expression true on three ordered pairs $(P,Q)$ and independent of $R$ is true on $3\cdot2=6$ triples. If a fourth independent input $S$ is also requested, the count becomes $3\cdot2^2=12$ quadruples. The factor is justified by independent choices, not by the number of letters printed in the formula.

For a three-variable expression, the true and false counts sum to 8. An always-false expression such as $P\overline P$ has 0 true triples; an always-true expression such as $P+\overline P$ has 8. A contradiction or a tautology still belongs to the same eight-input domain.

A practical solution order is: mark the bars and parentheses; try a small valid simplification; choose a full table or a disjoint case split; then check the total against $2^n$. When a problem asks for an expression rather than a count, finish with the expression and verify equivalence, not just its number of true rows.

### 检查点

**1.** For $S=(P+\overline Q)\overline R$, list all true triples in the order $(P,Q,R)$ and count false triples. Give a disjoint pattern description as a second check.

**2.** For $J=P+\overline Q$, how many ordered triples $(P,Q,R)$ make it true? How many ordered quadruples $(P,Q,R,S)$? Explain precisely which inputs are free.

**3.** Determine whether $U=(P+Q)(\overline P+R)$ is equivalent to $V=PR+\overline P Q$. Give a complete comparison table. Then justify why the extra term $QR$ obtained when expanding $U$ does not add new true inputs.

**4.** Count the true and false triples for $W=P+QR$ by splitting on $P$. Explain why adding “the four triples with $P=1$” to “the two triples with $Q=R=1$” is incorrect.

Completion standard: use disjoint cases or inspect every row, account for all requested variables, and distinguish equivalent expressions from equal counts.

### 参考答案

**1.** The final AND requires $R=0$. With that fixed, $P+\overline Q$ is true for $(P,Q)=(0,0),(1,0),(1,1)$. Hence the true triples are `(0,0,0)`, `(1,0,0)` and `(1,1,0)`: 3 true and $8-3=5$ false. The disjoint patterns `(1,*,0)` and `(0,0,0)` represent $2+1=3$ triples; the second cannot already be in the first because its first input is 0.

**2.** The only false pair is $(P,Q)=(0,1)$, so 3 of the 4 pairs are true. In triples, $R$ is free, giving $3\cdot2=6$ true inputs. In quadruples, $R$ and $S$ are independently free, giving $3\cdot2^2=12$. Do not count only three inputs just because the expression uses only $P,Q$; the question asks for longer ordered inputs.

**3.** The final columns agree in every row:

| $P$ | $Q$ | $R$ | $U$ | $V$ |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 0 | 0 |
| 0 | 1 | 0 | 1 | 1 |
| 0 | 1 | 1 | 1 | 1 |
| 1 | 0 | 0 | 0 | 0 |
| 1 | 0 | 1 | 1 | 1 |
| 1 | 1 | 0 | 0 | 0 |
| 1 | 1 | 1 | 1 | 1 |

Both expressions are true on 4 triples, and the row-by-row agreement proves equivalence. For an algebraic check, distribute first:

$$
\begin{aligned}
U&=P\overline P+PR+\overline P Q+QR\\
 &=PR+\overline P Q+QR.
\end{aligned}
$$

Whenever $QR=1$, either $P=1$ and therefore $PR=1$, or $P=0$ and therefore $\overline P Q=1$. Thus the extra term covers no new inputs. The same argument can be written with identities:

$$
\begin{aligned}
QR&=QR(P+\overline P)=PQR+\overline P QR,\\
PR+\overline P Q+QR
 &=PR+PQR+\overline P Q+\overline P QR\\
 &=PR+\overline P Q=V.
\end{aligned}
$$

Each final absorption removes a term whose true inputs are already included in the shorter term.

**4.** If $P=1$, all four choices of $(Q,R)$ work: `(1,*,*)`. If $P=0$, the remaining AND requires $Q=R=1$, giving only `(0,1,1)`. These cases are disjoint, so there are $4+1=5$ true triples and $8-5=3$ false triples. The naive count $4+2$ includes `(1,1,1)` twice; OR cannot turn that repeated input into another triple.

### 关联题目

[]

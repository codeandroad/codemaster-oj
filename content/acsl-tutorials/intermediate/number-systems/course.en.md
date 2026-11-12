---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 1 — Computer Number Systems
description: Learn place value, base conversion, column addition with carries, and mixed-base calculations through four original lessons and self-checks. Designed for Intermediate beginners and learners in other divisions reviewing the foundations. Prerequisites are integer arithmetic and remainders.
category: ACSL · Intermediate
estimatedMinutes: 100
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 1 — Computer Number Systems

## 章节：01. Digits, positions, and values

### 学习目标

- Explain a base, a digit, and a place value; distinguish a number's value from its notation.
- Expand a numeral by place value to find its decimal value.
- Check whether digits are valid and explain why an internal zero cannot simply be removed.

### 正文

#### Start by exchanging a full group for one larger unit

A warehouse puts 5 badges in a box, 5 boxes in a crate, and 5 crates in a cabinet. Its record `2304` means 2 cabinets, 3 crates, 0 boxes, and 4 loose badges. This is base-five notation, written $2304_5$. From right to left, the four place values are 1, 5, 25, and 125 badges.

| Position | Count | Badges per unit | Contribution |
| --- | ---: | ---: | ---: |
| Cabinet | 2 | 125 | 250 |
| Crate | 3 | 25 | 75 |
| Box | 0 | 5 | 0 |
| Loose badge | 4 | 1 | 4 |

Therefore:

$$
2304_5=2\cdot5^3+3\cdot5^2+0\cdot5+4=329_{10}.
$$

The subscript identifies the base; it is not a multiplication factor. Changing from base five to decimal does not change the actual number of badges.

#### The same rule works in every integer base

Let $b$ be an integer with $b≥2$. In base $b$, the rightmost place has value $b^0=1$. Moving one position left multiplies the place value by $b$. Digit values must belong to $0,1,\ldots,b-1$: once there are $b$ units in a position, exchange them for one unit in the next position. Thus $10_b=b_{10}$.

| Base | Valid digits | First three place values, from the right |
| --- | --- | --- |
| Binary | 0, 1 | 1, 2, 4 |
| Octal | 0 through 7 | 1, 8, 64 |
| Hexadecimal | 0 through 9, A through F | 1, 16, 256 |

In hexadecimal, A, B, C, D, E, and F represent decimal 10, 11, 12, 13, 14, and 15. For example, C is a digit, not an unknown variable:

$$
3C2_{16}=3\cdot256+12\cdot16+2=962_{10}.
$$

#### Common errors: using decimal place values or removing a placeholder

Do not give $2304_5$ decimal thousands, hundreds, tens, and units places. An internal zero means that a particular place contributes no units; the position still exists. Extra zeros at the far left of an integer do not change its value: for example, $0031_5=31_5$.

Check the digits before calculating. The notation $128_8$ contains the digit 8, so it is not a valid octal integer. There is no need to continue expanding it.

### 检查点

1. Expand $402_7$ by place value and find its decimal value.
2. Select all valid numerals: A. $10101_2$; B. $128_8$; C. $3E_{16}$; D. $206_6$. Explain each rejection.
3. A learner removes the zero from $306_8$ because “zero contributes nothing.” Evaluate both $306_8$ and $36_8$ and explain the error.

Completion standard: explain all three answers independently, especially the difference between “this position contributes zero” and “this position does not exist.” If you make an error, redraw the place-value table before checking the reference answer.

### 参考答案

**1.** $402_7=4\cdot7^2+0\cdot7+2=198_{10}$.

**2.** Select A and C. Binary uses only 0 and 1; hexadecimal E has value 14. In B, the digit 8 is not smaller than base 8. In D, the digit 6 is not smaller than base 6. Both are invalid.

**3.** $306_8=3\cdot64+0\cdot8+6=198_{10}$, whereas $36_8=3\cdot8+6=30_{10}$. Removing the internal zero moves the 3 from the sixty-fours place to the eights place, changing its contribution.

### 关联题目

[]

## 章节：02. Change the notation, keep the value

### 学习目标

- Convert a nonnegative decimal integer to another base by repeated division.
- Explain why remainders must be read in reverse order.
- Convert between binary, octal, and hexadecimal by grouping bits, then verify by place-value expansion.

### 正文

#### From decimal: the remainder gives the lowest digit first

There are 154 badges, and each box holds 8. Division gives 19 boxes and 2 loose badges. Grouping those boxes into crates of 8 gives 2 crates and 3 boxes. The remaining 2 crates cannot make another full group.

| Current number | Quotient after division by 8 | Remainder | Remainder's position |
| ---: | ---: | ---: | --- |
| 154 | 19 | 2 | Units |
| 19 | 2 | 3 | Eights |
| 2 | 0 | 2 | Sixty-fours |

Remainders are produced from the lowest place to the highest. Read from the final remainder back to the first:

$$
154_{10}=232_8.
$$

Check: $2\cdot64+3\cdot8+2=154$. In general, $N=bq+r$, with $0\le r<b$. The remainder $r$ is the lowest digit, and the quotient $q$ contains the remaining higher digits. Repeat with the quotient until it becomes zero. If the original number is zero, its representation is simply 0.

#### Group binary digits using the relationship between place values

Since $8=2^3$, one octal digit corresponds to exactly three bits. Since $16=2^4$, one hexadecimal digit corresponds to exactly four bits. For the integers in this course, group from right to left. Pad the leftmost group with zeros if it is incomplete.

Consider $1011010110_2$:

$$
\begin{aligned}
1011010110_2&=(001\;011\;010\;110)_2=1326_8,\\
1011010110_2&=(0010\;1101\;0110)_2=2D6_{16}.
\end{aligned}
$$

The octal groups have values 1, 3, 2, and 6. The hexadecimal groups have values 2, 13, and 6; 13 is written D. Both expansions give 726:

$$
1\cdot512+3\cdot64+2\cdot8+6
=2\cdot256+13\cdot16+6
=726.
$$

#### Common errors: grouping from the left or dropping zeros inside a group

To convert $2D6_{16}$ to binary, first write four bits per hexadecimal digit: `0010 1101 0110`. You may remove leading zeros at the far left of the whole integer. Do not shorten an internal group before concatenation: deleting a zero changes the place values of digits to its left.

Groups of three and four work because $8=2^3$ and $16=2^4$. Decimal 10 is not an integer power of 2, so a fixed number of binary bits cannot directly replace each decimal digit in a positional base conversion.

### 检查点

1. Convert $173_{10}$ to octal by repeated division. List every quotient and remainder.
2. Convert $111001011_2$ to hexadecimal. Show the groups and verify the value in decimal.
3. When converting $2D6_{16}$ to binary, a learner writes `10 1101 110` and joins the groups. Explain which zeros must be kept and give the correct result.

Completion standard: obtain both numeric answers and explain the third answer using “keep each group's width, then remove only the whole integer's leading zeros,” rather than memorizing the final string.

### 参考答案

**1.** $173=8\cdot21+5$, $21=8\cdot2+5$, and $2=8\cdot0+2$. Reading the remainders backward gives $255_8$. Check: $2\cdot64+5\cdot8+5=173$.

**2.** The groups are `0001 1100 1011`, giving $1CB_{16}$. Its decimal value is $256+12\cdot16+11=459$. Expanding the original binary numeral gives $256+128+64+8+2+1=459$ as well.

**3.** First write `0010 1101 0110`. The final digit 6 needs the four-bit group `0110`; shortening it before concatenation shifts the preceding groups. After joining, the two zeros at the far left may be removed, giving $1011010110_2$.

### 关联题目

[]

## 章节：03. Column arithmetic: carrying and borrowing

### 学习目标

- Align integers in the same base and include the incoming carry in each column.
- Use quotient and remainder to determine the outgoing carry and result digit.
- Distinguish internal carry marks from a new leading result digit, and handle carries greater than 1 when adding several numbers.
- Explain why borrowing one higher-place unit adds one base worth of units to the current column, and subtract across a zero.

### 正文

#### Derive the addition rule from grouping

Return to badges, this time with 8 badges per box and 8 boxes per crate. Two storage cabinets are recorded as $267_8$ and $145_8$. Align matching units and work from the rightmost column to the left.

Let $s$ be the sum of every digit in the current column plus its incoming carry. Write the remainder after dividing $s$ by 8, and send the quotient to the next column. In a general base $b$:

$$
\begin{aligned}
\text{result digit}&=s\bmod b,\\
\text{outgoing carry}&=\left\lfloor\frac{s}{b}\right\rfloor.
\end{aligned}
$$

#### Add two octal integers

A small carry mark belongs above the column **receiving it**, not above the column that produced it. All digits in this layout are octal:

$$
\begin{array}{rccc}
 & {\scriptstyle1} & {\scriptstyle1} & \\
 & 2 & 6 & 7 \\
+& 1 & 4 & 5 \\
\hline
 & 4 & 3 & 4
\end{array}
$$

1. Units: $7+5=12_{10}=1\cdot8+4$. Write 4 and carry 1 to the eights column.
2. Eights: $6+4+1=11_{10}=1\cdot8+3$. Write 3 and carry 1 to the sixty-fours column.
3. Sixty-fours: $2+1+1=4$. Write 4; there is no further carry.

Thus $267_8+145_8=434_8$. Decimal check: $183+101=284$, and $434_8=4\cdot64+3\cdot8+4=284$.

#### Hexadecimal uses the same rule

Add $2B7_{16}+19D_{16}$. B represents 11 and D represents 13. A column carries when it reaches 16:

$$
\begin{array}{rccc}
 & {\scriptstyle1} & {\scriptstyle1} & \\
 & 2 & B & 7 \\
+& 1 & 9 & D \\
\hline
 & 4 & 5 & 4
\end{array}
$$

The column totals from right to left are decimal 20, 21, and 4. The first two columns write 4 and 5 respectively and each carry 1. The result is $454_{16}$. Check: $695+413=1108=454_{16}$.

#### Intermediate extension: a carry need not be 1

For three addends, $75_8$, $67_8$, and $56_8$, the units total is $5+7+6=18_{10}$. That contains two groups of 8 and leaves 2, so the carry is 2:

$$
\begin{array}{rccc}
 & & {\scriptstyle2} & \\
 & & 7 & 5 \\
 & & 6 & 7 \\
+& & 5 & 6 \\
\hline
 & 2 & 4 & 2
\end{array}
$$

The eights total is $7+6+5+2=20_{10}=2\cdot8+4$. Write 4 and place the remaining carry 2 as the new leading digit. The result $242_8=162_{10}$ equals $61+55+46$. That leading 2 is already part of the result; do not add it a second time.

#### Borrowing: one higher-place unit supplies 8 units here

Calculate $402_8-157_8$. The first number is larger than the second. Work from right to left. The units digit 2 is too small to subtract 7, but the eights digit is zero. First borrow from the sixty-fours column.

1. Reduce the sixty-fours count from 4 to 3, supplying 8 units to the eights column.
2. The eights column lends one of those units to the units column. It now has 7 left, and the units column has $2+8=10_{10}$.
3. Subtract each column: $10-7=3$, $7-5=2$, and $3-1=2$.

| Temporary quantities (all written in decimal in this table) | Sixty-fours | Eights | Units |
| --- | ---: | ---: | ---: |
| Original first number | 4 | 0 | 2 |
| After borrowing across zero | 3 | 7 | 10 |
| Number to subtract | 1 | 5 | 7 |
| Difference | 2 | 2 | 3 |

Borrowing redistributes units without changing the value: $3\cdot64+7\cdot8+10=258$. The table's 10 is a temporary decimal quantity, not a final octal digit.

$$
\begin{array}{rccc}
 & 4 & 0 & 2 \\
-& 1 & 5 & 7 \\
\hline
 & 2 & 2 & 3
\end{array}
$$

Thus $402_8-157_8=223_8$. Check: $258-111=147_{10}=223_8$. In base $b$, borrowing one unit from the next column adds $b$ units here and reduces the lending column by 1. Do not increase one column without reducing the other.

#### Common errors: carrying at ten, forgetting a carry, or assuming every carry is 1

The base determines the grouping threshold; “carry at ten” applies only to decimal. Before processing a column, write down “all digits in this column plus the incoming carry,” then find quotient and remainder. With several addends, calculate the actual quotient rather than assuming it is 1.

### 检查点

1. Add $347_8+256_8$. Draw a column layout and mark both internal carries.
2. Add $58A_{16}+2CF_{16}$. List the three decimal column totals, including incoming carries, from right to left.
3. Select all correct statements about this lesson's calculation $75_8+67_8+56_8$. A. The units digit is 2. B. The carry from units to eights is 2. C. The eights column only needs $7+6+5$. D. The leading 2 must be added to the result again.
4. Calculate $503_8-246_8$. First list the three temporary quantities after borrowing across zero (in decimal), then find the difference.

Completion standard: both sums, the difference, and the multiple-select answer are correct, and you can explain where each carry goes. A correct final value with misplaced carry marks still needs correction.

### 参考答案

**1.** $347_8+256_8=625_8$. The two small 1s are above the receiving sixty-fours and eights columns:

$$
\begin{array}{rccc}
 & {\scriptstyle1} & {\scriptstyle1} & \\
 & 3 & 4 & 7 \\
+& 2 & 5 & 6 \\
\hline
 & 6 & 2 & 5
\end{array}
$$

The column totals from right to left are 13, 10, and 6, so write 5, 2, and 6. The first two columns each carry 1. Check: $231+174=405=625_8$.

**2.** $58A_{16}+2CF_{16}=859_{16}$. Both internal carries are 1:

$$
\begin{array}{rccc}
 & {\scriptstyle1} & {\scriptstyle1} & \\
 & 5 & 8 & A \\
+& 2 & C & F \\
\hline
 & 8 & 5 & 9
\end{array}
$$

Column totals are $10+15=25$, $8+12+1=21$, and $5+2+1=8$, giving digits 9, 5, and 8. Check: $1418+719=2137$.

**3.** Select A and B. C omits the incoming carry of 2. D counts the carry again after it has already become the leading digit.

**4.** After borrowing, the quantities from left to right are 4, 7, and 11: first lend from sixty-fours to eights, then from eights to units. Subtract 2, 4, and 6 respectively to obtain $235_8$. Check: $323-166=157_{10}=235_8$.

### 关联题目

[]

## 章节：04. Mixed bases: use common units, then check

### 学习目标

- Identify each operand's base and the required output base.
- Convert to a common base before calculating, and verify by a different route.
- Solve for an unknown base using place value and check that every given digit is allowed.

### 正文

#### The same quantity can be written in different ways

Two warehouses report badge counts. The first uses the octal label $236_8$; the second uses the hexadecimal label $3D_{16}$. Report their total in hexadecimal.

First convert each value to decimal, giving both counts common units:

$$
236_8=2\cdot64+3\cdot8+6=158_{10},\qquad
3D_{16}=3\cdot16+13=61_{10}.
$$

Their sum is $219_{10}$. Now convert to the requested hexadecimal notation: $219=16\cdot13+11$. Write 13 as D and 11 as B. The total is $DB_{16}$.

#### Verify by a different route

Convert $3D_{16}=61_{10}$ to $75_8$ and add in octal:

$$
236_8+75_8=333_8.
$$

The units total is $6+5=11_{10}$: write 3 and carry 1. The eights total is $3+7+1=11_{10}$: write 3 and carry 1. The sixty-fours total is $2+0+1=3$. Then regroup through binary:

$$
333_8=(011\;011\;011)_2=(1101\;1011)_2=DB_{16}.
$$

Both routes agree. The second route checks the conversions in the first, rather than merely rereading the same calculation.

#### Intermediate extension: use place value to find an unknown base

Suppose $31_b=22_{10}$. Find the integer base $b$. Expand the left side by place value:

$$
3b+1=22\quad\Longrightarrow\quad b=7.
$$

Finally, check validity: the base must be at least 2 and greater than the largest digit, 3. Base 7 meets both conditions. Substitution confirms $31_7=3\cdot7+1=22_{10}$.

Do not stop after solving the equation. For example, $24_b=8_{10}$ would give $b=2$, but digits 2 and 4 cannot appear in binary. That condition therefore has no valid integer-base solution.

#### Common errors: adding unlike columns or forgetting the output base

The next-to-last positions in $236_8$ and $3D_{16}$ represent different units. Do not line them up and add their digits directly. Convert to a common base first. Reaching decimal 219 also does not finish the warehouse example, because it asks for hexadecimal. Include the correct base in the final answer.

### 检查点

1. Calculate $157_8+2A_{16}$ and give the answer in hexadecimal. Include at least one place-value check.
2. Given $42_b=30_{10}$, find the valid integer base $b$ and explain why it permits the digit 4.
3. A learner adds the digits of $31_8+12_{16}$ as though both were decimal, obtains 43, and reports $43_{16}$. Find the correct result and explain the difference between the value 43 and the notation $43_{16}$.

Completion standard: all three values and base labels are correct. Explain your chosen common base and complete a check using a different route. You are then ready to attempt formal practice on this topic independently.

### 参考答案

**1.** $157_8=64+40+7=111_{10}$ and $2A_{16}=32+10=42_{10}$. Their total is $153_{10}=99_{16}$. Check backward: $9\cdot16+9=153$.

**2.** $4b+2=30$, so $b=7$. The largest digit is 4 and $4<7$. Substitution gives $42_7=4\cdot7+2=30_{10}$.

**3.** $31_8=25_{10}$ and $12_{16}=18_{10}$, so the sum is $43_{10}=2B_{16}$. Here 43 is the decimal value. The notation $43_{16}$ means $4\cdot16+3=67_{10}$ instead. Adding the digit strings as decimal happened to produce 43; this does not justify labeling it as hexadecimal.

### 关联题目

[]

---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 11 — Digital Electronics
description: Three original lessons connect native logic-gate diagrams to named intermediate signals, full truth tables, input counts, and equivalent circuits. Includes twelve self-checks with step-by-step reasoning. Prerequisites are Boolean values and the basic meaning of AND, OR and NOT.
category: ACSL · Intermediate
estimatedMinutes: 90
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 11 — Digital Electronics

## 章节：01. Read the gate, name its output, then move onward

### 学习目标

- Recognize AND, OR, NOT, NAND, NOR and XOR symbols, including inversion bubbles.
- Translate a diagram into one equation per gate without changing the wiring.
- Evaluate intermediate signals before evaluating the gates that use them.

### 正文

#### Prerequisite check: wires carry Boolean values

Use 0 for false and 1 for true. Each input is one Boolean value. In Boolean algebra, $AB$ means AND, $A+B$ means inclusive OR, $\overline A$ means NOT, and $A\oplus B$ means XOR. These are logical operations: $1+1=1$ for OR, whereas $1\oplus1=0$. They are not ordinary integer addition.

These lessons concern combinational circuits: outputs depend on the current inputs, with no clock, stored state, or feedback loop. Read each original diagram from the labeled inputs at the left toward the output at the right. A wire may turn without changing its value. A filled dot marks a connection or branch. At a branch, both paths carry the **same** signal; branching does not introduce an independent variable. We avoid ambiguous unmarked wire crossings in the examples.

#### Recognize the whole symbol

```diagram
{
  "id": "digital-gate-symbols",
  "width": 690,
  "height": 315,
  "alt": {
    "en": "Six logic symbols, left to right: AND, OR, NOT; then NAND, NOR, XOR. Inputs are at left and output Y at right. A small unfilled output circle means inversion; XOR has an extra input-side curve.",
    "zh": "六种逻辑门，从左至右依次为与、或、非；第二行为与非、或非、异或。左侧输入，右侧输出Y。输出端空心小圆表示取反，异或门输入侧多一条曲线。"
  },
  "elements": [
    {
      "type": "polyline",
      "points": [
        [
          42,
          68
        ],
        [
          80,
          68
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 32,
      "y": 73,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          42,
          92
        ],
        [
          80,
          92
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 32,
      "y": 97,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          140,
          80
        ],
        [
          185,
          80
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 196,
      "y": 85,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 110,
      "y": 38,
      "text": "AND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 80 54 L 110 54 C 126.57 54 140 65.64 140 80 C 140 94.36 126.57 106 110 106 L 80 106 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          262,
          68
        ],
        [
          308,
          68
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 252,
      "y": 73,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          262,
          92
        ],
        [
          308,
          92
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 252,
      "y": 97,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          365,
          80
        ],
        [
          405,
          80
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 416,
      "y": 85,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 330,
      "y": 38,
      "text": "OR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 300 54 Q 336 54 365 80 Q 336 106 300 106 Q 320 80 300 54 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          482,
          80
        ],
        [
          520,
          80
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 472,
      "y": 85,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          580,
          80
        ],
        [
          625,
          80
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 636,
      "y": 85,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 550,
      "y": 38,
      "text": "NOT",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 520 56 L 570 80 L 520 104 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 575,
      "cy": 80,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          42,
          228
        ],
        [
          80,
          228
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 32,
      "y": 233,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          42,
          252
        ],
        [
          80,
          252
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 32,
      "y": 257,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          150,
          240
        ],
        [
          185,
          240
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 196,
      "y": 245,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 110,
      "y": 198,
      "text": "NAND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 80 214 L 110 214 C 126.57 214 140 225.64 140 240 C 140 254.36 126.57 266 110 266 L 80 266 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 145,
      "cy": 240,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          262,
          228
        ],
        [
          308,
          228
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 252,
      "y": 233,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          262,
          252
        ],
        [
          308,
          252
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 252,
      "y": 257,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          375,
          240
        ],
        [
          405,
          240
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 416,
      "y": 245,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 330,
      "y": 198,
      "text": "NOR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 300 214 Q 336 214 365 240 Q 336 266 300 266 Q 320 240 300 214 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 370,
      "cy": 240,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          482,
          228
        ],
        [
          528,
          228
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 472,
      "y": 233,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          482,
          252
        ],
        [
          528,
          252
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 472,
      "y": 257,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "polyline",
      "points": [
        [
          585,
          240
        ],
        [
          625,
          240
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 636,
      "y": 245,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 550,
      "y": 198,
      "text": "XOR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "path",
      "d": "M 520 214 Q 556 214 585 240 Q 556 266 520 266 Q 540 240 520 214 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 512 214 Q 532 240 512 266",
      "stroke": "ink",
      "strokeWidth": 1.8
    }
  ]
}
```

The gallery shows six gate symbols. AND has a flat left edge and a rounded right edge. OR has a curved input edge and a pointed output; XOR adds an extra curve on the input side. NOT has a triangle followed by a small hollow circle. A hollow circle at an output means invert the result of the underlying gate: AND with that circle is NAND, and OR with it is NOR. Do not confuse an inversion circle with a solid wire-junction dot.

For a two-input gate, the following table gives every possible row. NOT has only one input; the last column shows NOT of A.

| A | B | AND | OR | NAND | NOR | XOR | NOT A |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 |
| 0 | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |

In symbols, NAND is $\overline{AB}$, and NOR is $\overline{A+B}$. The bar covers the complete gate result. XOR is true exactly when its two inputs differ. An XOR symbol with an output inversion circle would be XNOR, true when the two inputs agree; it is not the same as plain OR.

The symbol conventions and basic gate definitions follow the official ACSL Digital Electronics category. All circuits, examples and self-checks here are original; linked past-paper exercises use the same reasoning methods.

#### Translate one gate at a time

```diagram
{
  "id": "digital-trace-circuit",
  "width": 620,
  "height": 310,
  "alt": {
    "en": "B passes through NOT to p. A and p enter AND to q. q and C enter OR to Y. Equations: p=NOT B, q=A AND p, Y=q OR C.",
    "zh": "B经过非门得到p；A与p进入与门得到q；q与C进入或门得到Y。对应p=非B，q=A与p，Y=q或C。"
  },
  "elements": [
    {
      "type": "polyline",
      "points": [
        [
          35,
          98
        ],
        [
          280,
          98
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          35,
          190
        ],
        [
          120,
          190
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          180,
          190
        ],
        [
          230,
          190
        ],
        [
          230,
          122
        ],
        [
          280,
          122
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          340,
          110
        ],
        [
          390,
          110
        ],
        [
          390,
          168
        ],
        [
          448,
          168
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          35,
          260
        ],
        [
          405,
          260
        ],
        [
          405,
          192
        ],
        [
          448,
          192
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          505,
          180
        ],
        [
          565,
          180
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 120 166 L 170 190 L 120 214 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 175,
      "cy": 190,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 280 84 L 310 84 C 326.57 84 340 95.64 340 110 C 340 124.36 326.57 136 310 136 L 280 136 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 440 154 Q 476 154 505 180 Q 476 206 440 206 Q 460 180 440 154 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "text",
      "x": 20,
      "y": 103,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 20,
      "y": 195,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 20,
      "y": 265,
      "text": "C",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 205,
      "y": 177,
      "text": "p",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 365,
      "y": 97,
      "text": "q",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 580,
      "y": 185,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 145,
      "y": 152,
      "text": "NOT",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 310,
      "y": 69,
      "text": "AND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 470,
      "y": 138,
      "text": "OR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    }
  ]
}
```

This diagram has three inputs, A, B and C, and two named internal signals, p and q. Its complete text description is: B enters NOT to produce p; A and p enter AND to produce q; q and C enter OR to produce Y. Thus

$$
p=\overline B,\qquad q=Ap,\qquad Y=q+C.
$$

Substitute only after the connections are recorded: $Y=A\overline B+C$. The bar belongs to B alone. It does not cover A, the AND result, or the final OR. Working directly from a crowded picture without writing p and q often loses the scope of a negation.

| A | B | C | $p=\overline B$ | $q=Ap$ | $Y=q+C$ |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 1 | 1 | 1 |
| 0 | 0 | 1 | 1 | 0 | 1 |

For the first row, B=1 makes p=0, so the AND produces q=0 even though A=1. With C=0, the final OR produces Y=0. In the last row, q=0 but C=1 makes Y=1. An OR needs at least one input 1, while an AND needs both.

#### A reliable order for scratch work

Label each gate output, then write an equation using only its immediate input signals. Evaluate a gate only when all those inputs are known. On a branch, copy the known value to every destination. Finally substitute the original A, B and C into the combined expression as an independent check. In a circuit with several gates on one path and fewer on another, neither the number of bends nor the visual height tells you which Boolean operation has priority: the wiring does.

Two NOT operations in succession cancel: $\overline{\overline A}=A$. This works because each inverter acts on the previous output. It does not justify removing one inversion circle elsewhere in an unrelated branch.

### 检查点

**1.** For A=1 and B=1, list AND, OR, NAND, NOR, XOR and NOT A in that order. Explain the different roles of the extra XOR curve and the NAND output circle.

**2.** In the three-gate diagram, use $(A,B,C)=(0,1,1)$. Find p, q and Y. Change only C to 0 and recompute the affected output.

**3.** A new circuit has $u=AB$, $v=\overline C$, and $Z=\overline{u+v}$. Name its three gates, write a combined expression, and trace $(A,B,C)=(1,1,0)$ and $(0,0,1)$ through u, v and Z.

**4.** A branches to a NOT gate producing $p=\overline A$ and to an AND gate producing $F=Ap$. Another output is $G=A+p$. Make the two-row table for A, p, F and G. Why must you not try all four independent pairs $(A,p)$?

Completion standard: distinguish hollow inversion circles from solid connections, preserve every input branch, and show each intermediate output before the final answer.

### 参考答案

**1.** The outputs are `1,1,0,0,0,0`. AND is 1 because both inputs are 1; inclusive OR is also 1. NAND inverts AND to 0, and NOR inverts OR to 0. XOR is 0 because the inputs agree; NOT A is 0. The XOR curve changes the underlying two-input function, whereas the small NAND circle complements the AND result.

**2.** With `(0,1,1)`, $p=\overline1=0$, $q=0\cdot0=0$, and $Y=0+1=1$. With `(0,1,0)`, p and q remain `0,0`; only the final OR changes, giving $Y=0+0=0$. The C wire does not feed the earlier gates.

**3.** The gates are AND, NOT and NOR. Substitution gives $Z=\overline{AB+\overline C}$. For `(1,1,0)`, the intermediate outputs are `u=1,v=1,Z=0`. For `(0,0,1)`, they are `u=0,v=0,Z=1`. A NOR returns 1 only when both of its immediate inputs are 0; negating C alone is not the final NOR operation.

**4.** The rows `(A,p,F,G)` are `(0,1,0,1)` and `(1,0,0,1)`. In each row one of A and p is 0 and the other is 1, so $F=0$ and $G=1$. The impossible pairs `(A,p)=(0,0)` and `(1,1)` would violate $p=\overline A$. A derived signal is not a second free input.

### 关联题目

[]

## 章节：02. Build the whole truth table before counting inputs

### 学习目标

- Enumerate the original ordered inputs exactly once, keeping intermediate columns separate.
- Count true or false assignments, including assignments satisfying extra constraints.
- Avoid multiplying counts for signals that share an input.

### 正文

#### Count inputs, not wires

For three independent Boolean inputs A, B and C, there are $2^3=8$ ordered triples. Write them in binary order `000,001,010,011,100,101,110,111`, always interpreting positions as `(A,B,C)`. A changes every four rows, B every two rows, and C every row. A branch of B or a new intermediate label does not increase this number. “Ordered” means `(0,1,0)` and `(1,0,0)` are different assignments.

The following original circuit shares B between two gates. The filled junction shows that both branches have the same value.

```diagram
{
  "id": "digital-table-circuit",
  "width": 550,
  "height": 390,
  "alt": {
    "en": "A and B feed OR to p; the same B branches at a solid dot and joins C at NAND to q. p and q feed XOR to Y. Thus p=A OR B, q=NOT(B AND C), Y=p XOR q.",
    "zh": "A和B进入或门得到p；同一个B在实心点处分支，与C进入与非门得到q；p和q进入异或门得到Y。因此p=A或B，q=非(B与C)，Y=p异或q。"
  },
  "elements": [
    {
      "type": "polyline",
      "points": [
        [
          35,
          98
        ],
        [
          168,
          98
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          35,
          200
        ],
        [
          80,
          200
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          80,
          200
        ],
        [
          80,
          122
        ],
        [
          168,
          122
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          80,
          200
        ],
        [
          80,
          258
        ],
        [
          160,
          258
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          35,
          340
        ],
        [
          100,
          340
        ],
        [
          100,
          282
        ],
        [
          160,
          282
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          225,
          110
        ],
        [
          275,
          110
        ],
        [
          275,
          178
        ],
        [
          358,
          178
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          230,
          270
        ],
        [
          305,
          270
        ],
        [
          305,
          202
        ],
        [
          358,
          202
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          415,
          190
        ],
        [
          485,
          190
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 160 84 Q 196 84 225 110 Q 196 136 160 136 Q 180 110 160 84 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 160 244 L 190 244 C 206.57 244 220 255.64 220 270 C 220 284.36 206.57 296 190 296 L 160 296 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 225,
      "cy": 270,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 350 164 Q 386 164 415 190 Q 386 216 350 216 Q 370 190 350 164 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 342 164 Q 362 190 342 216",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 80,
      "cy": 200,
      "r": 3,
      "fill": "ink",
      "stroke": "none"
    },
    {
      "type": "text",
      "x": 20,
      "y": 103,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 20,
      "y": 205,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 20,
      "y": 345,
      "text": "C",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 250,
      "y": 96,
      "text": "p",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 265,
      "y": 256,
      "text": "q",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 500,
      "y": 195,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 190,
      "y": 68,
      "text": "OR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 190,
      "y": 228,
      "text": "NAND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 382,
      "y": 148,
      "text": "XOR",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    }
  ]
}
```

Equivalent text description: A and B enter OR to produce p; B and C enter NAND to produce q; p and q enter XOR to produce Y. The equations are

$$
p=A+B,\qquad q=\overline{BC},\qquad Y=p\oplus q.
$$

Compute p and q from the original inputs on each row, then compare those two bits at XOR.

| A | B | C | $p=A+B$ | $q=\overline{BC}$ | $Y=p\oplus q$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 1 |
| 0 | 0 | 1 | 0 | 1 | 1 |
| 0 | 1 | 0 | 1 | 1 | 0 |
| 0 | 1 | 1 | 1 | 0 | 1 |
| 1 | 0 | 0 | 1 | 1 | 0 |
| 1 | 0 | 1 | 1 | 1 | 0 |
| 1 | 1 | 0 | 1 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 | 1 |

The true input triples are `000,001,011,111`, so the true count is `4`; the false triples are `010,100,101,110`, also `4`. The counts sum to 8. Equal counts here do not mean XOR always makes half of a circuit's original inputs true: the two XOR inputs may be dependent signals.

For example, `(p,q)=(0,0)` is impossible. Having p=0 forces A=B=0, but then BC=0 and q=1. The pair `(p,q)=(1,1)` occurs for four different original triples. Treating the four possible pairs `(p,q)` as equally frequent would erase that information, even if a final count happened to look plausible.

#### Apply a condition to the input rows

If the question additionally requires C=1, keep only `001,011,101,111`. Among those, Y=1 for `001,011,111`, so the constrained true count is `3` out of `4` eligible triples.

If the requirement is A=C instead, the eligible triples are `000,010,101,111`. Only `000,111` make Y=1, so the answer is `2` out of `4`. Do not first count all true rows and then divide by two: a restriction can select an uneven portion of them.

Adding an independent input D changes the domain to 16 quadruples. If the new output is $H=YD$, each of the four Y=1 triples allows only D=1, so H has `4` true quadruples. If instead $J=Y+D$, all eight D=1 quadruples are true, and four more with D=0 are true, giving `12`. These two disjoint D cases make the counting explicit.

#### When a product is justified

For $K=(A+B)(C\oplus D)$, the input groups `(A,B)` and `(C,D)` are disjoint. There are three pairs making the OR true and two making the XOR true, so K has $3\cdot2=6$ true quadruples. Each pair can combine with each pair in the other group. The same multiplication would be unjustified if both groups constrained B: a shared signal must satisfy both conditions simultaneously.

A compact truth table is usually the safer first solution for three inputs. Once complete, a case split or equivalent expression can check the count. Remember to answer the question that was asked: TRUE count, FALSE count, or the actual ordered tuples.

### 检查点

**1.** Build all eight rows for the first lesson's circuit: $p=\overline B$, $q=Ap$, $Y=q+C$. List every true and false triple and give both counts.

**2.** For this lesson's OR–NAND–XOR circuit, restrict to B=0. Simplify p, q and Y under that condition, list the eligible triples, and find which give Y=1.

**3.** A new output is $F=(A\oplus B)\overline C$. List all triples with F=1. Explain the required condition at each of the XOR, NOT and final AND gates.

**4.** For $K=(A+B)(C\oplus D)$, list the allowed `(A,B)` pairs and the allowed `(C,D)` pairs. Use them to list all true quadruples in `(A,B,C,D)` order, then give the false count.

Completion standard: enumerate only independent inputs, show the intermediate columns, and separate restricted input rows from true output rows.

### 参考答案

**1.** In binary input order, the rows `(A,B,C,p,q,Y)` are `(0,0,0,1,0,0)`, `(0,0,1,1,0,1)`, `(0,1,0,0,0,0)`, `(0,1,1,0,0,1)`, `(1,0,0,1,1,1)`, `(1,0,1,1,1,1)`, `(1,1,0,0,0,0)`, `(1,1,1,0,0,1)`. True triples: `001,011,100,101,111`, count `5`. False triples: `000,010,110`, count `3`. The final OR fails exactly when both q and C are 0; $5+3=8$ checks coverage.

**2.** With B=0, $p=A+0=A$, $q=\overline{0\cdot C}=1$, and $Y=A\oplus1=\overline A$. Eligible triples are `000,001,100,101`. The true ones are `000,001`, count `2`; C can be either value, but A must be 0. B is fixed, so there are only four eligible rows.

**3.** AND requires both factors to be 1. NOT requires C=0, and XOR requires A and B to differ. Thus the true triples are `010,100`, count `2`. A=B=1 does not work: inclusive OR would be 1 there, but XOR is 0. The remaining six triples give F=0.

**4.** The OR allows `(0,1),(1,0),(1,1)` for `(A,B)`; the XOR allows `(0,1),(1,0)` for `(C,D)`. Combining each first pair with each second pair gives `0101,0110,1001,1010,1101,1110`. There are $3\cdot2=6$ true quadruples and $16-6=10$ false ones. Multiplication works because choosing the first pair does not constrain either variable of the second pair.

### 关联题目

[]

## 章节：03. Prove equivalence and work backward from an output

### 学习目标

- Translate inversion circles into correctly grouped complements before simplifying.
- Prove two circuits equivalent for every input or disprove equivalence with one row.
- Work backward through gate constraints while preserving shared-signal dependencies.

### 正文

#### Different drawings can implement the same function

Two circuits are equivalent if their final outputs agree for every assignment of the same independent inputs. Equal outputs for one test case are insufficient. A complete truth table proves equivalence for a finite input domain; a single differing row disproves it.

Consider a circuit made from two NAND gates:

```diagram
{
  "id": "digital-tied-nand",
  "width": 555,
  "height": 205,
  "alt": {
    "en": "A and B feed a NAND gate producing p. At a solid junction p branches to both inputs of a second NAND. Output Y is NOT(p AND p), equal to A AND B. Both second-gate inputs are the same signal.",
    "zh": "A和B进入第一个与非门得到p；p在实心连接点处分支，接到第二个与非门的两个输入。Y=非(p与p)，等于A与B；第二个门的两个输入是同一信号。"
  },
  "elements": [
    {
      "type": "polyline",
      "points": [
        [
          35,
          98
        ],
        [
          130,
          98
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          35,
          122
        ],
        [
          130,
          122
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          200,
          110
        ],
        [
          260,
          110
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          260,
          110
        ],
        [
          290,
          110
        ],
        [
          290,
          98
        ],
        [
          360,
          98
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          260,
          110
        ],
        [
          260,
          150
        ],
        [
          320,
          150
        ],
        [
          320,
          122
        ],
        [
          360,
          122
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "polyline",
      "points": [
        [
          430,
          110
        ],
        [
          495,
          110
        ]
      ],
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 130 84 L 160 84 C 176.57 84 190 95.64 190 110 C 190 124.36 176.57 136 160 136 L 130 136 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 195,
      "cy": 110,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "path",
      "d": "M 360 84 L 390 84 C 406.57 84 420 95.64 420 110 C 420 124.36 406.57 136 390 136 L 360 136 Z",
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 425,
      "cy": 110,
      "r": 5,
      "fill": "surface",
      "stroke": "ink",
      "strokeWidth": 1.8
    },
    {
      "type": "circle",
      "cx": 260,
      "cy": 110,
      "r": 3,
      "fill": "ink",
      "stroke": "none"
    },
    {
      "type": "text",
      "x": 20,
      "y": 103,
      "text": "A",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 20,
      "y": 127,
      "text": "B",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 230,
      "y": 96,
      "text": "p",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 510,
      "y": 115,
      "text": "Y",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 160,
      "y": 68,
      "text": "NAND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    },
    {
      "type": "text",
      "x": 390,
      "y": 68,
      "text": "NAND",
      "anchor": "middle",
      "fontSize": 17,
      "fill": "ink"
    }
  ]
}
```

The first NAND produces $p=\overline{AB}$. Its output branches to **both** inputs of the second NAND, so

$$
Y=\overline{pp}=\overline p=\overline{\overline{AB}}=AB.
$$

The middle step uses $pp=p$. This is an AND function built with two NAND gates, not a single NAND. The second inversion cancels the first because it acts on the complete same signal p.

| A | B | $p=\overline{AB}$ | $pp$ | $Y=\overline{pp}$ | $AB$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 1 | 0 | 0 |
| 0 | 1 | 1 | 1 | 0 | 0 |
| 1 | 0 | 1 | 1 | 0 | 0 |
| 1 | 1 | 0 | 0 | 1 | 1 |

The two rightmost columns agree on all four rows. If you accidentally treated the two second-gate inputs as independent, you would be evaluating a different circuit.

#### Moving a complement changes the gate operation too

De Morgan's laws express two useful circuit replacements:

$$
\overline{AB}=\overline A+\overline B,
\qquad
\overline{A+B}=\overline A\,\overline B.
$$

Thus a NAND can be replaced by two input inverters followed by OR; a NOR can be replaced by two input inverters followed by AND. Both the inversions **and** the AND/OR swap are necessary. For example, at `(A,B)=(0,1)`, $\overline{AB}=1$, but $\overline A\,\overline B=1\cdot0=0$. Moving the two bubbles while retaining AND changes the function.

A useful complementary check is that a NAND is false only when both its inputs are 1, whereas a NOR is true only when both its inputs are 0. The following NOR comparison tracks the replacement's intermediate inverter outputs too.

| A | B | $\overline{A+B}$ | $\overline A$ | $\overline B$ | $\overline A\,\overline B$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 1 | 1 | 1 |
| 0 | 1 | 0 | 1 | 0 | 0 |
| 1 | 0 | 0 | 0 | 1 | 0 |
| 1 | 1 | 0 | 0 | 0 | 0 |

#### Reason backward, then verify forward

Return to $Y=A\overline B+C$. To force Y=0, the final OR requires **both** C=0 and $A\overline B=0$. The AND is zero if A=0 **or** B=1. This gives the false triples `000,010,110`. When combining cases, `010` appears in both A=0 and B=1, so count it only once. Adding the case counts without checking their overlap would give four instead of three.

For the OR–NAND–XOR circuit, Y=1 requires p and q to differ. Split into disjoint cases:

- p=0, q=1: p=0 forces A=B=0; then q=1 automatically, and C is free. This gives `000,001`.
- p=1, q=0: q=0 forces B=C=1; then p=1 automatically, and A is free. This gives `011,111`.

The union is `000,001,011,111`, agreeing with the complete table. The final XOR inputs were not independent; the backward conditions must still be translated to A, B and C. This method explains *why* the true rows occur instead of merely recounting them.

#### Prevent a local shortcut from breaking the whole circuit

A repeated signal can simplify a gate: $X\oplus X=0$, $X+X=X$, $XX=X$. These identities apply when the two wires actually carry the same signal, not merely because the current row gives them the same value. Likewise, $X\oplus1=\overline X$ holds for either Boolean value of X. Write the relationship that makes a simplification valid, then verify at least one boundary case—or every row when proving a proposed replacement.

The linked formal-paper exercises include translating, simplifying, counting TRUE inputs and counting FALSE inputs. Apply the same workflow: record the diagram, derive equations, solve the requested condition, and verify. Original self-check solutions appear below; official exercise results remain in the paper's submission-and-review flow.

### 检查点

**1.** Compare a NAND of A and B with an OR of $\overline A$ and $\overline B$. Write all four rows, including the intermediate inverted inputs. Are the circuits equivalent?

**2.** A proposed replacement changes an XOR gate with inputs A and B into OR of A and B. Find a counterexample. How many of the four input pairs make the two outputs agree?

**3.** For $p=A+B$, $q=\overline{BC}$ and $Y=p\oplus q$, find all triples making Y=0 by backward reasoning. Consider p=q=0 as well as p=q=1, and explain whether each case is possible.

**4.** A three-NAND circuit has $p=\overline{AA}$, $q=\overline{BB}$ and $Z=\overline{pq}$. Simplify it, then show the four rows `(A,B,p,q,Z)`. Why is tying a gate's two inputs together different from connecting two independently chosen signals?

Completion standard: state the domain of independent inputs, preserve inversion scope, and give either an all-row proof or a specific counterexample.

### 参考答案

**1.** In `(A,B)` order `00,01,10,11`, the rows `(A,B,NOT A,NOT B,NAND,OR of inverses)` are `(0,0,1,1,1,1)`, `(0,1,1,0,1,1)`, `(1,0,0,1,1,1)`, `(1,1,0,0,0,0)`. The final columns agree on all rows, proving $\overline{AB}=\overline A+\overline B$. This replacement changes the gate to OR as well as inverting the inputs.

**2.** At `(A,B)=(1,1)`, XOR gives `0` while OR gives `1`. Therefore they are not equivalent. They agree on `00,01,10`, which is `3` of the four pairs. Agreement on several trial inputs cannot eliminate the need to check the remaining input.

**3.** XOR is zero when p=q. If p=q=0, then p=0 forces A=B=0, which forces q=1: a contradiction. If p=q=1, then A+B=1 and BC=0. Split by B. For B=0, A must be 1 and C is free, giving `100,101`. For B=1, C must be 0 and A is free, giving `010,110`. Thus the full false set is `010,100,101,110`, count `4`. The two B cases do not overlap.

**4.** Since $AA=A$ and $BB=B$, we have $p=\overline A$ and $q=\overline B$. Therefore $Z=\overline{\overline A\,\overline B}=A+B$. The rows `(A,B,p,q,Z)` are `(0,0,1,1,0)`, `(0,1,1,0,1)`, `(1,0,0,1,1)`, `(1,1,0,0,1)`. Tied inputs are equal on every assignment; they cannot take the mixed pairs `01` or `10`. The first two NAND gates consequently behave as inverters.

### 关联题目

[]

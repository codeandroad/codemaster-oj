---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate 专题 11：数字电路
description: 用三课把原生逻辑门图、命名的中间信号、完整真值表、输入计数与等价电路联系起来。包含十二道带逐步推导的原创自测。预备知识是布尔值及与、或、非的基本含义。
category: ACSL · Intermediate
estimatedMinutes: 90
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate 专题 11：数字电路

## 章节：01. 识别逻辑门，标出输出，再沿线路向前

### 学习目标

- 识别与、或、非、与非、或非、异或门，以及表示反相的空心小圆。
- 把电路图逐门转成方程，不改变线路的连接关系。
- 先计算中间信号，再计算使用这些信号的后续门。

### 正文

#### 预备检查：导线承载布尔值

用 0 表示假，1 表示真。每个输入是一个布尔值。在布尔代数中，$AB$ 表示与，$A+B$ 表示包含“两者都真”的或，$\overline A$ 表示非，$A\oplus B$ 表示异或。这些都是逻辑运算：或运算中 $1+1=1$，异或运算中 $1\oplus1=0$，不能当作普通整数加法。

本专题讨论组合电路：输出由当前输入决定，不涉及时钟、存储状态或反馈环。从左侧标明的输入沿线读到右侧输出。导线拐弯不会改变信号值；实心点表示连接或分支。分支后的两条线承载**同一个**信号，不会产生新的独立变量。本课例图避免了含义不明确、未作标记的导线交叉。

#### 看完整的门符号

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

上图展示六种逻辑门：AND 为与门，OR 为或门，NOT 为非门，NAND 为与非门，NOR 为或非门，XOR 为异或门。与门左侧平直、右侧圆弧；或门输入侧弯曲、输出端尖；异或门在或门的输入侧多一条曲线。非门是三角形加输出端的空心小圆。输出端的小圆表示对原门结果取反：与门加小圆成为与非门，或门加小圆成为或非门。不要把空心反相圆与导线上实心的连接点混淆。

下面列出双输入门的全部情况。非门只有一个输入，最后一列取的是 A 的反。

| A | B | AND | OR | NAND | NOR | XOR | NOT A |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 |
| 0 | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 | 0 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |

与非写作 $\overline{AB}$，或非写作 $\overline{A+B}$，横线覆盖整个门的结果。异或只在两个输入不同时为真。如果在异或门输出端再加一个反相圆，就成为同或门 XNOR，在输入相同时为真；它也不是普通或门。

门符号及基本定义依据 ACSL 官方 Digital Electronics 专题说明。本课电路、例题和自测均为原创；关联历年题练习同样的推理方法。

#### 每个门对应一个方程

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

这张图有 A、B、C 三个输入，以及 p、q 两个命名的中间信号。完整的文字描述是：B 经非门得到 p；A 与 p 经与门得到 q；q 与 C 经或门得到 Y。因此：

$$
p=\overline B,\qquad q=Ap,\qquad Y=q+C.
$$

先记录连接关系，再代入，得到 $Y=A\overline B+C$。横线只覆盖 B，不覆盖 A、与门的整体结果或最终或门。直接从拥挤的图中一口气写大表达式，却不标 p、q，很容易弄错取反范围。

| A | B | C | $p=\overline B$ | $q=Ap$ | $Y=q+C$ |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 1 | 1 | 1 |
| 0 | 0 | 1 | 1 | 0 | 1 |

第一行中，B=1 使 p=0；即使 A=1，与门仍输出 q=0。C 也为 0，所以最终 Y=0。最后一行中虽然 q=0，但 C=1 足以使 Y=1。或门只需要至少一个输入为 1，与门则需要两个输入都为 1。

#### 稳妥的草稿顺序

给每个门的输出起名，方程只写它直接连接的输入信号。某个门的全部输入确定后，才计算该门。遇到分支，把已知信号值复制到每个去向。最后，把原始 A、B、C 代入合并后的表达式，做一次独立核对。不同路径上的门数可能不同；不能根据导线拐弯次数或图上的高低决定运算优先级，必须根据连接关系决定。

连续两个非门会抵消：$\overline{\overline A}=A$，因为每个反相器都作用于前一个输出。但这不代表可以在另一条无关支路上随意删去一个反相圆。

### 检查点

**1.** 当 A=1、B=1 时，依次列出 AND、OR、NAND、NOR、XOR、NOT A 的输出。说明异或门多出的曲线与与非门输出端小圆的作用有何不同。

**2.** 对三门电路图，取 $(A,B,C)=(0,1,1)$，求 p、q、Y。然后只把 C 改成 0，重算受到影响的输出。

**3.** 一个新电路满足 $u=AB$、$v=\overline C$、$Z=\overline{u+v}$。说出三个门的名称，写出合并表达式，并对 $(A,B,C)=(1,1,0)$ 和 $(0,0,1)$ 逐步求 u、v、Z。

**4.** A 一路进入非门得到 $p=\overline A$，另一路进入与门得到 $F=Ap$；还有一个输出 $G=A+p$。为 A、p、F、G 建立两行真值表。为什么不能把 $(A,p)$ 当作独立的四种组合？

完成标准：分清空心反相圆与实心连接点，保留每个输入分支，先展示各中间输出，再给最终结果。

### 参考答案

**1.** 输出依次为 `1,1,0,0,0,0`。与门因两个输入都为 1 而输出 1；包含“两者都真”的或门也输出 1。与非把与的结果反为 0，或非把或的结果反为 0。异或因输入相同而为 0；NOT A 也为 0。异或多出的曲线改变双输入逻辑函数；与非的小圆则对与门结果取反。

**2.** 输入 `(0,1,1)` 时，$p=\overline1=0$，$q=0\cdot0=0$，$Y=0+1=1$。改为 `(0,1,0)` 后，p、q 仍为 `0,0`，只有最终或门改变，得到 $Y=0+0=0$。C 的导线没有接入前面的两个门。

**3.** 三个门依次为与、非、或非。代入得到 $Z=\overline{AB+\overline C}$。输入 `(1,1,0)` 时，中间结果为 `u=1,v=1,Z=0`；输入 `(0,0,1)` 时为 `u=0,v=0,Z=1`。或非只有在两个直接输入都为 0 时才输出 1；对 C 单独取反，并不等于最后的或非操作。

**4.** `(A,p,F,G)` 的两行分别为 `(0,1,0,1)`、`(1,0,0,1)`。每行中 A、p 总是一真一假，因此 $F=0$、$G=1$。`(A,p)=(0,0)` 和 `(1,1)` 不可能出现，因为它们违反 $p=\overline A$。派生信号不是另一个自由输入。

### 关联题目

[]

## 章节：02. 先列完整真值表，再计算输入数量

### 学习目标

- 把原始有序输入恰好列举一次，与中间输出列区分开。
- 统计真或假的输入组合，也处理额外输入限制。
- 避免对共享输入的中间信号直接相乘计数。

### 正文

#### 数输入，不是数导线

A、B、C 是三个独立布尔输入时，共有 $2^3=8$ 个有序三元组。按二进制顺序写成 `000,001,010,011,100,101,110,111`，始终按 `(A,B,C)` 解释位置：A 每四行改变一次，B 每两行改变，C 每行改变。B 的分支或一个新的中间信号名称，都不会增加输入数。“有序”意味着 `(0,1,0)` 和 `(1,0,0)` 是不同赋值。

下面的原创电路中，B 同时连接两个门。实心连接点表示两条分支上的值相同。

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

等价文字描述：A、B 经或门得到 p；B、C 经与非门得到 q；p、q 经异或门得到 Y。方程为：

$$
p=A+B,\qquad q=\overline{BC},\qquad Y=p\oplus q.
$$

每行都先从原始输入计算 p、q，再让异或门比较这两个位。

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

真输入三元组为 `000,001,011,111`，共 `4` 个；假输入为 `010,100,101,110`，也有 `4` 个，两种数量之和为 8。这次恰好各占一半，并不意味着经过异或的电路总有一半原始输入为真：异或的两个输入可能是相互依赖的中间信号。

例如 `(p,q)=(0,0)` 根本不可能出现。p=0 强制 A=B=0，进而 BC=0、q=1。相反，`(p,q)=(1,1)` 对应四个不同的原始三元组。如果把 `(p,q)` 的四种理论取值当作出现次数相同，就会丢掉这些信息，即使最后碰巧算出一个看似合理的数字。

#### 把条件应用到输入行

如果题目还要求 C=1，只保留 `001,011,101,111`。其中 `001,011,111` 使 Y=1，所以满足限制的 `4` 个三元组中，有 `3` 个使输出为真。

如果要求改为 A=C，允许的输入是 `000,010,101,111`。其中只有 `000,111` 使 Y=1，答案为 `4` 个候选中的 `2` 个。不要先数所有真行，再直接除以二：输入限制选中的真行不一定平均分布。

增加一个独立输入 D 后，定义域变为 16 个四元组。如果新输出为 $H=YD$，原来四个 Y=1 三元组都只允许 D=1，所以 H 为真的四元组有 `4` 个。如果改为 $J=Y+D$，D=1 的八个四元组全部为真，D=0 时又有四个为真，共 `12` 个。按 D 分成互不重叠的两种情况，计数依据就很明确。

#### 什么时候可以相乘

对 $K=(A+B)(C\oplus D)$，输入组 `(A,B)` 和 `(C,D)` 没有共享变量。第一组有三个组合使或为真，第二组有两个组合使异或为真，所以 K 有 $3\cdot2=6$ 个真四元组。第一组的每个选择都能与第二组的每个选择配对。如果两组都限制 B，就不能这样直接相乘，因为同一个信号必须同时满足两边的条件。

三个输入的题目，先完整列出真值表通常最稳妥；完成后再用分类讨论或等价表达式核验计数。最后要确认问的到底是真输入数量、假输入数量，还是具体有哪些有序元组。

### 检查点

**1.** 为第一课电路的 $p=\overline B$、$q=Ap$、$Y=q+C$ 建立完整八行表。列出所有真、假三元组及各自数量。

**2.** 对本课的或—与非—异或电路，限制 B=0。在此条件下化简 p、q、Y，列出允许的输入三元组，并找出其中 Y=1 的组合。

**3.** 新输出为 $F=(A\oplus B)\overline C$。列出所有 F=1 的三元组，并说明异或门、非门、最终与门各自要求什么。

**4.** 对 $K=(A+B)(C\oplus D)$，分别列出允许的 `(A,B)` 与 `(C,D)`。组合它们，按 `(A,B,C,D)` 顺序列出全部真四元组，再给出假输入数量。

完成标准：只枚举独立输入，展示中间列，并把满足输入限制的行与输出为真的行区分开。

### 参考答案

**1.** 按二进制输入顺序，`(A,B,C,p,q,Y)` 各行为 `(0,0,0,1,0,0)`、`(0,0,1,1,0,1)`、`(0,1,0,0,0,0)`、`(0,1,1,0,0,1)`、`(1,0,0,1,1,1)`、`(1,0,1,1,1,1)`、`(1,1,0,0,0,0)`、`(1,1,1,0,0,1)`。真三元组为 `001,011,100,101,111`，共 `5` 个；假三元组为 `000,010,110`，共 `3` 个。最终或门恰好在 q、C 都为 0 时失败，$5+3=8$ 可核验覆盖范围。

**2.** B=0 时，$p=A+0=A$，$q=\overline{0\cdot C}=1$，$Y=A\oplus1=\overline A$。允许的三元组为 `000,001,100,101`，其中真输入是 `000,001`，共 `2` 个。C 可以任选，但 A 必须为 0。B 已固定，因此只有四行允许输入。

**3.** 最终与门要求两个因子都为 1。非门要求 C=0，异或门要求 A、B 不同。因此真三元组为 `010,100`，共 `2` 个。A=B=1 不成立：此时普通或为 1，异或却为 0。其余六个三元组均使 F=0。

**4.** `(A,B)` 的或门允许 `(0,1),(1,0),(1,1)`；`(C,D)` 的异或门允许 `(0,1),(1,0)`。每个前组都与每个后组组合，得到 `0101,0110,1001,1010,1101,1110`。因此真输入有 $3\cdot2=6$ 个，假输入有 $16-6=10$ 个。之所以能相乘，是因为选定前组不会限制后组中的任何变量。

### 关联题目

[]

## 章节：03. 证明电路等价，并从输出反推输入

### 学习目标

- 先把反相圆翻译成范围正确的补运算，再化简。
- 对所有输入证明电路等价，或用一行反例否定等价。
- 反向分析各门的输入条件，同时保留共享信号之间的依赖。

### 正文

#### 不同图形可以实现同一函数

两个电路等价，要求它们对同一组独立输入的**每一种赋值**，最终输出都相同。某个试算输入得到相同结果还不够。有限输入定义域的完整真值表可以证明等价；只要找到一行不同，就足以否定。

看下面由两个与非门构成的电路：

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

第一个与非门产生 $p=\overline{AB}$，它的输出分支后接到第二个与非门的**两个**输入，所以：

$$
Y=\overline{pp}=\overline p=\overline{\overline{AB}}=AB.
$$

中间一步用了 $pp=p$。这是用两个与非门实现与函数，不是单独一个与非门。第二次反相作用于完整的同一个信号 p，因此能抵消第一次反相。

| A | B | $p=\overline{AB}$ | $pp$ | $Y=\overline{pp}$ | $AB$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 1 | 0 | 0 |
| 0 | 1 | 1 | 1 | 0 | 0 |
| 1 | 0 | 1 | 1 | 0 | 0 |
| 1 | 1 | 0 | 0 | 1 | 1 |

最右两列在全部四行中一致。如果误把第二个门的两个输入当作独立变量，就已经不是在计算原图了。

#### 移动补运算时，还必须改变门的操作

德摩根定律给出两种实用电路替换：

$$
\overline{AB}=\overline A+\overline B,
\qquad
\overline{A+B}=\overline A\,\overline B.
$$

因此，与非门可以替换为两个输入反相器后接或门；或非门可以替换为两个输入反相器后接与门。输入取反和与/或互换**两项都要做**。例如 `(A,B)=(0,1)` 时，$\overline{AB}=1$，但 $\overline A\,\overline B=1\cdot0=0$。只把小圆移到输入端，却仍保留与门，会改变函数。

还可以从门的必要条件检查：与非只在两个输入都为 1 时为假；或非只在两个输入都为 0 时为真。下面比较或非与替换电路，同时列出两个输入反相器的中间输出。

| A | B | $\overline{A+B}$ | $\overline A$ | $\overline B$ | $\overline A\,\overline B$ |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 1 | 1 | 1 | 1 |
| 0 | 1 | 0 | 1 | 0 | 0 |
| 1 | 0 | 0 | 0 | 1 | 0 |
| 1 | 1 | 0 | 0 | 0 | 0 |

#### 反推条件，再正向核验

回到 $Y=A\overline B+C$。要使 Y=0，最后的或门要求 C=0，**同时** $A\overline B=0$。与的结果为 0，需要 A=0 **或** B=1。因此假输入为 `000,010,110`。合并情况时，`010` 同时属于 A=0 与 B=1，必须只算一次。如果不检查交集就把两种情况的数量相加，会把三个错算成四个。

对或—与非—异或电路，Y=1 要求 p、q 不同，分成互不重叠的两种情况：

- p=0、q=1：p=0 强制 A=B=0，随后 q=1 自动成立，C 自由，得到 `000,001`。
- p=1、q=0：q=0 强制 B=C=1，随后 p=1 自动成立，A 自由，得到 `011,111`。

合起来为 `000,001,011,111`，与完整表一致。最终异或的两个输入并非独立变量，反推所得条件还必须落实到 A、B、C。这种方法说明了真行**为何**出现，而不只是重数一遍。

#### 不要让局部捷径破坏整张电路

重复信号可以化简某些门：$X\oplus X=0$、$X+X=X$、$XX=X$。这些恒等式要求两条线确实承载同一信号，不能仅因为当前一行恰好取值相同就套用。同样，$X\oplus1=\overline X$ 对 X 的两个布尔值都成立。先写清楚化简依赖的关系，再核验边界输入；若要证明某个替换，有限情况下可检查每一行。

关联正式题包含翻译、化简、统计真输入与统计假输入。统一方法是：记录图，建立方程，解所需条件，再核验。本课原创自测的推导列在下方；正式题结果仍在试卷的交卷、复盘流程中查看。

### 检查点

**1.** 比较 A、B 的与非门与 $\overline A$、$\overline B$ 的或门。写出完整四行，包括两个取反输入的中间值。两电路等价吗？

**2.** 有人想用 A、B 的或门替换异或门。找出一个反例。四种输入对中，有几种使它们输出相同？

**3.** 对 $p=A+B$、$q=\overline{BC}$、$Y=p\oplus q$，用反推找出所有 Y=0 三元组。同时考虑 p=q=0 和 p=q=1，说明各情况是否可能。

**4.** 三与非门电路满足 $p=\overline{AA}$、$q=\overline{BB}$、$Z=\overline{pq}$。先化简，再给出 `(A,B,p,q,Z)` 的四行。把一个门的两个输入绑在同一信号上，与连接两个独立选取的信号，有什么区别？

完成标准：声明哪些输入是独立的，保留补运算范围，并给出覆盖全部行的证明或一个具体反例。

### 参考答案

**1.** 按 `(A,B)` 为 `00,01,10,11` 的顺序，`(A,B,NOT A,NOT B,NAND,取反后OR)` 各行为 `(0,0,1,1,1,1)`、`(0,1,1,0,1,1)`、`(1,0,0,1,1,1)`、`(1,1,0,0,0,0)`。最后两列每行都相同，证明 $\overline{AB}=\overline A+\overline B$。替换时不仅输入取反，还要把门改为或。

**2.** `(A,B)=(1,1)` 时，异或给出 `0`，或给出 `1`，因此不等价。它们在 `00,01,10` 上相同，是四组中的 `3` 组。几个试算输入都一致，也不能省略剩下的输入。

**3.** 异或为零要求 p=q。如果 p=q=0，p=0 强制 A=B=0，又强制 q=1，产生矛盾。如果 p=q=1，要求 A+B=1、BC=0。按 B 分类：B=0 时，A 必须为 1，C 自由，得到 `100,101`；B=1 时，C 必须为 0，A 自由，得到 `010,110`。完整假输入集合是 `010,100,101,110`，共 `4` 个。两种 B 情况不重叠。

**4.** 因为 $AA=A$、$BB=B$，所以 $p=\overline A$、$q=\overline B$，进而 $Z=\overline{\overline A\,\overline B}=A+B$。`(A,B,p,q,Z)` 各行为 `(0,0,1,1,0)`、`(0,1,1,0,1)`、`(1,0,0,1,1)`、`(1,1,0,0,1)`。绑在一起的两个输入对每次赋值都相同，不可能出现混合对 `01` 或 `10`，所以前两个与非门起到反相器的作用。

### 关联题目

[]

---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 10 — Graph Theory
description: Three original lessons on reading directed graphs and adjacency matrices, counting fixed-length paths, and enumerating cycles without duplication. Distinguish paths that may repeat vertices from simple paths, track every arrow, and check counts with independent methods. Includes a short weighted-path extension.
category: ACSL · Intermediate
estimatedMinutes: 95
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 10 — Graph Theory

## 章节：01. Read the arrows and build an exact representation

### 学习目标

- Translate a drawing into directed edges, an adjacency list and a matrix.
- Distinguish incoming and outgoing degree, including self-loops.
- Decide whether a proposed route is legal and count its edges rather than its vertices.

### 正文

#### A drawing is a representation, not the definition

A graph consists of a set of vertices and a set of edges. Moving a vertex on the page does not change its connections. Lines that cross do not create a vertex unless the drawing marks one. In a **directed** graph, `PQ` means an edge from P to Q; it does not imply `QP`. An arrow at each end represents both directions. An undirected edge can be used in either direction.

This unit follows the ACSL Graph Theory terminology. Its general word **path** may repeat vertices and edges; other books often call that a **walk**. A **simple path** repeats no vertex. A **cycle** returns to its starting vertex and otherwise repeats no vertex. Always state the restriction before counting: a fixed length does not itself require a simple path. Every length in the main lessons counts **edges**; weights, when supplied in the final extension, are a separate quantity.

Our examples have no parallel edges. Each ordered vertex pair has either one directed edge or none; a self-loop such as `UU` is one edge. All examples and self-checks here are original, not solutions to the linked formal questions.

#### Worked graph G: record every outgoing edge

G has vertices `P,Q,R,S` and edges `PQ,PR,QR,QS,RS`.

```diagram
{
  "id": "tutorial-graph-dag",
  "width": 560,
  "height": 360,
  "alt": {
    "en": "Directed graph with edges P to Q, P to R, Q to R, Q to S, and R to S. There are no other edges.",
    "zh": "有向图，边为 P 到 Q、P 到 R、Q 到 R、Q 到 S、R 到 S，没有其他边。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 92.83,
      "y1": 165.58,
      "x2": 237.17,
      "y2": 74.42,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 237.17 74.42 L 231.96 83.03 L 227.16 75.42 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 92.83,
      "y1": 194.42,
      "x2": 237.17,
      "y2": 285.58,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 237.17 285.58 L 227.16 284.58 L 231.96 276.97 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 260.0,
      "y1": 87.0,
      "x2": 260.0,
      "y2": 273.0,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 260.0 273.0 L 255.5 264.0 L 264.5 264.0 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 283.94,
      "y1": 72.49,
      "x2": 466.06,
      "y2": 167.51,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 466.06 167.51 L 456.0 167.34 L 460.16 159.36 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 283.94,
      "y1": 287.51,
      "x2": 466.06,
      "y2": 192.49,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 466.06 192.49 L 460.16 200.64 L 456.0 192.66 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "circle",
      "cx": 70,
      "cy": 180,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 70,
      "y": 186,
      "text": "P",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 260,
      "cy": 60,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 260,
      "y": 66,
      "text": "Q",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 260,
      "cy": 300,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 260,
      "y": 306,
      "text": "R",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 490,
      "cy": 180,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 490,
      "y": 186,
      "text": "S",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    }
  ]
}
```

The following table is an equivalent, complete description of the drawing. The outgoing list is an inventory, not an instruction to visit every listed vertex in sequence.

| Vertex | Outgoing neighbours | Incoming neighbours | Out-degree | In-degree |
| --- | --- | --- | --- | --- |
| P | Q,R | — | 2 | 0 |
| Q | R,S | P | 2 | 1 |
| R | S | P,Q | 1 | 2 |
| S | — | Q,R | 0 | 2 |

There are 5 edges. Each contributes once to an outgoing count and once to an incoming count, so

$$
\sum_v d^+(v)=\sum_v d^-(v)=|E|=5.
$$

Here $d^+$ means out-degree and $d^-$ means in-degree. A self-loop contributes one to each of these directed degrees. Do not infer that every vertex's two degrees must be equal; only the two **totals** are equal. A vertex with no outgoing edge can still have incoming edges, as S does.

#### Rows are sources; columns are destinations

Use the same vertex order for rows and columns. Let $M_{ij}=1$ exactly when the edge from row vertex $i$ to column vertex $j$ exists. For G, the order is `P,Q,R,S`:

$$
M=\begin{array}{c|rrrr}
 &P&Q&R&S\\\hline
P&0&1&1&0\\
Q&0&0&1&1\\
R&0&0&0&1\\
S&0&0&0&0
\end{array}.
$$

A row sum is an out-degree; a column sum is an in-degree. Entry $M_{Q,R}=1$ says `QR` exists, but $M_{R,Q}=0$ says `RQ` does not. A diagonal 1 denotes a self-loop, not a connection to a different vertex. Reversing every edge transposes the matrix; merely changing the vertex order rearranges both row and column labels.

For an undirected graph without loops, the matrix is symmetric and its diagonal is zero. Each ordinary undirected edge contributes 2 to the sum of vertex degrees, so that sum is $2|E|$. An undirected self-loop, if allowed, contributes 2 to its vertex's degree; this differs from counting it once in each directed degree. The self-check below uses no undirected loops.

#### Check a proposed route one adjacent pair at a time

In G, `P→Q→S` is legal because both `PQ` and `QS` exist. It has 3 listed vertices but **2 edges**. `P→R→Q` is illegal because `RQ` is missing. The longer route `P→Q→R→S` is legal and has 3 edges. All three legal P-to-S paths are

| Path | Edge count |
| --- | --- |
| `P→Q→S` | 2 |
| `P→R→S` | 2 |
| `P→Q→R→S` | 3 |

These are all simple, and G has no directed cycle: the order `P,Q,R,S` places every edge from an earlier position to a later one. Such a graph is a directed acyclic graph, or DAG. Do not assume an arbitrary directed graph shares that property.

If an application asks for three ordered items, there are only two transitions to check. If a question asks whether a route exists with **exactly** three edges, finding a route with two edges does not settle it. A zero-length path, when needed as a counting starting condition, stays at its starting vertex and uses no edges.

### 检查点

**1.** In G, write row R and column R of the adjacency matrix in order `P,Q,R,S`. Give Q's and S's in-degree and out-degree, then check the edge total.

**2.** Check `P→Q→S`, `P→R→Q`, `Q→R→S` and `S→Q→P`. For each legal route give its length. For each illegal one identify its first missing directed edge.

**3.** An undirected graph has vertices `U,V,W,X` and edges `UV,VW,WU,WX`, with no loops. List each vertex's neighbours, give the degree sequence in that order, and verify the degree-sum relation. Why would counting the 1s in its adjacency matrix give twice the edge count?

**4.** A new directed graph J has the following matrix. List all edges, both degrees of every vertex, and the meaning of the final diagonal 1. Is this matrix symmetric?

$$
\begin{array}{c|rrr}
 &J&K&L\\\hline
J&0&1&0\\
K&1&0&1\\
L&0&0&1
\end{array}
$$

Completion standard: preserve direction, vertex order and every loop; say whether a number counts vertices, edges or incoming/outgoing connections.

### 参考答案

**1.** Row R is `0,0,0,1`; column R is `1,1,0,0`. Q has in-degree `1` and out-degree `2`; S has in-degree `2` and out-degree `0`. The outgoing sum is $2+2+1+0=5$; the incoming sum is $0+1+2+2=5$. These agree with the five listed edges.

**2.** `P→Q→S` is legal with length `2`. `P→R→Q` fails at `RQ`. `Q→R→S` is legal with length `2`. `S→Q→P` already fails at `SQ`; there is no need to accept or continue an invalid route. An edge can only be used in its displayed direction.

**3.** The neighbour lists are `U:V,W`, `V:U,W`, `W:U,V,X`, `X:W`. The degrees are `2,2,3,1`, so $2+2+3+1=8=2\cdot4$. Every undirected edge appears in two symmetric matrix positions, one for each direction. Thus the matrix has `8` ones but only `4` undirected edges.

**4.** The edges are `JK,KJ,KL,LL`. In order J,K,L, the out-degrees are `1,2,1`, while the in-degrees are `1,1,2`; each sum is `4`. The diagonal 1 at L is `LL`, contributing once to each of L's directed degrees. The matrix is not symmetric: `KL` exists but `LK` does not. The reciprocal pair `JK,KJ` does not make the whole graph undirected.

### 关联题目

[]

## 章节：02. Count fixed-length paths without imposing the wrong restriction

### 学习目标

- Enumerate paths of a fixed edge length, allowing repeats unless simplicity is required.
- Count two-edge paths by their middle vertex and verify with matrix multiplication.
- Handle exact-length reachability, newly added edges and excluded vertices.

### 正文

#### Worked graph H: repeats are part of the question

H has vertices `U,V,W` and edges `UU,UV,VW,WU,WV`. The self-loop and the two opposite directions between V and W are intentional.

```diagram
{
  "id": "tutorial-graph-walks",
  "width": 620,
  "height": 380,
  "alt": {
    "en": "Directed graph with edges U to U, U to V, V to W, W to U, and W to V. The curved arrow from W points to V; U has a self-loop.",
    "zh": "有向图，边为 U 到 U、U 到 V、V 到 W、W 到 U、W 到 V。W 出发的弧线箭头指向 V，U 上有自环。"
  },
  "elements": [
    {
      "type": "path",
      "d": "M 72 189 C 25 105 155 105 108 189",
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 108 189 L 108.47 178.95 L 116.32 183.34 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 113.74,
      "y1": 197.14,
      "x2": 306.26,
      "y2": 92.86,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 306.26 92.86 L 300.49 101.1 L 296.2 93.19 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 344.5,
      "y1": 102.78,
      "x2": 455.5,
      "y2": 277.22,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 455.5 277.22 L 446.87 272.04 L 454.46 267.21 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 443.73,
      "y1": 293.78,
      "x2": 116.27,
      "y2": 216.22,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 116.27 216.22 L 126.06 213.92 L 123.99 222.67 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "path",
      "d": "M 480.97 275.33 Q 550 120 356.56 84.83",
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 356.56 84.83 L 366.22 82.01 L 364.61 90.87 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "circle",
      "cx": 90,
      "cy": 210,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 90,
      "y": 216,
      "text": "U",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 330,
      "cy": 80,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 330,
      "y": 86,
      "text": "V",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 470,
      "cy": 300,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 470,
      "y": 306,
      "text": "W",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    }
  ]
}
```

| Vertex | Outgoing neighbours | In-degree | Out-degree |
| --- | --- | --- | --- |
| U | U,V | 2 | 2 |
| V | W | 2 | 1 |
| W | U,V | 1 | 2 |

For this lesson's fixed-length counts, vertices and edges **may repeat**. A two-edge path is a triple `start→middle→end`. Fixing the middle vertex separates all such paths into disjoint groups. There are $d^-(v)$ choices for the first edge and $d^+(v)$ for the second, giving

$$
N_2=\sum_v d^-(v)d^+(v).
$$

| Middle vertex | All two-edge paths with that middle | Count |
| --- | --- | --- |
| U | `U→U→U`, `U→U→V`, `W→U→U`, `W→U→V` | 4 |
| V | `U→V→W`, `W→V→W` | 2 |
| W | `V→W→U`, `V→W→V` | 2 |

Thus $N_2=2\cdot2+2\cdot1+1\cdot2=8$. `U→U→U` uses the same loop twice and is still one valid length-2 path under this rule. `W→V→W` returns to its start and is also included. Multiplying the total number of edges by itself would include edge pairs that do not join at the same middle vertex.

If the task instead asks for **simple** paths of length 2, remove every triple with any repeated vertex. Only `U→V→W`, `V→W→U` and `W→U→V` remain: `3`, not `8`. The degree product does not enforce simplicity. For a simple-path search, keep a visited set for the current route and undo that mark when returning to try another branch; a vertex used in one candidate is not globally forbidden in all other candidates.

#### Matrix entries count routes, not just yes/no reachability

In order `U,V,W`, H has

$$
M=\begin{pmatrix}1&1&0\\0&0&1\\1&1&0\end{pmatrix},\qquad
M^2=\begin{pmatrix}1&1&1\\1&1&0\\1&1&1\end{pmatrix}.
$$

Ordinary integer multiplication is used, not Boolean OR. In general,

$$
(M^2)_{ij}=\sum_k M_{ik}M_{kj}.
$$

Each summand chooses the middle vertex $k$. The sum of all entries of $M^2$ is `8`, agreeing with the enumeration. For example, $(M^2)_{V,U}=1$ represents `V→W→U`. A zero means no path of **that exact length**, not necessarily no route of any length.

For length 3, multiply once more:

$$
M^3=\begin{pmatrix}2&2&1\\1&1&1\\2&2&1\end{pmatrix}.
$$

The five length-3 paths starting at U are `U→U→U→U`, `U→U→U→V`, `U→U→V→W`, `U→V→W→U`, `U→V→W→V`. Their endpoint counts are `2,2,1`, matching the U row. A matrix entry can exceed 1; replacing it with 1 would lose distinct routes.

For a fixed target, there is no need to multiply the whole matrix. Define $c_0(t)=1$ at the target and 0 at other vertices, then

$$
c_{r+1}(v)=\sum_{v\to u}c_r(u).
$$

For target W in H, the vectors in order `U,V,W` are `0,0,1` at length 0, `0,1,0` at length 1, `1,0,1` at length 2, and `1,1,1` at length 3. Read zeros only after reaching the requested length. In particular V reaches W in one edge but not in two; it reaches W again in three via `V→W→V→W`.

#### Adding one edge: identify exactly the new routes

Add the previously absent edge `VU` to H. Since V and U are different, a new two-edge route can use the new edge either second or first, but cannot use it twice consecutively. Using **old** degrees, the added count is

$$
d^-_{\mathrm{old}}(V)+d^+_{\mathrm{old}}(U)=2+2=4.
$$

The new routes are `U→V→U`, `W→V→U`, `V→U→U`, `V→U→V`. The total becomes $8+4=12$. Counting only the new edge itself misses these two-step combinations. Adding an edge that already exists changes nothing in our graph model. Adding a **self-loop** needs separate care: for a new loop at X, include the route `X→X→X` using that new edge twice, in addition to the old incoming and outgoing choices.

If a question excludes a vertex entirely, delete that vertex and every incident edge before counting. If it excludes a vertex only from the interior of a route, retain the allowed endpoints and enforce the restriction during traversal. These are different conditions; do not silently replace one by the other.

### 检查点

**1.** Use graph J from Lesson 1: edges `JK,KJ,KL,LL`. Enumerate all length-2 paths, allowing repeats. Group them by their start, then count the simple ones separately.

**2.** In H, how many length-3 paths run from U to V? List them. How many of those are simple paths? Explain why a positive matrix entry does not answer the simple-path question.

**3.** Add `SQ` to graph G from Lesson 1. Use old degrees to count the additional length-2 paths, list them, and give the new total. Which new paths are simple?

**4.** In H, exclude V from the entire route, including endpoints. List all remaining length-2 paths and explain how you know the list is complete. What would change if you instead added a new self-loop `VV` to the original H: how many new length-2 paths would it create?

Completion standard: write the repeat rule, group candidates without overlap, and distinguish a newly added count from the resulting total.

### 参考答案

**1.** Starting at J: `J→K→J`, `J→K→L`. Starting at K: `K→J→K`, `K→L→L`. Starting at L: `L→L→L`. There are `5` paths, also $1\cdot1+1\cdot2+2\cdot1=5$ by middle vertex. Only `J→K→L` has three different vertices, so only `1` is simple. `K→L→L` repeats L even though its two edges are different.

**2.** The paths are `U→U→U→V` and `U→V→W→V`, giving `2`. The first repeats U and the second repeats V, so the simple-path count is `0`. A simple path on three vertices has at most two edges; the requested three-edge length already makes simplicity impossible here. Matrix powers count routes with repetition, exactly as the explicit list shows.

**3.** Originally, $d^-(S)=2$ and $d^+(Q)=2$, so there are $2+2=4$ new paths: `Q→S→Q`, `R→S→Q`, `S→Q→R`, `S→Q→S`. G originally had `P→Q→R`, `P→Q→S`, `P→R→S`, `Q→R→S`, so the new total is $4+4=8$. Only `R→S→Q` and `S→Q→R` are simple among the new paths; the other two return to their starting vertex.

**4.** Removing V leaves vertices U,W and edges `UU,WU`. Every surviving two-edge route must have U as its middle, then follow `UU`. Thus the complete list is `U→U→U`, `W→U→U`: `2` paths. Separately, adding `VV` to the original H creates `U→V→V`, `W→V→V`, `V→V→W`, and `V→V→V`. The old in-degree of V is 2 and old out-degree is 1; the repeated new loop adds the extra case, for $2+1+1=4$ new routes.

### 关联题目

[]

## 章节：03. Count cycles once and state optimization constraints

### 学习目标

- Enumerate directed cycles with only the starting vertex repeated.
- Distinguish a fixed start, a forbidden vertex and a global count up to rotation.
- Separate edge length from weight when comparing a small, explicit set of simple paths.

### 正文

#### Closing a route is not enough to make it a cycle

For a cycle, the only repeated vertex is the first vertex at the end. A self-loop is a cycle of length 1 when the graph allows one. Following a two-edge cycle twice gives a closed path of length 4, but it is not a cycle under this rule. Consequently, a diagonal entry of $M^k$ counts closed paths of length $k$, not automatically cycles.

If the start is fixed, list each cycle beginning and ending there. For a whole-graph count, cyclic rotations represent the **same** cycle. For example `P→Q→R→P` and `Q→R→P→Q` have the same directed edges in the same cyclic order. Give each one a consistent representative, such as starting with its alphabetically smallest vertex.

Direction is a separate issue. In a directed graph, the reverse of a cycle is valid only if every reverse edge exists, and a reversed cycle of length at least 3 is a distinct directed cycle. In a two-edge cycle, reversing the written order merely gives a rotation of the same pair of directed edges. In an undirected graph, rotations and reversal describe the same cycle. The following counts are for directed graphs.

#### Worked graph C: record cycles and the vertices they contain

C has vertices `P,Q,R,S,T` and the following directed edges.

```diagram
{
  "id": "tutorial-graph-cycles",
  "width": 700,
  "height": 420,
  "alt": {
    "en": "Directed graph with edges P to Q, Q to P, Q to R, R to P, R to R, R to S, S to Q, and S to T. R has a self-loop; T has no outgoing edge.",
    "zh": "有向图，边为 P 到 Q、Q 到 P、Q 到 R、R 到 P、R 到 R、R 到 S、S 到 Q、S 到 T。R 上有自环，T 没有出边。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 117.0,
      "y1": 100.0,
      "x2": 323.0,
      "y2": 100.0,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 323.0 100.0 L 314.0 104.5 L 314.0 95.5 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "path",
      "d": "M 326.61 86.51 Q 220 25 113.39 86.51",
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 113.39 86.51 L 118.94 78.11 L 123.43 85.91 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 334.75,
      "y1": 122.28,
      "x2": 235.25,
      "y2": 267.72,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 235.25 267.72 L 236.62 257.75 L 244.05 262.83 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 204.75,
      "y1": 267.72,
      "x2": 105.25,
      "y2": 122.28,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 105.25 122.28 L 114.05 127.17 L 106.62 132.25 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "path",
      "d": "M 202 311 C 155 395 285 395 238 311",
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 238 311 L 246.32 316.66 L 238.47 321.05 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 247.0,
      "y1": 290.0,
      "x2": 453.0,
      "y2": 290.0,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 453.0 290.0 L 444.0 294.5 L 444.0 285.5 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 464.75,
      "y1": 267.72,
      "x2": 365.25,
      "y2": 122.28,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 365.25 122.28 L 374.05 127.17 L 366.62 132.25 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "line",
      "x1": 496.02,
      "y1": 268.26,
      "x2": 603.98,
      "y2": 121.74,
      "stroke": "ink",
      "strokeWidth": 1.7,
      "fill": "none"
    },
    {
      "type": "path",
      "d": "M 603.98 121.74 L 602.26 131.65 L 595.02 126.32 Z",
      "fill": "ink",
      "stroke": "ink",
      "strokeWidth": 1
    },
    {
      "type": "circle",
      "cx": 90,
      "cy": 100,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 90,
      "y": 106,
      "text": "P",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 350,
      "cy": 100,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 350,
      "y": 106,
      "text": "Q",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 220,
      "cy": 290,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 220,
      "y": 296,
      "text": "R",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 480,
      "cy": 290,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 480,
      "y": 296,
      "text": "S",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 620,
      "cy": 100,
      "r": 20,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 620,
      "y": 106,
      "text": "T",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    }
  ]
}
```

| Vertex | Outgoing neighbours |
| --- | --- |
| P | Q |
| Q | P,R |
| R | P,R,S |
| S | Q,T |
| T | — |

Start at P. Its only first step is Q. From Q, returning immediately to P closes one cycle. Continuing to R can close another through `RP`. At R, the self-loop cannot be inserted into a P-based cycle because it repeats R; continuing to S would next revisit Q or reach the dead end T. Neither produces another P-based cycle.

| Representative cycle | Length | Distinct vertices in it |
| --- | --- | --- |
| `P→Q→P` | 2 | P,Q |
| `P→Q→R→P` | 3 | P,Q,R |
| `Q→R→S→Q` | 3 | Q,R,S |
| `R→R` | 1 | R |

This is the complete global list: `4` cycles. There are `2` cycles from P. Excluding P entirely leaves `Q→R→S→Q` and `R→R`, so `2` remain. Every vertex except T belongs to at least one listed cycle; T has no outgoing edge, so it cannot return to itself. A vertex with outgoing edges is not automatically on a cycle: it must lie on a route that returns to it.

To enumerate without omissions, branch over outgoing edges. On each branch, allow a return to the chosen start to close the cycle and then stop. Reject any other visited vertex. For a global count, repeat from each start and normalize by rotation. Do not divide a mixed-length cycle total by one fixed number: a length-2 cycle appears twice under different starts, a length-3 cycle three times, and a loop once.

#### A small weighted-path extension

The six-year Intermediate practice set emphasizes adjacency, fixed-length paths and cycles. Weights are a short extension here, not a replacement for those methods. Give the edges of the earlier DAG G the following positive weights:

| Edge | Weight |
| --- | --- |
| PQ | 2 |
| PR | 8 |
| QR | 1 |
| QS | 7 |
| RS | 2 |

Compare paths from P to S. The full list is still the three routes established in Lesson 1; weights change their costs, not the graph's connections.

| Path | Edge count | Weight sum |
| --- | --- | --- |
| `P→Q→S` | 2 | $2+7=9$ |
| `P→R→S` | 2 | $8+2=10$ |
| `P→Q→R→S` | 3 | $2+1+2=5$ |

The minimum total weight is `5`, using three edges; the maximum is `10`, using two. Neither claim follows from arrow length on the page or from edge count alone. State whether “shortest” means fewest edges or least total weight.

This comparison is finite because G is acyclic; all its paths are simple. In a graph with cycles, a longest **simple** path is still a finite search, while allowing arbitrary repetitions may make a greatest weight nonexistent. A positive-weight cycle that is reachable from the start and can still lead to the destination can be repeated to increase the total without bound. Restricting the number of edges would make the candidate set finite again. Never report a finite “longest path” without checking these conditions.

#### A checklist that follows the requested object

Record the edge list first. Then identify the start/end, exact length, forbidden vertices and repeat rule. Use a matrix or middle-vertex product for unrestricted fixed-length paths; use route-specific visited sets for simple paths and cycles. Normalize cycles only when the task asks for a whole-graph count. For weighted comparisons, list each candidate and add its actual edge weights. Finish by checking an independent representation, such as the adjacency table, matrix row or complete route list.

### 检查点

**1.** In C, list every cycle from R, grouping by edge length. Why may `R→P→Q→R` count while `R→P→Q→R→R` may not?

**2.** Remove Q entirely from C. List the surviving edges, the remaining cycles, and the vertices that belong to no cycle. Count those vertices after the removal, not in the original graph.

**3.** A directed graph has vertices `U,V,W` and all six edges `UV,VU,UW,WU,VW,WV`, with no loops. Count its distinct cycles globally, separating lengths 2 and 3. Then count the cycles from U. Explain exactly how rotation and reversal affect these counts.

**4.** Keep the same DAG G, but replace its weights with `PQ=5, PR=3, QR=2, QS=1, RS=4`. List every P-to-S path with its weight, and find the least and greatest total weights. Explain why the route that was cheapest in the worked weighted example need not remain cheapest.

Completion standard: provide the complete cycle or path list, identify the counting equivalence, and state which constraints make the search finite.

### 参考答案

**1.** Length 1: `R→R`. Length 3: `R→P→Q→R` and `R→S→Q→R`. There are `3` cycles from R and no others: after `RP`, P must go to Q, then Q must return to R; after `RS`, S must go to Q rather than dead-end T, then Q must return to R. Choosing P from Q instead would force the next step back to the already visited Q. The longer proposed `R→P→Q→R→R` repeats R before its final endpoint, so it is a closed path, not a cycle.

**2.** The remaining vertices are P,R,S,T. Edges are `RP,RR,RS,ST`. The only cycle is `R→R`; P has no outgoing edge, and S only leads to terminal T. The vertices on no cycle are `P,S,T`, a total of `3`. Removing Q also removes every edge into or out of Q; merely ignoring Q in the final list would leave invalid routes.

**3.** Length 2 gives `U→V→U`, `U→W→U`, `V→W→V`: `3` cycles. Length 3 gives `U→V→W→U` and `U→W→V→U`: `2` cycles. Thus the global total is $3+2=5$. From U, include the first two length-2 cycles and both length-3 cycles: $2+2=4$. Rotating the start adds no new global cycle. The two directed triangles have opposite orientations and use different edges, so both count; the reverse writing of a two-edge cycle is already its rotation.

**4.** `P→Q→S` costs $5+1=6$; `P→R→S` costs $3+4=7$; `P→Q→R→S` costs $5+2+4=11$. The least weight is `6` and the greatest is `11`. The connections and complete path list did not change, but the edge costs did. The previous least-cost path is now the greatest-cost one; recompute the sums instead of preserving an old ranking.

### 关联题目

[]

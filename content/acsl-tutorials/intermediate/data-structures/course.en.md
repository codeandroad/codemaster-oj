---
format: codemaster-learning-path
version: 1
title: ACSL Intermediate Topic 8 — Data Structures
description: Four original lessons on stacks, queues, binary search trees, path lengths and traversals. Trace each operation, draw duplicate keys as separate nodes, and verify results with state tables and tree invariants.
category: ACSL · Intermediate
estimatedMinutes: 100
difficulty: intermediate
coverKey: general
---

# ACSL Intermediate Topic 8 — Data Structures

## 章节：01. Trace stacks and queues without losing an item

### 学习目标

- Label the removal end before processing stack or queue commands.
- Separate a returned value from the contents that remain after POP.
- Trace repeated values, empty structures, and algorithms that move an item twice.

### 正文

#### Decide what the written order means

A **stack** removes the most recently added item: last in, first out (LIFO). A **queue** removes the earliest item still waiting: first in, first out (FIFO). Both may contain duplicate values. A second `A` is another item, not a replacement for the first one.

Throughout this lesson, a stack is written **bottom → top**, so its rightmost item is removed. A queue is written **front → rear**, so its leftmost item is removed. We append new items at the right in both representations. Always state these directions: a requested answer “top to bottom” reverses our stack display, but does not reverse a queue automatically.

`PUSH(v)` adds the value of `v`. `x = POP()` removes one item and assigns its value to `x`; assigning `x` does not put the item back. Some older questions use `POP(x)` for the same assignment. A read-only inspection of the next item, often called `PEEK`, would not remove it. Under the ACSL convention, popping an empty stack or queue returns `NIL` and leaves it empty. `NIL` is a special empty-result marker, not the number 0 or a new item silently inserted into the structure.

These conventions follow the official ACSL Data Structures category. The examples below are original. The linked past-paper exercises cover both direct command lists and a short stack algorithm.

#### The same commands, two different histories

Start with each structure empty. Each row shows the state **after** the command. `—` means that this command returns no value; `[]` means an empty structure.

| Step | Command | Stack: bottom → top | Returned by stack | Queue: front → rear | Returned by queue |
| --- | --- | --- | --- | --- | --- |
| 1 | `PUSH(P)` | `[P]` | — | `[P]` | — |
| 2 | `PUSH(Q)` | `[P,Q]` | — | `[P,Q]` | — |
| 3 | `x = POP()` | `[P]` | Q | `[Q]` | P |
| 4 | `PUSH(R)` | `[P,R]` | — | `[Q,R]` | — |
| 5 | `PUSH(S)` | `[P,R,S]` | — | `[Q,R,S]` | — |
| 6 | `x = POP()` | `[P,R]` | S | `[R,S]` | Q |
| 7 | `PUSH(T)` | `[P,R,T]` | — | `[R,S,T]` | — |
| 8 | `x = POP()` | `[P,R]` | T | `[S,T]` | R |

The last value already removed is `T` for the stack and `R` for the queue. The **next** removed values would instead be `R` and `S`. Do not perform that extra POP unless the question asks for a new state. The final stack from top to bottom is `R,P`; the final queue from front to rear is `S,T`.

There are five pushes and three successful pops, so each final size is $5-3=2$. This verifies the count but not the order. A reversed queue can have the right size and still give the wrong answer.

#### Variables and compound operations

Start with the stack `[2,5,9]`. Execute `a = POP()`, `b = POP()`, then `PUSH(a - b)`. The first two statements produce `a=9`, `b=5` and leave `[2]`. Evaluate the expression with those stored values: $9-5=4$. Pushing that result leaves `[2,4]`. Reversing the operand order would produce $5-9=-4$; LIFO determines the assignments, not the arithmetic order written in the expression.

For a longer algorithm, expand each loop iteration into its individual operations. Suppose the stack begins `[K,M]`, and for each new letter `v` in `R,T` we execute `x = POP(); PUSH(v); PUSH(x)`. After `v=R`, the state is `[K,R,M]`; after `v=T`, it is `[K,R,T,M]`. The old top `M` is removed and then restored at each iteration. Each iteration adds one item overall, and the output from top to bottom is `M,T,R,K`. This small invariant checks every row without replacing the actual trace.

#### A reliable scratch-work method

Keep separate columns for the step, the structure, and any variable read later. Cross out the removed item immediately. When two equal letters occur, temporary labels such as `A1` and `A2` can track their identity; the labels are not part of the value. On an empty POP, record `NIL` and do not subtract another item from the size. Finish by rereading the requested direction and whether the question asks for the last returned item, the next item, or the whole final structure.

### 检查点

**1.** Apply `PUSH(A), PUSH(B), PUSH(A), POP, PUSH(C), POP` to an empty stack and, separately, to an empty queue. Give both returned sequences, both final states in this lesson's display order, and the next item each would remove.

**2.** A stack begins `[4,7,3]` from bottom to top. Execute `a = POP(); b = POP(); PUSH(b - a); PUSH(a); c = POP()`. Find `a`, `b`, `c`, the final stack, and the next item to be popped.

**3.** An empty queue receives `POP, PUSH(J), POP, POP`. Give the returned sequence and final size. Explain why “pushes minus all POP commands” gives the wrong size here.

**4.** Start with stack `[L,N]`. For `v` in `P,R`, execute `x = POP(); PUSH(v); PUSH(x)`. Show the stack after each iteration and then report it from top to bottom.

Completion standard: show intermediate states, keep return values separate, and justify the final order instead of guessing from the last letter in the command list.

### 参考答案

**1.** For the stack, the two pops return `A,C`: the first removes the most recent `A`, and the second removes `C`. The final bottom-to-top state is `[A,B]`, so the next value is `B`. For the queue, the two pops return `A,B`, removing the oldest entries. The final front-to-rear state is `[A,C]`, so the next value is `A`. Each has size 2; the surviving `A` is the first pushed one in the stack and the second pushed one in the queue.

**2.** The first pop gives `a=3` and leaves `[4,7]`; the second gives `b=7` and leaves `[4]`. Since $7-3=4$, pushing the difference gives `[4,4]`. Pushing `a` gives `[4,4,3]`, and the final pop gives `c=3`. The final state is `[4,4]`, and the next value is `4`. Equal values remain two separate items.

**3.** The returned sequence is `NIL,J,NIL`; the final queue is `[]`, with size `0`. Only the middle POP removes an existing item. There is one push and one successful removal, so the size is $1-1=0$, not $1-3$.

**4.** After `v=P`, the state is `[L,P,N]`. After `v=R`, it is `[L,P,R,N]`. Each iteration removes and restores `N`, keeping it at the top. Therefore the requested top-to-bottom answer is `N,R,P,L`, not the display order in the state table.

### 关联题目

[]

## 章节：02. Build a binary search tree, including equal keys

### 学习目标

- Insert keys in their given order by comparing with each node on the search path.
- Keep repeated keys as separate nodes and apply the stated equality rule consistently.
- Check every edge against the restrictions inherited from all ancestors.

### 正文

#### The rule applies to a whole subtree

A binary search tree (BST) has at most one left child and one right child at each node. For the ACSL convention used here,

$$
\text{every key in the left subtree}\leq\text{node key}<\text{every key in the right subtree}.
$$

The first inserted key becomes the root. For each later key, start again at the root: go left on `≤`, right on `>`, and create a new node at the first empty child position. Never sort the input before inserting it. Never balance the tree unless the problem explicitly requests a balancing algorithm.

For letters, use their alphabetic order. A duplicate still takes a new position. For example, if a repeated `6` meets an existing `6`, it goes left at that comparison. It may then need to go right at a smaller node below; “duplicates go left” does not mean attaching every duplicate directly to its first equal node. Some other sources use a different equality rule, so an explicit rule in a problem takes priority.

#### A complete insertion trace

Insert `8,4,12,2,6,10,6,9`. Call the first `6` **6a** and the later one **6b** solely to distinguish their nodes; both keys equal 6. `L` and `R` name the choice made at each visited node.

| Inserted node | Comparisons along the path | New position | Comparisons |
| --- | --- | --- | --- |
| 8 | — | root | 0 |
| 4 | `8:L` | `8:L` | 1 |
| 12 | `8:R` | `8:R` | 1 |
| 2 | `8:L,4:L` | `4:L` | 2 |
| 6a | `8:L,4:R` | `4:R` | 2 |
| 10 | `8:R,12:L` | `12:L` | 2 |
| 6b | `8:L,4:R,6a:L` | `6a:L` | 3 |
| 9 | `8:R,12:L,10:L` | `10:L` | 3 |

```diagram
{
  "id": "tutorial-bst-duplicates",
  "width": 640,
  "height": 330,
  "alt": {
    "en": "Binary search tree: root 8; 8 has children 4 and 12; 4 has children 2 and 6a; 12 has left child 10; 6a has left child 6b; 10 has left child 9. Both 6a and 6b store key 6.",
    "zh": "二叉搜索树：根为8；8的孩子为4和12；4的孩子为2和6a；12的左孩子为10；6a的左孩子为6b；10的左孩子为9。6a和6b的键都等于6。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 320,
      "y1": 40,
      "x2": 170,
      "y2": 120,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 320,
      "y1": 40,
      "x2": 470,
      "y2": 120,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 170,
      "y1": 120,
      "x2": 80,
      "y2": 200,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 170,
      "y1": 120,
      "x2": 260,
      "y2": 200,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 470,
      "y1": 120,
      "x2": 430,
      "y2": 200,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 260,
      "y1": 200,
      "x2": 220,
      "y2": 280,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 430,
      "y1": 200,
      "x2": 390,
      "y2": 280,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "circle",
      "cx": 320,
      "cy": 40,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 320,
      "y": 46,
      "text": "8",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 170,
      "cy": 120,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 170,
      "y": 126,
      "text": "4",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 470,
      "cy": 120,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 470,
      "y": 126,
      "text": "12",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 80,
      "cy": 200,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 80,
      "y": 206,
      "text": "2",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 260,
      "cy": 200,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 260,
      "y": 206,
      "text": "6a",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 430,
      "cy": 200,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 430,
      "y": 206,
      "text": "10",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 220,
      "cy": 280,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 220,
      "y": 286,
      "text": "6b",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 390,
      "cy": 280,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 390,
      "y": 286,
      "text": "9",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    }
  ]
}
```

The edge table is also a text description of the diagram. `—` means there is no child at that position.

| Node | Left child | Right child |
| --- | --- | --- |
| 8 | 4 | 12 |
| 4 | 2 | 6a |
| 12 | 10 | — |
| 2 | — | — |
| 6a | 6b | — |
| 10 | 9 | — |
| 6b | — | — |
| 9 | — | — |

In particular, `6b` is less than 8, greater than 4, and equal to `6a`; its entire path is valid. Counting only the local comparison with `6a` misses the ancestor restrictions.

#### Insertion order and search effort

The same distinct keys `2,4,6` give a three-node right chain if inserted in that order. Inserting `4,2,6` instead gives root 4 with two leaf children. Both satisfy the BST rule, but their shapes and search costs differ. A successful search compares the query against each visited real node, including the matching node; searching for 6 in those two trees takes 3 comparisons and 2 comparisons respectively.

For the worked tree, searching for `9` follows `8,12,10,9`, so it takes 4 key comparisons. Trying to insert 9 at its current depth originally required only 3 existing-node comparisons: the new node did not exist yet. Searching for absent `11` visits `8,12,10`, then reaches an empty right-child position. That final empty-position check is not another **key** comparison. State what is being counted whenever the wording is ambiguous.

#### Check a drawing before counting it

There must be exactly one real node per inserted item, including duplicates. Each node except the root has one parent, and an $n$-node tree has $n-1$ edges. These counts catch missing nodes, but also inspect value ranges. Putting 5 to the left of 6 underneath the right subtree of 8 satisfies the local comparison $5\leq6$ yet violates the ancestor requirement $5>8$. A plausible-looking tree is not enough.

### 检查点

**1.** Insert `5,3,7,3,4`, with equal keys going left. Label the equal nodes `3a,3b`. List each node's children and the insertion path of 4.

**2.** Insert `5,3,7,3,4` again, this time using the explicitly changed rule `left < node ≤ right`. Where are `3b` and 4? Which earlier nodes keep their positions?

**3.** Insert the letters `M,H,T,K,H`. Use `Ha,Hb` for the repeated H. Give the full path for `Hb`, and count key comparisons when searching for `K` and for absent `J`.

**4.** A diagram has root 8, right child 12, and 12's left child 6. Every immediate edge seems correctly ordered. Is this a BST under our rule? Repair it by rebuilding from the insertion order `8,12,6`.

Completion standard: preserve input order and every duplicate; explain a node's full path, not just its immediate parent.

### 参考答案

**1.** The children are `5:(3a,7)`, `3a:(3b,4)`, `7:(—,—)`, `3b:(—,—)`, `4:(—,—)`, in `(left,right)` order. The new `3b` follows `5:L,3a:L`. The path for 4 is `5:L,3a:R`, so it becomes `3a`'s right child. There are 5 nodes and 4 edges.

**2.** The first three nodes stay at root 5, left child `3a`, and right child 7. Under the changed equality rule, `3b` follows `5:L,3a:R`. Then 4 follows `5:L,3a:R,3b:R`. Thus `3b` is the right child of `3a`, and 4 is the right child of `3b`. No old node is discarded to accommodate the duplicate.

**3.** `Ha` is M's left child, T is M's right child, K is `Ha`'s right child, and `Hb` follows `M:L,Ha:L`. Searching for K visits `M,Ha,K`: 3 key comparisons. Searching for J visits `M,Ha,K`, then an empty left position: also 3 key comparisons. The absence of J is detected only after comparing with K; it is not another real node to compare against.

**4.** It is invalid: 6 lies in the right subtree of 8 but is not greater than 8. Rebuilding gives `8:(6,12)`, with both 6 and 12 leaves. Testing only parent-child ordering can miss a restriction inherited from a higher ancestor.

### 关联题目

[]

## 章节：03. Count children, depths and path lengths precisely

### 学习目标

- Distinguish leaves, one-child nodes, and nodes with only a particular child.
- Use root depth 0, and distinguish a maximum depth from the sum of depths.
- Count ACSL external nodes as empty child positions and verify both path lengths.

### 正文

#### Start with the tree already built

Use the tree from `8,4,12,2,6,10,6,9` in Lesson 2. A **child** is one edge away; a **descendant** may be farther down. A leaf has no children. “Only a left child” requires a left child **and no right child**. A node with two children does not qualify, even though one of those children is on the left.

The **depth of a node** is the number of edges from the root. The root has depth 0. A node's **height** is the greatest number of edges from that node down to a leaf, so a leaf has height 0. The height of a nonempty tree is its maximum node depth. If counting occupied levels starting with level 1 at the root, there is one more level than the edge-based tree height. Always check the convention in the question.

| Node | Depth | Number of children | Height |
| --- | --- | --- | --- |
| 8 | 0 | 2 | 3 |
| 4 | 1 | 2 | 2 |
| 12 | 1 | 1 | 2 |
| 2 | 2 | 0 | 0 |
| 6a | 2 | 1 | 1 |
| 10 | 2 | 1 | 1 |
| 6b | 3 | 0 | 0 |
| 9 | 3 | 0 | 0 |

The leaves are `2,6b,9`. The one-child nodes are `12,6a,10`; each has only a left child. There are no nodes with only a right child. The two-child nodes are `8,4`. The tree height is `3`, and it occupies `4` levels. At depth 2, the nodes from left to right are `2,6a,10`: do not include `6b` merely because its key equals 6.

#### Internal path length sums all real-node depths

Under ACSL terminology, **internal path length** includes every real data node, including leaves. It is not the sum only over non-leaf nodes. For the worked tree,

$$
I=0+1+1+2+2+2+3+3=14.
$$

A second method groups nodes by depth: there is 1 node at depth 0, 2 at depth 1, 3 at depth 2 and 2 at depth 3, giving

$$
I=1\cdot0+2\cdot1+3\cdot2+2\cdot3=14.
$$

The sum of the insertion comparison counts in Lesson 2 is also 14: each new node compared with its ancestors, one per edge in its insertion path. By contrast, searching successfully for every node once would count the node itself too; when node identity is distinguishable, that total is $I+n=14+8=22$. For repeated keys, a plain value search may stop at the first equal key, so do not use that total to claim that a value search reaches every duplicate.

#### External nodes are missing child positions, not leaves

ACSL uses **external node** for an empty child position where insertion could attach a new node. A real leaf has **two** such positions. Consider the small tree obtained from `5,3,7`. The circles are real nodes; the four squares labelled `∅` are empty positions, not four additional stored values.

```diagram
{
  "id": "tutorial-bst-external",
  "width": 440,
  "height": 270,
  "alt": {
    "en": "Three real nodes: root 5 with left child 3 and right child 7. Each leaf has two empty child positions, four squares at depth 2 in total.",
    "zh": "三个真实节点：根5的左孩子为3，右孩子为7。每个叶子有两个空孩子位置，共四个方框，深度均为2。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 220,
      "y1": 40,
      "x2": 120,
      "y2": 120,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 220,
      "y1": 40,
      "x2": 320,
      "y2": 120,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 120,
      "y1": 120,
      "x2": 70,
      "y2": 210,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 120,
      "y1": 120,
      "x2": 170,
      "y2": 210,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 320,
      "y1": 120,
      "x2": 270,
      "y2": 210,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 320,
      "y1": 120,
      "x2": 370,
      "y2": 210,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "circle",
      "cx": 220,
      "cy": 40,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 220,
      "y": 46,
      "text": "5",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 120,
      "cy": 120,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 120,
      "y": 126,
      "text": "3",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 320,
      "cy": 120,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 320,
      "y": 126,
      "text": "7",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "rect",
      "x": 55,
      "y": 195,
      "width": 30,
      "height": 30,
      "rx": 3,
      "stroke": "muted",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 70,
      "y": 216,
      "text": "∅",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "muted"
    },
    {
      "type": "rect",
      "x": 155,
      "y": 195,
      "width": 30,
      "height": 30,
      "rx": 3,
      "stroke": "muted",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 170,
      "y": 216,
      "text": "∅",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "muted"
    },
    {
      "type": "rect",
      "x": 255,
      "y": 195,
      "width": 30,
      "height": 30,
      "rx": 3,
      "stroke": "muted",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 270,
      "y": 216,
      "text": "∅",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "muted"
    },
    {
      "type": "rect",
      "x": 355,
      "y": 195,
      "width": 30,
      "height": 30,
      "rx": 3,
      "stroke": "muted",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 370,
      "y": 216,
      "text": "∅",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "muted"
    }
  ]
}
```

Equivalent description: 5 has children 3 and 7. Node 3 has two missing children at depth 2; node 7 also has two missing children at depth 2. Thus $I=0+1+1=2$ and the external path length is $E=2+2+2+2=8$. There are 3 real nodes, 2 real edges, and 4 external positions.

In the eight-node worked tree, the missing positions are the right child of 12 at depth 2; both children of 2, the right child of `6a`, and the right child of 10 at depth 3; and both children of `6b` and of 9 at depth 4. Therefore

$$
E=1\cdot2+4\cdot3+4\cdot4=30.
$$

There are $1+4+4=9$ external positions. For a nonempty $n$-node binary tree, two useful checks are

$$
\text{external positions}=n+1,\qquad E=I+2n.
$$

Why? Real nodes supply $2n$ child positions, and the $n-1$ real edges occupy that many positions, leaving $n+1$ empty. To check the path identity, sum the depths of **all** child positions: each real node at depth $d$ contributes $2(d+1)$, so the total is $2I+2n$. The occupied positions contribute the depths of all non-root real nodes, which sum to $I$. Subtracting them leaves $E=I+2n$. Here $30=14+2\cdot8$.

If $n_0,n_1,n_2$ count nodes with 0, 1, and 2 children, then $n=n_0+n_1+n_2$ and $n-1=n_1+2n_2$. Subtraction gives $n_0=n_2+1$. The worked tree has $3=2+1$ leaves. This checks a count but does not reveal where those leaves belong.

### 检查点

**1.** Build the BST from `7,3,10,1,5,9,11,4`. List leaves, only-left-child nodes, only-right-child nodes, and nodes with two children. Check the edge and leaf identities.

**2.** For that same tree, list nodes at depth 2 from left to right, give the height and number of occupied levels, and calculate internal path length in two ways.

**3.** For that same tree, count external positions at each depth, compute external path length directly, and verify $E=I+2n$.

**4.** Compare a one-node tree with a tree formed by inserting `2,4,6,8`. For each give height, leaves, one-child nodes, $I$, external-position count and $E$. Explain why a leaf and an external position are not the same object.

Completion standard: give both the number and what you counted; distinguish the real-node depth table from empty child positions.

### 参考答案

**1.** The children are `7:(3,10)`, `3:(1,5)`, `10:(9,11)`, `5:(4,—)`, with 1, 4, 9 and 11 leaves. Only-left-child nodes: `5`; only-right-child nodes: none; two-child nodes: `7,3,10`. The counts are $n_0=4,n_1=1,n_2=3$. There are $8-1=7$ edges, also $1+2\cdot3=7$, and $n_0=n_2+1=4$.

**2.** The depth-2 nodes are `1,5,9,11`; node 4 is at depth 3. The height is `3` and the tree occupies `4` levels. In insertion order, depths are `0,1,1,2,2,2,2,3`. Thus $I=0+1+1+2+2+2+2+3=13$, or $I=1\cdot0+2\cdot1+4\cdot2+1\cdot3=13$.

**3.** The four nodes at depth 2 supply eight positions at depth 3; one is occupied by 4, leaving seven empty. Node 4 supplies two more empty positions at depth 4. There are `9` external positions, and $E=7\cdot3+2\cdot4=29$. Independently, $I+2n=13+2\cdot8=29$.

**4.** A single real node is a leaf at depth 0, so height `0`, leaves `1`, one-child nodes `0`, $I=0$, external positions `2`, and $E=1+1=2$. The increasing sequence produces a right chain of four nodes. It has height `3`, one leaf (8), three one-child nodes (2, 4, 6), and $I=0+1+2+3=6$. Its five empty positions have depths `1,2,3,4,4`, so $E=1+2+3+4+4=14=6+2\cdot4$. A real leaf stores a key and has two empty child positions; neither empty position stores a key.

### 关联题目

[]

## 章节：04. Traverse a tree and connect the structures

### 学习目标

- Produce preorder, inorder, postorder and breadth-first sequences from a drawn tree.
- Explain how the recursive order applies to a whole subtree, not just three adjacent nodes.
- Trace queue-to-stack transfers before building a tree, then check the result independently.

### 正文

#### Visiting a node is different from entering its subtree

A traversal lists each real node once. “Visit” means output that node's key; recursion can enter a subtree before its root key is output. Use these three rules on **every** subtree:

- Preorder: visit the root, then traverse its left subtree, then its right subtree.
- Inorder: traverse the left subtree, visit the root, then traverse the right subtree.
- Postorder: traverse the left subtree, then its right subtree, then visit the root.

Empty subtrees output nothing. These traversals preserve the left/right structure; they do not sort the input as a separate step. For a correctly constructed BST, inorder happens to be nondecreasing, including every duplicate. Preorder begins with the tree's root, and postorder ends with it. These quick checks do not replace the full traversal.

#### One tree, four useful orders

Build the BST from `5,3,8,1,4,7,9`.

```diagram
{
  "id": "tutorial-bst-traversals",
  "width": 600,
  "height": 280,
  "alt": {
    "en": "Binary search tree: root 5; its children are 3 and 8; 3 has children 1 and 4; 8 has children 7 and 9.",
    "zh": "二叉搜索树：根为5，孩子为3和8；3的孩子为1和4；8的孩子为7和9。"
  },
  "elements": [
    {
      "type": "line",
      "x1": 300,
      "y1": 40,
      "x2": 160,
      "y2": 125,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 300,
      "y1": 40,
      "x2": 440,
      "y2": 125,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 160,
      "y1": 125,
      "x2": 80,
      "y2": 220,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 160,
      "y1": 125,
      "x2": 240,
      "y2": 220,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 440,
      "y1": 125,
      "x2": 360,
      "y2": 220,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "line",
      "x1": 440,
      "y1": 125,
      "x2": 520,
      "y2": 220,
      "stroke": "muted",
      "strokeWidth": 2
    },
    {
      "type": "circle",
      "cx": 300,
      "cy": 40,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 300,
      "y": 46,
      "text": "5",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 160,
      "cy": 125,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 160,
      "y": 131,
      "text": "3",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 440,
      "cy": 125,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 440,
      "y": 131,
      "text": "8",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 80,
      "cy": 220,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 80,
      "y": 226,
      "text": "1",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 240,
      "cy": 220,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 240,
      "y": 226,
      "text": "4",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 360,
      "cy": 220,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 360,
      "y": 226,
      "text": "7",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    },
    {
      "type": "circle",
      "cx": 520,
      "cy": 220,
      "r": 22,
      "stroke": "ink",
      "strokeWidth": 1.5,
      "fill": "surface"
    },
    {
      "type": "text",
      "x": 520,
      "y": 226,
      "text": "9",
      "fontSize": 17,
      "anchor": "middle",
      "font": "sans",
      "fill": "ink"
    }
  ]
}
```

The equivalent edge description is `5:(3,8)`, `3:(1,4)`, `8:(7,9)`; 1, 4, 7 and 9 are leaves. The root is 5. Complete the entire left subtree before starting the right subtree in each depth-first traversal.

| Traversal | Left subtree rooted at 3 | Right subtree rooted at 8 | Whole tree |
| --- | --- | --- | --- |
| Preorder | `3,1,4` | `8,7,9` | `5,3,1,4,8,7,9` |
| Inorder | `1,3,4` | `7,8,9` | `1,3,4,5,7,8,9` |
| Postorder | `1,4,3` | `7,9,8` | `1,4,3,7,9,8,5` |

**Breadth-first**, or level order, visits nodes at depth 0, then depth 1, and so on, from left to right within each depth. A queue makes that order explicit: begin with the root waiting; remove and visit the front node, then enqueue its existing left child followed by its existing right child.

| Visited node | Waiting queue after its children are enqueued |
| --- | --- |
| 5 | `[3,8]` |
| 3 | `[8,1,4]` |
| 8 | `[1,4,7,9]` |
| 1 | `[4,7,9]` |
| 4 | `[7,9]` |
| 7 | `[9]` |
| 9 | `[]` |

The resulting sequence is `5,3,8,1,4,7,9`. Enqueueing the right child before the left child would reverse the requested within-level order. Sorting the waiting queue would change the algorithm entirely.

A stack can perform preorder without recursion: pop and visit a node, then push its existing **right child before its left child**. LIFO makes the left child the next node visited. For this tree, after visiting 5 the waiting stack is `[8,3]` bottom to top; after visiting 3 it is `[8,4,1]`. Reversing those pushes would visit the right subtree first.

#### Structure matters even when the sorted sequence is the same

The trees built from `4,2,6` and from `2,4,6` both have inorder `2,4,6`. Their preorder sequences are respectively `4,2,6` and `2,4,6`; their heights are 1 and 2. Inorder alone does not determine a BST's shape. An insertion list and a traversal are different pieces of information, although a particular list may coincide with a traversal by chance.

#### A pipeline: queue → stack → tree

Begin with queue `[6,2,9,4]` from front to rear and an empty stack. Repeatedly remove the queue's front and push it on the stack. The stack becomes `[6,2,9,4]` bottom to top. Now pop every stack item and insert it into an empty BST: the insertion order is `4,9,2,6`.

The resulting tree has `4:(2,9)` and `9:(6,—)`, with 2 and 6 leaves. Its inorder is `2,4,6,9`; its preorder is `4,2,9,6`; its postorder is `2,6,9,4`; its level order is `4,2,9,6`. The insertion depths are `0,1,1,2`, so $I=4$, and $E=4+2\cdot4=12$. Simply inserting the original queue order would produce a different root. Record the intermediate order before drawing any edges.

#### From a worked example to a past-paper solution

Before opening linked practice, identify the required output: a next POP, a child-type count, a depth row, a traversal, or a path-length sum. Write the structural convention first, construct the states or tree second, and count or traverse last. The original checks here can be reviewed immediately; linked formal-paper correctness and explanations remain part of the paper's submission-and-review flow.

### 检查点

**1.** Return to the tree from `8,4,12,2,6,10,6,9`. Keeping `6a,6b` distinct, give preorder, inorder and postorder. Then replace the labels with key 6 and explain why neither duplicate disappears.

**2.** Give its level order and the waiting queue after visiting 8, 4 and 12. Why is this different from preorder?

**3.** An initial queue is `[7,1,5,3]`. Transfer all its items to an empty stack, then pop them into an empty BST. Give the insertion order, child table, inorder, height and internal path length. Check external path length directly from the missing positions.

**4.** Can the inorder sequence `2,5,8` determine the root? Build two different BSTs with that inorder, and give each tree's preorder and height. Explain why “inorder is sorted” is a check of the values' ordering but not proof of a specific shape.

Completion standard: show the intermediate sequence and use both traversal checks and a depth or edge check on the final tree.

### 参考答案

**1.** Preorder is `8,4,2,6a,6b,12,10,9`. Inorder is `2,4,6b,6a,8,9,10,12`. Postorder is `2,6b,6a,4,9,10,12,8`. The left subtree of `6a` is visited before `6a` in inorder, so `6b` appears first there. Replacing both labels with 6 gives inorder `2,4,6,6,8,9,10,12`; all three traversals still contain 8 nodes. Labels distinguish identities without changing stored values.

**2.** Level order is `8,4,12,2,6a,10,6b,9`. The waiting queues after the first three visits are `[4,12]`, `[12,2,6a]`, `[2,6a,10]`. Preorder explores all descendants of 4 before visiting 12; a queue keeps 12 ahead of those newly enqueued descendants.

**3.** The stack is `[7,1,5,3]` bottom to top, so the insertion order is `3,5,1,7`. The child table is `3:(1,5)`, `5:(—,7)`, with 1 and 7 leaves. Inorder is `1,3,5,7`; the tree height is `2`. In insertion order the depths are `0,1,1,2`, so $I=4$. The five external positions have depths `2,2,2,3,3`, giving $E=2+2+2+3+3=12$, also $I+2n=4+8=12$.

**4.** Inserting `5,2,8` gives root 5 and two leaves: preorder `5,2,8`, height `1`. Inserting `2,5,8` gives a right chain: preorder `2,5,8`, height `2`. Both inorder sequences are `2,5,8`, so inorder does not determine the root or height. The order tells us how keys compare, but not when each key was inserted.

### 关联题目

[]

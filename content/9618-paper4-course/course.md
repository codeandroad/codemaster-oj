---
format: codemaster-learning-path
version: 1
title: 9618 Paper 4 Practical Programming with Python
description: Original, syllabus-aligned lessons and programming practice for school-based Paper 4 preparation
category: Computer Science
estimatedMinutes: 2400
difficulty: advanced
coverKey: algorithms
---

# 9618 Paper 4 Practical Programming with Python

## 章节：01 Paper 4 workflow and Python foundations

### 学习目标

Translate a task into input, processing, output and state requirements; build a small Python console program; collect meaningful tests and preserve source and output evidence.

### 正文

#### Scope and coverage map

| Syllabus skill | Course chapters | Place in this course |
| --- | --- | --- |
| AS sections 9–12 | 01, 04–06, 10 | Prerequisite algorithms, structures, procedures and testing; not a claim that these sections are directly examined in Paper 4. |
| 19.1 Algorithms | 02–08, 14 | Searching, sorting, stack/queue/list/tree/dictionary ADTs, comparisons and time/space complexity; graph concepts only. |
| 19.2 Recursion | 09 | Base case, progress, tracing, call stack and backtracking practice. |
| 20.1 Programming paradigms | 01, 10–12, 16 | Procedural code and OOP; low-level and declarative programming are excluded from Paper 4. |
| 20.2 File processing and exception handling | 13–16 | Text records, simulated random access, read/write/append and specific error handling. |

The official practical paper takes 2 hours 30 minutes, has 75 marks, and requires complete source code and testing evidence. This course is school practice, not an official exam delivery system. Automated output tests can verify behaviour, but teachers must inspect source and run evidence when marks depend on a requested data structure, file operation or class design. See the [2026 syllabus](https://www.cambridgeinternational.org/Images/697372-2026-syllabus.pdf) for the authoritative scope. The course uses Python console programs; the official examination also permits Java and Visual Basic.

#### Start with a contract

Paper 4 is a 150-minute practical paper worth 75 marks. Candidates produce complete code and evidence of testing. In this course, begin every task by writing four short notes: the input format, the required output format, the state that must be preserved, and at least three tests. For a function, state what it returns on an empty input and on invalid input before you code. An example is a *shipment alert*: read a count, then that many non-negative temperatures; print `ALERT` if any value exceeds 8, otherwise `OK`. Its boundary tests are an empty list, exactly 8, and just above 8. Never hard-code the displayed example: hidden cases will vary.

```python
def has_alert(values: list[int]) -> bool:
    for value in values:
        if value > 8:
            return True
    return False

count = int(input())
values = [int(input()) for _ in range(count)]
print("ALERT" if has_alert(values) else "OK")
```

This program does not yet reject a negative count or temperature; the specification decides whether that is required. A good solution does not add arbitrary output such as `Enter a value:` because the judge compares exact output. Prefer functions for logic and a tiny main routine for reading and printing. A named constant such as `LIMIT = 8` makes the rule visible.

#### Work like a practical candidate

Read every subpart before coding. Sketch the data structure and pointer invariants where relevant. Save source after each working increment. Run the smallest normal case, then empty/full/boundary cases, then a case designed to break your own assumptions. Keep a test table recording input, predicted output, observed output, and what you changed. In official Paper 4, candidates must submit code and testing evidence; in this school course the OJ stores code and run records, but teacher review remains necessary for requirements invisible to output. The official paper is offline; do not rely on web access or packages outside a basic environment.

**Common mistake:** treating a successful run of the given sample as proof of correctness. A hidden test may differ in length, ordering, duplicates or invalid data.

### 检查点

Write a console program that reads `n` on the first line and then `n` integer readings, one per line. Print `EMPTY` for `n = 0`; otherwise print the smallest reading and its first zero-based position separated by one space. Test an all-equal case and a case where the minimum repeats. Use no prompt text.

### 参考答案

```python
n = int(input())
readings = [int(input()) for _ in range(n)]
if not readings:
    print("EMPTY")
else:
    best_position = 0
    for position in range(1, n):
        if readings[position] < readings[best_position]:
            best_position = position
    print(readings[best_position], best_position)
```

For `4` followed by `7, 2, 9, 2`, the output is `2 1`. The strict `<` preserves the first position on a tie. Related practice: reading tables, boundary inputs and exact console output.

### 关联题目

[]

## 章节：02 Searching

### 学习目标

Implement linear and binary search; justify when binary search is valid; return a documented result for missing and duplicate keys; compare work done as input size grows.

### 正文

#### Search contracts

A linear scan works on any list. It examines at most `n` entries and needs constant extra storage. Binary search repeatedly discards half of a **sorted** list. A binary search on unsorted data may return a wrong answer even when the key exists. State whether your task wants any matching index, the first index, or every match; these are different contracts.

```python
def first_match_linear(values: list[int], target: int) -> int:
    for index, value in enumerate(values):
        if value == target:
            return index
    return -1


def first_match_binary(values: list[int], target: int) -> int:
    low, high = 0, len(values) - 1
    answer = -1
    while low <= high:
        middle = (low + high) // 2
        if values[middle] >= target:
            if values[middle] == target:
                answer = middle
            high = middle - 1
        else:
            low = middle + 1
    return answer
```

Moving `high` left after a match finds the first duplicate. For `[2, 4, 4, 4, 9]`, searching for 4 returns 1. A loop invariant is useful: if a first match exists, it is at `answer` or still in the remaining range. An empty list starts with `high = -1`, so the loop never runs. A target below the first or above the last item returns `-1`.

Linear search is `O(n)` time; binary search is `O(log n)` time on sorted data. Sorting a list solely to answer one search can cost more than scanning it. For many queries against stable data, one sort may be worthwhile. Count inspected elements experimentally rather than assuming speed from one tiny example.

**Common mistake:** using `while low < high` with a final unchecked item, or setting `high = middle` without ensuring the interval shrinks.

### 检查点

A ticket register contains sorted integer IDs and may contain duplicates. Read `n`, then `n` IDs, then a target ID. Print the first zero-based position or `-1`. Implement binary search yourself; do not use `.index()` or `bisect`. Include tests for empty input, a missing ID, and a repeated ID.

### 参考答案

```python
n = int(input())
ids = [int(input()) for _ in range(n)]
target = int(input())
low, high = 0, n - 1
first = -1
while low <= high:
    middle = (low + high) // 2
    if ids[middle] >= target:
        if ids[middle] == target:
            first = middle
        high = middle - 1
    else:
        low = middle + 1
print(first)
```

The sorted-input condition is part of the problem, not something the search silently repairs. Related practice: unsorted linear lookup and sorted duplicate lookup.

### 关联题目

[]

## 章节：03 Sorting and complexity

### 学习目标

Implement bubble and insertion sort without built-in sorting; preserve ties where required; explain best and worst cases, comparison counts, and auxiliary space.

### 正文

#### Two sorting mechanisms

Bubble sort compares adjacent items and swaps out-of-order neighbours. After one full pass, the largest item is at the right end. Stop early when a pass makes no swap. Insertion sort takes the next item and moves larger previous items right until the item fits. Both can sort in place with `O(1)` extra elements; both have `O(n²)` worst-case time. An already sorted input lets an optimized bubble sort and insertion sort finish in `O(n)`, but a reverse-sorted input requires many moves. Both can be stable if equal keys are not swapped or shifted past each other.

```python
def insertion_sort(rows: list[tuple[str, int]]) -> None:
    for end in range(1, len(rows)):
        current = rows[end]
        position = end - 1
        while position >= 0 and rows[position][1] > current[1]:
            rows[position + 1] = rows[position]
            position -= 1
        rows[position + 1] = current
```

The comparison uses `>` rather than `>=`; equal scores keep their original order. The loop invariant is that `rows[:end]` is sorted before the next insertion. An `O(n²)` time claim describes growth, not a guaranteed runtime in seconds. A new list copy would add `O(n)` auxiliary space. Record your assumptions: here the score is in tuple position 1 and lower scores come first.

#### Test ordering and stability

Use empty, one-item, already sorted, reverse sorted, repeated keys, and negative scores. To test stability, include two different names with equal scores and check that their relative order is unchanged. Also test more than ten records: a two-item sample often hides an off-by-one error.

**Common mistake:** calling `sorted()` in a task that explicitly asks for the sorting algorithm, or shifting on equality and accidentally reversing ties.

### 检查点

Read `n` lines in the form `label score`. Sort records by ascending integer score using insertion sort; preserve original input order for equal scores. Print only the labels, one per line. Do not call `sort()` or `sorted()`.

### 参考答案

```python
n = int(input())
rows = []
for _ in range(n):
    label, score = input().split()
    rows.append((label, int(score)))
for end in range(1, n):
    current = rows[end]
    position = end - 1
    while position >= 0 and rows[position][1] > current[1]:
        rows[position + 1] = rows[position]
        position -= 1
    rows[position + 1] = current
for label, _ in rows:
    print(label)
```

For `A 5`, `B 3`, `C 5`, the output order is `B`, `A`, `C`. Related practice: an optimized bubble sort and a stable insertion sort.

### 关联题目

[]

## 章节：04 Stacks

### 学习目标

Explain last-in-first-out behaviour; implement a bounded array-backed stack with a top pointer; handle overflow and underflow without corrupting state.

### 正文

#### State and invariants

A stack inserts and removes only at its top. In a fixed array of capacity `c`, let `top = -1` mean empty. Valid entries occupy indexes `0` through `top`. A push must check `top + 1 < c` **before** writing. A pop must check `top >= 0` **before** reading. If an operation fails, both pointer and contents should remain logically unchanged. Python's `list.append()` is useful in general programs, but it hides the array-backed implementation that this lesson practices.

```python
class BoundedStack:
    def __init__(self, capacity: int):
        self.data = [None] * capacity
        self.top = -1

    def push(self, value: str) -> bool:
        if self.top + 1 == len(self.data):
            return False
        self.top += 1
        self.data[self.top] = value
        return True

    def pop(self) -> str | None:
        if self.top == -1:
            return None
        value = self.data[self.top]
        self.data[self.top] = None
        self.top -= 1
        return value
```

The `None` in `pop` is an agreed empty result; it is not a real stack item in this example. A capacity-zero stack is always full and empty. A typical use is undo history: each accepted action is pushed; an undo removes the newest action. Nested brackets are another use: push opening symbols and match them against each closing symbol.

#### Test the transitions

Test push into empty; fill to capacity; attempt one extra push; pop all items; attempt one extra pop; then push again after emptying. Checking only the first push and pop misses stale-pointer errors. A stack is `O(1)` per push or pop and `O(c)` storage.

**Common mistake:** treating `top` as the next free position in one method and as the last occupied position in another. Choose one convention and keep it.

### 检查点

Build a stack of capacity 3. Process lines of `P value` (push) and `O` (pop), ending with `END`. For a full push print `FULL`; for an empty pop print `EMPTY`; for a successful pop print the removed value. Successful pushes print nothing. Implement the fixed array and top pointer explicitly.

### 参考答案

```python
items = [None] * 3
top = -1
while True:
    parts = input().split()
    if parts[0] == "END":
        break
    if parts[0] == "P":
        if top == 2:
            print("FULL")
        else:
            top += 1
            items[top] = parts[1]
    else:
        if top == -1:
            print("EMPTY")
        else:
            print(items[top])
            items[top] = None
            top -= 1
```

A useful sequence is `P A`, `P B`, `O`, `P C`, `P D`, `P E`, `O`, `END`; it tests reuse and overflow. Related practice: bounded undo and bracket matching.

### 关联题目

[]

## 章节：05 Queues and circular queues

### 学习目标

Model first-in-first-out service; implement a fixed-capacity circular queue; maintain head, tail and count through full, empty and wraparound transitions.

### 正文

#### A ring instead of shifting

A queue removes the oldest item first. Repeatedly shifting every array entry left after a removal takes `O(n)` time. A circular queue reuses array positions and performs enqueue and dequeue in `O(1)` time. One clear convention is: `head` points to the next item to remove; `tail` points to the next free position; `count` is the number of occupied positions. The queue is empty when `count == 0` and full when `count == capacity`. All occupied positions are reached by starting at `head` and advancing `count` times modulo capacity.

```python
class CircularQueue:
    def __init__(self, capacity: int):
        self.data = [None] * capacity
        self.head = self.tail = self.count = 0

    def enqueue(self, item: str) -> bool:
        if self.count == len(self.data):
            return False
        self.data[self.tail] = item
        self.tail = (self.tail + 1) % len(self.data)
        self.count += 1
        return True

    def dequeue(self) -> str | None:
        if self.count == 0:
            return None
        item = self.data[self.head]
        self.data[self.head] = None
        self.head = (self.head + 1) % len(self.data)
        self.count -= 1
        return item
```

With capacity 3: enqueue `A, B, C` yields a full queue; dequeue twice yields `A, B`; enqueue `D, E` wraps the tail to earlier indexes; dequeues now yield `C, D, E`. The code never divides by zero because a zero-capacity queue is full before the modulo operation. Some tasks use `head = tail = -1` when empty instead. That convention is also valid, but do not mix it with this one.

**Common mistake:** testing `head == tail` alone. In this convention that equality occurs both when empty and when full, so `count` distinguishes the states.

### 检查点

Implement a queue of capacity 3 using an array and modulo arithmetic. Read commands `E value`, `D`, and `END`. Print `FULL` for a rejected enqueue, `EMPTY` for a dequeue from an empty queue, or the removed value for a successful dequeue. Successful enqueues are silent. Demonstrate that positions are reused after a wraparound.

### 参考答案

```python
slots = [None] * 3
head = tail = count = 0
while True:
    parts = input().split()
    if parts[0] == "END":
        break
    if parts[0] == "E":
        if count == 3:
            print("FULL")
        else:
            slots[tail] = parts[1]
            tail = (tail + 1) % 3
            count += 1
    else:
        if count == 0:
            print("EMPTY")
        else:
            print(slots[head])
            slots[head] = None
            head = (head + 1) % 3
            count -= 1
```

Test `E A, E B, E C, D, D, E D, E E, D, D, D, D, END`. Related practice: overflow, wraparound and mixed service operations.

### 关联题目

[]

## 章节：06 Linked lists

### 学习目标

Represent a linked list with data and next-index arrays; traverse, insert and delete without breaking links; reuse released slots through a free list.

### 正文

#### Logical order differs from array order

A linked list stores each item with a link to its successor. The array position is not necessarily the item's logical position. With `head = 4`, `next[4] = 1`, and `next[1] = -1`, the list has two items even if other array slots contain old values. Always follow links from `head`; do not scan the entire array and treat every non-empty slot as a list member. A fixed-size implementation needs a free list so deleted nodes can be reused. Use `-1` as the null pointer; keep `head` and `free_head` separate.

```python
size = 4
data = [None] * size
next_index = list(range(1, size)) + [-1]
head = -1
free_head = 0
```

To allocate, take `free_head` and advance it along its link. To insert at the front, point the new node at the old `head`, then change `head`. To delete, save the removed node's successor, make either `head` or the predecessor link to that successor, and finally return the removed node to the free list. This order prevents losing the rest of the chain.

Searching requires `O(n)` time. Front insertion and deletion after a known predecessor are `O(1)`, but finding that predecessor is usually `O(n)`. Test deletion of the only item, the head, an interior item, the tail, a missing key and insertion after capacity is exhausted.

**Common mistake:** changing `head` before saving its old link, or forgetting to update the predecessor during deletion. Draw nodes and arrows for a three-item case before coding.

### 检查点

Implement a fixed four-slot integer linked list with commands `A value` to insert at the front, `R value` to remove the first matching value, and `END`. Print `FULL` for a failed insertion, `MISSING` for a failed removal, or `OK` for a successful removal. After `END`, print current values from head to tail on one line separated by spaces; print `EMPTY` if none. Deleted nodes must become available again.

### 参考答案

```python
capacity = 4
data = [None] * capacity
links = list(range(1, capacity)) + [-1]
head, free_head = -1, 0
while True:
    parts = input().split()
    if parts[0] == "END":
        break
    value = int(parts[1])
    if parts[0] == "A":
        if free_head == -1:
            print("FULL")
        else:
            node = free_head
            free_head = links[node]
            data[node] = value
            links[node] = head
            head = node
    else:
        previous, current = -1, head
        while current != -1 and data[current] != value:
            previous, current = current, links[current]
        if current == -1:
            print("MISSING")
        else:
            successor = links[current]
            if previous == -1:
                head = successor
            else:
                links[previous] = successor
            data[current] = None
            links[current] = free_head
            free_head = current
            print("OK")
output = []
current = head
while current != -1:
    output.append(str(data[current]))
    current = links[current]
print(" ".join(output) if output else "EMPTY")
```

Related practice: indexed-list search, head/tail deletion and a sorted linked list.

### 关联题目

[]

## 章节：07 Binary search trees

### 学习目标

Insert and find values in a binary search tree; describe the left/right ordering invariant, duplicate policy and effects of tree shape on performance.

### 正文

#### Maintain the tree invariant

For each node in a binary search tree (BST), values in the left subtree are smaller and values in the right subtree are larger. A duplicate policy must be explicit: this lesson counts duplicates in the existing node. An in-order traversal then visits values in ascending order. The time for search or insertion is `O(h)`, where `h` is tree height. A well-shaped tree may have `h = O(log n)`; inserting already sorted values into an unbalanced BST can create a chain with `h = O(n)`. A BST is not automatically a balanced tree.

```python
class Node:
    def __init__(self, value: int):
        self.value = value
        self.count = 1
        self.left = None
        self.right = None


def insert(root: Node | None, value: int) -> Node:
    if root is None:
        return Node(value)
    current = root
    while True:
        if value == current.value:
            current.count += 1
            break
        if value < current.value:
            if current.left is None:
                current.left = Node(value)
                break
            current = current.left
        else:
            if current.right is None:
                current.right = Node(value)
                break
            current = current.right
    return root
```

Start with `[8, 3, 10, 1, 6]`: 3 is to the left of 8; 6 is to the right of 3. A search for 6 compares 8, 3, then 6. A search for 7 ends at a missing child. Test an empty tree, repeated values, ascending insertion order and both left and right branches.

**Common mistake:** assuming that traversal of the backing array, or ordinary level order, is automatically sorted. In-order traversal means left subtree, node, right subtree.

### 检查点

Read `n` integers and build a BST that counts duplicates. Then read a target and print its count (`0` if absent). Implement explicit nodes and links; do not replace the tree with a dictionary. Test a repeated root value and an absent value.

### 参考答案

```python
class Node:
    def __init__(self, value):
        self.value = value
        self.count = 1
        self.left = self.right = None

root = None
n = int(input())
for _ in range(n):
    value = int(input())
    if root is None:
        root = Node(value)
        continue
    current = root
    while True:
        if value == current.value:
            current.count += 1
            break
        direction = "left" if value < current.value else "right"
        child = getattr(current, direction)
        if child is None:
            setattr(current, direction, Node(value))
            break
        current = child
target = int(input())
current = root
while current is not None and current.value != target:
    current = current.left if target < current.value else current.right
print(0 if current is None else current.count)
```

Related practice: BST insertion, lookup and a trace of height growth.

### 关联题目

[]

## 章节：08 Dictionaries, hashing and ADT composition

### 学习目标

Use a dictionary as a key-to-value ADT; explain collisions and a simple hash-table strategy; combine ADTs to solve a scenario; recognise graphs without writing graph algorithms.

### 正文

#### Choose operations before a structure

A dictionary supports operations such as insert/update by key, lookup by key and deletion by key. Python's `dict` supplies these operations, but a Paper 4 problem may ask you to implement the structure using arrays. A hash function turns a key into a candidate slot. Two different keys can share a slot; this is a **collision**, not proof that the keys are equal. Linear probing checks the next slot until it finds the key or an empty slot. With low occupancy, lookup may be near constant time on average; in a crowded table it can take `O(n)`. A deletion needs a tombstone or a rehash so later items in the probe chain remain findable.

For a service desk, a queue can preserve arrival order while a dictionary maps ticket ID to status. Use the queue to select the next ticket and the dictionary to answer fast status queries. The two structures solve different requirements; neither replaces the other. A stack of recent status changes can add undo. Write the operations first, then choose the collection of ADTs.

A graph represents vertices and relationships (edges), useful for routes or dependencies. The syllabus expects understanding of its features and appropriate uses, but **Paper 4 does not require graph code**. Do not turn a graph lecture into an extra mandatory graph-programming gate in this practical course.

**Common mistake:** assuming a hash value is a unique identifier, or removing a slot in an open-addressed table by making it empty and thereby hiding later colliding keys.

### 检查点

Maintain a first-in-first-out ticket queue and a status dictionary. Commands are `ADD id`, `DONE` and `STATUS id`, ending with `END`. IDs are unique on `ADD`. `DONE` prints the oldest waiting ID and marks it `done`; if none wait, print `EMPTY`. `STATUS` prints `waiting`, `done`, or `unknown`. Use two ADTs deliberately.

### 参考答案

```python
from collections import deque

waiting = deque()
status = {}
while True:
    parts = input().split()
    command = parts[0]
    if command == "END":
        break
    if command == "ADD":
        ticket_id = parts[1]
        waiting.append(ticket_id)
        status[ticket_id] = "waiting"
    elif command == "DONE":
        if not waiting:
            print("EMPTY")
        else:
            ticket_id = waiting.popleft()
            status[ticket_id] = "done"
            print(ticket_id)
    else:
        print(status.get(parts[1], "unknown"))
```

The built-in deque is appropriate here because this checkpoint assesses **composition**, not manual queue implementation. Related practice: hash collision tracing, dictionary lookup and queue-plus-dictionary workflow.

### 关联题目

[]

## 章节：09 Recursion and backtracking

### 学习目标

Identify a base case and a shrinking recursive step; trace calls and returns; use the call stack safely; apply simple backtracking when a choice must be explored and sometimes undone.

### 正文

#### A recurrence must progress

A recursive function solves a smaller instance of the same problem. Every possible path must reach a base case. For a non-negative integer `n`, `sum_to(n)` can return `0` at `n == 0` and otherwise return `n + sum_to(n - 1)`. Each recursive call needs a call frame holding its arguments, local variables and return point; compiled or interpreted execution creates these frames and removes them while unwinding. For `sum_to(3)`, the stack reaches `sum_to(0)` before returning `0, 1, 3, 6`. A missing base case eventually raises a recursion error. Very deep recursion also consumes `O(depth)` stack space, even when the body uses little data.

```python
def sum_to(n: int) -> int:
    if n == 0:
        return 0
    return n + sum_to(n - 1)
```

Backtracking explores alternatives, and returns to an earlier decision when one path fails. It is a useful extension of recursive reasoning, not a licence to try every combination when a direct algorithm exists. For positive activity durations and a target time, one branch includes the next duration and another skips it. If the running total exceeds the target, that branch can stop. Without this pruning, a worst case can visit about `2^n` combinations.

```python
def can_fill(durations: list[int], target: int, index: int = 0) -> bool:
    if target == 0:
        return True
    if target < 0 or index == len(durations):
        return False
    return (can_fill(durations, target - durations[index], index + 1)
            or can_fill(durations, target, index + 1))
```

The `target < 0` prune is valid only because all durations are positive. With negative values, it could incorrectly reject a solution. State assumptions before pruning. Test a solution using the first choice, a solution requiring a skipped choice, no solution, and target zero.

**Common mistake:** changing a shared list on the way down but failing to restore it on the way back. A pure function that passes the remaining target avoids that problem.

### 检查点

Read `n`, then `n` positive integer durations, then a target. Print `YES` if some subset totals exactly the target, otherwise `NO`. Use recursion with include/skip branches; do not use `itertools` or a built-in combinatorics routine. Explain why the negative-target prune is safe here.

### 参考答案

```python
def possible(values, index, remaining):
    if remaining == 0:
        return True
    if remaining < 0 or index == len(values):
        return False
    return (possible(values, index + 1, remaining - values[index])
            or possible(values, index + 1, remaining))

n = int(input())
values = [int(input()) for _ in range(n)]
target = int(input())
print("YES" if possible(values, 0, target) else "NO")
```

Because every value is positive, subtracting more values cannot repair a negative remainder. Related practice: recursion traces, tree traversal and bounded choice search.

### 关联题目

[]

## 章节：10 Procedural design and testing

### 学习目标

Decompose a scenario into procedures and functions with contracts; distinguish returned values from side effects; plan normal, abnormal and boundary tests; interpret failed tests precisely.

### 正文

#### Plan interfaces before writing main

A practical question may ask for several program elements before asking for a complete main routine. Treat each function as a contract: parameters and types, return value, state changes, and behaviour on invalid input. A good design separates parsing from calculation and printing. For a batch of event scores, `parse_score()` validates one token, `summarise()` calculates a total and count, and `main()` handles console I/O. This makes small stages independently testable.

```python
def parse_score(token: str) -> int | None:
    try:
        value = int(token)
    except ValueError:
        return None
    return value if 0 <= value <= 100 else None


def summarise(tokens: list[str]) -> tuple[int, int]:
    accepted = [value for token in tokens
                if (value := parse_score(token)) is not None]
    return sum(accepted), len(accepted)
```

Python passes object references to functions. Reassigning a parameter does not reassign the caller's variable, while mutating a passed list can affect the caller. If a task talks about *pass by value* or *pass by reference*, state clearly how the selected language represents the intended effect. Often returning the new value is simpler and less surprising than hidden mutation.

A test table should include normal, boundary and invalid inputs. For the code above, test `0`, `100`, `-1`, `101`, a non-integer token and an empty list. Predict each result before executing. If a result differs, find the **first** broken contract; do not patch output formatting to hide a logic error. For formal Paper 4 work, preserve enough source and run evidence for a teacher to assess both process and outcome.

**Common mistake:** one large function that reads input, changes globals, sorts, writes files and prints output. It is difficult to test one rule without running everything.

### 检查点

Write a function `summarise(tokens)` that accepts a list of strings and returns `(valid_count, valid_total, invalid_count)`. A valid token is an integer from 0 through 100 inclusive. Then read `n` followed by `n` tokens, one per line, and print the three values separated by spaces. Include boundary and malformed-token tests.

### 参考答案

```python
def summarise(tokens):
    valid_count = valid_total = invalid_count = 0
    for token in tokens:
        try:
            score = int(token)
        except ValueError:
            invalid_count += 1
            continue
        if not 0 <= score <= 100:
            invalid_count += 1
            continue
        valid_count += 1
        valid_total += score
    return valid_count, valid_total, invalid_count

n = int(input())
tokens = [input().strip() for _ in range(n)]
print(*summarise(tokens))
```

The function does not print or mutate its argument; the main routine owns I/O. Related practice: modular records processing and a written test plan.

### 关联题目

[]

## 章节：11 Classes and encapsulation

### 学习目标

Design a class with state, constructor and methods; distinguish a class from an instance; enforce an invariant through controlled operations and getters.

### 正文

#### Bundle data with behaviour

A class describes an object; an instance is one created object. An attribute stores state, and a method acts on it. For a wallet, the invariant is `balance >= 0`. A constructor establishes that invariant. Deposit and spend methods preserve it. Code outside the class should not directly set a negative balance. In Python, a leading underscore signals an internal attribute by convention; it is not a security boundary. Use a read-only property or explicit getter to expose what callers need.

```python
class CreditWallet:
    def __init__(self, owner: str, balance: int = 0):
        if balance < 0:
            raise ValueError("negative balance")
        self.owner = owner
        self._balance = balance

    @property
    def balance(self) -> int:
        return self._balance

    def deposit(self, amount: int) -> bool:
        if amount <= 0:
            return False
        self._balance += amount
        return True

    def spend(self, amount: int) -> bool:
        if amount <= 0 or amount > self._balance:
            return False
        self._balance -= amount
        return True
```

Two wallet instances have separate balances. A method call receives the intended instance as `self`; forgetting it in a method definition or call is a frequent error. OOP terminology also includes setter, encapsulation and attribute. A setter is useful when an attribute may change but requires validation. Do not write a setter that bypasses the very invariant you intended to protect.

Test constructor rejection, a deposit of zero, spending exactly the balance, overspending and independence between two instances. Output-only tests can confirm behaviour, while a teacher may inspect source to verify the requested class design.

**Common mistake:** storing all balances in one global variable and creating several nominal "objects" that actually share the same state.

### 检查点

Implement `StockItem(code, quantity)` with non-negative initial quantity; `add(amount)` and `take(amount)` return booleans and preserve non-negative quantity. Provide a read-only `quantity` property. Read `code initial`, then commands `ADD k`, `TAKE k`, `SHOW`, ending with `END`. Print `OK`/`REJECTED` for changes and the current quantity for `SHOW`.

### 参考答案

```python
class StockItem:
    def __init__(self, code, quantity):
        if quantity < 0:
            raise ValueError("negative quantity")
        self.code = code
        self._quantity = quantity

    @property
    def quantity(self):
        return self._quantity

    def add(self, amount):
        if amount <= 0:
            return False
        self._quantity += amount
        return True

    def take(self, amount):
        if amount <= 0 or amount > self._quantity:
            return False
        self._quantity -= amount
        return True

code, initial = input().split()
item = StockItem(code, int(initial))
while True:
    parts = input().split()
    if parts[0] == "END":
        break
    if parts[0] == "SHOW":
        print(item.quantity)
    else:
        result = item.add(int(parts[1])) if parts[0] == "ADD" else item.take(int(parts[1]))
        print("OK" if result else "REJECTED")
```

Related practice: constructors, validation, instance independence and getter/setter design.

### 关联题目

[]

## 章节：12 Inheritance, polymorphism and aggregation

### 学习目标

Distinguish an `is-a` inheritance relationship from a `has-a` aggregation relationship; override methods for polymorphic behaviour; use instances through a shared interface.

### 正文

#### Model relationships intentionally

Inheritance expresses a specialised type: `PriorityJob` **is a** `Job`. Aggregation expresses ownership or use: a `DispatchBoard` **has a** collection of jobs. Polymorphism means a call such as `job.cost()` can behave differently for different subclasses while the caller uses the same interface. An instance is an individual object; a class is its blueprint. A child should inherit behaviour only when the relationship and contract remain meaningful. Otherwise, place one object inside another.

```python
class Job:
    def __init__(self, minutes: int):
        self.minutes = minutes

    def cost(self) -> int:
        return self.minutes * 2

class PriorityJob(Job):
    def cost(self) -> int:
        return super().cost() + 5

class DispatchBoard:
    def __init__(self):
        self.jobs: list[Job] = []

    def add(self, job: Job) -> None:
        self.jobs.append(job)

    def total_cost(self) -> int:
        return sum(job.cost() for job in self.jobs)
```

`DispatchBoard` does not need to ask whether each job is priority; dynamic method dispatch selects the correct `cost`. This makes it easier to add another valid job type. The board is not a kind of job, so making it a subclass would be a design mistake. Encapsulation still matters: avoid changing job internals without their methods.

Test a base job, a priority job, a mixed board, an empty board and a boundary minute value. A teacher should inspect source if the task specifically awards marks for inheritance, overridden methods or aggregation; the total alone cannot prove how it was computed.

**Common mistake:** adding a `type` string and a large `if/elif` chain when the task explicitly asks for polymorphism, or making every class a subclass despite no genuine `is-a` relation.

### 检查点

Create `Delivery(weight)` whose `fee()` is `3 * weight`, and `ExpressDelivery(weight)` whose fee adds 7 to the base fee. Create a `Manifest` that aggregates deliveries and returns their combined fee. Read `n` lines of `S weight` or `E weight`; print the total fee. Use method overriding, `super()` and a common list of delivery objects.

### 参考答案

```python
class Delivery:
    def __init__(self, weight):
        self.weight = weight

    def fee(self):
        return 3 * self.weight

class ExpressDelivery(Delivery):
    def fee(self):
        return super().fee() + 7

class Manifest:
    def __init__(self):
        self.deliveries = []

    def add(self, delivery):
        self.deliveries.append(delivery)

    def total(self):
        return sum(delivery.fee() for delivery in self.deliveries)

manifest = Manifest()
for _ in range(int(input())):
    kind, weight = input().split()
    delivery_type = ExpressDelivery if kind == "E" else Delivery
    manifest.add(delivery_type(int(weight)))
print(manifest.total())
```

Related practice: class hierarchy, overridden methods and a container object.

### 关联题目

[]

## 章节：13 Text files and records

### 学习目标

Open, read, write, append and close text files; parse records reliably; distinguish serial and key-ordered sequential processing; test empty and malformed files.

### 正文

#### Records are more than lines

A record is a group of fields describing one item, such as `ticket_id|owner|minutes`. A text file stores characters; your program gives those characters record meaning. A serial file places records in arrival order. A sequential file is maintained in key order. To look up a key in a serial file, read records until you find it or reach the end; a sorted sequential file allows ordered processing, though a plain text stream still must be read in file order. State the delimiter and escaping rule. The simple example below prohibits `|` inside fields.

```python
def parse_record(line: str) -> tuple[str, str, int]:
    parts = line.rstrip("\n").split("|")
    if len(parts) != 3:
        raise ValueError("expected three fields")
    ticket_id, owner, raw_minutes = parts
    minutes = int(raw_minutes)
    if not ticket_id or not owner or minutes < 0:
        raise ValueError("invalid record")
    return ticket_id, owner, minutes


def read_records(path: str) -> list[tuple[str, str, int]]:
    with open(path, "r", encoding="utf-8") as source:
        return [parse_record(line) for line in source if line.strip()]


def append_record(path: str, record: tuple[str, str, int]) -> None:
    with open(path, "a", encoding="utf-8") as destination:
        destination.write(f"{record[0]}|{record[1]}|{record[2]}\n")
```

`with` closes a file even when an error occurs. Use `"w"` only when overwriting is intended; it truncates an existing file. Use `"a"` for an append. Check a blank file, missing file, blank lines, malformed fields, duplicate IDs and trailing newline. Decide explicitly whether malformed records reject the whole file or are counted and skipped.

In this OJ, console-input fixtures can test the parsing and record logic, but they do **not by themselves prove** that a submission opened a real file correctly. The Paper 4 workspace may provide work files for practice; a teacher must inspect source and run evidence for file-operation requirements. Do not assume a private external file exists in the judge. Official source files for Paper 4 are text, not binary.

**Common mistake:** writing output into the same path opened in write mode before reading the old contents; the original contents are lost immediately.

### 检查点

Treat each of `n` console lines as one line from a text file, with `ticket_id|owner|minutes`. Count valid records and sum their minutes. An invalid field count, empty ID/owner or negative/non-integer minutes makes the record invalid. Print `valid_count total_minutes invalid_count`. The parser should be a separate function taking one line. This deterministic console fixture tests parsing; inspect actual file I/O separately.

### 参考答案

```python
def parse(line):
    fields = line.split("|")
    if len(fields) != 3 or not fields[0] or not fields[1]:
        raise ValueError("bad fields")
    minutes = int(fields[2])
    if minutes < 0:
        raise ValueError("negative minutes")
    return fields[0], fields[1], minutes

valid_count = total = invalid_count = 0
for _ in range(int(input())):
    line = input()
    try:
        record = parse(line)
    except ValueError:
        invalid_count += 1
    else:
        valid_count += 1
        total += record[2]
print(valid_count, total, invalid_count)
```

For a true file task, replace the console loop with `with open(path, "r", encoding="utf-8") as source:` and iterate over `source`, then save output using the required mode. Related practice: record parsing, append logs and ordered-file merging.

### 关联题目

[]

## 章节：14 Simulated random access files

### 学习目标

Explain why a sequential text scan differs from indexed lookup; implement a hash-based fixed array index with collision handling; use text records to simulate random access without binary files.

### 正文

#### What Paper 4 means by random-file practice

The [Cambridge clarification for Paper 4](https://help.cambridgeinternational.org/hc/en-gb/articles/22579694713106-Are-candidates-expected-to-able-to-write-code-for-and-use-random-files-on-Paper-4-programming-practical) says supplied source files are `.txt`, not binary. Candidates may simulate random-file access by hashing keys and using another data structure. Do **not** assume the examiner supplies a binary database. A program can read text records once, insert them into an array-backed index and then perform repeated key lookups by calculated slot. The text file itself remains a serial input; the in-memory index provides the simulated direct access.

For a table of size `m`, a simple educational hash is `sum(ord(character) for character in key) % m`. This is not a secure hash and deliberately permits collisions. On collision, probe the next slot, wrapping with modulo `m`. Stop after at most `m` probes so a full table cannot cause an infinite loop. For existing keys, update the associated record rather than creating duplicates. If deletion is required, a tombstone is needed; this lesson's checkpoint intentionally has no delete operation.

```python
def slot_for(key: str, size: int) -> int:
    return sum(ord(character) for character in key) % size


def find(table: list[tuple[str, str] | None], key: str) -> str | None:
    start = slot_for(key, len(table))
    for offset in range(len(table)):
        entry = table[(start + offset) % len(table)]
        if entry is None:
            return None
        if entry[0] == key:
            return entry[1]
    return None
```

A collision test is essential: choose two keys with the same initial slot and verify both remain findable. Also test a missing key, wraparound, an update, and a full table. With few collisions lookup is often fast, but worst-case lookup is `O(m)`. Do not call this a guarantee of constant time.

The OJ can validate the hash-index behaviour with text records provided through standard input. It cannot prove physical file access merely from final output; a teacher should inspect the submitted source and evidence when file processing itself is part of the task.

### 检查点

Use a table with exactly 7 slots. Read `n` `key|value` records, then `q` query keys. Insert with the character-sum hash and linear probing; later records with an existing key replace its value. Assume there are at most 7 **distinct** keys. For each query print the value or `MISSING`. Do not use Python `dict` as the index.

### 参考答案

```python
SIZE = 7
slots = [None] * SIZE

def start(key):
    return sum(ord(character) for character in key) % SIZE

def put(key, value):
    for offset in range(SIZE):
        position = (start(key) + offset) % SIZE
        if slots[position] is None or slots[position][0] == key:
            slots[position] = (key, value)
            return
    raise ValueError("table full")

def get(key):
    for offset in range(SIZE):
        position = (start(key) + offset) % SIZE
        item = slots[position]
        if item is None:
            return "MISSING"
        if item[0] == key:
            return item[1]
    return "MISSING"

for _ in range(int(input())):
    key, value = input().split("|", 1)
    put(key, value)
for _ in range(int(input())):
    print(get(input()))
```

Related practice: collision chains, simulated direct-access records and source-file ingestion.

### 关联题目

[]

## 章节：15 Exceptions and defensive programming

### 学习目标

Recognise exceptional conditions; catch specific errors at the appropriate boundary; preserve valid state after a failure; distinguish an expected invalid record from an unexpected programming fault.

### 正文

#### Catch the error you can handle

An exception interrupts normal control flow. File input may fail because a path does not exist; numeric conversion may fail because a record is malformed. A well-designed program catches those conditions where it can give a meaningful response, and lets unrelated bugs remain visible for correction. Avoid `except:` or `except Exception:` around the entire program. Such broad handlers can hide a misspelled variable or a broken invariant and produce a misleading `INVALID` result.

```python
def read_non_negative_minutes(token: str) -> int:
    value = int(token)  # May raise ValueError.
    if value < 0:
        raise ValueError("minutes must be non-negative")
    return value


def load_minutes(path: str) -> tuple[list[int], int]:
    accepted = []
    rejected = 0
    try:
        with open(path, "r", encoding="utf-8") as source:
            for line in source:
                try:
                    accepted.append(read_non_negative_minutes(line.strip()))
                except ValueError:
                    rejected += 1
    except FileNotFoundError:
        return [], -1
    return accepted, rejected
```

The outer handler is for missing files; the inner handler is for a bad line. If the specification requires all-or-nothing ingestion, do not silently skip bad lines—parse into temporary state first and commit only after all lines pass. `else` after a `try` runs on success; `finally` is for cleanup regardless of success. A `with` block handles normal file closing without explicit `finally`.

In an OJ, an unexpected error may surface as a runtime error rather than a wrong answer. Read the exact failing input and traceback; then fix the cause. Your tests should include missing/empty data, a boundary valid value, malformed numeric text and state after a rejected operation.

**Common mistake:** catching `ValueError` but leaving a partially updated total or pointer. Validate first, mutate second.

### 检查点

Read `n` lines representing non-negative integer minutes. Print their accepted sum and invalid count. If a line is blank, non-integer or negative, count it as invalid and continue. Write a separate parsing function that raises `ValueError`, and catch only that error in the loop. The sum must not change for a rejected line.

### 参考答案

```python
def parse_minutes(text):
    value = int(text.strip())
    if value < 0:
        raise ValueError("negative")
    return value

total = invalid = 0
for _ in range(int(input())):
    raw = input()
    try:
        value = parse_minutes(raw)
    except ValueError:
        invalid += 1
    else:
        total += value
print(total, invalid)
```

Test lines `0`, `5`, `-2`, `not-a-number` and blank text. Related practice: malformed records, missing files and safe transaction-like updates.

### 关联题目

[]

## 章节：16 Integrated practical projects and mock exam practice

### 学习目标

Combine data structures, algorithms, OOP, text records and defensive code in a coherent solution; plan and review source plus run evidence; rehearse a 150-minute scenario without misleading claims about official assessment.

### 正文

#### Build from subproblems, not from a single giant function

An original *community workshop scheduler* can use a queue for unprocessed bookings, a dictionary for booking status, insertion sort for a printable order, a class hierarchy for standard and priority bookings, and text records for saving results. Sketch each interface before implementation: `parse_booking(line)`, `enqueue_booking(booking)`, `next_booking()`, `list_by_time()`, and `save_report(path)`. Decide how duplicate IDs, invalid times, full capacity and missing files behave. State which requirements a judge can verify from output and which require source inspection. For example, an identical report can be produced without inheritance, so a teacher must inspect the class design if inheritance is explicitly assessed.

A second original scenario, a *museum inventory audit*, can use a BST for item-code lookup, a stack for undo, a text import log, and exception handling for corrupt records. Keep the project small enough that every feature can be tested independently. Do not add complexity merely to use every syllabus word; a correct and understandable design is better than forced abstractions.

#### Rehearse under Paper 4 conditions

The official practical paper is 150 minutes and 75 marks, but this course's mock marks are **school practice marks**, not Cambridge grades. A useful rehearsal plan is 15 minutes reading and contracts, 95 minutes incremental coding, 25 minutes normal/boundary testing, and 15 minutes organising source and result evidence. Save after each working stage; test the integration again after a late edit. In the official setting internet and email are unavailable, so practice with only language-standard tools and the provided text source files. Do not bring a prewritten solution into a mock intended to simulate the exam.

Use a final verification table:

| Requirement | Source location | Test input | Expected | Observed | Evidence saved? |
| --- | --- | --- | --- | --- | --- |
| Duplicate key update | index insertion | two equal IDs | latest record wins | record result | yes/no |
| Empty queue | dequeue | no bookings | `EMPTY` | run result | yes/no |
| Missing source | file loader | absent path | documented error | run result | yes/no |

A passing public test is only one observation. Run hidden-style edge cases yourself. After a formal submission, review failed stages, repair only the relevant contract and resubmit; preserve evidence of the successful final version. Where the OJ supports teacher-awarded stages, the teacher may inspect code, comments, test plan and work files before giving those marks.

**Common mistake:** spending all available time writing code and leaving no time to run the final version or save evidence. The final source file must be the version whose output you recorded.

### 检查点

For the workshop scheduler, write a compact design before coding: identify five program elements with parameters and return values, define behaviour for a duplicate booking ID and an empty queue, and give at least six tests spanning normal, boundary and abnormal cases. Then implement one complete element and test it separately. The associated integrated practice problems supply runnable scenarios; this design checkpoint is reviewed by a teacher.

### 参考答案

One sound design is: `parse_booking(line) -> Booking` (raises `ValueError` for invalid fields); `add_booking(queue, status, booking) -> bool` (rejects an existing ID before changing either structure); `serve_next(queue, status) -> Booking | None`; `ordered_report(bookings) -> list[str]` (stable order by start time); and `write_report(path, lines) -> None` (writes UTF-8 text). A valid duplicate policy is to **reject** the new booking and preserve the existing one; a valid empty-queue result is `None`, translated to `EMPTY` only by the console layer. Tests should include one booking, an empty queue, a duplicate ID, equal start times, full queue capacity if bounded, malformed minutes, a missing text file, and a correct read/write round trip. The exact implementation may vary as long as the contracts, data structure invariants and evidence agree.

### 关联题目

[]

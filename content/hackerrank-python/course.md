---
format: codemaster-learning-path
version: 1
title: Python 专项训练 · HackerRank 全目录学习路线
description: 按 HackerRank Python 公开目录组织的 17 章学习路线，完整覆盖核验当天列出的 115 个练习入口。目录保留原题链接，课程讲解独立编写。
category: Python · 专项训练
estimatedMinutes: 3600
difficulty: intermediate
coverKey: python
---

# Python 专项训练 · HackerRank 全目录学习路线

## 章节：01. 基础输入、条件与循环 · Introduction

### 学习目标

练习输入输出、数值运算、分支、循环与函数边界。

### 正文

#### 把输入协议写清楚

input() 返回字符串，int() 和 float() 执行显式转换。多行输入应先确定行数，不能依赖交互提示。条件分支要覆盖互斥区间；循环的停止位置和空结果应单独检查。函数的返回值与打印输出是不同的接口。先写两组三行以内的小输入，再比较结果和格式。

下面是独立的概念示例，不是本章练习的参考答案。

```python
values = list(map(int, input().split()))
total = 0
for value in values:
    if value > 0:
        total += value
print(total)
```

**自测重点：**检查零值、负数、循环次数为零以及边界值。

本章包含 **7** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 01-01 | [Say "Hello, World!" With Python](https://www.hackerrank.com/challenges/py-hello-world/problem) | Easy |
| 01-02 | [Python If-Else](https://www.hackerrank.com/challenges/py-if-else/problem) | Easy |
| 01-03 | [Arithmetic Operators](https://www.hackerrank.com/challenges/python-arithmetic-operators/problem) | Easy |
| 01-04 | [Python: Division](https://www.hackerrank.com/challenges/python-division/problem) | Easy |
| 01-05 | [Loops](https://www.hackerrank.com/challenges/python-loops/problem) | Easy |
| 01-06 | [Write a function](https://www.hackerrank.com/challenges/write-a-function/problem) | Medium |
| 01-07 | [Print Function](https://www.hackerrank.com/challenges/python-print/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：02. 列表、元组与嵌套数据 · Basic Data Types

### 学习目标

理解可变容器、嵌套结构、排序、聚合与去重。

### 正文

#### 区分对象、顺序与别名

列表保持顺序且可修改，元组适合固定结构；嵌套容器需要逐层理解。sorted() 创建新列表，list.sort() 修改原对象。并列排名必须明确先去重还是先排序；均值和显示的小数位数分别属于计算规则和输出规则。复制外层列表不等于复制所有内层对象。

下面是独立的概念示例，不是本章练习的参考答案。

```python
records = [("Eli", 14), ("Mina", 14), ("Jo", 9)]
ordered = sorted(records, key=lambda row: (-row[1], row[0]))
for name, points in ordered:
    print(name, points)
```

**自测重点：**检查重复最大值、并列值、只有一个不同值以及含空格的字段。

本章包含 **6** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 02-01 | [List Comprehensions](https://www.hackerrank.com/challenges/list-comprehensions/problem) | Easy |
| 02-02 | [Find the Runner-Up Score!](https://www.hackerrank.com/challenges/find-second-maximum-number-in-a-list/problem) | Easy |
| 02-03 | [Nested Lists](https://www.hackerrank.com/challenges/nested-list/problem) | Easy |
| 02-04 | [Finding the percentage](https://www.hackerrank.com/challenges/finding-the-percentage/problem) | Easy |
| 02-05 | [Lists](https://www.hackerrank.com/challenges/python-lists/problem) | Easy |
| 02-06 | [Tuples](https://www.hackerrank.com/challenges/python-tuples/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：03. 字符串与文本布局 · Strings

### 学习目标

熟悉字符串遍历、切片、查找、格式化与稳定的空白输出。

### 正文

#### 字符串处理也有数据协议

字符串不可原地修改。切片、join()、split() 和格式化可组合使用，但会改变空白结构的操作不能随意替换。查找子串时应区分允许重叠与不允许重叠。文本图案通常适合先推导单行宽度，再决定填充字符和对齐方式。

下面是独立的概念示例，不是本章练习的参考答案。

```python
message = "red|green|blue"
parts = message.split("|")
print(" / ".join(part.upper() for part in parts))
print(f"{len(parts):04d}")
```

**自测重点：**检查空白、大小写、重复字符、图案最小尺寸和最后一列。

本章包含 **14** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 03-01 | [sWAP cASE](https://www.hackerrank.com/challenges/swap-case/problem) | Easy |
| 03-02 | [String Split and Join](https://www.hackerrank.com/challenges/python-string-split-and-join/problem) | Easy |
| 03-03 | [What's Your Name?](https://www.hackerrank.com/challenges/whats-your-name/problem) | Easy |
| 03-04 | [Mutations](https://www.hackerrank.com/challenges/python-mutations/problem) | Easy |
| 03-05 | [Find a string](https://www.hackerrank.com/challenges/find-a-string/problem) | Easy |
| 03-06 | [String Validators](https://www.hackerrank.com/challenges/string-validators/problem) | Easy |
| 03-07 | [Text Alignment](https://www.hackerrank.com/challenges/text-alignment/problem) | Easy |
| 03-08 | [Text Wrap](https://www.hackerrank.com/challenges/text-wrap/problem) | Easy |
| 03-09 | [Designer Door Mat](https://www.hackerrank.com/challenges/designer-door-mat/problem) | Easy |
| 03-10 | [String Formatting](https://www.hackerrank.com/challenges/python-string-formatting/problem) | Easy |
| 03-11 | [Alphabet Rangoli](https://www.hackerrank.com/challenges/alphabet-rangoli/problem) | Easy |
| 03-12 | [Capitalize!](https://www.hackerrank.com/challenges/capitalize/problem) | Easy |
| 03-13 | [The Minion Game](https://www.hackerrank.com/challenges/the-minion-game/problem) | Medium |
| 03-14 | [Merge the Tools!](https://www.hackerrank.com/challenges/merge-the-tools/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：04. 集合与关系判断 · Sets

### 学习目标

运用集合代数、成员关系、去重及子集判断解决问题。

### 正文

#### 先定义集合再判断关系

集合只保存不同的元素，不承诺输出顺序。交、并、差与对称差分别回答不同问题。用于输出时应显式排序；用于集合比较时应区分非严格子集与真子集。remove() 对不存在元素报错，discard() 则不会。若任务使用 pop()，必须给出确定规则或避免依赖被弹出的具体值。

下面是独立的概念示例，不是本章练习的参考答案。

```python
first = {2, 4, 6}
second = {4, 7}
print(sorted(first & second))
print(sorted(first - second))
print(first <= second)
```

**自测重点：**检查相同集合、空交集、重复输入以及不存在元素的删除。

本章包含 **13** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 04-01 | [Introduction to Sets](https://www.hackerrank.com/challenges/py-introduction-to-sets/problem) | Easy |
| 04-02 | [No Idea!](https://www.hackerrank.com/challenges/no-idea/problem) | Medium |
| 04-03 | [Symmetric Difference](https://www.hackerrank.com/challenges/symmetric-difference/problem) | Easy |
| 04-04 | [Set .add()](https://www.hackerrank.com/challenges/py-set-add/problem) | Easy |
| 04-05 | [Set .discard(), .remove() & .pop()](https://www.hackerrank.com/challenges/py-set-discard-remove-pop/problem) | Easy |
| 04-06 | [Set .union() Operation](https://www.hackerrank.com/challenges/py-set-union/problem) | Easy |
| 04-07 | [Set .intersection() Operation](https://www.hackerrank.com/challenges/py-set-intersection-operation/problem) | Easy |
| 04-08 | [Set .difference() Operation](https://www.hackerrank.com/challenges/py-set-difference-operation/problem) | Easy |
| 04-09 | [Set .symmetric_difference() Operation](https://www.hackerrank.com/challenges/py-set-symmetric-difference-operation/problem) | Easy |
| 04-10 | [Set Mutations](https://www.hackerrank.com/challenges/py-set-mutations/problem) | Easy |
| 04-11 | [The Captain's Room](https://www.hackerrank.com/challenges/py-the-captains-room/problem) | Easy |
| 04-12 | [Check Subset](https://www.hackerrank.com/challenges/py-check-subset/problem) | Easy |
| 04-13 | [Check Strict Superset](https://www.hackerrank.com/challenges/py-check-strict-superset/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：05. 数值计算与数学模式 · Math

### 学习目标

练习复数、几何、整除、模运算、大整数和数列图案。

### 正文

#### 计算正确之后再考虑显示

整除和余数在负数输入时也应按 Python 规则理解。大整数可以直接计算，但输出规模仍可能很大。几何计算要明确角度还是弧度、坐标顺序和退化图形处理。浮点比较应使用规定精度，输出时统一格式，避免依赖默认字符串表示。

下面是独立的概念示例，不是本章练习的参考答案。

```python
import math

x, y = 5, 12
length = math.hypot(x, y)
angle = math.degrees(math.atan2(y, x))
print(f"{length:.3f}")
print(f"{angle:.3f}")
```

**自测重点：**检查负数整除、模数边界、零向量及浮点舍入。

本章包含 **7** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 05-01 | [Polar Coordinates](https://www.hackerrank.com/challenges/polar-coordinates/problem) | Easy |
| 05-02 | [Find Angle MBC](https://www.hackerrank.com/challenges/find-angle/problem) | Medium |
| 05-03 | [Triangle Quest 2](https://www.hackerrank.com/challenges/triangle-quest-2/problem) | Medium |
| 05-04 | [Mod Divmod](https://www.hackerrank.com/challenges/python-mod-divmod/problem) | Easy |
| 05-05 | [Power - Mod Power](https://www.hackerrank.com/challenges/python-power-mod-power/problem) | Easy |
| 05-06 | [Integers Come In All Sizes](https://www.hackerrank.com/challenges/python-integers-come-in-all-sizes/problem) | Easy |
| 05-07 | [Triangle Quest](https://www.hackerrank.com/challenges/python-quest-1/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：06. 迭代工具与组合枚举 · Itertools

### 学习目标

掌握积、排列、组合、分组、枚举和组合优化。

### 正文

#### 把枚举空间当成输入的一部分

排列考虑位置顺序，组合忽略位置顺序，允许重复的组合又是另一种模型。itertools 通常惰性地产生结果，但把结果转换为 list 会占用相应内存。对组合优化问题，先估计候选数量，再选择枚举、状态集合或动态规划。groupby() 只合并相邻分组。

下面是独立的概念示例，不是本章练习的参考答案。

```python
from itertools import product, combinations

print(list(product("AB", range(2))))
print(list(combinations([2, 5, 9], 2)))
```

**自测重点：**检查 k 为零、重复元素、顺序要求和乘积空间过大。

本章包含 **7** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 06-01 | [itertools.product()](https://www.hackerrank.com/challenges/itertools-product/problem) | Easy |
| 06-02 | [itertools.permutations()](https://www.hackerrank.com/challenges/itertools-permutations/problem) | Easy |
| 06-03 | [itertools.combinations()](https://www.hackerrank.com/challenges/itertools-combinations/problem) | Easy |
| 06-04 | [itertools.combinations_with_replacement()](https://www.hackerrank.com/challenges/itertools-combinations-with-replacement/problem) | Easy |
| 06-05 | [Compress the String!](https://www.hackerrank.com/challenges/compress-the-string/problem) | Medium |
| 06-06 | [Iterables and Iterators](https://www.hackerrank.com/challenges/iterables-and-iterators/problem) | Medium |
| 06-07 | [Maximize It!](https://www.hackerrank.com/challenges/maximize-it/problem) | Hard |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：07. 计数与专用容器 · Collections

### 学习目标

使用 Counter、defaultdict、namedtuple、OrderedDict 和 deque。

### 正文

#### 选择合适的数据结构

Counter 表示频次，defaultdict 适合建立分组索引，deque 支持两端操作，namedtuple 为字段提供名字。字典保持插入顺序，但排序后的顺序需要另行构造。涉及收入、频次或前几名时，要明确缺货、同分和名称排序规则。

下面是独立的概念示例，不是本章练习的参考答案。

```python
from collections import Counter, defaultdict

words = ["lake", "tree", "lake"]
counts = Counter(words)
positions = defaultdict(list)
for index, word in enumerate(words):
    positions[word].append(index)
print(counts["lake"])
print(positions["lake"])
```

**自测重点：**检查未知键、重复项目、计数归零以及空队列操作。

本章包含 **8** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 07-01 | [collections.Counter()](https://www.hackerrank.com/challenges/collections-counter/problem) | Easy |
| 07-02 | [DefaultDict Tutorial](https://www.hackerrank.com/challenges/defaultdict-tutorial/problem) | Easy |
| 07-03 | [Collections.namedtuple()](https://www.hackerrank.com/challenges/py-collections-namedtuple/problem) | Easy |
| 07-04 | [Collections.OrderedDict()](https://www.hackerrank.com/challenges/py-collections-ordereddict/problem) | Easy |
| 07-05 | [Word Order](https://www.hackerrank.com/challenges/word-order/problem) | Medium |
| 07-06 | [Collections.deque()](https://www.hackerrank.com/challenges/py-collections-deque/problem) | Easy |
| 07-07 | [Company Logo](https://www.hackerrank.com/challenges/most-commons/problem) | Medium |
| 07-08 | [Piling Up!](https://www.hackerrank.com/challenges/piling-up/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：08. 日期与时区 · Date and Time

### 学习目标

正确解析日期、星期和带时区的时间差。

### 正文

#### 日期不是普通整数

使用 datetime.strptime() 解析明确格式。带时区的时间应保留时区信息再相减，不能只比较显示的小时数字。星期编号与名称之间应使用明确映射。计算跨月、跨年或闰年的差值时，让日期库承担日历规则，不要手写固定月份长度。

下面是独立的概念示例，不是本章练习的参考答案。

```python
from datetime import datetime, timezone

start = datetime(2024, 2, 28, tzinfo=timezone.utc)
end = datetime(2024, 3, 1, tzinfo=timezone.utc)
print(int((end - start).total_seconds()))
```

**自测重点：**检查闰日、跨年、同一时刻的不同偏移和负时间差。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 08-01 | [Calendar Module](https://www.hackerrank.com/challenges/calendar-module/problem) | Easy |
| 08-02 | [Time Delta](https://www.hackerrank.com/challenges/python-time-delta/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：09. 异常与错误恢复 · Errors and Exceptions

### 学习目标

区分输入错误、转换错误、运算错误和无效正则表达式。

### 正文

#### 把恢复范围限制在可能失败的操作

异常是控制流的一部分，但不能用 except Exception 掩盖所有逻辑错误。先区分转换失败和运算失败，再决定如何继续处理后续输入。验证正则表达式应捕获 re.error。错误消息是否参与评测必须在具体题目的输出规范中确定。

下面是独立的概念示例，不是本章练习的参考答案。

```python
def divide(text_a, text_b):
    try:
        a, b = int(text_a), int(text_b)
        return str(a // b)
    except ValueError:
        return "INVALID_INTEGER"
    except ZeroDivisionError:
        return "ZERO_DIVISOR"

print(divide("12", "0"))
```

**自测重点：**检查连续多组错误、空字符串、除数为零和无效正则语法。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 09-01 | [Exceptions](https://www.hackerrank.com/challenges/exceptions/problem) | Easy |
| 09-02 | [Incorrect Regex](https://www.hackerrank.com/challenges/incorrect-regex/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：10. 类与向量几何 · Classes

### 学习目标

用类组织复数、向量运算与几何计算，关注接口和数值边界。

### 正文

#### 用类表达接口与不变量

类应明确保存哪些字段、哪些方法返回新对象、哪些方法修改自身。复数和向量运算适合拆成小方法，并对除零与零长度向量作明确处理。表示层负责格式化，计算层尽量返回数字，避免把字符串计算与数值计算混在一起。

下面是独立的概念示例，不是本章练习的参考答案。

```python
class Point:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def shifted(self, dx, dy):
        return Point(self.x + dx, self.y + dy)

p = Point(2, 3).shifted(-1, 4)
print(p.x, p.y)
```

**自测重点：**检查对象之间是否意外共享状态，以及方法是否修改输入对象。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 10-01 | [Classes: Dealing with Complex Numbers](https://www.hackerrank.com/challenges/class-1-dealing-with-complex-numbers/problem) | Medium |
| 10-02 | [Class 2 - Find the Torsional Angle](https://www.hackerrank.com/challenges/class-2-find-the-torsional-angle/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：11. 内置函数与自定义排序 · Built-Ins

### 学习目标

练习 zip、any、all、表达式处理与稳定排序。

### 正文

#### 先理解函数契约再组合使用

zip() 默认在最短输入处停止，any() 判断至少一个条件，all() 判断所有条件；它们对空序列的行为不同。排序的 key 函数应直接表达优先级，保留稳定性。表达式求值与代码执行不同，处理外部文本时应优先解析受限数据格式，避免把任意字符串当作代码。

下面是独立的概念示例，不是本章练习的参考答案。

```python
rows = [[3, 7], [9, 2], [4, 5]]
columns = list(zip(*rows))
print([sum(column) for column in columns])
print(all(value >= 0 for row in rows for value in row))
```

**自测重点：**检查空序列、长短不一的输入和多关键字排序的并列情况。

本章包含 **6** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 11-01 | [Zipped!](https://www.hackerrank.com/challenges/zipped/problem) | Easy |
| 11-02 | [Input()](https://www.hackerrank.com/challenges/input/problem) | Easy |
| 11-03 | [Python Evaluation](https://www.hackerrank.com/challenges/python-eval/problem) | Easy |
| 11-04 | [Athlete Sort](https://www.hackerrank.com/challenges/python-sort-sort/problem) | Medium |
| 11-05 | [Any or All](https://www.hackerrank.com/challenges/any-or-all/problem) | Easy |
| 11-06 | [ginortS](https://www.hackerrank.com/challenges/ginorts/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：12. 函数式工具 · Python Functionals

### 学习目标

理解 map、filter、lambda、reduce 以及可测试的纯函数。

### 正文

#### 让变换函数保持小而纯

map() 表达逐项变换，filter() 表达保留条件，reduce() 表达累计折叠。普通循环有时更容易阅读，不必为了使用某个工具而牺牲可读性。函数应尽量只依赖参数并返回结果；日期、随机值和全局列表等外部状态会增加测试难度。

下面是独立的概念示例，不是本章练习的参考答案。

```python
from functools import reduce

numbers = [2, 4, 6]
squares = list(map(lambda value: value * value, numbers))
product = reduce(lambda result, value: result * value, numbers, 1)
print(squares)
print(product)
```

**自测重点：**检查空输入、初始累计值和迭代器被消费后再次使用。

本章包含 **3** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 12-01 | [Map and Lambda Function](https://www.hackerrank.com/challenges/map-and-lambda-expression/problem) | Easy |
| 12-02 | [Validating Email Addresses With a Filter](https://www.hackerrank.com/challenges/validate-list-of-email-address-with-filter/problem) | Medium |
| 12-03 | [Reduce Function](https://www.hackerrank.com/challenges/reduce-function/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：13. 正则与结构化文本解析 · Regex and Parsing

### 学习目标

练习匹配、分组、定位、替换、验证规则和 HTML 事件解析。

### 正文

#### 区分搜索、完整匹配和解析

re.search() 搜索任意位置，re.fullmatch() 检查整个字符串。原始字符串可减少反斜杠混淆；捕获分组会影响 findall() 的返回结构。定位重叠片段时应明确从哪个位置继续搜索。HTML 有嵌套、注释和实体等结构，适合使用事件解析器，而不是把所有情况塞进一条正则。

下面是独立的概念示例，不是本章练习的参考答案。

```python
import re

pattern = re.compile(r"(?P<code>[A-Z]{2})-(?P<number>[0-9]{3})")
match = pattern.fullmatch("AB-042")
if match:
    print(match.group("code"))
    print(int(match.group("number")))
```

**自测重点：**检查多余前后字符、空匹配、连续分隔符、重复标识和嵌套标签。

本章包含 **17** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 13-01 | [Detect Floating Point Number](https://www.hackerrank.com/challenges/introduction-to-regex/problem) | Easy |
| 13-02 | [Re.split()](https://www.hackerrank.com/challenges/re-split/problem) | Easy |
| 13-03 | [Group(), Groups() & Groupdict()](https://www.hackerrank.com/challenges/re-group-groups/problem) | Easy |
| 13-04 | [Re.findall() & Re.finditer()](https://www.hackerrank.com/challenges/re-findall-re-finditer/problem) | Easy |
| 13-05 | [Re.start() & Re.end()](https://www.hackerrank.com/challenges/re-start-re-end/problem) | Easy |
| 13-06 | [Regex Substitution](https://www.hackerrank.com/challenges/re-sub-regex-substitution/problem) | Medium |
| 13-07 | [Validating Roman Numerals](https://www.hackerrank.com/challenges/validate-a-roman-number/problem) | Easy |
| 13-08 | [Validating phone numbers](https://www.hackerrank.com/challenges/validating-the-phone-number/problem) | Easy |
| 13-09 | [Validating and Parsing Email Addresses](https://www.hackerrank.com/challenges/validating-named-email-addresses/problem) | Easy |
| 13-10 | [Hex Color Code](https://www.hackerrank.com/challenges/hex-color-code/problem) | Easy |
| 13-11 | [HTML Parser - Part 1](https://www.hackerrank.com/challenges/html-parser-part-1/problem) | Easy |
| 13-12 | [HTML Parser - Part 2](https://www.hackerrank.com/challenges/html-parser-part-2/problem) | Easy |
| 13-13 | [Detect HTML Tags, Attributes and Attribute Values](https://www.hackerrank.com/challenges/detect-html-tags-attributes-and-attribute-values/problem) | Easy |
| 13-14 | [Validating UID](https://www.hackerrank.com/challenges/validating-uid/problem) | Easy |
| 13-15 | [Validating Credit Card Numbers](https://www.hackerrank.com/challenges/validating-credit-card-number/problem) | Medium |
| 13-16 | [Validating Postal Codes](https://www.hackerrank.com/challenges/validating-postalcode/problem) | Hard |
| 13-17 | [Matrix Script](https://www.hackerrank.com/challenges/matrix-script/problem) | Hard |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：14. XML 树与递归遍历 · XML

### 学习目标

遍历元素树，计算属性统计和嵌套深度。

### 正文

#### 遍历树时先确定统计对象

XML 节点同时拥有标签、属性、文本和子节点。统计属性数量不等于统计节点数量；计算深度前要说明根节点深度是零还是一。用递归或显式栈都能遍历，深层输入应考虑递归限制。教学输入使用可信、受限的小型 XML，不加载外部资源。

下面是独立的概念示例，不是本章练习的参考答案。

```python
import xml.etree.ElementTree as ET

root = ET.fromstring('<bag count="2"><item kind="book"/></bag>')
nodes = list(root.iter())
print(len(nodes))
print(sum(len(node.attrib) for node in nodes))
```

**自测重点：**检查只有根节点、空元素、多属性节点以及多层嵌套。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 14-01 | [XML 1 - Find the Score](https://www.hackerrank.com/challenges/xml-1-find-the-score/problem) | Easy |
| 14-02 | [XML2 - Find the Maximum Depth](https://www.hackerrank.com/challenges/xml2-find-the-maximum-depth/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：15. 闭包与装饰器 · Closures and Decorators

### 学习目标

理解函数包装、参数传递、排序及格式化职责的拆分。

### 正文

#### 包装函数也需要清晰接口

闭包可以捕获外层变量，装饰器把函数转换成另一个函数。包装函数应使用 *args 和 **kwargs 传递参数，并保留返回值。使用 functools.wraps() 有助于保留函数名称和文档。数据标准化、排序与输出最好分成独立步骤，便于定位问题。

下面是独立的概念示例，不是本章练习的参考答案。

```python
from functools import wraps

def labelled(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        return "Result: " + str(function(*args, **kwargs))
    return wrapper

@labelled
def add(a, b):
    return a + b

print(add(4, 9))
```

**自测重点：**检查参数是否丢失、返回值是否被遗漏，以及排序前后类型是否一致。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 15-01 | [Standardize Mobile Number Using Decorators](https://www.hackerrank.com/challenges/standardize-mobile-number-using-decorators/problem) | Easy |
| 15-02 | [Decorators 2 - Name Directory](https://www.hackerrank.com/challenges/decorators-2-name-directory/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：16. NumPy 数组与数值计算 · Numpy

### 学习目标

练习数组形状、广播、聚合、矩阵乘法和线性代数。

### 正文

#### 先画出 shape 再写数组表达式

NumPy 的 shape 描述各轴长度，reshape() 不改变元素数量。axis 指定沿哪个轴聚合，广播规则从末尾维度比较。逐元素乘法与矩阵乘法并不相同。输出应遵守具体题目的小数位和数组格式约定，不能依赖不同版本的默认显示样式。

下面是独立的概念示例，不是本章练习的参考答案。

```python
import numpy as np

data = np.array([[2, 5], [7, 1]], dtype=np.int64)
print(data.shape)
print(data.sum(axis=0).tolist())
print(data.T.tolist())
```

**自测重点：**检查形状相容、数据类型、舍入边界、轴方向和奇异矩阵。

本章包含 **15** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 16-01 | [Arrays](https://www.hackerrank.com/challenges/np-arrays/problem) | Easy |
| 16-02 | [Shape and Reshape](https://www.hackerrank.com/challenges/np-shape-reshape/problem) | Easy |
| 16-03 | [Transpose and Flatten](https://www.hackerrank.com/challenges/np-transpose-and-flatten/problem) | Easy |
| 16-04 | [Concatenate](https://www.hackerrank.com/challenges/np-concatenate/problem) | Easy |
| 16-05 | [Zeros and Ones](https://www.hackerrank.com/challenges/np-zeros-and-ones/problem) | Easy |
| 16-06 | [Eye and Identity](https://www.hackerrank.com/challenges/np-eye-and-identity/problem) | Easy |
| 16-07 | [Array Mathematics](https://www.hackerrank.com/challenges/np-array-mathematics/problem) | Easy |
| 16-08 | [Floor, Ceil and Rint](https://www.hackerrank.com/challenges/floor-ceil-and-rint/problem) | Easy |
| 16-09 | [Sum and Prod](https://www.hackerrank.com/challenges/np-sum-and-prod/problem) | Easy |
| 16-10 | [Min and Max](https://www.hackerrank.com/challenges/np-min-and-max/problem) | Easy |
| 16-11 | [Mean, Var, and Std](https://www.hackerrank.com/challenges/np-mean-var-and-std/problem) | Easy |
| 16-12 | [Dot and Cross](https://www.hackerrank.com/challenges/np-dot-and-cross/problem) | Easy |
| 16-13 | [Inner and Outer](https://www.hackerrank.com/challenges/np-inner-and-outer/problem) | Easy |
| 16-14 | [Polynomials](https://www.hackerrank.com/challenges/np-polynomials/problem) | Easy |
| 16-15 | [Linear Algebra](https://www.hackerrank.com/challenges/np-linear-algebra/problem) | Easy |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

## 章节：17. 调试与可变默认参数 · Debugging

### 学习目标

通过定位反例理解状态污染、边界判断和可变默认参数。

### 正文

#### 通过反例定位状态与边界错误

调试时先写出预期行为，再构造能区分正确与错误实现的小输入。可变默认参数在函数定义时创建，而不是在每次调用时创建；连续调用很容易暴露状态污染。对字符计分或计数问题，逐词与逐字符的层级也必须区分。

下面是独立的概念示例，不是本章练习的参考答案。

```python
def record(value, values=None):
    if values is None:
        values = []
    values.append(value)
    return values

print(record(3))
print(record(8))
```

**自测重点：**检查同一函数连续调用、重复字符和最短单词。

本章包含 **2** 个对应练习，按原站目录出现顺序排列。

| 编号 | 原题入口 | 难度 |
| --- | --- | --- |
| 17-01 | [Words Score](https://www.hackerrank.com/challenges/words-score/problem) | Medium |
| 17-02 | [Default Arguments](https://www.hackerrank.com/challenges/default-arguments/problem) | Medium |

### 检查点

为本章每个练习记录：使用的核心操作、一个边界用例，以及调试中修复的一处错误。完成后尝试解释时间复杂度和输入约定。

### 参考答案


### 关联题目

[]

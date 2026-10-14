---
format: "codemaster-learning-path"
version: 1
title: "Python 从入门到独立解题"
description: "面向零基础学生的完整 Python 3.12 学习路径，20 章覆盖语言基础、容器、函数、文件、模块、类、测试、基础算法与综合项目。每章包含目标、讲解、可运行例子、输出、易错点、检查点及参考答案。推荐每周 2 章；练习可先在本机或代码编辑器中完成。示例不依赖已有题库 UUID。"
category: "Python 3.12 · 入门到进阶"
estimatedMinutes: 1800
difficulty: beginner
coverKey: python
---

# Python 从入门到独立解题

## 章节：开始编程与运行环境

### 学习目标

理解解释器、脚本与标准输出；运行第一个 Python 3 程序。

### 正文

#### 概念与思考

Python 按语句执行程序。代码编辑页的运行按钮使用题目公开样例，提交按钮用于正式评测，两者用途不同。课程示例按 Python 3.12 编写，不需要第三方库。
先在编辑区输入下面的代码，运行后观察两行输出。字符串用成对引号包围，括号中的内容传给函数。

#### 跟做示例

```python
print("Hello, Python!")
print(2 + 3)
```

预期输出：

```text
Hello, Python!
5
```

#### 常见错误与自查

中文标点不能代替代码中的英文引号或括号。Python 区分大小写，Print 与 print 不相同。不要把示例输出复制进代码。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：能从空白文件独立运行程序，并区分源码与输出。

### 检查点

分别输出你的姓名和 7 与 8 的和。输出应有两行。

### 参考答案

```python
print("小明")
print(7 + 8)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：变量、数值与表达式

### 学习目标

使用变量、整数、浮点数与算术运算；理解赋值。

### 正文

#### 概念与思考

变量是对象的名称。赋值语句右侧先计算，再把结果绑定到左侧名称；它不是数学中的等式证明。使用有意义的小写名称，如 total、count。
整数 int 可表示正负整数；浮点数 float 表示近似的小数。/ 是除法，// 是向下取整除法，% 是余数，** 是幂。负数运算时也遵循向下取整。

#### 跟做示例

```python
a, b = 17, 5
print(a // b, a % b)
print(-7 // 3)
price = 12.5
count = 4
print(price * count)
```

预期输出：

```text
3 2
-3
50.0
```

#### 常见错误与自查

不要用变量名覆盖 print、sum 或 list。浮点数常存在表示误差，金额练习优先使用整数分。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：解释 // 与 % 如何配合拆分单位。

### 检查点

有 125 分钟，计算小时数与剩余分钟。

### 参考答案

```python
minutes = 125
print(minutes // 60, minutes % 60)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：输入、转换与格式化输出

### 学习目标

读取标准输入；将字符串转换为数值；控制输出格式。

### 正文

#### 概念与思考

input() 读取一行文本并去掉结尾换行，返回字符串。int() 与 float() 完成显式转换。split() 默认按连续空白拆分，可以处理多余空格。
评测题通常只要求输出答案，不应额外输出“请输入”。本章练习输入 3 5，输出 8。

#### 跟做示例

```python
line = "3 5"  # 在评测中改为 input()
a, b = map(int, line.split())
print(a + b)
print(f"平均值：{(a + b) / 2:.2f}")
```

预期输出：

```text
8
平均值：4.00
```

#### 常见错误与自查

输入数量必须与解包变量数量一致；缺少数字时会出错。格式化字符串以 f 开头，花括号包含表达式。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：能画出输入文本 → 拆分 → 转换 → 计算 → 输出流程。

### 检查点

读入长、宽两个整数，输出矩形面积。输入 6 4 时输出 24。

### 参考答案

```python
length, width = map(int, input().split())
print(length * width)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：布尔值与条件分支

### 学习目标

比较数值；编写 if/elif/else；掌握缩进。

### 正文

#### 概念与思考

比较表达式返回 True 或 False。== 判断相等，!= 判断不等；= 用于赋值。and、or、not 组合条件，并采用短路求值。
Python 用缩进确定语句块，同一级使用四个空格。if、elif、else 的条件按顺序检查，仅执行第一个满足的分支。

#### 跟做示例

```python
score = 76
if score >= 90:
    level = "优秀"
elif score >= 60:
    level = "合格"
else:
    level = "继续练习"
print(level)
```

预期输出：

```text
合格
```

#### 常见错误与自查

较严格的条件通常写在前面。if score >= 60 放在 >= 90 前面会吞掉优秀分支。检查边界值 59、60、89、90。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：为三个分支各给一个测试输入。

### 检查点

读入整数 n，输出 positive、zero 或 negative。

### 参考答案

```python
n = int(input())
if n > 0:
    print("positive")
elif n == 0:
    print("zero")
else:
    print("negative")
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：for 循环与 range

### 学习目标

重复执行语句；遍历范围；构建累加器。

### 正文

#### 概念与思考

for 从可迭代对象中依次取值。range(start, stop, step) 不包含 stop；range(n) 产生 0 到 n-1。累计结果时，应在循环外初始化。
一到 n 求和有公式，也可以循环。先用循环建立对状态变化的理解，再比较不同解法。

#### 跟做示例

```python
n = 5
total = 0
for value in range(1, n + 1):
    total += value
print(total)
print(list(range(2, 9, 2)))
```

预期输出：

```text
15
[2, 4, 6, 8]
```

#### 常见错误与自查

不要在循环内重新把 total 设为 0。range 的停止值不包含在结果中，常见错误是少处理最后一个数。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：能手工记录每次循环后 total 的变化。

### 检查点

计算 1 到 n 中所有偶数的和。n=6 时结果为 12。

### 参考答案

```python
n = int(input())
total = 0
for x in range(2, n + 1, 2):
    total += x
print(total)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：while 循环与流程控制

### 学习目标

使用条件重复；理解 break、continue 与终止条件。

### 正文

#### 概念与思考

while 在每轮开始前检查条件。循环中必须让状态向终止条件推进，否则可能无限循环。break 结束最内层循环；continue 跳过本轮剩余语句。
处理不确定次数的操作时可以使用 while。例如逐位分解正整数；除以 10 让剩余部分不断缩小。

#### 跟做示例

```python
n = 407
digits = []
while n > 0:
    digits.append(n % 10)
    n //= 10
print(digits)
```

预期输出：

```text
[7, 0, 4]
```

#### 常见错误与自查

拆分结果是从低位到高位。零需要单独考虑，因为 while n > 0 对 0 不执行。continue 不能绕过关键的状态更新。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：解释为什么该程序一定停止，且 n=0 时返回 0。

### 检查点

计算一个非负整数的各位数字之和。输入 407 时输出 11。

### 参考答案

```python
n = int(input())
total = 0
while n > 0:
    total += n % 10
    n //= 10
print(total)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：字符串与文本处理

### 学习目标

使用索引、切片与字符串方法；理解不可变对象。

### 正文

#### 概念与思考

字符串是字符序列，索引从 0 开始，负索引从末尾开始。切片 s[start:stop:step] 不含 stop，s[::-1] 可以反转字符串。
字符串不可原地修改，replace、strip、lower 等方法返回新字符串。文本清洗与判断应明确大小写、空白等规则。

#### 跟做示例

```python
text = "  Python  "
clean = text.strip().lower()
print(clean)
print(clean[:3])
print(clean[::-1])
```

预期输出：

```text
python
pyt
nohtyp
```

#### 常见错误与自查

对长度为 n 的字符串访问索引 n 会越界；切片超出范围通常不会报错。不要认为 strip 会删除中间空格。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：测试单字符、偶数长度回文与非回文。

### 检查点

判断一个输入单词是否为回文；本题区分大小写。输入 level 输出 YES，Python 输出 NO。

### 参考答案

```python
word = input().strip()
print("YES" if word == word[::-1] else "NO")
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：列表、遍历与推导式

### 学习目标

保存有序数据；修改列表；使用 enumerate 与推导式。

### 正文

#### 概念与思考

列表可变，能存储多个对象。append 添加一个元素；pop 移除并返回元素。遍历时可直接取得值，enumerate 同时提供索引。
列表推导式把映射与筛选写成表达式，适合简单转换。复杂逻辑应拆成普通循环，避免可读性下降。

#### 跟做示例

```python
values = [3, 1, 4, 1, 5]
even_squares = [x * x for x in values if x % 2 == 0]
print(even_squares)
for index, value in enumerate(values[:2]):
    print(index, value)
```

预期输出：

```text
[16]
0 3
1 1
```

#### 常见错误与自查

遍历列表时随意删除元素可能跳过后续元素；可以构建新列表。b=a 共享列表对象，b=a.copy() 创建浅拷贝。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：测试空列表思想以及没有正数的输入。

### 检查点

读入一行整数，输出其中正数的数量及总和。输入 -2 3 0 5 时输出 2 8。

### 参考答案

```python
values = list(map(int, input().split()))
positive = [x for x in values if x > 0]
print(len(positive), sum(positive))
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：二维列表与矩阵

### 学习目标

创建独立行；遍历二维结构；完成行列统计。

### 正文

#### 概念与思考

二维列表是包含多个列表的列表。访问 matrix[row][column]，先取得行，再访问行内元素。每一行应独立创建。
[[0]*cols]*rows 会重复引用同一行，修改一个位置可能同时影响多行。使用推导式按行创建。

#### 跟做示例

```python
matrix = [[1, 2, 3], [4, 5, 6]]
print([sum(row) for row in matrix])
col_sums = [sum(row[j] for row in matrix) for j in range(3)]
print(col_sums)
```

预期输出：

```text
[6, 15]
[5, 7, 9]
```

#### 常见错误与自查

列遍历需保证每行长度一致。空矩阵没有 matrix[0]，读取首行前先检查数据。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：解释浅拷贝与共享行问题。

### 检查点

创建 2×3 的零矩阵，将第一行第一列改为 9，确保第二行仍全为 0。

### 参考答案

```python
matrix = [[0 for _ in range(3)] for _ in range(2)]
matrix[0][0] = 9
print(matrix)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：元组、字典与集合

### 学习目标

选择合适容器；使用键值映射、计数与去重。

### 正文

#### 概念与思考

元组适合固定组合；字典通过键查找值，适合频率表与索引；集合保存不重复元素，适合成员判断和集合运算。
字典键必须可哈希，字符串、整数和只含可哈希对象的元组可作键；列表不能作键。集合没有用于表达业务顺序的索引。

#### 跟做示例

```python
words = ["cat", "dog", "cat"]
counts = {}
for word in words:
    counts[word] = counts.get(word, 0) + 1
print(counts["cat"])
print(sorted(set(words)))
```

预期输出：

```text
2
['cat', 'dog']
```

#### 常见错误与自查

直接读取不存在的字典键会抛 KeyError，get 可提供默认值。需要稳定输出时，应明确排序，而不是依赖集合遍历顺序。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：为联系人查找、去重和坐标分别选择容器。

### 检查点

统计输入一行整数中不同值的数量。输入 2 2 3 1 时输出 3。

### 参考答案

```python
values = list(map(int, input().split()))
print(len(set(values)))
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：函数与参数

### 学习目标

拆分程序；理解参数、返回值与职责边界。

### 正文

#### 概念与思考

函数封装一项职责，def 定义函数，return 返回结果。仅 print 结果的函数不等于返回结果；没有显式 return 时返回 None。
先写清输入与输出，再编写函数。将计算逻辑与 input/print 分离，可以重复调用并方便测试。

#### 跟做示例

```python
def rectangle_area(length, width):
    return length * width

result = rectangle_area(6, 4)
print(result)
```

预期输出：

```text
24
```

#### 常见错误与自查

避免默认参数使用 [] 等可变对象。默认值在函数定义时创建，会被后续调用共享。可用 None 再在函数体内创建列表。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：用不同列表重复调用函数，确认结果不相互干扰。

### 检查点

编写 count_positive(values)，返回正数个数，不在函数内部读取输入或打印。

### 参考答案

```python
def count_positive(values):
    return sum(1 for x in values if x > 0)

print(count_positive([-2, 3, 0, 5]))
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：作用域、对象与递归入门

### 学习目标

区分局部状态与共享对象；理解递归基例。

### 正文

#### 概念与思考

函数参数也是局部名称。将参数重新绑定为新对象不改变调用者的名称；修改传入列表的内容则会影响同一对象。
递归函数调用自身，必须有基例和趋近基例的步骤。递归不是所有循环的更优替代，大量递归调用可能超过深度限制。

#### 跟做示例

```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))
```

预期输出：

```text
120
```

#### 常见错误与自查

本例只针对非负整数。递归参数若不减小，会一直调用；在线判题处理大数据时，优先考虑迭代实现。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：列出 factorial(3) 的调用链并说明基例。

### 检查点

用循环实现阶乘，输入 0 输出 1，输入 5 输出 120。

### 参考答案

```python
n = int(input())
result = 1
for x in range(2, n + 1):
    result *= x
print(result)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：异常处理与输入校验

### 学习目标

识别常见异常；捕获预期错误；保持错误可观察。

### 正文

#### 概念与思考

异常表示程序无法按当前操作继续，如 ValueError、IndexError、KeyError。try/except 只捕获你预期并能处理的错误。
校验与异常处理互补：已知业务范围应主动检查，外部输入转换可能失败则明确处理。不要用裸 except 隐藏所有错误。

#### 跟做示例

```python
def parse_age(text):
    try:
        age = int(text)
    except ValueError:
        return None
    return age if 0 <= age <= 130 else None

print(parse_age("18"))
print(parse_age("abc"))
```

预期输出：

```text
18
None
```

#### 常见错误与自查

不要把整个程序放进一个巨大的 try。定位具体可能失败的语句，更容易保留真实错误原因。正式题目有效输入通常不需要交互提示。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：测试 6/3、0/3 与 3/0，解释返回值差异。

### 检查点

函数 safe_divide(a,b) 在 b=0 时返回 None，其他情况返回商。

### 参考答案

```python
def safe_divide(a, b):
    if b == 0:
        return None
    return a / b
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：文件、路径与 JSON

### 学习目标

使用上下文管理器；读写 UTF-8 文本；理解结构化数据。

### 正文

#### 概念与思考

with 在代码块结束时自动释放文件资源。文本文件应明确 encoding="utf-8"，写模式 w 会覆盖已有文件，追加模式 a 保留原内容。
JSON 交换列表、字典、字符串、数字、布尔值及 null。Python 的 json.loads 解析文本，json.dumps 编码文本。文件练习请在本机可写目录完成；在线判题按题目要求读标准输入，不依赖外部文件。

#### 跟做示例

```python
import json

data = {"name": "小明", "scores": [80, 90]}
text = json.dumps(data, ensure_ascii=False)
restored = json.loads(text)
print(restored["name"], sum(restored["scores"]))
```

预期输出：

```text
小明 170
```

#### 常见错误与自查

JSON 的键是字符串；元组编码后成为数组，再解析会得到列表。不要用 eval 读取陌生文档。文件路径需要考虑当前工作目录。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：区分 Python 对象、JSON 文本与磁盘文件。

### 检查点

用 JSON 编码并解析 {"completed": True, "chapter": 3}，验证解析后 completed 是布尔值。

### 参考答案

```python
import json

data = json.loads(json.dumps({"completed": True, "chapter": 3}))
print(data["completed"] is True)
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：模块与标准库

### 学习目标

组织可复用函数；使用 math、collections 与 pathlib。

### 正文

#### 概念与思考

模块是可导入的 Python 文件。import module 后通过 module.name 访问；from module import name 引入指定名称。不要将自己的文件命名为 json.py、math.py 等常用库名。
if __name__ == "__main__" 可以将脚本入口与可导入函数分开。课程只使用标准库，不要求在评测容器中安装包。

#### 跟做示例

```python
from collections import Counter
from math import gcd

print(gcd(18, 24))
print(Counter("banana")["a"])
```

预期输出：

```text
6
3
```

#### 常见错误与自查

导入模块可能执行其顶层代码，避免在模块顶层无条件读取 input。确认所用函数存在于当前解释器版本。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：说明为什么模块入口保护有利于测试。

### 检查点

使用 Counter 统计输入单词中每个字符的次数，按字符排序输出。

### 参考答案

```python
from collections import Counter

counts = Counter(input().strip())
for ch in sorted(counts):
    print(ch, counts[ch])
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：类与数据建模

### 学习目标

定义类、实例属性与方法；封装简单业务状态。

### 正文

#### 概念与思考

类描述对象的结构与行为。__init__ 初始化实例，self 表示当前实例；实例属性属于各自对象，类属性由类提供。
不要为每个小程序强行创建类。多个相关字段需要一起维护，并有一致性规则时，类能让职责更清楚。

#### 跟做示例

```python
class ScoreBook:
    def __init__(self):
        self.scores = []

    def add(self, score):
        if not 0 <= score <= 100:
            raise ValueError("分数应在 0 到 100 之间")
        self.scores.append(score)

    def average(self):
        return sum(self.scores) / len(self.scores) if self.scores else 0

book = ScoreBook()
book.add(80)
book.add(90)
print(book.average())
```

预期输出：

```text
85.0
```

#### 常见错误与自查

把 scores=[] 写成类属性会让多个实例共享同一个列表。空集合求平均需要明确规则，不要除以 0。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：指出实例数据为什么不能意外共享。

### 检查点

创建两个 ScoreBook，分别加入 60 与 100，确认平均值分别为 60 和 100。

### 参考答案

```python
first = ScoreBook()
second = ScoreBook()
first.add(60)
second.add(100)
print(first.average(), second.average())
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：测试、调试与边界

### 学习目标

编写断言与 unittest；构建边界测试表。

### 正文

#### 概念与思考

测试先描述预期行为，再比较实际结果。正常值、边界值和无效输入应分别考虑。测试不能证明没有所有错误，但能防止已知问题回归。
调试时缩小输入，打印中间状态，并检查循环边界与对象共享。assert 适合开发期验证；生产业务校验不能只依赖 assert，因为优化模式可移除它。

#### 跟做示例

```python
def clamp(value, low, high):
    return max(low, min(value, high))

assert clamp(-1, 0, 10) == 0
assert clamp(5, 0, 10) == 5
assert clamp(11, 0, 10) == 10
print("测试通过")
```

预期输出：

```text
测试通过
```

#### 常见错误与自查

测试数据需要独立预期答案，不应原样调用待测函数产生期望值。输出比较要注意换行和空格。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：能解释每个测试覆盖的风险，而非仅增加数量。

### 检查点

为 count_positive 写至少 4 个测试，覆盖空列表、全负数、含零和混合列表。

### 参考答案

```python
assert count_positive([]) == 0
assert count_positive([-2, -1]) == 0
assert count_positive([0, 0]) == 0
assert count_positive([-1, 2, 3]) == 2
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：排序、查找与算法思维

### 学习目标

使用 sorted 与 key；理解二分查找的前提。

### 正文

#### 概念与思考

sorted 返回新列表，list.sort 原地排序并返回 None。key 将每个元素映射为排序依据，适合按成绩、姓名或复合字段排序。
二分查找必须在有序数据上进行；每轮将候选范围缩小约一半。标准库 bisect_left 返回插入位置，不保证目标存在，仍要检查边界与值。

#### 跟做示例

```python
from bisect import bisect_left

values = [1, 3, 3, 7, 9]
pos = bisect_left(values, 3)
print(pos)
print(sorted([("林", 80), ("陈", 90)], key=lambda item: -item[1]))
```

预期输出：

```text
1
[('陈', 90), ('林', 80)]
```

#### 常见错误与自查

不要把 values.sort() 的返回值赋给 values。二分查找前排序会改变原始位置，若题目要求原位置需要额外记录。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：测试目标小于最小值、等于最大值和大于最大值。

### 检查点

使用 bisect_left 判断 7 是否在有序列表中，输出 YES 或 NO。

### 参考答案

```python
from bisect import bisect_left

values = [1, 3, 7, 9]
target = 7
pos = bisect_left(values, target)
print("YES" if pos < len(values) and values[pos] == target else "NO")
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：复杂度与前缀和

### 学习目标

估计运行成本；用预处理减少重复计算。

### 正文

#### 概念与思考

复杂度描述输入规模增长时资源使用的趋势，不是某台机器的精确秒数。遍历 n 个元素通常是 O(n)，两层各 n 次的循环通常是 O(n²)。空间复杂度关注额外存储。
前缀和 prefix[i] 保存前 i 个元素之和，区间 [left,right) 的和为 prefix[right]-prefix[left]。预处理 O(n)，每次区间查询 O(1)。

#### 跟做示例

```python
values = [2, 4, 1, 5]
prefix = [0]
for x in values:
    prefix.append(prefix[-1] + x)
print(prefix)
print(prefix[3] - prefix[1])
```

预期输出：

```text
[0, 2, 6, 7, 12]
5
```

#### 常见错误与自查

约定半开区间能减少边界歧义。prefix 比原数组多一个元素；区间端点必须满足 0<=left<=right<=n。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：能明确预处理时间、查询时间与额外空间。

### 检查点

对 [2,4,1,5] 求索引 0 到 3（不含 3）的区间和，并说明做 1000 次查询时为何优于反复切片求和。

### 参考答案

```python
values = [2, 4, 1, 5]
prefix = [0]
for x in values:
    prefix.append(prefix[-1] + x)
print(prefix[3] - prefix[0])
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

## 章节：综合项目：学习成绩分析器

### 学习目标

串联解析、函数、字典、验证与测试；完成可运行的小项目。

### 正文

#### 概念与思考

项目输入每行包含姓名与分数，允许同名多次记录。本章用固定文本模拟输入，计算每人的平均分，并按平均分降序、姓名升序输出。扩展时可从文件读取，但应让分析函数不依赖文件或交互。
需求：分数范围 0–100，空数据输出空结果，格式错误抛 ValueError。先拆出 analyze 函数，再单独处理展示。最后写测试，检查重复姓名、同分排序、空输入与错误输入。

#### 跟做示例

```python
def analyze(lines):
    groups = {}
    for line in lines:
        if not line.strip():
            continue
        name, raw = line.split()
        score = int(raw)
        if not 0 <= score <= 100:
            raise ValueError("分数超出范围")
        groups.setdefault(name, []).append(score)
    result = [(name, sum(scores) / len(scores)) for name, scores in groups.items()]
    return sorted(result, key=lambda item: (-item[1], item[0]))

for name, average in analyze(["小林 80", "小陈 90", "小林 100"]):
    print(name, f"{average:.1f}")
```

预期输出：

```text
小林 90.0
小陈 90.0
```

#### 常见错误与自查

同分排序按 Unicode 字符顺序，不等于拼音顺序。需求若要求拼音，应另行明确规则。不能将错误输入静默改成 0 分。

#### 学习建议

先预测示例结果，再运行对照；修改一个输入或变量后再次预测。将错误原因记录在笔记中，不只记录最终代码。

完成标准：提交项目说明、源码、测试表，并解释拆分函数后的收益。

### 检查点

为 analyze 写三个断言；扩展返回每位学生记录数量，不改变原来的均分规则。

### 参考答案

```python
assert analyze([]) == []
assert analyze(["A 80", "A 100"]) == [("A", 90.0)]
assert analyze(["B 90", "A 90"]) == [("A", 90.0), ("B", 90.0)]
```

先独立完成，再核对参考实现。输出格式以题目要求为准；部分答案复用本章或前面章节已定义的函数/类。

### 关联题目

[]

---
format: codemaster-learning-path
version: 1
title: Python 专项训练 · 全目录学习路线
description: 这门课用 17 章讲解 Python 3.12。从表达式、控制流和容器出发，逐步学习标准库、文本解析、NumPy 与程序调试。每章包含独立示例和知识自测。
category: Python · 专项训练
estimatedMinutes: 3600
difficulty: intermediate
coverKey: python
---

# Python 专项训练 · 全目录学习路线

## 章节：01. 基础输入、条件与循环 · Introduction

### 学习目标

能读写基本类型，使用条件、模式匹配、循环和函数组织程序，并按要求控制输出的内容、宽度与精度。

### 正文

#### 值、变量与表达式

Python 中变量名指向值，赋值语句 `temperature = 18` 把名称绑定到整数。常用基本类型有 `int` 整数、`float` 浮点数、`str` 字符串、`bool` 布尔值，以及表示缺失的 `None`。可用 `type(value)` 查看类型，用 `int("18")`、`float("18.5")` 和 `str(18)` 显式转换。数值加法 `2 + 3` 得到 5，字符串拼接 `"2" + "3"` 得到 `"23"`。

| 运算 | 语法 | 示例 |
| --- | --- | --- |
| 加、减、乘 | `+`、`-`、`*` | `2 + 3 * 4` 得 14，括号可以改变顺序 |
| 真除法 | `/` | `7 / 2` 得 3.5 |
| 向下取整的商 | `//` | `-7 // 3` 得 -3 |
| 余数 | `%` | `-7 % 3` 得 2，和上一行的商能还原 -7 |
| 乘方 | `**` | `3 ** 2` 得 9，`^` 表示按位异或 |

`x += 1` 将 x 加 1 后重新赋值。对整除性可检查 `x % k == 0`。比较相等用 `==`，赋值用 `=`。比较可以连写，例如 `0 <= percent <= 100`。用 `and`、`or`、`not` 组合条件。前两者会短路，所以 `denominator != 0 and total / denominator > 1` 能先排除零除。

#### 输入、输出与函数接口

`input()` 读一行并返回字符串，去掉行末的换行，其余字符保留。读一个数字可以写 `int(input())`。用 `line.split()` 按连续空白拆分，再用 `x, y = map(int, line.split())` 解析两项，或用列表推导式解析不定数量。面向标准输入的程序按约定读取，面向终端用户的程序可以另加提示。

`print(*values, sep=" ", end="\n")` 默认用空格连接参数并换行。使用 `sep` 可以自定义参数之间的分隔符，用 `end` 可以控制结尾。`file` 指定写入的文本流，`flush=True` 立即刷新该流。`separator.join(parts)` 则创建一个字符串，要求每个片段本身是字符串。

`def` 定义函数。调用时传入实参，函数体中以参数名使用这些值。`return` 会立即结束当前调用并把结果交回调用方；函数没有执行到显式返回值时会得到 `None`。把计算封装在函数里，可直接检查返回值，再决定是否打印。

```python
def minutes_to_hours(total):
    hours, minutes = divmod(total, 60)
    return hours, minutes

hours, minutes = minutes_to_hours(135)
assert (hours, minutes) == (2, 15)
print(hours, minutes, sep=":", end="\n")
```

#### 条件分支与结构化模式匹配

单独的 `if` 表示“满足条件才执行”。`if / else` 表示两条互斥路径。`if / elif / else` 从上到下判断，最多执行一条分支，可省略 `else`，也可写多个 `elif`。冒号后用缩进标识代码块。同一层写多个独立的 `if` 时，各条件会分别判断。分支可能重叠时，先考虑较具体的规则和等号该归哪边。布尔条件中，零、空字符串、空容器和 `None` 都为假。需要专门判断缺失时使用 `is None`，以免把零也当成缺失。

```python
def air_quality(reading):
    if reading is None:
        return "no reading"
    elif reading < 30:
        return "good"
    elif reading <= 60:
        return "fair"
    else:
        return "poor"

assert [air_quality(n) for n in (None, 0, 29, 30, 60, 61)] == [
    "no reading", "good", "good", "fair", "fair", "poor"
]
label = "online" if True else "offline"
assert label == "online"
```

条件表达式 `a if condition else b` 适合在两个短表达式之间选一个值。涉及多条语句或多项规则时，展开为完整分支更便于阅读。

Python 3.10 起提供 `match / case`，可承担其他语言中部分 `switch / case` 的用途，还能匹配序列等结构。从上到下选择第一个匹配且守卫条件为真的分支，每个分支执行后直接结束整个匹配。`|` 表示模式择一，`case _` 兜底，`if` 可附加守卫。裸名字会捕获对应的值，匹配字面文本要写引号。检查数值范围时通常用 `if / elif` 更直观。

```python
def describe_event(event):
    match event:
        case ("open" | "close",):
            return "door"
        case ("temperature", value) if value < 0:
            return "freezing"
        case ("temperature", value):
            return f"{value} °C"
        case _:
            return "unknown"

assert describe_event(("close",)) == "door"
assert describe_event(("temperature", -2)) == "freezing"
assert describe_event(("temperature", 18)) == "18 °C"
assert describe_event(("heartbeat",)) == "unknown"
```

#### 循环、范围与累加

`for item in iterable` 逐项访问字符串、列表等可迭代对象。`range(stop)` 从 0 开始，`range(start, stop, step)` 可指定起点、终点与步长，始终排除 stop。反向遍历时步长为负。已知遍历对象时用 `for`，需要在条件成立期间反复执行时用 `while`，并确保循环体改变条件或最终能退出。

`break` 结束最内层循环，`continue` 跳过本轮剩余语句。循环的 `else` 在正常结束时执行，包括一轮都没运行的情况，遇到 `break` 则跳过。累加模式先在循环外初始化状态，再在循环内更新。嵌套循环的内层会为每个外层元素重新执行。

```python
total = 0
for change in [4, 0, -2, 9, 20]:
    if change == 0:
        continue
    if change > 10:
        break
    total += change
else:
    total = -1

assert total == 11
assert list(range(6, 1, -2)) == [6, 4, 2]
```

#### 格式化输出

格式化负责把值变成可展示的文本。f-string 在花括号内计算表达式，可在冒号后加格式说明。已有模板可用 `str.format()` 填充位置或命名参数，`format(value, spec)` 可独立格式化单个值。旧代码中还会见到 `%` 格式化，`%s` 插入文本、`%d` 插入十进制整数、`%.2f` 显示两位小数、`%%` 输出字面百分号。需要输出字面花括号时，在 f-string 或 `str.format()` 的模板中写 `{{` 和 `}}`。

| 需求 | 常用格式 | 含义 |
| --- | --- | --- |
| 对齐与填充 | `:<10`、`:>10`、`:.^10` | 最少 10 字符宽，依次为左对齐、右对齐、用点居中 |
| 带符号和补零 | `:+06d` | 总宽至少 6，显式显示符号并在符号后补零 |
| 数字分组 | `:,d`、`:_d` | 使用逗号或下划线分组 |
| 整数进制 | `:d`、`:b`、`:o`、`:x`、`:X` | 十、二、八、十六进制。使用 `#` 可加进制前缀 |
| 定点、科学、通用记法 | `:.2f`、`:.2e`、`:.3g` | 两位小数、科学记法小数点后两位、最多三位有效数字 |
| 百分比 | `:.1%` | 将比例乘 100，显示一位小数和百分号 |
| 截取字符串长度 | `:.4s` | 最多显示四个字符 |
| 转换与调试 | `!s`、`!r`、`!a`、`{value=}` | 分别先调用 `str()`、`repr()`、`ascii()`，或同时显示表达式和结果 |

格式说明可依次指定填充与对齐、符号、负零处理 `z`、前缀 `#`、零填充、宽度、分组、精度和类型。不需要的部分可省略。数字可用 `=` 把填充放在符号和数字之间。`+` 总显示正负号，空格符号选项为正数留一格，默认只显示负号。`c` 把整数解释为 Unicode 码点。`n` 按区域设置格式化数字，需要固定输出时用明确的 `d`、`f` 等类型。

宽度通常是最小宽度，超过宽度的值会扩展字段。精度的意义由类型字符决定，`f` 的精度控制小数位，`g` 的精度控制有效位。`f"{value:.2f}"` 会保留尾随零，返回字符串，原数值可以继续计算。宽度和精度也可来自变量，如 `f"{value:{width}.{digits}f}"`。一行多个格式化值可先生成片段再连接，精确控制空格、分隔符和换行。

```python
height = 7.5
width, digits = 7, 2
assert f"{height:{width}.{digits}f}" == "   7.50"
assert "{item:^7} {count:03d}".format(item="oak", count=8) == "  oak   008"
assert f"{-12:+06d}" == "-00012"
assert format(31, "#X") == "0X1F"
assert f"{0.125:.1%}" == "12.5%"
assert f"{{{height=}}}" == "{height=7.5}"
assert "%s %.2f %%" % ("oak", height) == "oak 7.50 %"
assert " | ".join(f"{value:.1f}" for value in [2, 4.5]) == "2.0 | 4.5"
```

### 检查点

设计一个按温度区间给出提示的小函数，列出每个区间两侧的边界值，再用模式匹配识别传感器事件。另写一段输出，用同一数值展示补零、定点小数、科学记法和百分比。用 repr 核对前导空格和换行。

### 参考答案

### 关联题目

[]

## 章节：02. 列表、元组与嵌套数据 · Basic Data Types

### 学习目标

能根据数据的顺序和可变性选择容器，使用索引、解包、推导式、排序与聚合组织嵌套数据。

### 正文

#### 顺序、索引与解包

列表和元组都是有序序列，可以有重复项。列表写成 `[value, ...]`，可以增删和替换元素；元组常写成 `(value, ...)`，创建后不能替换它的元素。单元素元组需要逗号，如 `("oak",)`。二者都支持从 0 开始的索引、从末尾起算的负索引和切片 `seq[start:stop:step]`。普通索引越界会报错，切片会在实际范围内取值。空序列的长度与默认求和均为 0。

用 `name, year = record` 拆开固定字段，用 `label, *values = record` 接收其余项。`enumerate(items, start=1)` 可以同时得到编号和值，编号适合显示或加权计算，列表索引依然从 0 开始。元组适合表示固定字段，只有所有成员都可哈希时才可用作字典键。自定义校验和应按定义计算，`hash()` 用于哈希查找，不能用作通用校验和。

```python
reading = ("greenhouse", 18, 21, 19)
site, *temperatures = reading
checksum = sum(index * value for index, value in enumerate(temperatures, start=1))
assert (site, temperatures[-1], checksum) == ("greenhouse", 19, 117)
```

#### 列表方法、原地修改与复制

| 操作 | 写法 | 行为 |
| --- | --- | --- |
| 增加 | `append(x)`、`extend(values)`、`insert(i, x)` | 分别加入一个值、加入多个值、在指定索引前插入 |
| 删除 | `remove(x)`、`pop(i)`、`del items[i]` | 分别按值删首次出现项、按索引取出并返回、按索引删除 |
| 查找 | `x in items`、`index(x)`、`count(x)` | 判断存在、找首次索引、数出现次数 |
| 改顺序 | `reverse()`、`sort()` | 原地反转与排序，返回 `None` |
| 创建新容器 | `items.copy()`、`items[:]`、`sorted(items)` | 创建新的外层列表 |

`remove()` 和 `index()` 找不到值时抛出 `ValueError`，可先用成员测试。空列表的 `pop()` 抛出 `IndexError`。`b = a` 让两个名字指向同一个列表。浅复制只复制外层；内层列表仍共享。构造独立网格用 `[[0] * cols for _ in range(rows)]`，避免把同一个内层列表重复引用。需要根据操作名改变列表时，可把操作名和参数分开解包，按到达顺序执行。

```python
grid = [[0] * 3 for _ in range(2)]
grid[0][1] = 8
assert grid == [[0, 8, 0], [0, 0, 0]]
original = ["tea", "coffee", "tea"]
working = original.copy()
working.remove("tea")
working.insert(1, "water")
assert working == ["coffee", "water", "tea"]
assert original == ["tea", "coffee", "tea"]
```

#### 推导式与二维数据

`[expression for item in values if condition]` 先遍历、再筛选、最后计算结果。多个 `for` 按书写顺序嵌套。二维列表一般用 `matrix[row][column]`，按行访问时先固定 row 再遍历 column。需要输出行列表时，在外层推导式中创建内层列表；需要输出扁平的坐标记录时，让每一项直接产生一个坐标。任一遍历范围为空时，不会产生组合。

```python
aisles = ["east", "west"]
positions = [(aisle, shelf) for aisle in aisles for shelf in range(4) if shelf % 2]
assert positions == [("east", 1), ("east", 3), ("west", 1), ("west", 3)]
```

#### 去重、排序、并列与统计

`set(values)` 把可哈希值去重，`sorted(values)` 返回排序后的列表。按不同数值排名时先去重，再对不同值排序并取相应位置；需要所有并列记录时，拿排名值回到原始数据筛选。检查不同值数量后再索引，按接口用 `None` 或空列表表达缺失。要根据记录的一部分排序，可传 `key`，如 `key=lambda item: item[1]`。字典适合按名称保存记录，`mapping.get(key, default)` 可处理缺失键。

算术平均是总和除以项数。加权平均中每项乘自己的权重，再除以总权重。先确认分母不为零，计算完成后按需要格式化。计数、求和、最值与平均是不同的聚合，决定是否去重前先明确聚合对象。

```python
supplies = [("paper", 5), ("ink", 2), ("pens", 5), ("clips", 1)]
levels = sorted({quantity for _, quantity in supplies}, reverse=True)
names = sorted(name for name, quantity in supplies if quantity == levels[0])
assert names == ["paper", "pens"]

measurements = [(10, 1), (16, 2)]
weighted = sum(value * weight for value, weight in measurements)
weight_total = sum(weight for _, weight in measurements)
assert f"{weighted / weight_total:.2f}" == "14.00"
```

### 检查点

解释为何对嵌套列表做浅复制后，修改一行可能影响原列表。再用含重复值和负数的一组记录，比较原序列、不同值排名和按键稳定排序的结果。

### 参考答案

### 关联题目

[]

## 章节：03. 字符串与文本布局 · Strings

### 学习目标

掌握字符串的不可变性、分割和连接、字符分类、子串查找、定宽分块和文本布局。

### 正文

#### 字符串是不可变的文本序列

字符串可用单引号、双引号或三引号表示。常见转义包括 `\n` 换行、`\t` 制表符和 `\\` 反斜杠。使用 `repr(text)` 可以看见普通打印不易辨认的空白。`len(text)` 数 Unicode 码点，`ord(char)` 将单个字符转换为码点，`chr(number)` 反向转换。ASCII 范围里的英文字母码点连续，适合用来生成字母序列。包含多码点表情或全宽字符时，`len()` 与视觉宽度可能不同。

用下标读取字符，用 `text[start:stop]` 读取半开区间。替换某段文本可拼接前缀、新内容和后缀。相同的 start 和 stop 对应插入。负步长可以反转文本，`text[::-1]` 会产生一个反序字符串。

```python
text = "front desk"
patched = text[:6] + "gate" + text[10:]
assert patched == "front gate"
assert "abcd"[-2::-1] == "cba"
assert "".join(chr(ord("M") + i) for i in range(3)) == "MNO"
```

#### 大小写、字符分类与空白

`lower()`、`upper()`、`swapcase()` 分别转换为小写、大写和交换大小写。`capitalize()` 会大写开头字符，并小写余下字符。若要保留词内原样，只转换首字符再拼回后缀。`title()` 按自己的词边界规则处理标题，遇到撇号等符号时应先验证结果。做 Unicode 不区分大小写的比较可用 `casefold()`。

`isalpha()`、`isdecimal()`、`isdigit()`、`isalnum()`、`isspace()` 检查整个非空字符串是否符合字符类别。数字类别依次有不同覆盖范围，例如 `"²".isdigit()` 为真而 `isdecimal()` 为假。只接受 ASCII 时可结合 `isascii()` 或显式字符范围。判断“有一个”用 `any()`，“全部”用 `all()`；空序列的 `any` 为假，`all` 为真，而空字符串的 `isalnum()` 为假。

`split()` 按连续空白分组并忽略首尾空白。`split(" ")` 只在字面空格处切割，连续空格会留下空字段，便于原样接回。`strip()` 只处理首尾空白，`splitlines()` 按行拆分。`join()` 要求所有项都是字符串。空白有业务含义时，先决定保留、规范化还是丢弃。

```python
source = "  oak\t pine  "
assert source.split() == ["oak", "pine"]
assert source.split(" ") == ["", "", "oak\t", "pine", "", ""]
assert "/".join(source.split()) == "oak/pine"
assert "aBC".capitalize() == "Abc"
assert "aBC"[:1].upper() + "aBC"[1:] == "ABC"
```

#### 查找、重叠与分块

`pattern in text` 检查是否存在，`text.find(pattern)` 返回第一次出现的起点或 -1，`index()` 找不到时抛出异常。`startswith(pattern, i)` 可从指定位置匹配，`endswith()` 可检查末尾。`count()` 统计非重叠出现次数。允许重叠时逐起点检查，最后合法起点是 `len(text) - len(pattern)`。统计所有子串时，长度 n 的文本在起点 i 后有 `n-i` 个非空子串，无需逐个构造就能计算按首字符分组的数量。

用 `range(0, len(text), width)` 找块起点，再用切片取固定宽度。宽度必须为正，末块可以较短。需要按行宽排版自然语言时，可用 `textwrap.wrap()`，它按自己的换行和空白规则工作。要在各块内保留第一次出现的字符，可遍历字符时用集合记录是否已见，或用 `dict.fromkeys(block)` 按插入顺序去重。

```python
text = "abcabca"
assert text.count("abca") == 1
assert [i for i in range(len(text)) if text.startswith("abca", i)] == [0, 3]
blocks = [text[i:i + 3] for i in range(0, len(text), 3)]
assert blocks == ["abc", "abc", "a"]
assert "".join(dict.fromkeys("balloon")) == "balon"
```

#### 对齐、镜像与数值栏位

`ljust()`、`rjust()`、`center()` 将字符串填充到最小宽度，可以指定一个填充字符。格式说明符 `<`、`>`、`^` 可把对齐和类型格式结合，如 `f"{31:>6X}"`。前缀可用 `#` 控制，`b`、`o`、`x`、`X` 各表示不同进制或大小写。需要把奇数个空位中的额外一格固定给右边时，手工计算左宽 `extra // 2` 和右宽 `extra - left`。

文本图案可先确定每行宽度、内容宽度和离中心的距离，再计算填充。镜像时可反转去掉中心的半段，避免重复中心字符。生成多行后用 `"\n".join(lines)` 统一连接，有助于检查末尾换行。

```python
caption, width = "map", 8
extra = width - len(caption)
left = extra // 2
assert "." * left + caption + "." * (extra - left) == "..map..."
assert f"{255:d} {255:X} {255:b}" == "255 FF 11111111"
```

### 检查点

预测默认拆分和字面空格拆分对含制表符文本的差别。再手算一段有重叠匹配的文本、一个末块不足宽的分块结果，以及一行左右填充量不同的标题。

### 参考答案

### 关联题目

[]

## 章节：04. 集合与关系判断 · Sets

### 学习目标

能在去重、成员查询、集合运算和频次统计之间选择合适的数据结构，并正确处理包含关系。

### 正文

#### 集合、元素与成员查询

集合存储互不重复的可哈希元素，适合快速判断 `x in group`。可用 `{1, 2}` 或 `set(iterable)` 创建，空集合写成 `set()`，`{}` 创建空字典。整数、字符串和成员均可哈希的元组可以放入集合，普通列表不行。字符串区分大小写。集合没有可用作业务约定的顺序，输出要求有序时使用 `sorted(group)`。要保留第一次出现的次序，可以另用列表或插入有序的字典保存顺序。

去重会丢弃出现次数。独立元素的平均值应对集合求和并除以不同元素数量；事件评分通常需要保留事件列表，对每个事件用集合做成员查找。空集合不能直接求平均。

#### 四种集合运算与包含关系

| 关系 | 运算符或方法 | 语义 |
| --- | --- | --- |
| 并集 | `a \| b`、`a.union(b)` | 在任一方出现 |
| 交集 | `a & b`、`a.intersection(b)` | 两方共有 |
| 差集 | `a - b`、`a.difference(b)` | 在 a 中且不在 b 中 |
| 对称差 | `a ^ b`、`a.symmetric_difference(b)` | 恰好在一方出现 |
| 子集与超集 | `a <= b`、`a >= b` | 允许两者相等 |
| 严格子集与严格超集 | `a < b`、`a > b` | 包含关系成立并且有额外元素 |
| 不相交 | `a.isdisjoint(b)` | 交集为空 |

运算符通常要求集合操作数，方法形式可以接收一般可迭代对象。差集交换左右会改变含义。集合的大小无法单独决定包含关系。用 `all(required <= available for required in requests)` 检查每一项需求，无需求时结果为真。换成严格包含时，即使内容相同也不通过。

```python
morning, afternoon = {"Ada", "Lin"}, {"Lin", "Mei"}
assert morning & afternoon == {"Lin"}
assert morning ^ afternoon == {"Ada", "Mei"}
assert morning - afternoon == {"Ada"}
assert set() < morning and not morning < morning
assert all(morning > group for group in [])
```

#### 修改集合与消除成对元素

`add(x)` 加入一项，`discard(x)` 删除存在的项，缺失时静默返回。`remove(x)` 在缺失时抛出 `KeyError`。`pop()` 取出一个未指定元素，若业务要求取最小值，先确认非空再用 `min()`。`update()`、`intersection_update()`、`difference_update()`、`symmetric_difference_update()` 原地应用对应关系，适合依次处理变更。需要可哈希的不可变集合时，可用 `frozenset`。

定位只出现一次的元素，可以用 `Counter` 保存精确频次。在其他整数都成对出现的前提下，也可从零开始做整数异或。整数满足 `x ^ x == 0` 和 `x ^ 0 == x`，成对值互相抵消。输入允许任意频次时应按实际规则选择计数，异或只保存奇偶性的信息。

```python
permissions = {"read", "write"}
permissions.update(["share", "read"])
permissions.difference_update(["write", "manage"])
assert sorted(permissions) == ["read", "share"]

odd = 0
for value in [5, -3, 5, 8, 8]:
    odd ^= value
assert odd == -3
```

### 检查点

画出两个部分重叠集合，分别写出四种运算结果。用空集合、相等集合和元素数较多但有缺项的集合验证严格包含。再说明哪些统计可以先去重，哪些必须保留重复次数。

### 参考答案

### 关联题目

[]

## 章节：05. 数值计算与数学模式 · Math

### 学习目标

能选择适当的数值类型，用整数算术、数学函数和序列构造表达计算过程。

### 正文

#### 整数、浮点数与舍入

Python 的 `int` 可以精确保存很大的整数，实际大小受内存等资源限制。`float` 使用有限精度，许多十进制小数只能近似表示。整数计数、幂和余数应尽量保持整数运算；距离、角度和统计量通常用浮点。近似值可用 `math.isclose()` 比较，接近零时可按需求设绝对容差。金融等需要十进制精确表示的场景可用从字符串构造的 `Decimal`，有理数可用 `Fraction`。

`math.floor()` 向负无穷取整，`math.ceil()` 向正无穷取整，`int()` 对浮点向零截断。`round()` 就近舍入，正好在中点时取偶数。格式化如 `f"{value:.4f}"` 负责显示位数，并不改变原数值。很小的负浮点数可能显示为负零；如果显示规范要求正零，Python 3.12 可用 `z` 格式选项，如 `f"{value:z.4f}"`。

```python
import math
from decimal import Decimal

assert math.isclose(0.1 + 0.2, 0.3)
assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
assert (math.floor(-2.3), math.ceil(-2.3), int(-2.3)) == (-3, -2, -2)
assert (round(2.5), round(3.5)) == (2, 4)
assert f"{-0.00001:z.4f}" == "0.0000"
```

#### 整除、取模与快速模幂

对非零整数 b，`divmod(a, b)` 得到商 q 和余数 r。它们满足 `a == b*q + r`，q 向下取整，非零余数与 b 同号，且 `abs(r) < abs(b)`。整数循环编号或整除判断常用 `%`。直接用 `//`，可以避免 `int(a / b)` 的方向与精度问题。

`a ** n` 和双参数 `pow(a, n)` 可做乘方。整数底数和非负整数指数的结果保持整数，指数为 0 时结果为 1，包括 `0 ** 0`。三参数 `pow(a, n, m)` 在运算中约模，适合计算大指数的余数，m 不能为 0。正模数为 1 时余数总是 0。`math.pow()` 使用浮点数，精确整数运算应使用内置运算。大整数转十进制文本用 `str()`。

```python
assert divmod(17, -5) == (-4, -3)
assert divmod(-17, 5) == (-4, 3)
assert pow(3, 20, 7) == (3 ** 20) % 7 == 2
assert pow(0, 0, 1) == 0
assert str(10 ** 30 + 1).endswith("001")
```

#### 平面距离、复数与角度

点 `(x, y)` 到原点的距离可用 `math.hypot(x, y)` 计算。复数 `complex(x, y)` 的 `.real` 和 `.imag` 是实部与虚部，`abs(z)` 给出模长。`math.atan(y / x)` 可由斜率求角，但 x 为 0 时无法做除法，只凭比值也不能判断象限。`math.atan2(y, x)` 分别接收纵、横分量，能区分象限并处理竖直方向，结果是弧度。坐标原点没有几何方向，应由程序明确如何表示。也可用 `cmath.phase(z)` 求复数的相位角。

`math.degrees(radians)` 把弧度转为度数，`math.radians(degrees)` 反向转换。显示角度时应标出单位。两条分量符号相反时，尤其要核对 `atan2` 的参数顺序。

```python
import math

z = complex(-3, 4)
assert abs(z) == math.hypot(-3, 4) == 5
assert math.isclose(math.degrees(math.atan2(4, 0)), 90)
assert 90 < math.degrees(math.atan2(z.imag, z.real)) < 180
```

#### 从数列构造文本图案

先用 `range()` 定义一行中的整数序列，再用 `str()` 转成文本并用 `join()` 连接。若需要重复一个符号，字符串乘法 `symbol * count` 会重复整个字符串。要构造镜像，可保留序列中间项一次，再用切片倒序追加剩余部分。元素可能有多位数字时，应在数列层面镜像，随后格式化。反转已经拼好的文本会连各元素内部的字符一并反转。

```python
row = [8, 9, 10]
mirrored = row + row[-2::-1]
assert " ".join(map(str, mirrored)) == "8 9 10 9 8"
assert ["[]" * size for size in range(1, 4)] == ["[]", "[][]", "[][][]"]
```

### 检查点

手算一正一负和两负的整除结果，检查商和余数能否还原被除数。画出四个象限并预测角度正负。用多位数字解释镜像数列和反转字符串的区别。

### 参考答案

### 关联题目

[]

## 章节：06. 迭代工具与组合枚举 · Itertools

### 学习目标

理解可迭代对象和迭代器，能按顺序生成组合、消费连续分组，并用组合计数推导概率。

### 正文

#### 可迭代对象与一次性消费

列表、字符串和 `range` 可反复遍历。调用 `iter(values)` 得到一个迭代器，`next(iterator)` 每次取下一项，耗尽时抛出 `StopIteration`。生成器表达式和大多数 `itertools` 工具返回按需产生结果的迭代器。调用 `list(iterator)` 会把剩余值全部取出并保存；只需计数、最值或聚合时可以直接遍历，避免同时保存全部输出。

```python
items = iter(["first", "second", "third"])
assert next(items) == "first"
assert list(items) == ["second", "third"]
assert list(items) == []
```

#### 笛卡尔积、排列与组合

| 要生成的对象 | 工具 | 顺序与重复规则 |
| --- | --- | --- |
| 从各组取一项 | `product(a, b)` | 组有固定位置，右边一组变化最快 |
| 从一组取 k 项排列 | `permutations(items, k)` | 区分顺序，不重复使用同一位置 |
| 从一组取 k 项组合 | `combinations(items, k)` | 只按输入位置递增取项 |
| 从一组取 k 项可重复组合 | `combinations_with_replacement(items, k)` | 输入位置非递减，同一位置可多次使用 |

这些工具区分的是输入位置。相同的值出现在两个位置时，可能产生相同的输出元组。若要求按值的字典序生成，可先排序输入，并根据实际规则决定是否去重。取零项时有一种空选法，得到一个空元组。普通排列与组合中 k 大于输入长度时没有结果。组数可变时，用 `product(*groups)` 把各组展开为参数。

```python
from itertools import combinations, combinations_with_replacement, permutations, product

assert list(product("AB", [1, 1])) == [("A", 1), ("A", 1), ("B", 1), ("B", 1)]
assert list(permutations("AB", 2)) == [("A", "B"), ("B", "A")]
assert list(combinations("AB", 2)) == [("A", "B")]
assert list(combinations_with_replacement("AB", 2)) == [
    ("A", "A"), ("A", "B"), ("B", "B")
]
assert list(combinations("AB", 0)) == [()]
```

#### 连续分组与全局计数

`groupby(iterable, key=...)` 在键值变化处切开，返回 `(key, group)`。同一键隔一段后再次出现时会开启新组，适合处理连续运行记录。若目的是真正按键合并，可先按相同键排序再分组，或用字典、`Counter` 保留全局状态。子迭代器共享数据源，应在进入下一组前消费当前组，如 `sum(1 for _ in group)`。

```python
from itertools import groupby

logs = ["idle", "idle", "run", "run", "idle"]
runs = [(state, sum(1 for _ in group)) for state, group in groupby(logs)]
assert runs == [("idle", 2), ("run", 2), ("idle", 1)]
```

#### 组合概率与搜索空间

`math.comb(n, k)` 计算从 n 个不同位置中不放回选 k 个的方式，不计顺序。均匀选样时，概率是符合条件的选法数除以总选法数。对“至少一个”可数补事件，先算完全避开的选法数，再从总数中减去。k 为 0 时有一种空选法，指定项目出现的概率为 0。计数保留为整数，最后再做除法并按所需精度显示。

笛卡尔积的候选数量等于各组长度的乘积，可以边生成边用 `max()` 或循环保存最优值。对先聚合再取模的目标，取模会打乱原来的大小顺序，局部最大不一定给出全局最优。如果后续计算只依赖当前余数，可以将同余状态合并，每一步保留可达的不同余数。

```python
from math import comb

# 四种书籍里有一种是图册，抽取两种。
total = comb(4, 2)
with_atlas = total - comb(3, 2)
assert f"{with_atlas / total:.6f}" == "0.500000"
```

### 检查点

列出三个符号取两个时的三种组合方式。构造一个连续组与全局频次不同的记录。再解释空选法为何只有一种，以及取模优化中何时可以合并两个部分状态。

### 参考答案

### 关联题目

[]

## 章节：07. 计数与专用容器 · Collections

### 学习目标

能用标准库容器维护频次、位置、字段名和双端状态，并在输出时处理顺序、并列和空容器。

### 正文

#### 字典、默认值与插入顺序

普通字典按键存取值。`mapping[key]` 读取缺失键会抛出 `KeyError`，`mapping.get(key, default)` 只读。`setdefault(key, default)` 在缺失时保存默认值。`defaultdict(list)` 则在使用下标访问缺失键时调用工厂创建空列表，适合把多个值分配给同一键；它的 `.get()` 不会触发默认工厂。遍历 `.items()` 可以同时获得键和值。

字典保留键的插入顺序。更新已有键不会改变位置，删除再插入会移动到末尾。按首次出现的顺序聚合时，可累加到同一字典键，并按业务需要保留总量为 0 的记录。`OrderedDict` 还提供 `move_to_end()` 等专门操作。构建倒排索引可用 `enumerate()` 收集每个键出现的位置，逐项查询可以保留查询顺序和重复项。

```python
from collections import defaultdict

events = ["rain", "sun", "rain", "fog"]
positions = defaultdict(list)
for index, event in enumerate(events):
    positions[event].append(index)

assert positions["rain"] == [0, 2]
assert positions.get("wind", []) == []
assert "wind" not in positions
assert list(positions) == ["rain", "sun", "fog"]
```

#### Counter 与多重集合

`Counter(iterable)` 创建值到次数的字典，读取缺失项为 0。`update()` 增加次数，`subtract()` 可将次数减到零或负数，键仍会保留。只有计数为正的项会按重复次数从 `elements()` 产生，适合将库存数量转换回单位列表。每次消耗资源前检查当前次数，可以处理同一资源的重复请求。

`most_common()` 按频次降序，同频按首次出现顺序。如果业务规定字母顺序作为次关键字，可排序 `.items()`，键为 `(-count, name)`。先排序再用 `[:k]` 限制输出数，k 为 0 时自然返回空列表。

```python
from collections import Counter

votes = Counter(["violet", "orange", "blue", "violet"])
assert votes["green"] == 0
assert [name for name, _ in votes.most_common()] == ["violet", "orange", "blue"]
ranked = sorted(votes.items(), key=lambda item: (-item[1], item[0]))
assert ranked == [("violet", 2), ("blue", 1), ("orange", 1)]
```

#### 用字段名描述记录

当列的顺序可以变化时，先读表头，再将每行转换成有字段名的记录。`dict(zip(headers, row))` 便于按键访问，必要时用 `zip(..., strict=True)` 检查长度。`namedtuple("Record", headers)` 创建可按属性访问的元组类；可用 `Record(*row)` 初始化，并用 `.field` 读取字段。字段名须符合其命名规则。遍历时可以只取需要的字段，同时保留各行原顺序。

```python
from collections import namedtuple

headers = ["depth", "site", "height"]
Reading = namedtuple("Reading", headers)
reading = Reading(3, "north", 12)
assert (reading.site, reading.height - reading.depth) == ("north", 9)
```

#### deque 与两端贪心

`deque` 支持两端追加与弹出。左边用 `appendleft()`、`popleft()`，右边用 `append()`、`pop()`。两端操作通常是常数时间，普通列表的 `pop(0)` 需要移动后续项。空队列弹出会抛出 `IndexError`。`rotate(k)` 正数右旋，负数左旋，可用 `list(queue)` 转回列表。

从两端取值构造单调序列时，要说明为何当前选择不会丢失可行解。例如所有元素最终都要取出、且结果必须非递增时，当前最大剩余元素必须先出场。比较两个端点，尝试选较大者，若它比上一次取值大，则不能接到已有序列后。相等允许时使用非严格比较。也可用两个下标模拟双端操作，避免修改输入。

```python
from collections import deque

queue = deque(["blue", "green"])
queue.appendleft("amber")
queue.rotate(1)
assert list(queue) == ["green", "amber", "blue"]
assert queue.popleft() == "green"
assert queue.pop() == "blue"
```

### 检查点

用一个缺失键分别测试 get、defaultdict 下标与 Counter 下标，观察键是否被创建。预测一次负旋转，再用有并列和中间最大值的序列解释端点选择。

### 参考答案

### 关联题目

[]

## 章节：08. 日期与时区 · Date and Time

### 学习目标

能构造公历日期、读取星期与格式化时间，区分本地表盘时间和 UTC 时刻，并计算完整时间差。

### 正文

#### 日期、星期与公历规则

`datetime.date(year, month, day)` 表示日历日期。构造时会检查月份和日是否合法，可用 `.year`、`.month`、`.day` 读取。`date.weekday()` 以周一为 0、周日为 6，`isoweekday()` 从 1 到 7。`calendar.weekday()` 也使用从 0 开始的规则。固定英文输出可用以周一为首的名称序列按下标取值；`strftime("%A")` 的语言受运行环境影响。

公历闰年遵循周期和例外规则。能被 4 整除通常是闰年，能被 100 整除的年须同时能被 400 整除。使用 `calendar.isleap()` 可直接判断，也可以用余数和布尔条件表达这一规则。闰年二月有 29 天。日期加减可用 `timedelta(days=...)`，让日期对象处理月末和年末进位。

```python
import calendar
from datetime import date, timedelta

assert not calendar.isleap(2100)
assert calendar.isleap(2400)
assert date(2028, 2, 28) + timedelta(days=1) == date(2028, 2, 29)
assert date(2024, 1, 1).weekday() == 0
```

#### 时间戳、偏移与解析

`datetime` 表示日期加时间。带时区的对象称为 aware，对应某个可定位的时刻。不带时区的 naive 对象只表达表盘读数。`datetime.fromisoformat()` 可解析 ISO 风格文本，显式 `+HH:MM` 或 `-HH:MM` 表示相对 UTC 的固定偏移。已知自定义格式时可用 `strptime()` 解析，常用标记包括 `%Y` 年、`%m` 月、`%d` 日、`%H` 时、`%M` 分、`%S` 秒和 `%z` 偏移。`strftime()` 按模板输出，`.isoformat()` 输出 ISO 风格文本。

`astimezone(timezone.utc)` 换算到 UTC 并保持同一时刻。`replace(tzinfo=...)` 只替换时区信息，会改变原表盘读数所代表的时刻。需要由地区规则计算夏令时时，可用 `zoneinfo.ZoneInfo`，固定偏移本身没有地区的历史变化规则。

#### 时间差与单位转换

两个 aware 时间可以相减得到 `timedelta`。需要按绝对时间比较时，可先把双方转换为 UTC，尤其在地区时区跨偏移变化时。naive 和 aware 不能直接相减。`total_seconds()` 包含天数、秒和微秒，可得到负值。`.seconds` 是归一化后不足一天的非负秒数，不能代替总秒数。需要无方向的时差可取绝对值；已知输入精确到秒时可转为整数。

```python
from datetime import datetime, timezone

left = datetime.fromisoformat("2025-12-31T23:45:00-02:00")
right = datetime.strptime("2026-01-01 01:45:00 +0000", "%Y-%m-%d %H:%M:%S %z")
assert left.astimezone(timezone.utc) == right
later = datetime.fromisoformat("2026-01-02T02:15:00+00:00")
assert (later - right).total_seconds() == 88200
assert (right - later).total_seconds() == -88200
```

### 检查点

写出两个日期不同却指向同一 UTC 时刻的时间戳。再计算超过一天的时间差，并用负时间差解释 seconds 与 total_seconds 的区别。

### 参考答案

### 关联题目

[]

## 章节：09. 异常与错误恢复 · Errors and Exceptions

### 学习目标

能阅读异常类型和调用栈，区分格式验证与运算错误，在局部恢复并保持整批处理结果的对应关系。

### 正文

#### 识别错误发生在哪一步

解析阶段的 `SyntaxError` 通常来自代码语法。程序开始执行后，还可能遇到 `ValueError`、`TypeError`、`ZeroDivisionError`、`IndexError` 等。读 traceback 时先看底部的异常类型与消息，再沿调用栈找到自己写的、实际触发异常的那一行。相同的“无法完成”可能源于输入不合格式、值越界、类型不符或运算前置条件不满足。

#### 预先验证与异常捕获

若输入契约只接受可选正负号和 ASCII 数字，可以用 `re.fullmatch(r"[+-]?[0-9]+", text)`，需要限长度时换成 `{m,n}`。直接调用 `int()` 的接受范围更宽，包括首尾空白、某些 Unicode 数字和数字间的下划线。只有规则允许时才做 `strip()` 等预处理。多个输入要分别验证，再判断零除等计算条件，错误优先级由业务规则明确。

`try` 放入可能失败的少量语句。`except SomeError as exc` 捕获并记录特定异常，多个异常可写成元组，也可分支处理。`else` 只在 try 成功时执行，`finally` 无论是否抛错都会执行，适合清理资源。不要用裸 `except` 吞掉意料外的程序错误。调用方需要知道失败时可用 `raise` 主动抛出或在处理后重新抛出。批量任务若允许单项失败，可在循环体内处理，并为每项给出结果或明确的失败状态。

```python
import re

def read_signed_token(text):
    if re.fullmatch(r"[+-]?[0-9]{1,4}", text) is None:
        raise ValueError("invalid signed token")
    return int(text)

outcomes = []
for token in ["+15", " 9", "-0", "3_0", "-11"]:
    try:
        value = read_signed_token(token)
    except ValueError:
        outcomes.append(None)
    else:
        outcomes.append(value)

assert outcomes == [15, None, 0, None, -11]
```

#### 除法与正则语法失败

`/`、`//` 和 `%` 的除数为零时会抛出 `ZeroDivisionError`。可以先判零，或捕获这个明确的异常。文本 `"-0"` 转换后也是整数 0。向下取整的商可用 `//`，与浮点商转整数不同。一次只捕获你准备恢复的错误，避免把格式异常和除零异常合并为含糊的输出。

`re.compile(pattern)` 验证模式语法并返回可复用的模式对象。Python 3.12 的语法错误可捕获 `re.error`。编译成功只说明模式合法，未必会匹配给定文本。空模式可以编译，也能产生零长度匹配。用户给出的字面文本若要拼进模式，应按字面处理或用 `re.escape()`。

```python
import re

def compiles(pattern):
    try:
        re.compile(pattern)
    except re.error:
        return False
    return True

assert [compiles(pattern) for pattern in (r"a+", "(", "")] == [True, False, True]
try:
    value = 3 // 0
except ZeroDivisionError:
    value = None
assert value is None
```

### 检查点

为一批含非法格式、零除和正常项的输入设计错误优先级。预测空正则、未闭合括号和有效但匹配不到文本的模式会在哪一步失败。

### 参考答案

### 关联题目

[]

## 章节：10. 类与向量几何 · Classes

### 学习目标

能定义类、初始化实例、实现方法和运算符，并用对象表达复数与向量的计算过程。

### 正文

#### 类、实例与方法

`class` 定义一类对象的行为。调用类时会构造实例，并通过 `__init__(self, ...)` 初始化实例状态。方法的第一个参数 `self` 指当前实例，调用 `obj.method(value)` 时 Python 会自动传入它。用 `self.x` 保存实例属性。类属性由实例共享读取，因此独立的可变状态通常应在 `__init__` 内初始化。

对象可以封装有效的数据与对它的操作。表示坐标的对象可以存不可变的元组，在加法或平移时创建新对象。需要普通数据时，可提供转换方法，将实例转换成列表或字典。Python 可通过特殊方法调用对象的行为，例如 `__add__` 对应 `+`，`__mul__` 对应 `*`，`__abs__` 对应 `abs()`，`__repr__` 控制调试显示。二元运算遇到不支持的操作数类型时，可返回 `NotImplemented`，让 Python 尝试对应的反向操作或抛出类型错误。

```python
class Displacement:
    def __init__(self, dx, dy):
        self.dx = dx
        self.dy = dy

    def __add__(self, other):
        if not isinstance(other, Displacement):
            return NotImplemented
        return Displacement(self.dx + other.dx, self.dy + other.dy)

    def as_list(self):
        return [self.dx, self.dy]

step = Displacement(2, -1)
combined = step + Displacement(3, 4)
assert combined.as_list() == [5, 3]
assert step.as_list() == [2, -1]
```

#### 复数的分量与模

设复数为 `a + bi`，i² 等于 -1。复数加法按分量相加，乘法先分配再合并，实部为 `ac - bd`，虚部为 `ad + bc`。取模得到 `sqrt(a² + b²)`，可用 `math.hypot(a, b)`。

Python 用 `j` 表示虚数单位，可以写 `3 + 4j`，也可用 `complex(a, b)`。内置复数的 `.real` 和 `.imag` 是浮点数。当输入分量是整数且需要对任意大的整数保持精确时，可以用两个整数属性实现运算，再对模长使用浮点近似。显示小数位数由格式化控制。

```python
import math

z = complex(1, 2)
rotation = 1j
rotated = z * rotation
assert (rotated.real, rotated.imag) == (-2.0, 1.0)
assert math.isclose(abs(z), abs(rotated))
```

#### 向量差、点积、叉积与夹角

从点 A 到点 B 的方向向量是 B 减 A。两个等维向量的点积是对应分量乘积之和，可用 `sum(a*b for a, b in zip(u, v))`。三维叉积返回垂直于两输入的向量，三个分量依次为 `uy*vz - uz*vy`、`uz*vx - ux*vz`、`ux*vy - uy*vx`。输入交换后方向反转。用同一平面的两个不共线方向向量做叉积，可得到平面法向量；共线或重复点会得到零向量。

非零向量的夹角由点积与两者模长的乘积相除得到余弦。浮点误差可能令余弦稍超出 [-1, 1]，计算 `acos()` 前可用 `min(1.0, max(-1.0, cosine))` 约束在范围内。结果默认是弧度，用 `math.degrees()` 可转为 0 到 180 度。点积为负对应钝角，取绝对值会丢失这一区别。零向量没有方向，应先处理其夹角无定义的情形。

```python
import math

u = (1, 0, 0)
v = (-1, 1, 0)
dot = sum(a * b for a, b in zip(u, v))
cosine = dot / (math.hypot(*u) * math.hypot(*v))
angle = math.degrees(math.acos(min(1.0, max(-1.0, cosine))))
assert math.isclose(angle, 135)
```

### 检查点

用两个实例验证属性是否各自独立。画出纯虚数乘法的旋转方向，手算一组点积与叉积，再说明零法向量和钝角应怎样处理。

### 参考答案

### 关联题目

[]

## 章节：11. 内置函数与自定义排序 · Built-Ins

### 学习目标

能用内置函数进行配对、聚合与稳定排序，并用明确的数据结构实现精确求值。

### 正文

#### zip、拆包与位置聚合

`zip(a, b)` 按位置给出元组，默认在最短输入用完时停止。需要长度相同时可用 `strict=True` 检查，长度不符时在消费迭代器的过程中抛出 `ValueError`。对于矩形的行列表，`zip(*rows)` 将每一行展开为一个参数，再把同一列的值组合成元组。可用 `sum()`、`min()` 或 `max()` 对每列聚合。若没有行，`zip(*rows)` 不产生列，空数据的输出形状需由数据定义决定。

```python
rows = [(3, 5, 2), (1, 4, 8)]
columns = list(zip(*rows, strict=True))
assert columns == [(3, 1), (5, 4), (2, 8)]
assert [max(column) for column in columns] == [3, 5, 8]
```

#### 排序键、稳定性与复合顺序

`sorted(iterable, key=..., reverse=...)` 返回新列表，`list.sort()` 原地排序。排序键是每项用于比较的派生值，可以用命名函数、`lambda` 或 `operator.itemgetter()` 提取字段。两者都是稳定排序，键相等的元素保持原相对顺序。若需按多项规则比较，可返回元组，依次比较各字段。混合升降序时，可对数值键取负来反转某一个字段。对字符分类时，先计算组优先级，再比较同组内的字符。若保留并列的原始顺序，就只用指定主键。

```python
from operator import itemgetter

records = [("moss", 3), ("fern", 1), ("ivy", 3)]
assert sorted(records, key=itemgetter(1)) == [("fern", 1), ("moss", 3), ("ivy", 3)]

def category(char):
    if char.isupper():
        return 0
    if char.islower():
        return 1
    return 2

assert "".join(sorted("z2AZa2", key=lambda char: (category(char), char))) == "AZaz22"
```

#### 真值、短路与空序列

`bool(value)` 反映对象真值，空容器和零为假。`all(iterable)` 检查是否所有项为真，遇假立即停止；`any(iterable)` 检查是否有真项，遇真立即停止。空序列的 `all()` 为真，`any()` 为假。如果业务要求非空，另行检查 `bool(values)`。布尔运算符 `and` 和 `or` 可返回操作数本身，若接口要求布尔类型，应明确转为 `bool`。生成器表达式可让每个条件按需计算。

```python
def usable_measurements(values):
    return bool(values) and all(value >= 0 for value in values) and any(values)

assert not usable_measurements([])
assert not usable_measurements([0, 0])
assert usable_measurements([0, 5])
```

#### 多项式求值与结构化表达式

给出从高次到低次的系数时，霍纳法每读一项做 `acc = acc * x + coefficient`。处理结束后得到多项式值。系数和 x 都是整数时，全程可以保持精确整数。零系数表示该次项缺失，常数多项式也可用同一个过程。

表达式树可用整数叶子和形如 `[operator, left, right]` 的节点表示。递归先计算左右子树，再执行节点运算。树结构已经表达优先级，减法等操作仍需保持左右顺序。将允许运算写成字典或分支白名单，可使用 `operator.add`、`operator.sub`、`operator.mul`。直接对输入文本调用 `eval()` 会执行 Python 表达式，结构化计算应根据自己的数据规则解释。

```python
from operator import add, mul, sub

def polynomial(coefficients, x):
    total = 0
    for coefficient in coefficients:
        total = total * x + coefficient
    return total

def evaluate(node):
    if isinstance(node, int):
        return node
    symbol, left, right = node
    operations = {"+": add, "-": sub, "*": mul}
    return operations[symbol](evaluate(left), evaluate(right))

assert polynomial([3, 0, -4], 2) == 8
assert evaluate(["-", 20, ["*", 3, ["+", 1, 4]]]) == 5
```

### 检查点

用单行矩阵和长短不一的两行验证 zip 的行为。构造并列键检查稳定性，并手算一个含零系数的多项式和一个含嵌套减法的表达式。

### 参考答案

### 关联题目

[]

## 章节：12. 函数式工具 · Python Functionals

### 学习目标

能区分映射、筛选与归约，正确处理惰性迭代、空输入和精确分数。

### 正文

#### 函数值、lambda 和 map

函数是可传递的值。把函数名写成 `transform` 是传递函数对象，`transform(value)` 才是调用。短小的单表达式函数可用 `lambda parameters: expression`。复杂逻辑用 `def` 命名更容易测试。给定 `map(function, iterable)`，每取出一个结果才执行一次函数，输出与输入一一对应并保序。多个输入可以写成 `map(f, a, b)`，在最短输入耗尽时停止。列表推导式可表达同样的逐项转换。

保持整数的映射应选择整数公式。比如对前 n 个正整数求和，用 `n * (n + 1) // 2`，相邻整数的积一定为偶数。若改用 `/` 会得到浮点数。迭代器一旦耗尽，后续再次遍历通常没有结果，需要复用时可以重新构造或转换为列表。

```python
labels = map(lambda number: f"R-{number:03d}", [2, 5, 9])
assert next(labels) == "R-002"
assert list(labels) == ["R-005", "R-009"]
assert list(labels) == []
assert list(map(lambda n: n * (n + 1) // 2, [0, 4, 100])) == [0, 10, 5050]
```

#### 谓词、filter 与格式校验

谓词是用于判断是否保留某项的函数。`filter(predicate, values)` 保留结果为真的项，顺序不变，重复项也会保留。用 `filter(None, values)` 会按项本身的真值筛选。文本格式验证可先用 `re.compile()` 编译，然后把模式对象的 `.fullmatch` 方法传给 `filter()`。成功返回匹配对象，失败返回 `None`，正好可作为筛选条件。

描述文本格式时可分解为首字符、允许字符集合、长度范围和字面分隔符。例如 `[a-z][a-z0-9_]{0,7}` 要求首字符为小写 ASCII 字母，后面至多七个允许字符。模式中的字面点要写成 `\.`。先校验原文本，后续按需要去重或排序。先去掉空格或改变大小写，可能把原先不合法的值变成合法值。

```python
import re

device = re.compile(r"[a-z][a-z0-9_]{0,7}\.lab")
candidates = ["fan2.lab", " fan2.lab", "Pump.lab", "fan2.lab", "r_4.lab"]
assert sorted(set(filter(device.fullmatch, candidates))) == ["fan2.lab", "r_4.lab"]
```

#### reduce、初值与 Fraction

`functools.reduce(function, iterable, initial)` 从初值出发，将当前累计值和下一项交给二元函数。初值应与运算及返回类型一致。求和的单位元是 0，求积是 1，空输入返回初值。省略初值时，第一项会充当初值，空输入会抛出 `TypeError`。常见加法和乘法已有 `sum()`、`math.prod()`，需要自定义合并规则时可用 `reduce()` 或普通循环。

`fractions.Fraction(numerator, denominator)` 保存精确有理数，会自动约分并让分母为正。输入给出整数分子和分母时直接构造 Fraction，避免先做浮点除法。结果可从 `.numerator` 和 `.denominator` 读出。用 `Fraction(1)` 作为乘法初值，空输入和非空输入都会返回同一类型。

```python
from fractions import Fraction
from functools import reduce
from operator import mul

factors = (Fraction(n, d) for n, d in [(6, 7), (-14, 9)])
result = reduce(mul, factors, Fraction(1))
assert (result.numerator, result.denominator) == (-4, 3)
assert reduce(mul, [], Fraction(1)) == Fraction(1, 1)
```

### 检查点

对同一列表分别执行映射、筛选和归约，解释三者的输出长度。检查重复文本、空输入及含零分子的分数乘积。

### 参考答案

### 关联题目

[]

## 章节：13. 正则与结构化文本解析 · Regex and Parsing

### 学习目标

能编写并组合正则模式，处理整串校验、提取、分割、替换、边界和重叠；能使用解析器按事件读取 HTML。

### 正文

#### 正则表达式的词汇

正则用模式描述一组可能的文本。Python 中常用原始字符串 `r"..."` 写模式，避免 Python 字符串层先处理反斜杠。字面字符一般直接写，点、加号、括号和竖线等元字符若要匹配本身，应转义。将任意字面文本嵌进模式时用 `re.escape(text)`。

| 结构 | 写法 | 用途 |
| --- | --- | --- |
| 字符类 | `[A-Z]`、`[0-9_]`、`[^,]` | 选范围、选一组字符、排除一组字符 |
| 重复 | `?`、`*`、`+`、`{m,n}` | 可选、零次以上、一次以上、指定范围 |
| 分支 | `A\|B` | 尝试匹配其中一个模式 |
| 捕获 | `(...)`、`(?P<name>...)` | 保存编号或命名字段 |
| 非捕获分组 | `(?:...)` | 组合子模式，不产生捕获字段 |
| 边界与锚点 | `\b`、`^`、`$` | 描述词边界、行首和行末条件 |

点号默认匹配除换行外的任意字符。`\d`、`\w`、`\s` 在默认 Unicode 模式下覆盖比 ASCII 更广的数字、词字符和空白。需要 ASCII 时使用明确的字符范围或 `re.ASCII`。要求恰好一个普通空格时，写字面空格。量词默认贪婪，会尽量多匹配，再根据后续条件回退。加 `?` 可变为非贪婪，如 `.*?`。

#### 选择匹配操作并取字段

`fullmatch()` 要求整个字符串匹配，适合格式校验。`match()` 从起始位置尝试，`search()` 在任意位置寻找第一次匹配。`finditer()` 按出现顺序提供匹配对象，便于读 `.group()`、`.start()`、`.end()` 和半开的 `.span()`。 `findall()` 直接返回文本或捕获组，返回形态随捕获组数量变化。多次应用同一模式时可以先 `re.compile()`。命名组可通过 `.group("name")` 取值。先判断匹配对象是否存在，再把数字字段转换为整数。编码、邮编等若需保留前导零，应保留为字符串。

```python
import re

sensor = re.compile(r"(?P<zone>[A-Z]{2})-(?P<id>[0-9]{2,4})")
matched = sensor.fullmatch("NW-007")
assert matched is not None
assert (matched.group("zone"), int(matched.group("id"))) == ("NW", 7)
assert sensor.fullmatch("NW-007 ") is None
assert sensor.search("updated NW-007!").span() == (8, 14)
```

#### 分割、连续段和替换

`re.split()` 在模式匹配处切分。用量词可将连续分隔符视为一段，若不希望分隔符进入结果，避免使用捕获组。开头或结尾正好是分隔符时，结果可能包含空项，是否过滤取决于文本规则。

寻找最大连续段时，可用 `[A-Z]{2,}` 匹配至少两个连续大写字母。默认贪婪会读完整段，段可以位于文本首尾。`re.sub(pattern, replacement, text)` 用字符串或回调替换匹配。回调接收匹配对象，适合按匹配内容查不同的替换词。`\b` 表示词字符与非词字符之间的边界，在 ASCII 模式下词字符仍包括下划线。

```python
import re

assert re.split(r"[,;]+", "sky,,sea;land") == ["sky", "sea", "land"]
assert re.findall(r"[A-Z]{2,}", "ABmXYZpQ") == ["AB", "XYZ"]
aliases = {"temp": "temperature", "hum": "humidity"}
result = re.sub(r"\b(?:temp|hum)\b", lambda m: aliases[m.group()], "temp, hum, temp_raw", flags=re.ASCII)
assert result == "temperature, humidity, temp_raw"
```

#### 前瞻、后顾和重叠匹配

前瞻 `(?=...)` 检查当前位置后面的文本，后顾 `(?<=...)` 检查前面，否定形式是 `(?!...)` 和 `(?<!...)`。断言只检查条件，不消费所检查的字符。Python 的后顾模式要求固定宽度。需要在任意起点尝试同一个字面模式时，可逐位置调用 `startswith()`，也可用带捕获组的正向前瞻。此时匹配对象本身是零长度，应从捕获组取得真实跨度。

如果只想规范化两个词字符之间的符号段，可在符号模式左右加断言。首尾没有两侧字符的段会保留。`\b` 是否适合取决于词字符定义。比如规定下划线属于分隔符时，应显式写字母数字字符类。把非字母数字判为分隔符之前，可以用 `zip(*rows)` 转置等宽行，再按需要重建文本。

```python
import re

pattern = re.compile(r"(?=(" + re.escape("xyx") + r"))")
assert [match.span(1) for match in pattern.finditer("xyxyx")] == [(0, 3), (2, 5)]
assert re.sub(r"(?<=[A-Za-z0-9])[_-]+(?=[A-Za-z0-9])", " ", "--a__b--c_") == "--a b c_"
assert re.findall(r"(?<![A-Za-z0-9_])ID[0-9]{2}(?![A-Za-z0-9_])", "ID02 xID03 ID045") == ["ID02"]
```

#### 将格式规则与语义规则分层

先验证字符种类、位置、固定分组和长度，再执行规范化与业务计算。可选片段全都允许缺席时，模式也可能接受空串，要按定义明确处理。多种允许写法可用非捕获组包住分支，再整串匹配，避免只验证其中一段。校验有固定长度的数据时，不应先移除可能不合法的分隔符再判断。格式成立后，可以用 `set()` 检查字符唯一性，用 `sum()` 统计某类字符或计算校验和，用 `zip(text, text[offset:])` 对齐比较相隔若干位置的字符。

```python
import re

def is_asset_code(text):
    matched = re.fullmatch(r"([A-Z]{2})(?:-([0-9]{4}))?", text)
    if matched is None:
        return False
    letters, digits = matched.groups()
    return len(set(letters)) == 2 and (digits is None or sum(map(int, digits)) % 2 == 0)

assert is_asset_code("AB-1032")
assert is_asset_code("AB")
assert not is_asset_code("AA")
assert not is_asset_code("AB-1031")
assert not is_asset_code("AB1032")
```

#### 使用 HTMLParser 消费结构化事件

HTML 标签和文本需要按结构识别，使用 `html.parser.HTMLParser` 可以接收解析事件。建立子类后，用 `.feed(fragment)` 输入文本、`.close()` 完成输入。解析只处理传入的字符串。

| 回调 | 收到的数据 |
| --- | --- |
| `handle_starttag(tag, attrs)` | 起始标签，标签名小写，属性是键值对列表 |
| `handle_startendtag(tag, attrs)` | 形如 `<item/>` 的自闭合标签 |
| `handle_endtag(tag)` | 结束标签 |
| `handle_data(data)` | 文本数据片段 |
| `handle_comment(comment)` | 注释内容 |

默认的自闭合回调会转调起始和结束回调。若重写此方法，可以按所需事件显式转发，避免重复计数。属性名由解析器转为小写，缺失属性值可能为 `None`。按标签收集属性名时用字典的集合值，既能合并重复属性，也能保留无属性标签。默认 `convert_charrefs=True` 会在普通文本中解码字符引用，`script`、`style` 等内容遵循解析器自己的规则。只用 `text.strip()` 判断是否全空白时，可原样保存有内容的文本。按事件顺序记录时，将不同回调的结果追加到同一列表。

```python
from html.parser import HTMLParser

class FragmentEvents(HTMLParser):
    def __init__(self):
        super().__init__()
        self.events = []

    def handle_starttag(self, tag, attrs):
        self.events.append(("start", tag, attrs))

    def handle_data(self, text):
        if text.strip():
            self.events.append(("text", text))

    def handle_comment(self, text):
        self.events.append(("comment", text))

parser = FragmentEvents()
parser.feed("<BOX data-Mode='A'> x &amp; y <!--keep--><pin/></BOX>")
parser.close()
assert parser.events == [
    ("start", "box", [("data-mode", "A")]),
    ("text", " x & y "),
    ("comment", "keep"),
    ("start", "pin", []),
]
```

### 检查点

为同一段文本分别设计整串匹配、搜索和替换。构造含制表符、字面点、重叠文本、紧贴下划线的标识符和多余分隔符的输入。最后手写一段 HTML 事件序列，核对属性名、空白和字符引用。

### 参考答案

### 关联题目

[]

## 章节：14. XML 树与递归遍历 · XML

### 学习目标

能读取 XML 元素树，区分属性、文本与子元素，并用递归或显式栈遍历和统计树。

### 正文

#### 从 XML 文本得到元素树

XML 由嵌套元素组成，整个文档有一个根元素。`xml.etree.ElementTree.fromstring(text)` 解析完整文本并返回根元素，语法不合法时抛出 `ParseError`。读取已打开的文件或路径可以用 `ElementTree.parse(...).getroot()`。元素的 `.tag` 是名称，`.attrib` 是属性字典，`.get(name, default)` 可读取单个属性。普通文本在 `.text`，元素闭合后到后续标记之前的文本可在 `.tail`。属性、文本和子元素分别属于不同位置。

`for child in element` 只遍历直接孩子。`element.iter()` 依文档顺序遍历自身和全部后代，也可传入标签名筛选。使用 `.find()` 可选第一个匹配元素，找不到返回 `None`，检查时应使用 `is None`。属性总数可以将各元素的 `len(element.attrib)` 相加，同名属性在不同元素上分别计数。

```python
from xml.etree import ElementTree as ET

root = ET.fromstring('<map scale="small"><river id="a"/> crosses <city/></map>')
assert root.tag == "map"
assert root.get("scale") == "small"
assert root.find("river").tail == " crosses "
assert sum(len(node.attrib) for node in root.iter()) == 2
assert [node.tag for node in root.iter()] == ["map", "river", "city"]
```

#### 根、深度与叶子

以根深度为 0 时，每沿父子边向下走一次就加 1。最大深度是从根到最深节点的边数。没有元素孩子的节点是叶子，即使它有文本或属性，仍可用 `len(node) == 0` 判断。只含根的树深度为 0，有一个叶子。

递归遍历可以接收当前节点和深度，逐个递归进入孩子，再合并统计量。另一种做法是把 `(element, depth)` 放进列表栈，弹出后加入各孩子。栈后进先出，若需要保持文档顺序，可逆序将孩子压栈。每个节点只访问一次；树很深时显式栈可以避免递归深度限制。

```python
from xml.etree import ElementTree as ET

root = ET.fromstring("<park><pond/><garden><oak/><rose>red</rose></garden></park>")
stack = [(root, 0)]
visited = []
while stack:
    node, depth = stack.pop()
    visited.append((node.tag, depth))
    stack.extend((child, depth + 1) for child in reversed(list(node)))

assert visited == [("park", 0), ("pond", 1), ("garden", 1), ("oak", 2), ("rose", 2)]
assert max(depth for _, depth in visited) == 2
assert sum(len(node) == 0 for node in root.iter()) == 3
```

### 检查点

画出一棵有两条不同深度分支的树，标注每个节点的深度和叶子状态。再用单根元素、含文本的叶子和重复属性名验证遍历规则。

### 参考答案

### 关联题目

[]

## 章节：15. 闭包与装饰器 · Closures and Decorators

### 学习目标

能解释作用域和闭包的行为，编写接收配置的装饰器，并正确处理参数转发、返回值和独立调用。

### 正文

#### 作用域和闭包

函数内读取名字时，Python 依次查找局部作用域、外层函数作用域、模块全局作用域和内置作用域。内层函数引用外层局部变量并被返回时，它仍能访问被捕获的变量，这种组合称为闭包。每次调用外层函数，可以创建一组独立的配置。读取外层变量无需声明，若要重新绑定外层函数的变量，使用 `nonlocal`。

闭包通常在调用时读取捕获的变量。循环中创建的多个函数若捕获同一个循环变量，调用时可能都读到最后一个值。可以使用工厂函数为每次迭代建立独立作用域，也可用默认参数固定当时的值。

```python
def make_scaler(factor):
    def scale(value):
        return factor * value
    return scale

double = make_scaler(2)
triple = make_scaler(3)
assert (double(5), triple(5), double(7)) == (10, 15, 14)

scalers = [make_scaler(factor) for factor in (2, 4, 8)]
assert [scale(3) for scale in scalers] == [6, 12, 24]
```

#### 装饰器、包装函数与执行时机

装饰器接收函数并返回新的可调用对象。定义上写 `@decorate`，相当于定义完后执行 `function = decorate(function)`。装饰发生在定义时，包装函数内的代码在以后每次调用时运行。参数化装饰器 `@decorate(option)` 多一层工厂，先用配置创建装饰器，再用装饰器包装函数。多层装饰器按由内到外的顺序应用，调用时从最外层进入。

包装函数可以在调用原函数前转换参数，或在获得结果后再处理。用 `*args` 与 `**kwargs` 转发位置和关键字参数，注意将结果 `return`。用 `functools.wraps` 保留原函数的名称、文档等元信息。对传入列表做预处理时可以创建新列表，保留原数据。文本标识符的前导零有意义时应保留字符串类型。删除固定前缀用 `removeprefix()`，`lstrip(chars)` 会删除任意属于 chars 的前导字符。

```python
from functools import wraps

def cleaned(function):
    @wraps(function)
    def wrapped(values, *args, **kwargs):
        normalized = [value.removeprefix("tag:").upper() for value in values]
        return function(normalized, *args, **kwargs)
    return wrapped

@cleaned
def arrange(values, *, descending=False):
    return sorted(values, reverse=descending)

tags = ["tag:a02", "tag:b01", "tag:a02"]
assert arrange(tags, descending=True) == ["B01", "A02", "A02"]
assert tags[0] == "tag:a02"
assert arrange.__name__ == "arrange"
```

#### 保留结构直到排序完成

当数据含数值字段时，先按字段排序再生成人类可读的标签。字符串中的数字按字符比较，`"10"` 会排在 `"2"` 前；保持数值类型可保留数值顺序。Python 的排序稳定，相同键会保留输入次序，重复项仍存在。需要输出标签时，装饰器可以读取工厂捕获的配置，并在原函数返回结构化数据后再格式化。

```python
from functools import wraps

def with_unit(unit):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            records = function(*args, **kwargs)
            return [f"{value} {unit} ({station})" for station, value in records]
        return wrapped
    return decorate

@with_unit("cm")
def ordered_measurements(records):
    return sorted(records, key=lambda record: record[1])

assert ordered_measurements([("B", 12), ("A", 2), ("C", 12)]) == [
    "2 cm (A)", "12 cm (B)", "12 cm (C)"
]
```

### 检查点

画出工厂调用、函数定义和包装函数调用的顺序。为同一函数创建两个不同配置的包装器，检查配置是否独立、关键字参数是否转发、空列表和并列项是否保留预期语义。

### 参考答案

### 关联题目

[]

## 章节：16. NumPy 数组与数值计算 · Numpy

### 学习目标

能根据形状、轴和 dtype 选择数组操作，区分逐元素与线性代数运算，并准确处理舍入、统计和结果类型。

### 正文

#### ndarray、形状和数据类型

`numpy.ndarray` 把同一种 `dtype` 的值按一个或多个轴组织起来。`np.array(data, dtype=...)` 创建数组，`np.asarray(data, dtype=...)` 可以复用已经符合要求的数组。`.ndim` 是轴数，`.shape` 是每个轴的长度，`.size` 是元素总数。形状 `(n,)` 是一维，`(1, n)` 是一行，`(n, 1)` 是一列。这三者在转置和广播中行为不同。

`a[row, column]` 可同时指定多个轴。`a[::-1]` 沿第一轴反转，`a[:, ::-1]` 沿第二轴反转。基本切片通常共享原数组数据，写入视图可能影响原数组，独立修改前用 `.copy()`。数组转嵌套普通列表用 `.tolist()`，NumPy 标量可用 `.item()`、`int()` 或 `float()` 转换为 Python 类型。JSON 需要可序列化类型。整数精确到 dtype 的范围，必要时将元素转成 Python 整数继续计算。

```python
import numpy as np

matrix = np.array([[2, 4, 6], [1, 3, 5]], dtype=np.int64)
assert (matrix.ndim, matrix.shape, matrix.size) == (2, (2, 3), 6)
assert matrix[:, ::-1].tolist() == [[6, 4, 2], [5, 3, 1]]
reverse = matrix[:, ::-1].copy()
reverse[0, 0] = 99
assert matrix[0, 2].item() == 6
assert np.asarray([], dtype=np.int64)[::-1].tolist() == []
```

#### 重塑、转置、展开与拼接

`reshape(rows, columns)` 改变形状，要求元素总数不变。默认 C 顺序下，二维数组按行读取和填充，可以用一个 `-1` 让 NumPy 推断长度。`.T` 对二维矩阵交换行和列，一维数组的 `.T` 仍是一维。 `.ravel()` 默认按行展开，可能共享原数组；`.flatten()` 总是复制。先转置再展开通常会改变元素的访问顺序。

`np.concatenate((a, b), axis=0)` 沿行轴拼接，同一列的结构必须一致。沿列轴 `axis=1` 拼接时行数要相等。`vstack()` 可纵向堆叠二维数组。`np.stack()` 在现有轴之外新增一个轴，因此输入通常要有相同形状。拼接前可以先写出输出的预期形状。

```python
import numpy as np

data = np.arange(6).reshape(2, 3)
assert data.tolist() == [[0, 1, 2], [3, 4, 5]]
assert data.T.ravel().tolist() == [0, 3, 1, 4, 2, 5]
assert np.concatenate((data, [[6, 7, 8]]), axis=0).shape == (3, 3)
assert np.stack((data, data)).shape == (2, 2, 3)
```

#### 构造矩阵、广播和舍入

`np.zeros(shape)`、`np.ones(shape)`、`np.full(shape, value)` 构造填充值固定的数组，可指定 dtype。 `np.eye(rows, columns, k=offset)` 在列下标减行下标等于 offset 的位置填 1，其他位置填 0。正偏移在主对角线上方，负偏移在下方，超出边界时整个矩阵为零。

`+`、`-`、`*`、`/` 在数组上逐元素运算。形状不同但可广播时，从最右侧对齐各维，长度相同或其中之一为 1 的维度相容，缺失的前导维视为 1。例如 `(2,3)` 与 `(3,)` 结合时，一维值应用到每行。`(2,1)` 则会在列方向展开。形状不相容时 NumPy 抛出错误。数值条件可以生成布尔数组，组合条件用 `&`、`|` 并用括号包住各比较；可用 `.any()`、`.all()` 汇总。

`np.floor()` 向负无穷取整，`np.ceil()` 向正无穷取整，`np.rint()` 就近取整并在中点取偶数。`.astype(np.int64)` 将浮点转成整数时会向零截断，想要其他舍入规则应先调用相应函数，再转换到合适的整数 dtype。

```python
import numpy as np

assert np.eye(2, 3, k=-1, dtype=int).tolist() == [[0, 0, 0], [1, 0, 0]]
assert (np.ones((2, 3), dtype=int) * [1, 2, 3]).tolist() == [[1, 2, 3], [1, 2, 3]]
values = np.array([-2.5, -1.5, 1.5, 2.5])
assert np.floor(values).astype(int).tolist() == [-3, -2, 1, 2]
assert np.ceil(values).astype(int).tolist() == [-2, -1, 2, 3]
assert np.rint(values).astype(int).tolist() == [-2, -2, 2, 2]
```

#### 轴、归约与统计

归约把一个轴的多个值合成一个。对二维矩阵，`axis=0` 消去行轴，每列留下一个值；`axis=1` 消去列轴，每行留下一个值。不传 axis 时，`sum()`、`prod()`、`min()`、`max()` 等通常汇总所有元素。组合两个归约时先写清先消去哪个轴，以及后一步处理的是哪组结果。`keepdims=True` 将被归约的轴保留为长度 1，便于后续广播。

固定宽度的整数乘积可能溢出。小范围时可选择足够的 `dtype`，超过范围时用 `math.prod()` 处理 Python 整数。`mean()` 求平均，`var()` 求方差，`std()` 求标准差。总体方差使用 `ddof=0`，分母是 N，样本方差常用 `ddof=1`，分母是 N-1。单元素总体方差为零，空数组或自由度不足要按数据要求另行处理。按指定精度展示时最后格式化，可用 `z` 选项规范显示为正零。

```python
import math
import numpy as np

matrix = np.array([[1, 3, 2], [5, 2, 6]], dtype=np.int64)
assert matrix.sum(axis=0).tolist() == [6, 5, 8]
assert math.prod(matrix.sum(axis=0).tolist()) == 240
assert matrix.min(axis=1).max().item() == 2
assert np.mean([2, 4]) == 3.0
assert np.var([2, 4], ddof=0) == np.std([2, 4], ddof=0) == 1.0
```

#### 点积、外积、矩阵乘法和行列式

一维向量的点积可用 `np.dot(a, b)` 或 `np.inner(a, b)`，结果是对应元素乘积之和。`np.outer(a, b)` 计算所有跨向量配对，形状为 `(len(a), len(b))`。二维矩阵乘法用 `A @ B`，结果的每个位置是 A 的一行与 B 的一列做点积。形状 `(r,k)` 乘 `(k,c)` 得到 `(r,c)`，两个内维必须相等。逐元素乘法 `A * B` 根据相同位置或广播配对。三维叉积可用 `np.cross(u, v)` 得到垂直向量。

二阶行列式可精确计算为 `a*d - b*c`，行成比例时为零。`np.linalg.det()` 适用于方阵并返回浮点近似。若已知真实结果为小整数，可以就近舍入再转成整数；直接截断可能错一位。浮点数据应根据数值容差判断是否接近零。

```python
import numpy as np

a, b = np.array([2, -1]), np.array([3, 4])
assert np.dot(a, b).item() == 2
assert np.outer(a, b).tolist() == [[6, 8], [-3, -4]]
assert (np.array([[1, 2, 3]]) @ np.array([[2], [0], [-1]])).tolist() == [[-1]]
square = np.array([[2, 5], [3, 4]])
assert round(np.linalg.det(square)) == -7
```

#### 多项式的系数与导数

`np.polyval(coefficients, x)` 用从高次到低次的系数求值。`np.polyder(coefficients)` 求导后给出新系数，再用 `polyval` 可求某点斜率。手工求导时，原次数 p 对应的系数乘以 p，次数减 1，常数项消失，常数多项式的导数为零。若使用 `numpy.polynomial.polynomial.polyval`，该接口按从低次到高次接收系数，两种顺序应明确区分。精确整数多项式也可用 Python 整数的霍纳法。

```python
import numpy as np

descending = [2, 0, -1]
assert np.polyval(descending, 3).item() == 17
assert np.polyval(np.polyder(descending), 3).item() == 12
assert np.polynomial.polynomial.polyval(3, descending[::-1]) == 17
```

### 检查点

先用非方阵手算 shape、转置、拼接和两条轴的归约，再用 NumPy 核对。设计一个可广播和一个不可广播的形状组合，并测试负数中点、常数多项式和奇异矩阵。

### 参考答案

### 关联题目

[]

## 章节：17. 调试与可变默认参数 · Debugging

### 学习目标

能用可复现的最小输入定位问题，检查状态更新、元素计数和对象共享，并用断言验证修复。

### 正文

#### 从症状缩小到最小反例

先记录输入、预期结果和实际结果。每次只缩小一个维度，例如去掉无关项、简化数值或减少调用次数。把问题分成输入解析、状态变化、结果格式三个阶段，用 `repr()` 检查空格与类型，用 `assert` 固定已知的预期，也可用 `breakpoint()` 在本地观察变量。调试结束后保留能自动复现问题的断言。普通输入的合法性检查应使用显式分支或异常，因为优化模式可以关闭 `assert`。

#### 追踪状态更新和计数语义

`score += value` 在原分数上累加，`score =+ value` 将一元正号作用后的值重新赋给 score。追踪累计变量时，写出每轮之前和之后的值。重复项有意义时应按位置计数，集合只保存不同值。`sum(predicate(item) for item in items)` 可以计数，布尔值在求和中相当于 1 或 0。“恰好”“至少”和“至多”对应不同的比较。

运行总和在每一步加入当前值后记录累计量。可以用循环维护，也可用 `itertools.accumulate()`。每组独立数据都应从新状态开始。测试时加入空组、零和负值，可以发现错误的初始化与边界处理。

```python
from itertools import accumulate

assert list(accumulate([3, -1, 0, 4])) == [3, 2, 2, 6]
flags = ["ok", "warn", "ok", "ok"]
assert sum(flag == "ok" for flag in flags) == 3
total = 0
for change in [3, -1, 4]:
    total += change
assert total == 6
```

#### 默认参数、可变对象与调用隔离

默认参数表达式在 `def` 执行时求值一次。若写 `def f(buffer=[])`，省略 buffer 的多次调用共享这个列表。字典、集合和其他可变对象也有同样风险。若缓冲区只在函数内部使用，每次调用时创建；若缓冲区可由调用者传入，可用 `None` 表示未提供，并在函数内写 `if buffer is None:`。使用 `if not buffer` 会将调用者显式传入的空列表也当成缺省，可能改变接口行为。

`==` 比较值，`is` 比较是否为同一对象。调试状态泄漏时，可分别检查输出内容和对象身份。如果多个输出独立，修改其中一个不应影响另一个。仅调用一次很难暴露共享默认值，应在同一个 Python 进程中连续调用并插入空输入。

```python
def record_event(event, buffer=None):
    if buffer is None:
        buffer = []
    buffer.append(event)
    return buffer

first = record_event("connect")
second = record_event("disconnect")
assert first == ["connect"] and second == ["disconnect"]
assert first is not second

provided = []
assert record_event("refresh", provided) is provided
assert provided == ["refresh"]
```

### 检查点

写出能区分覆盖赋值和累加的最小输入。对一个函数连续调用三次，分别测试省略参数、显式传入空容器和显式传入已有容器，再核对状态是否按接口约定共享。

### 参考答案

### 关联题目

[]

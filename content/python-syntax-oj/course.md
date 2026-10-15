---
format: codemaster-learning-path
version: 1
title: Python 语法与综合实践
description: 20 章循序学习 Python 3.12 语法与综合实践，覆盖数据类型、容器、控制流程、函数、类、异常、模块、装饰器、生成器和综合题。中英对照概念配合代码示例；章节练习采用适合在线判题的标准输入输出格式。
category: Python 3.12 · 语法与实践
estimatedMinutes: 1200
difficulty: beginner
coverKey: python
---

# Python 语法与综合实践

## 章节：01. 基础语法 · Basics

### 学习目标

理解注释、缩进与代码块；掌握 OJ 的标准输入和标准输出约定。

### 正文

#### 在 OJ 中运行程序 | Online Judge I/O

每道题会给出明确的输入与输出格式。程序从**标准输入**读取数据（如 `input()` 或 `sys.stdin.read()`），用 `print()` 输出**标准输出**；不要打印“请输入…”之类交互提示。公开样例用于自测，正式提交还会运行未公开的测试数据，因此不能把样例答案写死。每次运行只依赖题目给定的输入，不依赖本机路径、图形界面或手动操作。

```python
name = input().strip()
print(f"Hello, {name}!")
```

若输入是 `Ada`，输出应为 `Hello, Ada!`。一个测试可能有多行输入，严格按题面规定读取；输出的行数、顺序与格式也应遵照题面。

**注释 Comments** — 使用 `#` 写单行注释；三引号 `"""` 创建多行字符串，常用于文档字符串，并不是真正的注释。Use `#` for comments; triple quotes create a multiline string or docstring.

```python
# 这是单行注释 | This is a single-line comment

"""
这是多行注释
This is a multi-line comment
"""

print("Hello, Python!")  # 输出 | Output
```

**缩进 Indentation** — Python 用缩进而非花括号来定义代码块，默认 4 个空格。Python uses indentation (4 spaces) instead of braces to define blocks.

```python
if True:
    print("缩进即代码块")  # Indentation defines the block
    print("Indentation matters")
```

### 检查点

阅读本章示例后，独立完成配套 OJ 题：只读取题目给定的输入，按要求输出答案，不打印交互提示。

### 参考答案


### 关联题目

[]

## 章节：02. 变量与数据类型 · Variables & Data Types

### 学习目标

识别 Python 常用内置类型，理解变量绑定与显式类型转换。

### 正文

Python 是动态类型语言，无需声明类型。Python is dynamically typed — no need to declare types.

- `int` 整数（Integer）：`x = 42`。
- `float` 浮点数（Float）：`x = 3.14`。
- `str` 字符串（String）：`x = "hi"`。
- `bool` 布尔值（Boolean）：`x = True`。
- `list` 列表（List）：`x = [1, 2]`，有序且可变。
- `tuple` 元组（Tuple）：`x = (1, 2)`，有序且不可变。
- `dict` 字典（Dictionary）：`x = {}`，保存键值对。
- `set` 集合（Set）：`x = set()`，元素不重复，遍历顺序不固定。

```python
x = 10          # int
y = 3.14       # float
name = "Python"  # str
flag = True     # bool

print(type(x))  # 输出 <class 'int'> | Output: <class 'int'>

# 类型转换 | Type conversion
a = str(42)       # "42"
b = int("100")    # 100
c = float(5)      # 5.0
```

### 检查点

先判断输入需要转换成哪种类型，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：03. 运算符 · Operators

### 学习目标

运用算术、比较、逻辑和赋值运算符，并注意优先级与边界值。

### 正文

#### 算术运算符 Arithmetic Operators

```python
print(7 + 3)   # 10 加 | Addition
print(7 - 3)   # 4  减 | Subtraction
print(7 * 3)   # 21 乘 | Multiplication
print(7 / 3)   # 2.333 除 | Division
print(7 // 3)  # 2  整除 | Floor division
print(7 % 3)   # 1  取余 | Modulus
print(2 ** 3)  # 8  幂 | Exponent
```

#### 比较运算符 Comparison Operators

```python
print(5 == 5)  # True  等于 | Equal
print(5 != 3)  # True  不等 | Not equal
print(5 > 3)   # True  大于 | Greater
print(5 < 3)   # False 小于 | Less
print(5 >= 5)  # True  大于等于 | Greater or equal
print(5 <= 3)  # False 小于等于 | Less or equal
```

#### 逻辑运算符 Logical Operators

```python
print(True and False)  # False  与 | And
print(True or False)   # True   或 | Or
print(not True)        # False  非 | Not
```

#### 赋值运算符 Assignment Operators

```python
x = 10
x += 5   # x = 15  等价于 x = x + 5
x -= 3   # x = 12
x *= 2   # x = 24
x //= 5  # x = 4
```

### 检查点

练习前说明 `//`、`%` 与 `/` 的区别，并检查零和负数等边界输入。

### 参考答案


### 关联题目

[]

## 章节：04. 字符串 · String

### 学习目标

使用索引、切片与常用字符串方法处理文本。

### 正文

字符串是不可变的文本序列。Strings are immutable text sequences.

```python
s = "Hello, Python"

# 基本操作 | Basic operations
print(len(s))         # 13  长度 | Length
print(s.upper())      # HELLO, PYTHON  大写 | Uppercase
print(s.lower())      # hello, python  小写 | Lowercase
print(s.replace("Python", "World"))  # Hello, World
print(s.split(", "))   # ['Hello', 'Python']  分割 | Split

# 切片 | Slicing
print(s[0:5])   # Hello
print(s[-6:])   # Python
print(s[::-1])  # nohtyP ,olleH  反转 | Reverse

# 格式化 | Formatting
name = "Alice"
age = 25
print(f"My name is {name}, age {age}")  # f-string (推荐)
print("My name is {}, age {}".format(name, age))
print("My name is %s, age %d" % (name, age))
```

### 检查点

尝试用索引或切片描述文本片段，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：05. 列表 · List

### 学习目标

创建、修改与遍历列表，理解切片和可变容器。

### 正文

列表是有序、可变的序列。Lists are ordered, mutable sequences.

```python
fruits = ["apple", "banana", "cherry"]

# 增 | Add
fruits.append("orange")      # 末尾添加 | Append to end
fruits.insert(0, "mango")    # 指定位置插入 | Insert at index
fruits.extend(["grape", "kiwi"])  # 合并 | Extend

# 删 | Remove
fruits.remove("banana")     # 按值删除 | Remove by value
popped = fruits.pop()         # 弹出末尾 | Pop last
del fruits[0]               # 按索引删除 | Delete by index

# 查 | Access
print(fruits[0])        # 第一个 | First
print(fruits[-1])       # 最后一个 | Last
print(fruits[1:3])      # 切片 | Slice

# 其他操作 | Other operations
print(len(fruits))        # 长度 | Length
print("apple" in fruits)  # 是否包含 | Membership
fruits.sort()             # 排序 | Sort
fruits.reverse()          # 反转 | Reverse
print(fruits)
```

### 检查点

先区分“修改原列表”和“生成新列表”，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：06. 元组 · Tuple

### 学习目标

理解元组的有序不可变特性，并使用打包与解包。

### 正文

元组是有序、不可变的序列。Tuples are ordered, immutable sequences.

```python
t = (10, 20, 30)
print(t[0])     # 10
print(t[-1])    # 30

# 解包 | Unpacking
a, b, c = t
print(a, b, c)  # 10 20 30

# 单元素元组需加逗号 | Single-element tuple needs a comma
single = (42,)
print(type(single))  # <class 'tuple'>
```

### 检查点

说明元组何时比列表更合适，然后完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：07. 字典 · Dictionary

### 学习目标

使用字典表示键值关系，完成查询、更新和遍历。

### 正文

字典是键值对集合，键唯一。Dictionaries store key-value pairs with unique keys.

```python
student = {
    "name": "Alice",
    "age": 20,
    "courses": ["Math", "CS"]
}

# 访问 | Access
print(student["name"])            # Alice
print(student.get("age"))         # 20
print(student.get("phone", "N/A"))  # N/A（键不存在时的默认值）

# 修改 / 新增 | Modify / Add
student["age"] = 21               # 修改 | Update
student["email"] = "alice@example.com"  # 新增 | Add

# 删除 | Delete
del student["email"]

# 遍历 | Iterate
for key, value in student.items():
    print(f"{key}: {value}")

# 常用方法 | Common methods
print(list(student.keys()))    # 所有键 | All keys
print(list(student.values()))  # 所有值 | All values
```

### 检查点

思考键不存在时如何安全读取，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：08. 集合 · Set

### 学习目标

使用集合去重，理解成员判断与基本集合运算。

### 正文

集合是无序、不重复的元素集。打印集合时元素顺序不保证固定。Sets contain unique elements and do not guarantee display order.

```python
A = {1, 2, 3, 4}
B = {3, 4, 5, 6}

# 集合运算 | Set operations
print(A | B)   # {1,2,3,4,5,6} 并集 | Union
print(A & B)   # {3,4} 交集 | Intersection
print(A - B)   # {1,2} 差集 | Difference
print(A ^ B)   # {1,2,5,6} 对称差 | Symmetric difference

# 添加 / 删除 | Add / Remove
A.add(5)
A.discard(1)  # 不存在不报错 | No error if absent
```

### 检查点

说明集合去重后为什么不应依赖遍历顺序，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：09. 条件语句 · Conditional Statements

### 学习目标

使用 if / elif / else 表达互斥分支并覆盖边界。

### 正文

```python
score = 85

if score >= 90:
    grade = "A 优秀 | Excellent"
elif score >= 80:
    grade = "B 良好 | Good"
elif score >= 60:
    grade = "C 及格 | Pass"
else:
    grade = "F 不及格 | Fail"

print(grade)

# 三元表达式 | Ternary expression
status = "及格" if score >= 60 else "不及格"
print(status)

# match-case (Python 3.10+)
command = "start"
match command:
    case "start":
        print("启动 | Starting...")
    case "stop":
        print("停止 | Stopping...")
    case _:
        print("未知命令 | Unknown command")
```

### 检查点

列出题目中的所有分支，尤其检查临界值，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：10. 循环 · Loops

### 学习目标

使用 for 与 while 循环，理解 break、continue 和终止条件。

### 正文

#### for 循环

```python
# 遍历列表 | Iterate over a list
for fruit in ["apple", "banana", "cherry"]:
    print(fruit)

# range() | 生成数字序列
for i in range(5):       # 0,1,2,3,4
    print(i)
for i in range(2, 10, 2):  # 2,4,6,8 (起始, 终止, 步长)
    print(i)

# enumerate() | 同时获取索引和值
for index, value in enumerate(["a", "b", "c"]):
    print(f"{index}: {value}")
```

#### while 循环

```python
count = 0
while count < 5:
    print(count)
    count += 1
```

#### break / continue / else

```python
# break: 跳出循环 | Exit loop
for i in range(10):
    if i == 5:
        break
    print(i)  # 0,1,2,3,4

# continue: 跳过本次 | Skip iteration
for i in range(5):
    if i == 2:
        continue
    print(i)  # 0,1,3,4

# for...else: 循环正常结束时执行 | Executes if no break
for i in range(5):
    print(i)
else:
    print("循环结束 | Loop finished")
```

### 检查点

写下循环不变量与停止条件，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：11. 函数 · Functions

### 学习目标

设计带参数与返回值的函数，区分局部变量与全局变量。

### 正文

```python
# 基本定义 | Basic definition
def greet(name):
    """向某人打招呼 | Greet someone"""
    return f"Hello, {name}!"

print(greet("Alice"))

# 默认参数 | Default argument
def greet_full(name, greeting="Hello"):
    return f"{greeting}, {name}!"

print(greet_full("Bob"))              # Hello, Bob!
print(greet_full("Bob", "Hi"))       # Hi, Bob!

# 关键字参数 | Keyword argument
print(greet_full(greeting="Hey", name="Carol"))

# *args: 可变位置参数 | Variable positional args
def sum_all(*args):
    return sum(args)

print(sum_all(1, 2, 3, 4))  # 10

# **kwargs: 可变关键字参数 | Variable keyword args
def show_info(**kwargs):
    for key, value in kwargs.items():
        print(f"{key}: {value}")

show_info(name="Dave", age=30, city="Beijing")

# 返回多个值 | Return multiple values
def min_max(nums):
    return min(nums), max(nums)

lo, hi = min_max([3, 1, 4, 1, 5])
print(f"min={lo}, max={hi}")
```

### 检查点

先明确函数的输入、返回值与副作用，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：12. 列表推导式 · List Comprehension

### 学习目标

用列表推导式清楚地表达映射和筛选。

### 正文

列表推导式适合简洁地创建或筛选列表；条件复杂时，普通循环通常更容易读懂。List comprehensions express simple mapping and filtering concisely; use a regular loop when the logic becomes complex.

```python
# 基本形式 | Basic form
squares = [x**2 for x in range(10)]
print(squares)  # [0,1,4,9,...,81]

# 带条件 | With condition
evens = [x for x in range(20) if x % 2 == 0]
print(evens)  # [0,2,4,...,18]

# 带条件表达式 | With if-else
labels = ["偶|Even" if x % 2 == 0 else "奇|Odd" for x in range(5)]
print(labels)  # ['偶|Even','奇|Odd','偶|Even','奇|Odd','偶|Even']

# 嵌套循环 | Nested loop
pairs = [(x, y) for x in range(3) for y in range(3)]
print(pairs)

# 字典推导式 | Dict comprehension
squares_dict = {x: x**2 for x in range(5)}
print(squares_dict)  # {0:0, 1:1, 2:4, 3:9, 4:16}

# 集合推导式 | Set comprehension
unique_lengths = {len(w) for w in ["hi", "hello", "hey", "ok"]}
print(unique_lengths)  # {2, 3, 5}
```

### 检查点

先用普通循环描述算法，再判断是否适合改写为列表推导式。

### 参考答案


### 关联题目

[]

## 章节：13. 类与对象 · Class & Object

### 学习目标

用类组织数据与行为，理解 __init__、self 和实例方法。

### 正文

```python
class Animal:
    """动物基类 | Animal base class"""

    def __init__(self, name, sound):
        self.name = name      # 实例属性 | Instance attribute
        self.sound = sound

    def speak(self):
        return f"{self.name} says {self.sound}"

    def __str__(self):
        return f"Animal({self.name})"


# 继承 | Inheritance
class Dog(Animal):
    def __init__(self, name):
        super().__init__(name, "Woof")  # 调用父类 | Call parent

    def fetch(self):
        return f"{self.name} fetches the ball!"


# 使用 | Usage
dog = Dog("Buddy")
print(dog.speak())   # Buddy says Woof
print(dog.fetch())  # Buddy fetches the ball!
print(dog)          # Animal(Buddy) — 使用 __str__

# 类属性 vs 实例属性 | Class vs instance attribute
class Cat(Animal):
    species = "Felis catus"  # 类属性 | Class attribute

    def __init__(self, name):
        super().__init__(name, "Meow")

cat = Cat("Whiskers")
print(Cat.species)   # Felis catus
print(cat.speak())    # Whiskers says Meow
```

### 检查点

明确对象保存哪些状态、哪些行为由方法负责，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：14. 文件操作 · File I/O

### 学习目标

理解文本文件读写与 with 资源管理；区分本地文件示例和 OJ 标准输入输出。

### 正文

#### 从本地文件过渡到 OJ | From files to stdin

下面的 `open()` 示例用于理解本地文件与 `with` 的生命周期。当前 OJ 练习以标准输入提供测试数据、以标准输出比对结果，不会为程序准备示例中的相对路径文件。解题时保留解析与计算逻辑，将读取文件的部分改为读取输入。

```python
# 写文件 | Write to file
with open("demo.txt", "w", encoding="utf-8") as f:
    f.write("Hello, World!\n")
    f.write("你好，世界！\n")

# 读文件 | Read file
with open("demo.txt", "r", encoding="utf-8") as f:
    content = f.read()
    print(content)

# 逐行读取 | Read line by line
with open("demo.txt", "r", encoding="utf-8") as f:
    for line in f:
        print(line.strip())

# 追加写入 | Append
with open("demo.txt", "a", encoding="utf-8") as f:
    f.write("追加的一行 | Appended line\n")
```

- `"r"`：只读（read only，默认模式）。
- `"w"`：写入并覆盖原内容（write / overwrite）。
- `"a"`：在文件末尾追加（append）。
- `"r+"`：读写现有文件（read and write）。
- `"b"`：二进制模式标记，可与其他模式组合，例如 `"rb"`。

### 检查点

本章文件示例适合在本机探索；配套 OJ 题将由标准输入提供等价文本记录，请勿依赖预置文件。

### 参考答案


### 关联题目

[]

## 章节：15. 异常处理 · Exception Handling

### 学习目标

使用 try / except 处理预期异常，避免掩盖程序错误。

### 正文

下面的 `test.txt` 片段用于本地演示文件异常；OJ 不会提供该文件，正式练习会用标准输入构造可复现的错误情形。

```python
# try-except | 捕获异常
try:
    result = 10 / 0
except ZeroDivisionError:
    print("不能除以零 | Cannot divide by zero")

# 捕获多种异常 | Multiple exceptions
try:
    num = int("abc")
except ValueError as e:
    print(f"值错误 ValueError: {e}")
except (TypeError, KeyError) as e:
    print(f"其他错误 | Other error: {e}")

# try-except-else-finally | 完整结构
try:
    f = open("test.txt", "r")
except FileNotFoundError:
    print("文件不存在 | File not found")
else:
    print(f.read())
    f.close()
finally:
    print("无论如何都执行 | Always executes")

# 自定义异常 | Custom exception
class AgeError(Exception):
    def __init__(self, msg="年龄不合法 | Invalid age"):
        super().__init__(msg)

def set_age(age):
    if age < 0 or age > 150:
        raise AgeError()
    return age

try:
    set_age(-5)
except AgeError as e:
    print(e)
```

### 检查点

想清楚哪些错误可以恢复、哪些错误应修正代码，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：16. 模块与包 · Modules & Packages

### 学习目标

认识模块与包，使用可复现的 Python 标准库功能。

### 正文

在 OJ 题中，输出应由题目输入确定。随机数和当前时间适合本地实验；若题目没有规定固定随机种子或时间输入，不要把它们用于正式输出。

```python
# 导入标准库 | Import standard library
import math
print(math.pi)          # 3.141592...
print(math.sqrt(16))   # 4.0

# 导入特定函数 | Import specific function
from random import randint, choice
print(randint(1, 100))           # 随机整数 | Random int
print(choice(["a", "b", "c"]))    # 随机选择 | Random choice

# 别名 | Alias
import datetime as dt
now = dt.datetime.now()
print(now.strftime("%Y-%m-%d %H:%M:%S"))

# 自定义模块 | Custom module
# 文件 my_module.py 中定义:  | In my_module.py:
#   def greet(name): return f"Hi {name}"
#
# 在另一文件中导入:  | In another file:
#   from my_module import greet

# 包：含 __init__.py 的目录 | Package: dir with __init__.py
# my_package/
#   __init__.py
#   utils.py
# from my_package.utils import some_function
```

### 检查点

判断题目输出是否应完全由输入决定；使用随机或时间函数时需考虑可复现性。

### 参考答案


### 关联题目

[]

## 章节：17. 装饰器 · Decorators

### 学习目标

理解装饰器如何包装函数并保留调用行为。

### 正文

装饰器是在不修改原函数的前提下扩展其功能的函数。Decorators extend function behavior without modifying the original function.
下例的日志输出仅用于观察调用过程；提交 OJ 题时不要输出题面未要求的调试信息。

```python
# 基本装饰器 | Basic decorator
def log_call(func):
    def wrapper(*args, **kwargs):
        print(f"[LOG] 调用 Calling {func.__name__}({args}, {kwargs})")
        result = func(*args, **kwargs)
        print(f"[LOG] {func.__name__} 返回 Returned {result}")
        return result
    return wrapper

@log_call
def add(a, b):
    return a + b

print(add(3, 5))
# [LOG] 调用 Calling add((3, 5), {})
# [LOG] add 返回 Returned 8
# 8

# 带参数的装饰器 | Decorator with arguments
def repeat(n):
    def decorator(func):
        def wrapper(*args, **kwargs):
            for i in range(n):
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator

@repeat(3)
def say_hi(name):
    print(f"Hi {name}!")
    return name

say_hi("Alice")  # 打印 3 次 | Prints 3 times

# functools.wraps 保留原函数信息 | Preserve metadata
from functools import wraps

def timer(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        print(f"计时器启动 | Timer started for {func.__name__}")
        return func(*args, **kwargs)
    return wrapper
```

### 检查点

画出装饰前后函数调用顺序，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：18. 生成器 · Generators

### 学习目标

理解 yield 与惰性迭代，按需产生数据。

### 正文

生成器用 `yield` 逐个产出值，节省内存。Generators yield values one at a time, saving memory.

```python
# 生成器函数 | Generator function
def count_up(n):
    """从 0 数到 n-1 | Count from 0 to n-1"""
    i = 0
    while i < n:
        yield i
        i += 1

for num in count_up(5):
    print(num)  # 0, 1, 2, 3, 4

# 生成器表达式 | Generator expression
gen = (x**2 for x in range(1000000))
print(next(gen))  # 0
print(next(gen))  # 1
print(next(gen))  # 4

# 无限序列 | Infinite sequence
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

fib = fibonacci()
for _ in range(10):
    print(next(fib), end=" ")
print()  # 0 1 1 2 3 5 8 13 21 34
```

### 检查点

比较列表一次生成与生成器逐个产生元素的行为，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：19. Lambda 与高阶函数 · Lambda & Higher-Order Functions

### 学习目标

理解 lambda 与高阶函数，使用排序键、map 和 filter。

### 正文

```python
# lambda: 匿名函数 | Anonymous function
square = lambda x: x**2
print(square(5))  # 25

add = lambda x, y: x + y
print(add(3, 4))  # 7

# map(): 对每个元素应用函数 | Apply function to each element
nums = [1, 2, 3, 4, 5]
squared = list(map(lambda x: x**2, nums))
print(squared)  # [1, 4, 9, 16, 25]

# filter(): 过滤 | Filter elements
evens = list(filter(lambda x: x % 2 == 0, nums))
print(evens)  # [2, 4]

# sorted() with key | 自定义排序
students = [("Alice", 85), ("Bob", 72), ("Carol", 90)]
sorted_by_score = sorted(students, key=lambda s: s[1], reverse=True)
print(sorted_by_score)  # [('Carol', 90), ('Alice', 85), ('Bob', 72)]

# reduce(): 累积运算 | Accumulate
from functools import reduce
product = reduce(lambda x, y: x * y, nums)
print(product)  # 120 (1*2*3*4*5)
```

### 检查点

先写出排序键或映射函数的含义，再完成本章配套 OJ 练习。

### 参考答案


### 关联题目

[]

## 章节：20. 综合练习 · Comprehensive Exercises

### 学习目标

综合运用输入解析、数据结构、函数与排序解决多步骤问题。

### 正文

#### 从想法到可评测程序 | From project to judged solution

原课程将词频统计、学生成绩管理和文本记录处理作为三个开放式小项目。在 OJ 中，程序需要明确的输入格式、输出格式与边界约束，才能自动判题。配套习题会把这些场景改为可复现的单文件输入输出题：读取给定文本或记录，解析数据，统计或排序，然后只输出指定结果。不要访问本机文件，也不要输出交互菜单。

可以按四步设计：

1. **输入 Input**：确定记录数、每行字段和异常输入的约定。
2. **表示 Model**：选择列表、字典、集合或类保存必要状态。
3. **处理 Transform**：把统计、比较和排序拆成小函数。
4. **输出 Output**：按题目指定的顺序与格式打印，特别处理并列与空输入。

例如，下面只演示如何拆开一条记录，没有给出综合题的完整解法：

```python
line = "Ada,90"
name, score_text = line.split(",")
score = int(score_text)
print(name, score)
```

完成练习后，可以尝试为解析函数设计正常、边界与错误输入的测试。

### 检查点

将综合题拆成输入解析、数据处理、结果排序与格式化输出四步，独立完成配套 OJ 练习。

### 参考答案


### 关联题目

[]

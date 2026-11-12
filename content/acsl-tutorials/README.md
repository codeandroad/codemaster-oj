# ACSL 专题教程

首批面向 Intermediate，基础讲解可供其他组别使用。完整教学设计见 [设计说明](../../docs/acsl-tutorial-design.md)。这是自主编写的教程，不是官方课程或试卷解答汇编。

双语切换、共享进度和真题关联的运行能力见 [第二阶段实施记录](../../docs/acsl-tutorial-integration.md)。递归与程序追踪的内容、检查及教师入口见 [C1 扩写记录](../../docs/acsl-tutorial-c1-expansion.md)。两份单语言数制样板的早期检查保留在 [首批验收记录](../../docs/acsl-tutorial-validation.md)。

## 已编写样板

每个专题提供同结构中英文文档，每节含目标、完整推演例题、错因、自测及按需阅读的参考解析。它们分别导入为一门双语课程，语言共用章节 ID 与阅读进度。

| 目录 | 章节 | 对应真题 |
| --- | --- | --- |
| `intermediate/number-systems/` | 位值、转换、进位借位、混合进制，共四节 | 12 道 |
| `intermediate/recursion/` | 基例与回代、调用树与复合调用、多参数与取整，共三节 | 12 道 |
| `intermediate/program-tracing/` | 顺序赋值、分支边界、循环与旧值，共三节 | 8 道 |

- 各目录的 `course.en.md`、`course.zh.md` 是两份同构的编写源文件，使用兼容的 `codemaster-learning-path` v1 格式。默认导入脚本将它们组合成一门课程的 `localizations`。英文文档中的中文结构分隔符是导入格式要求，不影响英文正文。
- `arithmetic-checks.json` 保存独立整数算术检查。进位数组按个位到最高输入列记录每列**向左送出**的进位；排版中的小进位数字则放在**接收列**上方，两种记录方向不能混淆。
- 递归与程序追踪各有 `checks.mjs`，独立计算调用状态、回代、执行表和边界结果，并检查中英文实际显示的代码、公式或数值，避免只验证与正文脱节的样例数据。它们是可信的教材校验程序，不执行学生提交或文档中的代码。
- `curriculum.json` 记录 12 个规划专题、39 节计划课及 128 道 Intermediate 笔试题的编辑参考。目前前三个专题共十节已有课件，其余 29 节按后续阶段编写，不创建空白课程或自动发布到学生目录。
- 各目录的 `practice-map.json` 把本专题正式题分配到相应章节。数制为 0／6／1／5，递归为 2／5／5，程序追踪为 1／5／2。关联只包含试卷标识、题号及类型，在导入时由目标学校解析并固定版本。

编辑参考只含试卷 slug 与题号。它不包含题干、答案、解析、正式用例或数据库 ID，不能用于绕过课程或试卷权限。样板不把 ACSL ID 写入普通课程的 `problemIds`。

## 校验与本地草稿

在仓库根目录运行：

```sh
node scripts/check-acsl-tutorials.mjs
node scripts/check-acsl-tutorials.mjs --all
node scripts/check-acsl-tutorials.mjs --unit recursion
node scripts/import-acsl-tutorials.mjs
node scripts/import-acsl-tutorials.mjs --unit program-tracing
```

这些命令均不写数据库。未指定专题时仍检查数制；`--all` 检查所有已编写专题。校验包括课程格式、导入导出往返、双语章节与自测数量、KaTeX 公式、独立运算及执行状态，以及全 24 卷的专题引用完整性。导入预检还验证所选专题的逐章引用覆盖及领域校验后译文／关联不丢失。

显式创建本地草稿：

```sh
node scripts/import-acsl-tutorials.mjs --unit recursion --import --origin http://localhost:3165 --auth-file PRIVATE_AUTH_JSON
```

`PRIVATE_AUTH_JSON` 是忽略目录中的本地文件，仅含该本地环境的 `username`、`password`。不得提交到仓库。脚本只接受本机 HTTP 地址，通过教师 API 导入，不发布课程。目标学校须已启用关联试卷；不可解析或无权访问的引用会拒绝导入。导入记录放在 `.campus-local/acsl-tutorial-import/`，按环境、教师、内容语言及专题分开，原数制记录保持兼容。相同内容重跑复用已有草稿，并检查原课程、章节 ID 和固定题目版本；已编辑或已发布的课程不会被覆盖。同名而内容不同的草稿需要先核对，不自动再建一门。若连接在提交后中断，先查课程列表与私有记录，不盲目重复创建。

`--language en` 或 `--language zh` 保留单语言文档的校验／导入兼容用途，不用于新版双语样板的常规发布。旧的两份未发布样板需要先核对教师编辑和学习进度，再保留其中一门及原章节 ID、补齐另一语言；旧译文草稿归档保留。不能删除旧课程后重新创建来模拟共享进度。

课程阅读与正式答题分开记录。关联题的对错和完成状态来自已有正式判分；阅读、自测答案展开和语言切换均不发积分，也不解锁未交卷真题的答案解析。

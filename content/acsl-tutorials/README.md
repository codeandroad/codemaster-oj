# ACSL Intermediate 系统课程

面向 Intermediate，基础讲解可供其他组别使用。运行时统一为一门课程，以 C1、C2 等轮次分组，下设专题与课时；编写源仍按专题维护。完整教学设计见 [设计说明](../../docs/acsl-tutorial-design.md)。这是自主编写的教程，不是官方课程或试卷解答汇编。

本轮已完成本地验收与 3004 部署，六门草稿已合并为一门未发布课程。统一目录、原 ID 与进度保留、旧草稿迁移、工具使用及验收范围见 [统一课程说明](../../docs/acsl-unified-course.md)。历史记录中的独立专题课程链接保留，现已转到新目录内相应专题。

双语切换、共享进度和真题关联的运行能力见 [第二阶段实施记录](../../docs/acsl-tutorial-integration.md)。递归与程序追踪的内容、检查及教师入口见 [C1 扩写记录](../../docs/acsl-tutorial-c1-expansion.md)。表达式、位串与 LISP 的编写、验收及本地入口见 [C2 扩写记录](../../docs/acsl-tutorial-c2-expansion.md)。两份单语言数制样板的早期检查保留在 [首批验收记录](../../docs/acsl-tutorial-validation.md)。

## 已编写样板

每个专题提供同结构中英文文档，每节含目标、完整推演例题、错因、自测及按需阅读的参考解析。六个已编写专题共十九节，组合进同一门双语课程；课时 ID 与阅读进度跨语言共用，课程总进度统一统计。

| 目录 | 章节 | 对应真题 |
| --- | --- | --- |
| `intermediate/number-systems/` | 位值、转换、进位借位、混合进制，共四节 | 12 道 |
| `intermediate/recursion/` | 基例与回代、调用树与复合调用、多参数与取整，共三节 | 12 道 |
| `intermediate/program-tracing/` | 顺序赋值、分支边界、循环与旧值，共三节 | 8 道 |
| `intermediate/expressions/` | 表达式结构、栈求值、结构转换，共三节 | 12 道 |
| `intermediate/bit-strings/` | 逐位逻辑、移位旋转、逆向约束，共三节 | 12 道 |
| `intermediate/lisp/` | 列表层级、嵌套操作、前缀算术与引用，共三节 | 8 道 |

- 各目录的 `course.en.md`、`course.zh.md` 是两份同构的编写源文件，使用兼容的 `codemaster-learning-path` v1 格式。统一导入先组合每个专题的 `localizations`，再组装总课程的 `sections` 与各课时的 `sectionKey`。英文文档中的中文结构分隔符是导入格式要求，不影响英文正文。
- `arithmetic-checks.json` 保存独立整数算术检查。进位数组按个位到最高输入列记录每列**向左送出**的进位；排版中的小进位数字则放在**接收列**上方，两种记录方向不能混淆。
- 除数制外，各专题有 `checks.mjs`，独立计算调用状态、执行表、表达式结构、位串或列表操作及边界结果，并检查中英文实际显示的代码、公式或数值，避免只验证与正文脱节的样例数据。它们是可信的教材校验程序，不执行学生提交或文档中的代码。
- `curriculum.json` 记录 12 个规划专题、39 节计划课及 128 道 Intermediate 笔试题的编辑参考。目前前六个专题共十九节已有课件，其余 20 节按后续阶段编写，不创建空白课程或自动发布到学生目录。
- 各目录的 `practice-map.json` 把本专题正式题分配到相应章节。数制为 0／6／1／5，递归为 2／5／5，程序追踪为 1／5／2；表达式为 1／6／5，位串为 2／5／5，LISP 为 2／4／2。关联只包含试卷标识、题号及类型，在导入时由目标学校解析并固定版本。

编辑参考只含试卷 slug 与题号。它不包含题干、答案、解析、正式用例或数据库 ID，不能用于绕过课程或试卷权限。样板不把 ACSL ID 写入普通课程的 `problemIds`。

## 校验与本地草稿

在仓库根目录运行以下预检，不连接业务 API：

```sh
node scripts/check-acsl-tutorials.mjs --all
node scripts/check-acsl-tutorials.mjs --unit expressions
node scripts/import-acsl-course.mjs
node scripts/import-acsl-tutorials.mjs --unit bit-strings
```

未指定专题的旧校验命令仍检查数制；`--all` 检查所有已编写专题。校验包括课程格式、导入导出往返、双语章节与自测数量、KaTeX 公式、独立运算及执行状态，以及全 24 卷的专题引用完整性。统一导入预检还组装六专题十九课时的总课程，校验专题顺序、章节归属及领域格式。

已有六门双语专题草稿时，先预览，核对后显式合并，保留原课程和课时 ID：

```sh
node scripts/merge-acsl-tutorials.mjs --origin http://localhost:3004 --auth-file PRIVATE_AUTH_JSON
node scripts/merge-acsl-tutorials.mjs --apply --origin http://localhost:3004 --auth-file PRIVATE_AUTH_JSON
```

没有旧专题草稿的全新本地教师环境，显式创建一门统一草稿：

```sh
node scripts/import-acsl-course.mjs --import --origin http://localhost:3165 --auth-file PRIVATE_AUTH_JSON
```

`PRIVATE_AUTH_JSON` 是忽略目录中的本地认证文件，包含 `username`、`password` 字段，不能提交到仓库。写入脚本只接受本机 HTTP 地址，通过教师 API 操作，不发布课程。合并预览仅读取课程计划，不修改课程业务数据。目标学校须已启用关联试卷；不可解析或无权访问的引用会拒绝导入。

合并使用服务端全事务计划，保留全部原课时、双语进度、固定练习版本和学习资料，其他来源草稿归档为旧入口。旧 URL 按主课程权限跳转；主课程未发布时学生仍不可读。来源的权限条件须一致，教师编辑、同名重复草稿、发布或教学活动历史等冲突不会被自动覆盖。操作条件、私有记录和中断恢复见 [统一课程说明](../../docs/acsl-unified-course.md)。

记录保存在 `.campus-local/acsl-tutorial-import/`，按环境和教师隔离。重复操作核对原 ID 和固定版本，不新建副本；源文件或教师内容已改变时要求显式核对。后续专题应通过审核后的更新流程加入总课程，不能删除课程重新导入来模拟共享进度。

旧 `scripts/import-acsl-tutorials.mjs` 的 `--unit`、`--language en`、`--language zh` 只保留分专题／单语言预检兼容用途，单专题 `--import` 已停用。历史单语言样板与后来的六门双语专题草稿记录保留，用于追溯实施过程。

课程阅读与正式答题分开记录。关联题的对错和完成状态来自已有正式判分；阅读、自测答案展开和语言切换均不发积分，也不解锁未交卷真题的答案解析。

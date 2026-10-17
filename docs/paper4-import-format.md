# Paper 4 结构化试卷包格式（v1）

本格式用于把已经取得使用权、由教师整理好的编程练习批量导入为**草稿**。上传原始试卷 PDF 或只含考生文件的 ZIP 不会自动抽题；题面、小题、运行文件、用例和参考答案须由教师核对后写入 manifest。示例 JSON 和 ZIP 是依据用户提供的 9618/41 原卷制作的课堂改编包，包含必要的考生文本数据，不是官方 PDF、Word 证据模板或完整评分细则。逐步制作方法见[原卷到试卷包指南](paper4-package-authoring-guide.md)。

## 导入流程

1. 选择 `.json` 自包含 manifest，或包含根目录 `manifest.json` 与被引用文本附件的 `.zip`。浏览器把文件以 base64 作为 `{ "filename": "paper.zip", "contentBase64": "..." }` 发送到 `POST /api/v1/paper4/imports/preview`。仅教师/管理员可调用。
2. 预览返回 `preview`（试卷标题、3 题分值、自动/人工/证据阶段数、用例数、参考答案覆盖）及经过服务端校验的 `createBody`。确认后将 `createBody` 发给 `POST /api/v1/paper4/papers` 创建草稿。预览本身不写数据库。
3. 核对题面、文件和隐藏用例，对每道大题运行参考程序。所有自动阶段通过隔离执行器的完整用例后，可上架为全校自由练习；无需选择班级或时间。教师后续以阶段分值评分，AC 不自动授予 75 分。
4. 上架后的试卷可另行「布置活动」：选择班级练习或模拟考试。班级练习可不设时间，模拟考试须填写开始与结束时间；班级活动独立保存版本、答卷与成绩。

## 顶层结构

```json
{
  "format": "codemaster-paper4",
  "version": 1,
  "paper": {
    "title": "Original English practice", "description": "...",
    "examYear": 2025, "examSession": "summer", "examVariant": 41,
    "classId": null, "startsAt": null, "endsAt": null
  },
  "questions": [{
    "key": "Q1", "title": "A circular queue", "statement": "...", "starterCode": "...",
    "initialFiles": {}, "outputFiles": [],
    "stages": [{ "id": "Q1_enqueue", "title": "Enqueue", "description": "...", "maxMarks": 6, "judgeMode": "auto" }]
  }],
  "runnerCases": {
    "Q1_enqueue": [{ "id": "sample", "public": true, "stdin": "", "inputFiles": {}, "expectedStdout": "...", "expectedFiles": {} }]
  },
  "referenceSolutions": { "Q1": "# Full runnable Python reference program\n..." }
}
```

### 年份、考季与卷号

`paper` 可选填写以下分类字段；旧包可以省略，未分类的值为 `null`，不需要修改格式版本号。

| 字段 | 接受的值 | 用途 |
| --- | --- | --- |
| `examYear` | 1900–2100 的整数，或 `null` | 原卷年份；不能填写字符串年份 |
| `examSession` | `"summer"`、`"autumn"`，或 `null` | 分别显示为夏季 May/June、秋季 October/November |
| `examVariant` | 整数 `41`、`42`、`43`，或 `null` | 原卷卷号 |

分类随试卷版本保存，修订草稿与导出 JSON 均保留。编辑时省略字段会保留原值，显式传 `null` 可清空；导出后重新导入也保留分类。不要从标题猜测缺失的分类。

教师和学生的 Paper 4 列表都支持组合使用**年份**和**考季**筛选。年份还会在有未分类试卷时提供“未分类”选项；考季可选全部、夏季或秋季。列表分为自由练习和班级活动。筛选只整理当前用户有权看到的试卷，不改变可见范围。导入包中的班级和时间不会用于上架；活动的班级与时间在布置时单独设置。

`questions` 包含 1–3 道大题；全部 `stages[].maxMarks` 之和必须恰为 75。每个大题键、阶段 ID、用例 ID 唯一。`runnerCases` **按阶段 ID** 而非题号组织。`judgeMode` 为 `auto`、`manual` 或 `evidence`：`auto` 必须有用例和可比对的预期输出/文件，`manual` 留给教师检查源码与解释，`evidence` 留给代码与运行证据。后两者不得配置自动用例。每道大题要有完整的 `referenceSolutions` Python 程序，先跑通自动测试才能发布；它不作为学生起始代码公开。

自动用例可选 `driverCode`：教师编写的短 Python 程序在同一个无网络判题沙箱中运行，读取 `/w/main.py` 后调用指定的类或函数。直接用 `importlib` 导入会执行学生顶层主程序；接口用例应按需用 AST 加载声明和定义，排除顶层输入、主程序调用以及赋值表达式中的嵌套调用，并另设完整程序用例。不得要求学生添加原卷没有规定的主程序保护写法。驱动、隐藏输入和参考答案仅在教师与 worker 路径保留，学生只能看到公开用例及总体状态。不要把预期答案写入 `driverCode` 再从学生代码读取。`public:false` 用例的输入、输出和生成文件不返回学生。

`initialFiles`、`inputFiles`、`expectedFiles` 是文件名到 UTF-8 文本的映射。仅支持 `.txt`、`.csv`、`.dat` 简单文件名。`outputFiles` 列出可从沙箱收集的文件；每个用例在新沙箱中运行，预置或覆盖输入文件，既能验证写入也能验证追加。`expectedStdout` 按既有 OJ 的 token 规则比较；`expectedFiles` 规范化换行后逐字比较。题面和参考程序在 JSON 中直接写字符串。

ZIP 可把大文本改为 `{ "file": "assets/Q1-reference.py" }`，其值将在服务端读入后替换为 UTF-8 文本。允许引用的字段有题面、起始代码、阶段说明、标准输入、预期标准输出、初始/输入/预期文件内容、驱动代码和参考程序。ZIP 只允许根目录 `manifest.json` 与被引用的 `assets/` 下 `.txt`、`.csv`、`.dat`、`.md`、`.py` 文本；多余文件、PDF、符号链接、绝对路径与 `..` 路径均被拒绝。

## 按年份维护和批量导入

结构化历年包放在 `content/paper4-pastpapers/<年份>/`，由各年份的构建脚本、原件清单和 `coverage.md` 记录题目映射、源文件与已知差异。原始 PDF、评分细则、考生文件 ZIP 仍是制作依据，不能代替结构化包直接导入。缺失原件要标记 `source-gap`；教学补造数据要标记 `synthetic` 并说明范围，不能当作原始考生文件。

在仓库根目录执行以下命令，将 `YYYY` 换成实际年份：

```sh
node scripts/validate-paper4-pastpapers.mjs --year=YYYY
node scripts/import-paper4-pastpapers.mjs --year=YYYY
```

第一步通过隔离执行器验证参考答案与错误答案对照，并记录当前 manifest 的 SHA-256；第二步只接受与当前文件哈希一致的通过记录。导入脚本仅连接本机 `localhost` / `127.0.0.1` 的 **3002** 预览环境，使用 `.campus-local/test-accounts.json` 中已有、已忽略的教师登录资料，不创建账户或重置密码，不执行 seed。它创建未指定班级和时间的**草稿**，并运行草稿的参考验证，不会发布。完整批量流程及教师复核要求见[制作指南](paper4-package-authoring-guide.md#按年份维护历年试卷集)。

## 安全和大小限制

- 原始 JSON/ZIP ≤ 1 MiB；API 请求体上限 2 MiB。ZIP 最多 100 项，展开合计 ≤ 2 MiB、单项 ≤ 256 KiB、压缩比 ≤ 100；不支持加密、ZIP64 或多卷包。内容须为有效 UTF-8，ZIP 校验 CRC。
- 大题最多 3 道；每题最多 30 个阶段；每阶段最多 12 个用例、全卷最多 50 个。每个运行用例的初始/输入/输出/预期文件名去重后最多 16 个；单个文本文件 ≤ 64 KiB。具体字段长度以服务端最终校验为准。
- 预览解析器不执行代码、不解压到磁盘；参考程序与教师驱动只能进入受限判题 worker，API/Web 进程不运行它们，执行器不持有数据库凭据。

自包含示例：[JSON](../examples/paper4-english-practice/paper4-english-practice.json)。带文本附件示例：[ZIP](../examples/paper4-english-practice/paper4-english-practice.zip)。其生成源码位于 `examples/paper4-english-practice/build.mjs`；修改参考程序或用例后运行该脚本重新生成两个包。

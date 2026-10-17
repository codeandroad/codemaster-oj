# Paper 4 批量导入与导出

教师在 **Paper 4 试卷** 列表中，可以一次选择多个 JSON / ZIP 试卷包，先查看整批预览，再统一创建草稿。所有文件、题目及测试配置校验通过后才会写入；任何一项失败，整批不会导入。

导入始终创建新的自由练习草稿，不覆盖已有试卷，不携带班级、时间、公开状态、参考答案验证结果、学生答卷或积分。教师仍须运行参考答案验证后，才能公开为全校自由练习。

普通 OJ 题目包 `problems.json` 属于普通 OJ 题目格式，应在 **题库 → 导入题目** 中使用。它不是 Paper 4 试卷包。原始 PDF、考试素材 ZIP、课程习题包须先按 [Paper 4 制作说明](paper4-package-authoring-guide.md) 转换。

## 支持的输入

- 多个现有 `codemaster-paper4` 第 1 版 JSON 文件。
- 多个现有单卷 ZIP：根目录为 `manifest.json`，配套文本文件位于 `assets/`。
- 一个集合 ZIP，包含多个独立 JSON 或单卷 ZIP。
- 一个集合 ZIP，包含若干子目录中的 `manifest.json` 与对应 `assets/`。
- 系统“批量导出 ZIP”生成的集合包，可以直接再次导入。

每批最多 100 套试卷，输入文件合计最多 8 MiB，解析后的试卷内容合计最多 16 MiB。单卷包最多 1 MiB。ZIP 中最多 500 个条目；单卷 ZIP 仍遵循原有单卷条目与文本素材限制。不接受路径穿越、重复文件名、符号链接、损坏校验、加密 ZIP、ZIP64 或过高压缩比。

## 导出与重新导入

列表中的复选框可选择草稿、已公开试卷和已归档试卷。**批量导出 ZIP** 下载 `paper4-papers.zip`；单行 **导出 JSON** 下载一份单卷包。发布自由练习操作仅使用选中项中尚未公开的草稿。

完整包包含参考答案与隐藏测试。仅试卷创建者或管理员可以导出；其他教师能够查看公开题面，但不能导出他人完整题包。学生不能使用导出接口。

集合包结构如下：

```text
paper4-papers.zip
├── paper4-index.json
└── papers/
    ├── paper4-<paper-id>-v1.json
    └── paper4-<another-paper-id>-v2.json
```

`paper4-index.json` 示例：

```json
{
  "format": "codemaster-paper4-collection",
  "version": 1,
  "papers": [
    { "path": "papers/paper4-first-v1.json" },
    { "path": "papers/paper4-second-v2.json" }
  ]
}
```

索引中的路径必须存在且不能重复；集合包不能夹带未引用的文件。每个 JSON 文件依然使用 [单卷格式](paper4-import-format.md)，保留年份、考季、卷号、英文题面、初始文件、评分阶段、参考答案及公开和隐藏测试。

## 接口

- `POST /api/v1/paper4/imports/batch-preview`：`{ "files": [{ "filename": "paper4.json", "contentBase64": "..." }] }`，只校验并返回逐卷预览，不写入。
- `POST /api/v1/paper4/papers/batch-import`：接受相同文件结构，完整校验后在一个事务内创建草稿，返回 `{ "count": 2, "items": [...] }`。
- `POST /api/v1/paper4/papers/batch-export`：`{ "paperIds": ["..."] }`，按选择顺序导出，返回 ZIP 下载信息。

三个接口都经过登录、角色与修改请求保护。只有两个批量导入接口允许 12 MiB 的 JSON 请求体，用于容纳 Base64 开销；其他接口保持原有 2 MiB 请求限制。

# Python 全目录原创对应课程

按 [HackerRank Python 公开目录](https://www.hackerrank.com/domains/python) 的知识点逐一对应，**115 个目录条目 → 115 道本站原创可判题练习，17 章**。目录快照核验日期：2026-10-24。用户已选择「站内原创对应练习」。这些练习的题面、案例和参考程序独立编写，不是 HackerRank 原题转载，也不承诺与原题输入输出协议或难度完全相同。

## 文件

- `course.md`：17 章可导入课程，独立概念讲解、示例、自测重点和全部原题链接。
- `source-catalogue.json`：公开目录元数据快照，不含原站题面或答案。
- `coverage.json` / `coverage.csv`：原站稳定 ID、来源链接和章节映射。
- `native-catalogue.csv`：本站原创题名、接口和来源条目的逐题清单。
- `problems.json`：115 题的**私有教师导入包**，包含参考代码和正式测试；仅在受限本地目录或私有传输中提供，已从公开 Git 仓库和镜像构建上下文排除，不得放入网站公开资源目录。
- `build-problems.py`：私有题包生成器，同样不提交公开仓库；预期值来自独立夹具或小规模 Python 预言机，不从参考程序输出反填。

每题 2 个公开样例、5 个正式用例（各 20 分），共 805 个用例。入门包含 6 道标准输入输出题；其余 109 道为单参数 `solve(data)` 函数题，JSON 用例由系统传入，返回 JSON 值。函数题不需要主函数、手动调用或 main guard。方法建议用于学习，判题按行为检查，不声称能强制使用某个类、装饰器或库。

| 章 | 分类 | 原创题数 |
| --- | --- | ---: |
| 1 | Introduction | 7 |
| 2 | Basic Data Types | 6 |
| 3 | Strings | 14 |
| 4 | Sets | 13 |
| 5 | Math | 7 |
| 6 | Itertools | 7 |
| 7 | Collections | 8 |
| 8 | Date and Time | 2 |
| 9 | Errors and Exceptions | 2 |
| 10 | Classes | 2 |
| 11 | Built-Ins | 6 |
| 12 | Python Functionals | 3 |
| 13 | Regex and Parsing | 17 |
| 14 | XML | 2 |
| 15 | Closures and Decorators | 2 |
| 16 | NumPy | 15 |
| 17 | Debugging | 2 |

## 核验与导入

以下命令需要先通过私有通道取得教师导入包及生成器；公开仓库仅提供目录、课程讲义和导入工具，不提供付费题解或隐藏测试。

```sh
python3 content/hackerrank-python/build-problems.py
node scripts/check-hackerrank-python.mjs
# 必须在真实执行器所在的可信网络内配置 GO_JUDGE_TEST_URL / TOKEN：
node scripts/check-hackerrank-python.mjs --judge
# 只接受本地 HTTP，使用忽略目录中的教师凭据，创建/恢复草稿：
node scripts/import-hackerrank-python-course.mjs
```

检查器不启用真实执行器时明确输出 SKIPPED，静态检查不能替代真实判题。本次已完成全部 115 参考解的 805 个用例，以及 115 个只重复首个样例答案的错误程序验证；导入后又由生产 worker 验证全部版本。

导入器按 25 题分批，持久保存幂等键、来源摘要、问题/版本 ID 和回执。源包改变或课程被他人编辑/发布时停止，不覆盖后续修改。已创建的 17 章目录草稿按准确内容复用；导入不会重设账号、改成绩、修改旧课程、公开答案或发放 Luq。

初次制作只创建本地草稿。用户随后授权开放给学生核验；已在本地 3000 通过现有题目发布、管理员全校审核与课程发布流程，发布 17 章和全部 115 道配套练习，保留准确章节及题目版本关联。学生可在课程列表进入「Python 专项训练 · HackerRank 全目录学习路线」。教师仍可从课程详情或同名题目分组管理。参考程序不会随题目发布自动成为免费答案或 Luq 内容。原站分值不映射为本站成绩或奖励。

NumPy 练习使用隔离执行器中固定的 NumPy 2.2.6；运行库、隔离、真实检查与当前限制见 [实施记录](../../docs/hackerrank-python-course-2026-10-24.md)。

后续用户授权的 Luq 内容已在本地 3000 发布：115 份中文题面、115 份完整题解，沿用逐题原价（本批分别为 3/8 Luq），学生需通过现有辅助入口解锁，不能随界面语言免费取得正文。参考代码保留主题选择，默认 GitHub Dark。此发布独立于原始草稿导入器，不由导入器自动执行。详见 [本地内容发布记录](../../docs/hackerrank-python-luq-content-2026-10-24.md)。

再次获得用户明确授权后，课程、115 道练习、115 份中文题面及 115 份题解已增量同步到 [cmoj.space](https://cmoj.space/student/learning-paths/743d18d3-50b7-4b25-8841-9bab5ed06285)，保持章节与准确题目版本关联及 3/8 Luq 报价。没有复制本地学生记录或覆盖线上旧内容；私有材料经后端接口传输，未加入公开仓库。实际线上验证与备份见 [增量同步记录](../../docs/tx99-python-course-sync-2026-10-24.md)。

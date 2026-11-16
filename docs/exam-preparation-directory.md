# 备考中心分类目录

学生侧栏顺序为「我的作业 / My assignments → 备考中心 / Exam preparation → 提交记录 / Submissions」。教师及学校管理员继续使用「备考资源 / Exam resources」，共享目录结构，具体操作入口仍由当前学校和角色决定。

## 分类与命名

| 一级分类 | 下一层 | 后续层级 |
| --- | --- | --- |
| 国际课程 | A Level、IGCSE、AP | A Level／IGCSE 按考试局 → 科目 → 卷别；AP 直接按科目 |
| 升学考试 | 本科入学、研究生入学 | SAT；GRE、GMAT |
| 学科竞赛 | 计算机、数学、物理、化学 | ACSL；美国 AMC、澳洲 AMC、英国 SMC；BPhO；UKChO |
| 语言考试 | IELTS、TOEFL | 听力、阅读、写作、口语 |

A Level 考试局预留 Cambridge (CIE)、Edexcel、LRN、AQA。使用「计算机科学 · 9618」「数学 · 9709」「物理 · 9702」等短科目名，考试局和课程体系由上层提供，不在每一项重复完整路径。Edexcel 使用正确名称 Further Mathematics／进阶数学。卷别名称使用 Paper 1、Paper 4；进入具体练习页后继续显示完整的「Paper 1 真题练习」「Paper 4 真题练习」。

2026-11-16 补齐的主要科目：

| 体系 | Cambridge (CIE) | Edexcel |
| --- | --- | --- |
| A Level | 数学 9709、化学 9701、经济 9708、生物 9700、计算机科学 9618；保留物理 9702 | 数学、化学、经济、生物、计算机科学；保留进阶数学、物理 |
| IGCSE / International GCSE | 数学 0580、附加数学 0606 | 数学 A 4MA1、进阶纯数学 4PM1 |

Cambridge 的代码与名称以[官方 A Level 科目表](https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/subjects/)为准。0580 包含 Core 和 Extended，0606 的正式名称是 Additional Mathematics，因此使用“附加数学”，并保留用户习惯的“扩展数学”搜索别名。[Cambridge 数学课程说明](https://www.cambridgeinternational.org/programmes-and-qualifications/maths/)

Edexcel IGCSE 的 Mathematics A／Further Pure Mathematics 是相近方向的独立课程，不表示与 Cambridge 考纲等同。名称和代码参考 [Pearson 课程目录](https://qualifications.pearson.com/en/support/Services/remote-invigilation/pearson-edexcel-remote-invigilation-service-for-schools.html)。A Level 选择沿用 International AS/A Level（IAL），课程代码检索别名参考 [Pearson 资格手册](https://qualifications.pearson.com/content/dam/pdf/Support/Information-manual/4-ial-2024-25.pdf)。新版 [Edexcel IAL Computer Science](https://qualifications.pearson.com/en/qualifications/edexcel-international-advanced-levels/computer-science-2026.html)于 2026 年开课，IAS／IAL 首考分别为 2027／2028；当前仅预留课程，不标为已有历年真题。

IGCSE 当前只展示 Cambridge 与 Edexcel 两个已规划考试局；A Level 仍保留四个考试局。无效的 IGCSE 考试局书签回到 Cambridge，不出现空白目录。课程体系切换保留有效考试局。导航评审及本次具体调整见 [备考目录导航评审](exam-preparation-navigation-review.md)。

两个 AMC 必须按地区区分。阿思丹／ASEEDER 作为竞赛检索线索，不作为与 A Level、AP 同级的考试体系；这样以后新增其他机构的竞赛不需要重排整个目录。

此组织方式参考了 [College Board 的 AP 科目目录](https://apstudents.collegeboard.org/courses)、[LRN 的 A Level 体系](https://lrnglobal.org/lrn-international-as-and-a-level/)及[阿思丹官网的项目目录](https://www.seedasdan.asia/about/)。这些外部名称只用于目录描述，不表示本平台获得主办方或代理方授权。

## 当前内容与预留状态

已有内容保留三条快捷入口：9618 Paper 1、9618 Paper 4、ACSL。Cambridge 9618 行提供两个卷别入口，科目名称也保留原有科目页链接。教师端 ACSL 显示「管理资源」。

其余项目显示「筹备中 / Planned」，仅作目录预留，不生成空练习页或可点击的失效入口。当前预留包括上述考试局、AP 计算机科学 A／计算机科学原理／微积分 AB／微积分 BC／物理 1／化学，以及表中的升学、竞赛和语言考试。未建立课程、试卷、题库或学习记录。

ACSL 的实际授权状态单独处理：「本校未开放」「正在确认开放状态」「暂时无法确认开放状态」均不显示为筹备中。请求失败提供重试，其他现有练习仍可进入。目录配置不授予权限；学校管理员的目录不额外增加 Paper 4 教学入口。

## 浏览与兼容

桌面左侧选择四大类别，右侧显示考试局及紧凑科目列表；窄屏将分类移到内容上方。搜索跨所有类别，支持中英文名称、科目代码和常用别名，例如 CIE、Cambridge、AMC、雅思。

分类、课程体系、考试局使用 URL 查询参数，支持刷新和浏览器后退。学校地址保留学校与工作区上下文；切换目录时移除旧的试卷或答卷选择。分类链接使用原生 Tab／Enter 交互及 `aria-current`，搜索输入关联可见标签，颜色过渡尊重减少动态效果偏好。

旧 `/student/paper4`、`/teacher/paper4`、各角色 ACSL 地址、9618 科目及 Paper 1 地址、学校 `section=paper4|acsl` 与课程深链保持原有路由。本次不修改 API、领域规则、数据库结构或判题执行器。

## 2026-11-16 验证范围

本次重新通过 19 项目录／路由／面包屑测试、Web 类型检查、目标文件 ESLint 及容器生产构建。预览使用实际学生和教师账号只读核验目录、三个练习入口、分类切换、刷新／后退、全目录搜索及中英文布局；检查宽度为 320／768／1024／1440，另检查 200% 等效重排。

完全模拟 API 的浏览器检查覆盖原校及多学校的学生、教师、管理员共六种工作区，以及 ACSL 未开放、错误重试和加载中状态；键盘进入分类和角色入口均通过。七次页面可读性检查无提示。独立截图评审为 8/10，无必修项；后续可进一步压缩窄屏纵向间距，减少筹备行的重复状态文案。

Paper 1 的完整作答、批阅、成绩发布和复盘沿用第一阶段验收，本次没有重跑该流程或沙箱测试。生产检查只登录并读取页面，屏蔽心跳和业务写入，不创建测试答卷。部署结果及历史数据核对记录见设计决策 D121。

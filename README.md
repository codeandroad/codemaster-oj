# CodeMaster OJ · Production

独立的校内教学 OJ。前端采用 Next.js 16 / React / TypeScript，API 采用 NestJS 12 / TypeScript，业务数据使用 PostgreSQL 17。Python 3.12、C++23 和 JavaScript 代码由独立 worker 和 Linux go-judge 沙箱评测；C++ 使用 Clang 19 与 GCC 14 libstdc++。这个项目可以单独复制、安装、构建和部署，不依赖相邻的原型仓库。

## 目录

```text
apps/web/          Next.js App Router、真实业务页面与独立登录/注册
apps/api/          NestJS 模块、控制器、认证 Guard 与生命周期
packages/domain/  业务事务、SQL 迁移、评分规则、worker 与沙箱客户端
deploy/           Web/API/worker 镜像、Compose、Caddy 与执行器配置
scripts/          本地启动、演示数据、验收、负载、备份和结构检查
docs/             生产设计、设计审查与部署记录
```

应用与业务包各有独立的 `package.json` 和锁文件，不共享原型依赖。业务核心保留经验证的 SQL、会话与判题规则，API 的 HTTP 接入由 NestJS 管理。

站点品牌资源来自用户提供的 `brand.zip`：浅色与深色页面分别使用其中的 `codemaster-oj-light-v2.svg`、`codemaster-oj-dark-v2.svg`，浏览器标签页使用 `codemaster-oj-favicon-v2.svg`。生产副本位于 `apps/web/public/brand/` 和 `apps/web/src/app/icon.svg`。

本仓库根目录即生产项目；原型独立保存在相邻的 `../myoj-prototype/`，不参与生产构建。生产仓库使用 `master` 主分支。

## 本地体验

要求 Node.js 24.14+ 与运行中的 Docker/Compose。在本目录执行：

```sh
npm run setup
npm run start:local
```

打开 [本地 OJ](http://127.0.0.1:3000/login)。首次启动创建管理员、教师与学生测试账号，初始密码保存在本机 `.campus-local/test-accounts.json`（权限 600，Git 忽略）。迁移前已创建的三个账号、密码和体验数据继续有效。

首次初始化会准备原创 A + B、Row Sums 两题、课堂作业、学习路径、30 分钟训练，以及真实错误提交与订正报告；再次启动保留实际使用后产生的状态。可先用学生账号完成作业，再切换教师查看成绩与反馈，最后以管理员查看身份、账号及实际评测队列。

积分排行榜默认展示全校学生，也可筛选班级。管理员在「系统设置 → 题目审核」逐版本批准题目向全校公开；批准后的新正式 AC 才计入校级排名积分。教师设置的作业与训练额外奖励保留在个人和活动积分记录，不参与全校排名。学生端排行榜字段由管理员统一设置。

Luq 是独立的可消费助学点，保留现有成绩、个人累计积分及榜分。学生可用 Luq 解锁经教师审核的中文题面或完整题解；管理员可发放、调整和退款，教师可设置冻结的活动额外奖励及辅助开放规则。默认首次有效正式 AC +4、中文题面 3、题解 8 Luq；历史成果不补发，私有参考答案不自动公开。升级须同时应用迁移 043 和运行角色授权；详见 [Luq 实现、配置与升级](docs/luq-system.md)。

编程工作区顶部的 Settings 可调整代码编辑、快捷键、布局及本地计时器。代码区齿轮 → 代码编辑器 → 键位绑定可选择 Vim（默认仍为标准）；普通题与 Paper 4 共用，设置按账号保存在当前浏览器。支持普通/插入/可视模式及常用移动、编辑、撤销和查找键位，具体范围见 [Vim 模式说明](docs/editor-vim-2026-10-24.md)。语言选择和草稿按账号、题目版本、活动上下文及语言分别保存；正式提交会记录语言。函数题的 C++ 接口采用明确的 JSON 协议，说明见 [生产设计](docs/campus-judge-production-design.md#judging)。

停止服务并保留数据：`npm run stop:local`。重新启动：`npm run start:local`。脚本不会重设已有密码或覆盖成绩，持久卷仍为 `campus-judge-local_database`；不要通过删除卷处理启动问题。

本机入口和初始化数据库端口仅绑定 loopback；本地 HTTP 会话传输配置与学校 HTTPS 部署配置分开维护。

## 开发与验证

```sh
npm run typecheck
npm run lint
npm run build
npm test
node scripts/check-separation.mjs
```

`npm test` 默认只运行无需外部服务的测试，缺少真实测试数据库或执行器环境变量时会明确跳过对应集成测试。完整验收需提供 `TEST_DATABASE_URL`、`JUDGE_TEST_DATABASE_URL`、`GO_JUDGE_TEST_URL` 和 `GO_JUDGE_TEST_TOKEN`，使用独立测试库；不能以跳过结果代替通过。

本地开发分别运行 `npm run dev:api` 和 `npm run dev:web`，所需数据库和会话环境见 [部署说明](docs/campus-judge-deployment.md)。正式学校部署使用 `deploy/compose.yaml`，需校园域名、HTTPS 和学校机器上的隔离、负载、备份恢复验收。

tx99 的 cmoj.space 与 ali99 的 HTTPS 8443 入口现共用 tx99 的唯一写入主库；两边学生记录和 Luq 流水已合并保留。ali99 旧库停止归档，不得作为在线回退；迁移只在主库执行。拓扑、受限隧道、备份与实际验证见[共用主库实施记录](docs/shared-primary-2026-10-27.md)，宿主配置模板见 [deploy/shared-primary](deploy/shared-primary/README.md)。

设计与范围见 [生产设计](docs/campus-judge-production-design.md) 和 [设计审查](docs/campus-judge-design-review.md)。最新本地检查见 [根目录迁移验收](docs/campus-judge-root-migration-verification.md)；先前的三角色原型对齐与页面切换记录分别见 [原型对齐](docs/campus-judge-prototype-alignment.md)、[导航验收](docs/campus-judge-navigation-verification.md)。[Next.js 文档](https://nextjs.org/docs/app)、[NestJS 文档](https://docs.nestjs.com/)。

Luq 初始助学金与批量定价：迁移 044 为每个未领取的活跃学生身份追加默认 100 Luq（保留原余额，未来建档自动发放）；管理员可配置初始金额。教师可在 Paper 4 勾选多卷后点击「Luq 价格」，分别设置翻译和题解的解锁价格，已购买权益和考核限制保留。详见 [Luq 配置与迁移](docs/luq-system.md) 及 [本地核验](docs/paper4-luq-translations-2026-10-20.md)。

Luq 助学管理的「批量审核题解」支持普通题目和 Paper 4 大题，清楚区分已发布、待审核与缺少内容，并可勾选已有草稿统一审核发布。迁移 046 保存幂等审核批次，发布前校验权限与正文快照，不自动公开私有参考程序。详见 [批量审核说明](docs/luq-batch-review-2026-10-20.md)。

普通题可按准确版本追加经审核的公开英文展示，中文题面和完整题解仍通过 Luq 辅助入口提供。迁移 047 不覆盖原题版本、课程关联或判题材料，不自动回填内容。本轮整理范围为本地 3000 的 80 题英文展示与中文翻译、缺失的 58 份题解，并补齐 4 个历史版本以保留旧课程入口；已有 22 份课程题解保留。实际迁移、发布与验证状态见 [普通题内容整理记录](docs/luq-ordinary-content-2026-10-20.md)。

Python 专项训练另有按 HackerRank Python 目录逐条对应的原创课程：17 章、115 道本站练习，包含真实隔离 NumPy 判题支持。已按用户授权在本地 3000 审核发布，并经后续授权增量同步到 tx99 的 cmoj.space，保留原有线上课程与学生记录。题包、来源映射和安全导入说明见 [原创课程内容](content/hackerrank-python/README.md)，制作检查与运行库限制见 [实施记录](docs/hackerrank-python-course-2026-10-24.md)。

该课程教师题包及生成器包含参考程序和隐藏测试，保存在 Git 忽略的本地文件，通过私有通道管理；公开仓库只包含课程索引、讲义和导入工具。Luq 正文不会随源代码或公开静态资产发布。

上述 Python 专项训练的 115 份中文题面和 115 份完整题解已在本地及 cmoj.space 审核发布为 Luq 内容，沿用 3/8 Luq 价格并保留代码主题选择。详见 [本地内容发布](docs/hackerrank-python-luq-content-2026-10-24.md)和[线上增量同步与数据核验](docs/tx99-python-course-sync-2026-10-24.md)。

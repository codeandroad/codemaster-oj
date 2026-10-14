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

本仓库根目录即生产项目；原型独立保存在相邻的 `../myoj-prototype/`，不参与生产构建。生产仓库使用 `master` 主分支。

## 本地体验

要求 Node.js 24.14+ 与运行中的 Docker/Compose。在本目录执行：

```sh
npm run setup
npm run start:local
```

打开 [本地 OJ](http://127.0.0.1:3000/login)。首次启动创建管理员、教师与学生测试账号，初始密码保存在本机 `.campus-local/test-accounts.json`（权限 600，Git 忽略）。迁移前已创建的三个账号、密码和体验数据继续有效。

首次初始化会准备原创 A + B、Row Sums 两题、课堂作业、学习路径、30 分钟训练，以及真实错误提交与订正报告；再次启动保留实际使用后产生的状态。可先用学生账号完成作业，再切换教师查看成绩与反馈，最后以管理员查看身份、账号及实际评测队列。

编程工作区顶部的 Settings 可调整代码编辑、快捷键、布局及本地计时器。语言选择和草稿按账号、题目版本、活动上下文及语言分别保存；正式提交会记录语言。函数题的 C++ 接口采用明确的 JSON 协议，说明见 [生产设计](docs/campus-judge-production-design.md#judging)。

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

设计与范围见 [生产设计](docs/campus-judge-production-design.md) 和 [设计审查](docs/campus-judge-design-review.md)。最新本地检查见 [根目录迁移验收](docs/campus-judge-root-migration-verification.md)；先前的三角色原型对齐与页面切换记录分别见 [原型对齐](docs/campus-judge-prototype-alignment.md)、[导航验收](docs/campus-judge-navigation-verification.md)。[Next.js 文档](https://nextjs.org/docs/app)、[NestJS 文档](https://docs.nestjs.com/)。

# 生产仓库根目录迁移与本地验收 · 2026-10-14

## 范围与结果

真实 OJ 的 `apps/`、`packages/`、`deploy/`、`scripts/` 和 `docs/` 已移到项目根目录。原型完整移至相邻的 `../myoj-prototype/` 独立仓库；旧父目录的 Git 元数据仅在本机忽略目录 `.campus-local/legacy-parent-git/` 留存，不进入新生产仓库。新仓库使用 `master`，远端为 `https://github.com/codeandroad/codemaster-oj.git`。本轮部署仅是本机 `http://127.0.0.1:3000/login`，等待人工体验；学校服务器仍需另行部署验收。

## 数据与隔离

- 迁移前制作 PostgreSQL 自定义格式备份，保存在本机忽略目录，SHA-256 为 `ddd9740ac59b6ddbf812e3eaa6500749f8ef774a9e29c5514720012582dbe15c`。
- 迁移前后均为 3 个账号、2 个作业、36 次提交、1 次计时尝试。原错误提交仍为 WA 75 分、订正仍为 AC 100 分；三种角色账号可用，worker 心跳与并发配置正常。私有账号文件和部署密钥文件的 SHA-256 均未变化。
- 原型仓库工作区干净，169 个受 Git 管理的文件、HEAD `e92b0df06f96442276e45f980cf260c8033cfbfe` 与内容哈希 `b538f5188b46afaad952516f3a5be47a86799b7e24f7a1bdf2594effc03f0172` 均匹配既有基线。`check-separation` 通过。
- 所有会修改测试数据的 PostgreSQL 集成测试使用独立的 `campus_qa_20261014` 数据库；浏览器页面检查只登录和读取体验数据，未重置账号、作业或成绩。

## 当前代码验收

- `npm run typecheck`、`npm run lint`、`npm run build` 均通过。`npm test` 在独立测试库运行，领域、Nest HTTP 和 Web 测试均为零失败。
- 在实际 Docker Linux go-judge 中，8 项沙箱测试通过，覆盖 Python 3.12、Clang 19 / GCC 14 libstdc++ / C++23、JavaScript、函数与标准输入协议、隔离及资源限制。
- 在独立数据库加实际 go-judge 的组合中，11 项队列与 worker 测试通过，覆盖并发认领、租约、重试、重判、真实评分及 C++/JavaScript 语言持久化。
- Chromium 检查管理员、教师、学生及公开入口共 92 个桌面和 390 px 手机页面，无脚本错误、可见请求错误或横向溢出。27 次角色内站内切换的整页文档请求、重复 `auth/me` 和全屏闪烁均为 0。品牌图在登录、注册、桌面管理与手机导航等 5 处正确加载，PNG 文件与用户提供的附件 SHA-256 完全一致。
- 交互式浏览器检查通过：管理员账号搜索、角色筛选与编辑抽屉；教师班级详情/编辑入口及作业导航；学生在编程页切换 Python、C++、JavaScript，打开设置的五个分区并用 Escape 关闭。390 px 手机导航与工作区设置可用，未出现横向溢出或客户端异常；检查中没有发送业务写入请求。

本轮修复了学生函数题 `args/kwargs` 自定义输入、同题切换活动时的草稿串写、管理员判题队列语言显示、计时训练状态与分数反馈不一致，以及隔离 schema 中积分函数迁移失败；还恢复了用户指定的 CodeMaster OJ 品牌图片。相应回归测试已纳入代码库。

学校域名、HTTPS、30–50 人并发负载与真实服务器备份恢复仍属于正式上线前的独立验收项目。本地体验服务已启动，人工验收尚未完成。

> 后续品牌更正（2026-10-14）：本记录中的 PNG 对比仅说明根目录迁移时的状态。用户随后指定 `brand.zip` 内的 SVG 才是最终品牌资源；现行选择见 [D32](campus-judge-design-summary.md#decision-d32)。

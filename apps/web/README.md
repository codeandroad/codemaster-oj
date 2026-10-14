# Campus Judge Web 实现说明

独立 Next.js App Router 应用，运行时组件和资产来自本目录。身份、教学数据和判题结果使用同源 `/api/v1` 服务；生产页面不加载验收 fixtures 或模拟账号。测试脚本中的接口替身仅用于验证。

## 开发与构建

Web 需要 Node.js >=22；完整 API/domain 工程需要 >=24.14。按锁文件 `npm ci`，开发使用 `npm run dev`。DEV_API_URL 默认为 http://127.0.0.1:3001，仅控制开发 API 转发；生产由 Caddy 将 API 请求转至 NestJS。

```bash
npm run typecheck
npm run lint
npm run build
node --test tests/*.test.mjs
```

构建产出 `.next/standalone/server.js`，部署需同时携带 `.next/static` 和 public；参考 ../../deploy/Dockerfile.web，设置 PORT、HOSTNAME。build/dev 先执行 scripts/sync-formatters.mjs，把本地格式化器 WASM 与许可复制到 public/formatters。

## 当前组件与功能

- student/workspace.tsx：真实题目加载、来源导航、前后/随机题目、面板布局、公开运行、正式提交和结果轮询。
- student/code-editor.tsx、editor-behavior.ts：词法高亮、缩进、括号补全、编辑历史和移行；code-format.ts 使用 Ruff、clang-format、Prettier，程序执行仍交给现有评测链路。
- workspace-settings.tsx：页面和编辑器设置隔离；页面跟随系统、14 配色与预览、可自定义编辑快捷键。Alt+W 离开答题页返回列表，保存本机会话草稿并对未提交修改确认。
- teacher/problem-editor.tsx、math-editor.tsx：题面、接口/模板、测试、判题、参考答案和发布；Markdown/LaTeX 支持 KaTeX 展示及语法错误提示。
- teacher/timed.tsx、assignments.tsx：草稿编辑与专用进行情况维护。已发布活动保持锁定，列表只显示“查看”，复制草稿入口已移除。
- teacher/use-activity-draft.tsx：按账号/活动类型/ID 保存浏览器本机草稿，600ms 防抖并在离开时补存；提供恢复/忽略，手动保存成功后清理。本机保存不会上传或发布。
- teacher/activity-validation.ts 与 packages/domain/src/timed.mjs：历史但顺序正确的时间窗口可保存为训练草稿；发布仍要求结束晚于当前时间。

教师页面主题覆盖表单、表格、弹窗和抽屉；主题来源和许可见 editor-theme-sources.md 与 theme-licenses/。会话 cookie 为 HttpOnly，CSRF token 留在内存；沿用服务端权限、活动不可变规则和事务。Debug 七项显示未启用，需要另建隔离调试会话服务。

## 部署核对

包含 domain 时间校验的更新需同时重建/重启 API 和 Web；如新增迁移，应先备份并执行迁移。生产部署步骤见项目根 [部署说明](../../docs/campus-judge-deployment.md)。真实账号、数据库和评测环境仍需人工核对，浏览器自动检查使用接口测试数据。

## 账户菜单与上线准备（2026-10-13）

生产主导航新增真实用户头像（姓名首字）、设置、角色切换和退出登录；移除教师页面 T01/T02/T04/T05 设计编号与固定示例课程名称。正式教学/主题预览保留。上线状态为待预生产验收，不能以本地验证替代数据库、HTTPS、隔离判题、备份恢复和容量测试。初始管理员通过 domain 的 bootstrap 命令一次性创建，无默认管理员密码；已存在管理员时使用邀请。上线核对记录见 [launch-readiness.md](launch-readiness.md)，当前部署步骤见项目根 [部署说明](../../docs/campus-judge-deployment.md)。

本轮验证：类型检查、lint、生产构建通过；82 项 Web 单元通过；账户菜单的真实 React 接口替身检查单独记录于 RECON/production/account-menu-browser-tests.json。部署指南同时随 Web 工程交付为 launch-readiness.md。

顶部信息横条清理：删除主页面最顶部的平台说明与角色/姓名重复横条；工作区布局恢复完整视口高度。账户头像菜单保留，用户资料仍来自真实认证接口，不擅自改写账号名称。

## 角色权限显示

管理员包含教学权限：账号列表、角色筛选和「角色与范围」均显示有效 teacher 权限；admin 勾选时 teacher 自动勾选并标注「管理员包含」，不可单独取消。取消 admin 后仅保留显式授予的 teacher；继承显示不会向数据库额外写入 teacher，也不会提升普通教师权限。

## 运行环境语言显示

运行环境表不再写死 C++ 未配置：Python、C++、JavaScript 的版本与关联节点由 worker 环境探测字符串解析，节点心跳决定可用状态；无观测时显示未获取。Java 镜像与编译判题尚未接入，明确显示当前不支持，不冒充已配置。

## 班级创建与公共页面整理

管理员创建班级不再被强行作为显式教师提交；后端负责教师查询接受具备管理员继承教学权限的账号，保持权限模型一致。运行环境只列 Python/C++/JavaScript，未接入 Java 不显示。公共页面标题、描述宽度、状态色、表格行高与表单圆角统一，并保持既有主题色。

## 新 Logo 应用

CodeMaster OJ 字标更新为现代无衬线矢量轮廓，保留书页与代码括号符号。BrandLogo 统一使用本地透明 SVG，主题上下文选择浅色/深色版；登录、侧栏与调用该组件的工作区同步更新。浏览器 icon.svg 改为独立符号。新资源包含在单文件更新包内，无额外字体与网络依赖。

## 编辑页题目列表抽屉

代码编辑页左上「题目列表」打开左侧模态抽屉，展示 API 返回的可访问题目，支持标题搜索、当前题目、加载/空列表/错误重试状态。选择其他题目使用既有 navigateWorkspace 草稿离开保护，进入独立题库练习，不继承作业或计时训练上下文；原上下文返回入口保留。Esc、遮罩及关闭按钮可关闭抽屉，焦点由模态组件管理。

## 编辑页账户与通知

代码编辑页顶部右侧增加真实账户头像（设置、角色切换、退出），退出有未提交草稿确认并调用 auth/logout。通知改为铃铛锚定下拉面板，学生主页面共用该组件；展示真实站点公告和作业截止提醒，支持加载、空状态、失败重试、Esc/外部点击关闭。现有服务未提供独立未读/已读接口，因此不伪造未读计数或已读操作。LeetCode 登录后的通知面板无法通过公开页面获取，本轮采用通用铃铛下拉交互，不宣称像素级复刻。

## 学习路径文档交换与 Python 课程

新增教师 Markdown 导入预览、事务内创建新草稿与导出当前编辑内容。沿用路径/章节/练习引用/身份阅读进度模型，不导入发布状态或学生进度。正文、检查点与答案统一按 Markdown 渲染，移除学生页按题名注入演示课程块；目录与内容容器独立组织。python-learning-path.md 为完整 20 章课程（1800 分钟），含例子、输出、检查点与答案，不依赖题库 ID。导入限制及跨站题库引用规则见 learning-path-format.md。

## 学习路径导入路由、练习与双进度

修复 API 控制器遗漏导入路由。新增课程封面/难度与 014 数据库迁移；Python 原始 20 章资料可生成 20 道配套题（100 测试），真实判题全部 AC 后才能发布并关联。学生阅读与正式 AC 任务进度分别统计，教师可查看负责班级学生的双进度；计时练习未公开结果不泄漏为任务完成。安装必须先迁移再重启 API/Web。操作与验证边界见 python-course-testing.md。

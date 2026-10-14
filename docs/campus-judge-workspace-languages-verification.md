# 编程工作区设置与三语言判题验收（2026-10-12）

本轮只改动独立的 `production/` 及父项目设计摘要。原型 `myoj/` 保持独立。校内 Ubuntu 服务器尚未部署；以下是本机 Docker Compose 生产构建、真实 go-judge 沙箱和 Chromium 的验收结果。

上述为 2026-10-12 的历史目录名称。自 2026-10-14 起，生产项目位于本仓库根目录，原型位于相邻 `../myoj-prototype/`；复跑原型隔离检查时使用 `node scripts/check-separation.mjs --prototype ../myoj-prototype`。

## 实现边界

- 工作区顶部 Settings 弹窗包含 Dynamic Layout、Code Editor、Shortcuts、Advanced 和 Timer。按钮位置、面板宽度、字体/字号、连字、Tab 宽度、自动换行、相对行号、快捷键、实时调整宽度、新标签打开结果及个人计时器均有实际行为。设置按用户保存在浏览器本地；各语言代码草稿独立保存在当前浏览器会话。
- Python 3.12、C++23 和 JavaScript/Node.js 22 均支持标准输入输出与 JSON 函数题的公开样例、正式提交及教师参考解验证。C++ 函数签名固定为 `json name(json& args, json& kwargs)`；JavaScript 按位置展开 `args`，非空 `kwargs` 作为最后一个对象参数。教师可设置参考解语言及各语言初始代码，ZIP 题包可包含对应 `.cpp`/`.js` 文件。旧版本、旧提交和旧幂等请求保持 Python 兼容。
- C++ 在隔离沙箱中使用 Clang 19.1.7、GCC 14 libstdc++ 与 `__cplusplus=202302L`；编译错误记 CE，编译产物缓存于任务结束时删除。Node.js 的有效内存上限为 `max(题目设置, 128 MiB)`，题目 API 与工作区明确披露；Python/C++ 仍用题目值。这解决 32 MiB JavaScript 题的间歇性语法预检内存超限。
- 未接入 LeetCode 专有 AI、Premium 或调试服务，因此界面不提供无效的同名按钮。个人计时器不改变服务器计时训练的正式截止时间。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`、`npm run lint`、`npm run build` | 全部通过；Docker Compose 的 API、worker、web、judge 镜像重新构建并启动 |
| `npm test` 默认环境 | 领域单元 29 通过、0 失败、31 项需数据库/沙箱的集成项跳过；API 默认集成 1 项跳过；题包 19 通过、0 失败。跳过项另按下列显式环境执行，不能计作默认命令通过 |
| 显式真实 go-judge 沙箱集成 | 8/8 通过；涵盖三语言标准输入输出及函数协议、C++ 编译错误/缓存清理、32 MiB 题的 JavaScript 有效内存及超限 |
| 随机隔离 PostgreSQL schema、真实队列及迁移 013 | 11/11 通过；测试 schema 已清理 |
| 真实 Nest HTTP 集成 | 1/1 通过；含语言响应、历史 Python 幂等请求兼容 |
| 三角色无整页重绘 Chromium 回归 | 27 次站内导航，0 次整页文档请求、0 次重复 `auth/me`、0 次全屏闪烁、0 个浏览器异常 |
| 编程工作区 Chromium 功能与响应式验收 | C++/JavaScript 公开样例分别获 Accepted（SUB17/SUB18）；5 个设置分区可操作，面板分隔位置 44%→48%、语言草稿及个人计时器刷新后恢复；390 px 窄屏页面与视口等宽、设置弹窗无横向溢出、Esc 可关闭；设置过程中 0 次意外整页请求，0 个浏览器异常。原始报告保存在本机 `.campus-local/alignment-evidence/workspace-final-qa.json`，同目录有桌面、窄屏和自动换行编辑器截图 |
| 本地体验数据保留 | 迁移 013 后三角色账号可用；原 75 分 WA、100 分订正 AC 不变，演示作业正式提交仍为 0、计时训练尝试仍为 0 |
| 原型隔离 | `node scripts/check-separation.mjs --prototype ../myoj` 通过；原型 169 个已跟踪文件、Git HEAD 与内容哈希均与基线一致 |

本轮仍需在目标学校服务器重新验证镜像架构、cgroup/seccomp、课堂容量与备份恢复。此前 Python 课堂压力结果不能直接当作 C++ 编译高峰容量结果。

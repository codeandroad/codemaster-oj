# 编辑器主题来源

配色从 @shikijs/themes 4.5.0 的内置主题、Atom One Light/Dark、Moonlight 的真实源码提取；不加载第三方脚本。颜色转换为 OKLch，低对比度的注释与行号调整至 4.5:1；活动行、选区与括号高亮由本主题前景和背景派生。当前轻量编辑器映射关键词、字符串、数字、注释、内置函数，不宣称提供完整 VS Code 语义高亮。

- Shiki: https://github.com/shikijs/shiki/tree/main/packages/themes （MIT）
- Atom: https://github.com/atom/one-dark-syntax 、 https://github.com/atom/one-light-syntax （MIT）
- Moonlight: https://github.com/atomiks/moonlight-vscode-theme/tree/master/src （MIT）

许可证保存在 theme-licenses/。vs_dark/vs 对应 VS Code Dark+/Light+ 配色；material dark/light 对应 Material Theme / Lighter。


## 当前使用方式

14 个命名配色仅影响代码区，页面主题另设浅色、深色、跟随系统；设置页的预览复用 editor-themes.ts 与 CodeTokens。教师端模板和参考答案随页面使用 vs / vs_dark。背景、前景、行号、语法颜色与活动行、括号、选区状态都在编辑器自身作用域内，不向页面或弹窗传播。

自定义快捷键及其悬停提示由 editor-keymap.ts 管理，与配色数据独立。Debug 尚未接入隔离服务，不属于主题或快捷键配置能够启用的能力。14 种配色的普通/活动行已有最低 4.5:1 检查，证据见项目 RECON/production/theme-contrast-tests.json；这不等同于完整 VS Code 语义高亮或原站像素保真。

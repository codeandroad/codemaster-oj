# 备考目录导航评审 · 2026-11-16

调整前评分：**3/4 — 层级与视觉基本清楚，需要三项具体修正**。

评审对象为 3004 的学生备考目录，查看 1440px 桌面与 320px 英文手机画面；教师端沿用同一目录组件。本次目标是容纳用户新增的 Cambridge／Edexcel A Level 与 IGCSE 科目，保留原有练习和角色入口。评分采用 design-review 的 0–4 标尺，与此前 10 分制评审分开。

## 1. 为 IGCSE 增加明确层级

- **Before:** 课程体系只有 A Level 和 AP，0580、0606 没有所属层级；考试局说明也固定显示 A Level。
- **After:** 增加 IGCSE，与 A Level、AP 并列；IGCSE 下显示 Cambridge 与 Edexcel，分别展示 IGCSE／International GCSE 说明。切换 A Level 与 IGCSE 时保留仍有效的考试局，刷新和后退可恢复位置。
- **Why:** Nielsen heuristic #2 — Match between system and the real world：按学生实际课程体系定位科目。

## 2. 压缩手机导航的纵向占用

- **Before:** 320px 英文画面上，四个分类块同时显示名称和说明，首条科目约在页面纵向 915px，卷别按钮位于首屏下方。
- **After:** 窄屏保留四个可见分类链接，隐藏附加说明和装饰图标、缩小区块间距，并将重复的面板分类标题改为仅供辅助技术读取；保留至少 44px 的导航点击高度及三个现有练习快捷入口。
- **Why:** Nielsen heuristic #7 — Flexibility and efficiency of use：减少进入科目前的滚动距离。

## 3. 删除筹备科目的重复信息

- **Before:** 数学与物理行同时显示“科目与卷别资源筹备中”和右侧“筹备中”，每个筹备科目占约 90px 高度。
- **After:** 普通筹备科目只保留名称、代码及一次状态提示，缩小行距；0580 的 Core／Extended、Edexcel 数学 A 的 Foundation／Higher 和新计算机课程首考年份继续显示，因为这些信息有助于选择课程。
- **Why:** Nielsen heuristic #8 — Aesthetic and minimalist design：让科目名和可用卷别更容易扫描。

**优先修正：IGCSE 层级。** 它决定新增科目是否能被正确找到；手机密度和重复文案随后处理。本次已落实上述三项，未改动全局侧栏顺序或现有练习路由。

实施后已查看桌面、Cambridge IGCSE 及 320px 英文实际截图。320px 英文视口中首条科目行起点为 697px，Paper 1／Paper 4 操作完整显示在 960px 高的首屏内；没有横向溢出。桌面首屏可同时查看六门 Cambridge A Level 科目。上述是布局观察，不代表真实用户任务耗时测量。

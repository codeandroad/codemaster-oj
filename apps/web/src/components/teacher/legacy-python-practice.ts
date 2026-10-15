// The one-click practice importer is tied to the original 20-chapter sample.
// Keep its eligibility separate from the editable category label so other
// Python courses can use the normal problem-bank and chapter-link workflow.
const sampleChapterTitles = [
  "开始编程与运行环境",
  "变量、数值与表达式",
  "输入、转换与格式化输出",
  "布尔值与条件分支",
  "for 循环与 range",
  "while 循环与流程控制",
  "字符串与文本处理",
  "列表、遍历与推导式",
  "二维列表与矩阵",
  "元组、字典与集合",
  "函数与参数",
  "作用域、对象与递归入门",
  "异常处理与输入校验",
  "文件、路径与 JSON",
  "模块与标准库",
  "类与数据建模",
  "测试、调试与边界",
  "排序、查找与算法思维",
  "复杂度与前缀和",
  "综合项目：学习成绩分析器",
] as const;

export function canUseLegacyPythonPractice(path: {
  chapters?: readonly { title: string }[];
  practiceBundle?: readonly unknown[];
}): boolean {
  // Existing imported bundles still need their validation/publish controls if
  // a teacher has since renamed a chapter.
  if (path.practiceBundle?.length) return true;
  return path.chapters?.length === sampleChapterTitles.length &&
    path.chapters.every((chapter, index) => chapter.title === sampleChapterTitles[index]);
}

export type SolutionUse = { id: string; title: string };
export type SolutionVersion = {
  versionId: string;
  title: string;
  createdAt: string;
  current: boolean;
  latest?: boolean;
  published?: boolean;
  solutionStatus?: string | null;
  hasPendingSolutions?: boolean;
  usage?: {
    courseCount: number;
    courses: SolutionUse[];
    assignmentCount: number;
    assignments?: SolutionUse[];
    timedCount: number;
    timedPractices?: SolutionUse[];
    schoolPractice: boolean;
  };
};

export function hasStudentUse(version: SolutionVersion) {
  const usage = version.usage;
  return Boolean(usage && (usage.courseCount || usage.assignmentCount || usage.timedCount || usage.schoolPractice));
}

export function solutionUseLabels(version: SolutionVersion, locale: string) {
  const zh = locale === "zh", usage = version.usage;
  if (!usage) return [];
  const labels: string[] = [];
  if (usage.courseCount) {
    labels.push(...usage.courses.map(course => `${zh ? "课程" : "Course"} · ${course.title}`));
    const unnamed = usage.courseCount - usage.courses.length;
    if (unnamed > 0) labels.push(zh ? `另有 ${unnamed} 门课程` : `${unnamed} other course${unnamed === 1 ? "" : "s"}`);
  }
  if (usage.assignmentCount) {
    labels.push(...(usage.assignments ?? []).map(item => `${zh ? "作业" : "Assignment"} · ${item.title}`));
    const unnamed = usage.assignmentCount - (usage.assignments?.length ?? 0);
    if (unnamed > 0) labels.push(zh ? `${unnamed} 项作业` : `${unnamed} assignment${unnamed === 1 ? "" : "s"}`);
  }
  if (usage.timedCount) {
    labels.push(...(usage.timedPractices ?? []).map(item => `${zh ? "限时练习" : "Timed practice"} · ${item.title}`));
    const unnamed = usage.timedCount - (usage.timedPractices?.length ?? 0);
    if (unnamed > 0) labels.push(zh ? `${unnamed} 项限时练习` : `${unnamed} timed practice${unnamed === 1 ? "" : "s"}`);
  }
  if (usage.schoolPractice) labels.push(zh ? "校内题库练习" : "School problem practice");
  return labels;
}

export function solutionContextName(version: SolutionVersion, locale: string) {
  return solutionUseLabels(version, locale)[0] ?? (version.latest
    ? locale === "zh" ? "本次题目修改" : "Latest problem edit"
    : locale === "zh" ? "历史保存记录" : "Historical save");
}

export function solutionStatusName(version: SolutionVersion, locale: string) {
  const zh = locale === "zh";
  if (version.hasPendingSolutions) return zh ? "更新待审核" : "Updates awaiting review";
  if (version.solutionStatus === "published") return zh ? "题解已发布" : "Solutions published";
  if (version.solutionStatus === "draft") return zh ? "题解草稿" : "Solution draft";
  if (version.solutionStatus === "withdrawn") return zh ? "题解已撤回" : "Solutions withdrawn";
  return zh ? "题解尚未发布" : "Solutions not published";
}

export function solutionSaveDate(version: SolutionVersion, locale: string) {
  const date = new Date(version.createdAt);
  return Number.isNaN(date.getTime()) ? (locale === "zh" ? "保存时间未知" : "Unknown save time")
    : date.toLocaleString(locale === "zh" ? "zh-CN" : "en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

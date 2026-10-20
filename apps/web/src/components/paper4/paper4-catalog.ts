import type { Paper4PaperSummary } from "./model";

/** Outer-list navigation opens the target paper, without inheriting another paper's version or chapter. */
export function paper4PracticeHref(paperId: string, scope: "catalog" | "activities") {
  return `/student/paper4/${encodeURIComponent(paperId)}${scope === "activities" ? "?scope=activities" : ""}`;
}

export function paper4Years(items: Paper4PaperSummary[]): number[] {
  return [...new Set(items.flatMap(item => item.examYear == null ? [] : [item.examYear]))].sort((a, b) => b - a);
}

export function filterPaper4Catalog(items: Paper4PaperSummary[], year: string, session: string): Paper4PaperSummary[] {
  return items.filter(item => (!year || (year === "unclassified" ? item.examYear == null : String(item.examYear) === year)) && (!session || item.examSession === session))
    .sort((a, b) => (b.examYear ?? 0) - (a.examYear ?? 0) || (a.examSession ?? "z").localeCompare(b.examSession ?? "z") || (a.examVariant ?? 99) - (b.examVariant ?? 99));
}

export function paper4ExamLabel(paper: Pick<Paper4PaperSummary, "examYear" | "examSession" | "examVariant">, locale: "zh" | "en"): string {
  return [paper.examYear, paper.examSession === "summer" ? (locale === "zh" ? "夏季" : "May/June") : paper.examSession === "autumn" ? (locale === "zh" ? "秋季" : "October/November") : null, paper.examVariant ? `${locale === "zh" ? "卷" : "Paper "}${paper.examVariant}` : null].filter(value => value != null).join(" · ");
}

import type { CourseLanguage } from "./course-localization";

export type CourseAcslReference = {
  paperSlug: string;
  kind: "question" | "written" | "programming";
  questionId?: string;
  versionId?: string;
};
export type CourseAcslLink = CourseAcslReference & {
  paperId?: string;
  title?: Record<CourseLanguage, string>;
  questionNumber?: number;
  available?: boolean;
  reason?: string;
  status?: "not_started" | "draft" | "submitted" | "accepted" | "unavailable";
  completed?: boolean;
  historical?: boolean;
};
export type CourseAcslCandidate = {
  paperId: string;
  versionId: string;
  paperSlug: string;
  title: Record<CourseLanguage, string>;
  division: string;
  season: string;
  round: number;
  hasProgramming: boolean;
  questions: {
    id: string;
    number: number;
    topic: Record<CourseLanguage, string>;
  }[];
};
export function courseAcslKey(link: CourseAcslReference) {
  return `${link.paperSlug}:${link.versionId ?? "current"}:${link.kind}:${link.questionId ?? ""}`;
}
export function courseAcslReferences(
  links: CourseAcslReference[] = [],
): CourseAcslReference[] {
  return links.map(({ paperSlug, kind, questionId, versionId }) => ({
    paperSlug,
    kind,
    ...(versionId ? { versionId } : {}),
    ...(kind === "question" && questionId ? { questionId } : {}),
  }));
}
export function courseAcslLabel(
  link: CourseAcslLink,
  language: CourseLanguage,
) {
  const title = link.title?.[language] || link.paperSlug;
  return `${title} · ${link.kind === "question" ? (language === "en" ? `Question ${link.questionNumber ?? link.questionId}` : `第 ${link.questionNumber ?? link.questionId} 题`) : link.kind === "written" ? (language === "en" ? "Written section" : "整卷笔试") : language === "en" ? "Programming" : "编程题"}`;
}

export function parseCourseAcslReferences(
  value: unknown,
): CourseAcslReference[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("ACSL links must contain up to 100 practice references.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.paperSlug !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,159}$/.test(item.paperSlug) ||
      !["question", "written", "programming"].includes(item.kind) ||
      (item.versionId !== undefined &&
        (typeof item.versionId !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
            item.versionId,
          ))) ||
      (item.kind === "question" &&
        (typeof item.questionId !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(item.questionId)))
    )
      throw new Error("Invalid ACSL practice reference.");
    const link = courseAcslReferences([item])[0],
      key = courseAcslKey(link);
    if (seen.has(key)) throw new Error("Duplicate ACSL practice reference.");
    seen.add(key);
    return link;
  });
}

export function acslLearningLinkApplies(link: { questionIds?: string[]; written?: boolean; programming?: boolean }, context: { programming: boolean; questionIds?: string[] }) {
  if (link.questionIds === undefined && link.written === undefined && link.programming === undefined) return true;
  if (context.programming) return link.programming === true;
  return link.written === true || (link.questionIds ?? []).some(id => !context.questionIds || context.questionIds.includes(id));
}

import type { PlatformSourceProblem } from "@/components/teacher/platform-problem-source";
import type { Problem } from "./school-practice-types";

export type PlatformProblemBank = {
  id: string; name: string; description?: string; revision: number;
  problemCount: number; archivedProblemCount?: number; archivedAt?: string | null;
};
export type PlatformProblemRow = { id: string; title: string; source?: PlatformSourceProblem; publication?: Problem };
export type ProblemReviewDecision = "approve" | "reject" | "withdraw";
export function problemReviewTarget(row: PlatformProblemRow) {
  const { publication } = row;
  if (row.source?.archivedAt || !publication?.schoolId || !publication.versionId) return null;
  return { ...publication, versionId: publication.versionId };
}
export function canReviewProblem(row: PlatformProblemRow, decision: ProblemReviewDecision) {
  const target = problemReviewTarget(row);
  if (!target) return false;
  if (decision === "withdraw") return target.platformPublished === true;
  if (target.platformPublished) return false;
  return decision === "approve" || target.publicRequestStatus === "pending";
}
export type PlatformProblemFilters = { query: string; source: string; bank: string; visibility: string; validation: string; course: string; deleted: boolean };
export const platformProblemFilterKeys = { query: "problemSearch", source: "problemSource", bank: "problemCategory", visibility: "problemVisibility", validation: "problemValidation", course: "problemCourse", deleted: "deletedProblems" } as const;
export function platformProblemFilters(search: Pick<URLSearchParams, "get">): PlatformProblemFilters {
  return { query: search.get(platformProblemFilterKeys.query) ?? "", source: search.get(platformProblemFilterKeys.source) ?? "", bank: search.get(platformProblemFilterKeys.bank) ?? "", visibility: search.get(platformProblemFilterKeys.visibility) ?? "", validation: search.get(platformProblemFilterKeys.validation) ?? "", course: search.get(platformProblemFilterKeys.course) ?? "", deleted: search.get(platformProblemFilterKeys.deleted) === "1" };
}
export function mergePlatformLibrary(sources: PlatformSourceProblem[], publications: Problem[]): PlatformProblemRow[] {
  const rows = new Map<string, PlatformProblemRow>();
  for (const publication of publications) rows.set(publication.id, { id: publication.id, title: publication.title, publication });
  for (const source of sources) rows.set(source.id, { ...rows.get(source.id), id: source.id, title: source.title, source });
  const needsReview = (row: PlatformProblemRow) =>
    row.source?.draftReviewStatus === "pending" || row.source?.hasSolutionDraft || row.publication?.publicRequestStatus === "pending";
  return [...rows.values()].sort((a, b) => Number(Boolean(needsReview(b))) - Number(Boolean(needsReview(a))) || a.title.localeCompare(b.title));
}
export function problemVisibility(row: PlatformProblemRow) {
  return row.publication?.platformPublished ? "public" : row.publication?.publicRequestStatus === "pending" ? "pending" : row.publication?.publicRequestStatus === "rejected" ? "rejected" : "private";
}
export function problemValidation(row: PlatformProblemRow) {
  const status = row.source?.validationStatus;
  return !row.source ? "unknown" : status === "AC" ? "passed" : ["Waiting", "Judging"].includes(status ?? "") ? "running" : !status || ["Draft", "Incomplete"].includes(status) ? "incomplete" : "failed";
}
export function matchesPlatformProblem(row: PlatformProblemRow, filter: PlatformProblemFilters) {
  return Boolean(row.source?.archivedAt) === filter.deleted
    && (!filter.source || (filter.source === "platform" ? Boolean(row.source) : !row.source && row.publication?.schoolId === filter.source))
    && (!filter.bank || Boolean(row.source) && (filter.bank === "unclassified" ? !row.source?.bankId : row.source?.bankId === filter.bank))
    && (!filter.visibility || problemVisibility(row) === filter.visibility)
    && (!filter.validation || problemValidation(row) === filter.validation)
    && (!filter.course || row.source?.courses?.some(course => course.id === filter.course))
    && `${row.id} ${row.title} ${row.source ? "CodeMaster" : row.publication?.schoolName ?? ""} ${row.source?.bankName ?? row.publication?.bankName ?? ""} ${row.source?.tags?.join(" ") ?? ""}`.toLocaleLowerCase().includes(filter.query.trim().toLocaleLowerCase());
}

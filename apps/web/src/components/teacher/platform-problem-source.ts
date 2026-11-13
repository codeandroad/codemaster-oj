import type { ProductionProblem } from "@/lib/production-api";

export const teacherProblemSummaries = "problems?view=summary";
export const teacherPlatformProblemSummaries = "platform/source-problems?schoolId=00000000-0000-4000-8000-000000000052&view=summary";

export type PlatformSourceProblem = ProductionProblem & {
  ownerScope: "platform";
  bankName?: string;
  sourceBankId?: string | null;
  archivedAt?: string | null;
  courses?: { id: string; title: string }[];
  schoolId?: string;
  formalTestCount?: number;
};

export function isPlatformProblem(problem: { id: string }): boolean {
  return (problem as { ownerScope?: string }).ownerScope === "platform";
}

/** A source grant changes editing access, never the identity of the problem. */
export function mergePlatformProblems<T extends ProductionProblem>(items: T[], sources: PlatformSourceProblem[]): (T | PlatformSourceProblem)[] {
  const merged = new Map<string, T | PlatformSourceProblem>(items.map(problem => [problem.id, problem]));
  for (const problem of sources) {
    const existing = merged.get(problem.id);
    merged.set(problem.id, { ...existing, ...problem, bankId: existing?.bankId ?? problem.sourceBankId ?? problem.bankId });
  }
  return [...merged.values()];
}

export function problemEditorHref(problem: { id: string; canEdit?: boolean }, returnTo?: string, tab?: string, kind?: string): string {
  const query = new URLSearchParams();
  if (returnTo) query.set("returnTo", returnTo);
  if (isPlatformProblem(problem) && problem.canEdit !== false) query.set("source", "platform");
  if (tab) query.set("tab", tab);
  if (kind) query.set("kind", kind);
  return `/teacher/problems/${encodeURIComponent(problem.id)}/edit${query.size ? `?${query}` : ""}`;
}

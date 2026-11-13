import type { ProductionProblem } from "@/lib/production-api";

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

export function problemEditorHref(problem: { id: string; canEdit?: boolean }, returnTo: string): string {
  const query = new URLSearchParams({ returnTo, ...(isPlatformProblem(problem) && problem.canEdit !== false ? { source: "platform" } : {}) });
  return `/teacher/problems/${problem.id}/edit?${query}`;
}

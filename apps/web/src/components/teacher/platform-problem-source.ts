import type { ProductionProblem } from "@/lib/production-api";

export type PlatformSourceProblem = ProductionProblem & {
  ownerScope: "platform";
  bankName?: string;
  schoolId?: string;
  formalTestCount?: number;
};

export function isPlatformProblem(problem: { id: string }): boolean {
  return (problem as { ownerScope?: string }).ownerScope === "platform";
}

/** A source grant changes editing access, never the identity of the problem. */
export function mergePlatformProblems<T extends ProductionProblem>(items: T[], sources: PlatformSourceProblem[]): (T | PlatformSourceProblem)[] {
  const merged = new Map<string, T | PlatformSourceProblem>(items.map(problem => [problem.id, problem]));
  for (const problem of sources) merged.set(problem.id, { ...merged.get(problem.id), ...problem });
  return [...merged.values()];
}

export function problemEditorHref(problem: { id: string; canEdit?: boolean }, returnTo: string): string {
  const query = new URLSearchParams({ returnTo, ...(isPlatformProblem(problem) && problem.canEdit !== false ? { source: "platform" } : {}) });
  return `/teacher/problems/${problem.id}/edit?${query}`;
}

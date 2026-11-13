import type { Problem } from "./school-practice-types";

export type PracticeCatalogFilters = {
  bankId: string;
  query: string;
  status: string;
  tab: "banks" | "problems";
  bankQuery: string;
  archived: boolean;
};

export const practiceFilterKeys = {
  bankId: "bankId", query: "problemQuery", status: "problemStatus", tab: "problemTab",
  bankQuery: "bankQuery", archived: "bankArchived",
} as const;

export function practiceCatalogFilters(search: Pick<URLSearchParams, "get">, staff: boolean): PracticeCatalogFilters {
  const statuses = staff ? ["published", "review", "validating", "failed", "draft"] : ["accepted", "attempted", "not-started"];
  const status = search.get(practiceFilterKeys.status) ?? "";
  return {
    bankId: search.get(practiceFilterKeys.bankId) ?? "",
    query: search.get(practiceFilterKeys.query) ?? "",
    status: statuses.includes(status) ? status : "",
    tab: staff && search.get(practiceFilterKeys.tab) !== "problems" ? "banks" : "problems",
    bankQuery: search.get(practiceFilterKeys.bankQuery) ?? "",
    archived: search.get(practiceFilterKeys.archived) === "1",
  };
}

export function practicePublicationState(problem: Problem) {
  if (problem.published && !problem.hasDraftChanges) return "published";
  if (["queued", "leased"].includes(problem.validation?.state ?? "")) return "validating";
  if (problem.validation?.status === "AC") return "review";
  if (problem.validation?.status) return "failed";
  return "draft";
}

export function practiceProblemMatches(problem: Problem, filters: PracticeCatalogFilters, staff: boolean) {
  const progress = problem.solved ? "accepted" : (problem.attempts ?? 0) > 0 ? "attempted" : "not-started";
  return (!filters.bankId || filters.bankId === problem.bankId)
    && `${problem.id} ${problem.title} ${problem.bankName} ${problem.tags?.join(" ") ?? ""}`.toLocaleLowerCase().includes(filters.query.trim().toLocaleLowerCase())
    && (!filters.status || (staff ? practicePublicationState(problem) : progress) === filters.status);
}

/** Keep the current row as an anchor if solving it changes the status filter. */
export function practiceNavigationItems(problems: Problem[], filters: PracticeCatalogFilters, staff: boolean, currentId: string, archivedBankIds: string[] = []) {
  return problems.filter(problem => problem.published && !archivedBankIds.includes(problem.bankId)
    && (problem.id === currentId || practiceProblemMatches(problem, filters, staff)));
}

/** Patch only this view's query fields; course, chapter and workspace stay intact. */
export function practiceLocation(pathname: string, search: string, patch: Record<string, string | null>, hash = "") {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

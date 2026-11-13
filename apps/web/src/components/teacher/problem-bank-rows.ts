import type { ProductionProblem } from "@/lib/production-api";
import type { Bank, Group } from "./problem-banks";
import type { ProblemBankFilters } from "./use-problem-bank-filters";

export function filterTeacherProblemRows<T extends ProductionProblem>({
  items, banks, groups, filters, bankId, currentId,
}: {
  items: T[];
  banks?: Bank[];
  groups?: Group[];
  filters: ProblemBankFilters;
  bankId?: string;
  currentId?: string;
}) {
  const filterBank = !bankId && (!banks || banks.some(bank => bank.id === filters.bank && !bank.archivedAt)) ? filters.bank : "";
  const scopedBank = bankId || filterBank;
  const scopedGroups = (groups ?? []).filter(group => !scopedBank || group.bankId === scopedBank);
  const filterGroup = filters.group === "ungrouped" || !groups || scopedGroups.some(group => group.id === filters.group) ? filters.group : "";
  const selectedGroup = scopedGroups.find(group => group.id === filterGroup);
  const groupMembers = new Set(filterGroup === "ungrouped" ? scopedGroups.flatMap(group => group.problemIds) : selectedGroup?.problemIds);
  const searchText = filters.query.trim().toLowerCase();
  const rows = items.filter(problem =>
    (!scopedBank || problem.bankId === scopedBank) &&
    (!filterGroup || (filterGroup === "ungrouped" ? !groupMembers.has(problem.id) : groupMembers.has(problem.id))) &&
    (problem.id === currentId || (
      (!filters.status || (filters.status === "published" ? problem.published : !problem.published)) &&
      `${problem.title} ${(problem.draftTags ?? problem.tags)?.join(" ")} ${problem.id}`.toLowerCase().includes(searchText)
    )),
  );
  return { rows, scopedBank, scopedGroups, filterBank, filterGroup, selectedGroup, searchText };
}

export function filterTeacherBankDetailRows<T extends ProductionProblem>(items: T[], bankId: string, groupId: string, groups?: Group[]) {
  const currentGroup = groups?.find(group => group.id === groupId);
  const view = groupId === "none" || currentGroup ? groupId : "all";
  const all = items.filter(problem => problem.bankId === bankId);
  const rows = view === "all" ? all : all.filter(problem => view === "none"
    ? !groups?.some(group => group.problemIds.includes(problem.id))
    : currentGroup?.problemIds.includes(problem.id));
  return { all, rows, view, currentGroup };
}

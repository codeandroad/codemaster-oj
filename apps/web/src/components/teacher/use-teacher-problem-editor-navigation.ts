"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceData } from "@/components/workspace-data";
import type { ProductionProblem } from "@/lib/production-api";
import { filterTeacherBankDetailRows, filterTeacherProblemRows } from "./problem-bank-rows";
import type { Bank, Group } from "./problem-banks";
import { adjacentProblemRows, type ProblemEditorNavigation } from "./problem-editor-navigation";
import { isPlatformProblem, mergePlatformProblems, problemEditorHref, teacherPlatformProblemSummaries, teacherProblemSummaries, type PlatformSourceProblem } from "./platform-problem-source";
import { useProblemBankFilters } from "./use-problem-bank-filters";

export function useTeacherProblemEditorNavigation(id: string, accountId: string): ProblemEditorNavigation | undefined {
  const router = useRouter();
  const search = useSearchParams();
  const returnTo = search.get("returnTo") ?? "";
  const catalogPath = returnTo.split(/[?#]/, 1)[0];
  const bankId = /^\/teacher\/problems\/banks\/([a-z0-9-]+)$/i.exec(catalogPath)?.[1];
  const fromAll = catalogPath === "/teacher/problems";
  const fromCatalog = fromAll || Boolean(bankId);
  const keepReturnTo = fromCatalog || catalogPath === "/teacher/imports" || /^\/teacher\/assignments\/[a-z0-9-]+\/(edit|progress)$/i.test(catalogPath);
  const platformOnly = !fromCatalog && search.get("source") === "platform";
  const enabled = id !== "new" && !search.has("versionId") && !search.has("solutionVersionId");
  const { filters, ready } = useProblemBankFilters(accountId, bankId);
  const needsGroups = enabled && ready && fromCatalog && Boolean(filters.group);
  const needsBanks = enabled && ready && fromAll && Boolean(filters.bank);
  const problems = useWorkspaceData<{ items: ProductionProblem[] }>(enabled && !platformOnly ? teacherProblemSummaries : "");
  const sources = useWorkspaceData<{ items: PlatformSourceProblem[] }>(enabled ? teacherPlatformProblemSummaries : "");
  const groups = useWorkspaceData<{ items: Group[] }>(needsGroups ? bankId ? `problem-groups?bankId=${bankId}` : "problem-groups" : "");
  const banks = useWorkspaceData<{ items: Bank[] }>(needsBanks ? "problem-banks?includeArchived=owned" : "");

  if (!enabled || sources.loading || problems.loading ||
    (fromCatalog && !ready) || (needsGroups && (!groups.data || groups.error)) || (needsBanks && (!banks.data || banks.error))) return;

  const sourceRows = sources.error ? [] : sources.data?.items ?? [];
  const items = mergePlatformProblems(problems.error ? [] : problems.data?.items ?? [], sourceRows);
  const current = items.find(row => row.id === id && row.canEdit === true);
  if (!current) return;

  let rows: ProductionProblem[];
  if (bankId) {
    rows = filterTeacherBankDetailRows(items, bankId, filters.group, groups.data?.items).rows;
  } else if (fromAll) {
    rows = filterTeacherProblemRows({ items, banks: banks.data?.items, groups: groups.data?.items, filters, currentId: id }).rows;
  } else if (isPlatformProblem(current)) {
    const category = sourceRows.find(row => row.id === id)?.bankId;
    rows = sourceRows.filter(row => row.bankId === category);
  } else {
    rows = items.filter(row => !isPlatformProblem(row) && row.bankId === current.bankId);
  }

  const { previous, next } = adjacentProblemRows(rows.filter(row => row.canEdit === true), id);
  const requestedTab = search.get("tab");
  const tab = requestedTab && ["tests", "tutorial", "solutions"].includes(requestedTab) ? requestedTab : undefined;
  const kind = tab === "solutions" && search.get("kind") === "FULL_TRANSLATION" ? "FULL_TRANSLATION" : undefined;
  const target = (row?: ProductionProblem) => row && ({
    title: row.title,
    select: () => router.push(problemEditorHref(row, keepReturnTo ? returnTo : undefined, tab, kind)),
  });
  return { previous: target(previous), next: target(next) };
}

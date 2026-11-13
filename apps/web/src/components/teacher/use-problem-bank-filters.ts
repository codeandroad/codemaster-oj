"use client";

import { useCatalogFilterPreferences } from "@/components/use-catalog-filter-preferences";

const defaults = { query: "", bank: "", group: "", status: "", archived: false, showBanks: false };
export type ProblemBankFilters = typeof defaults;

function readFilters(saved: Partial<ProblemBankFilters>): ProblemBankFilters {
  return {
    query: typeof saved.query === "string" ? saved.query : "",
    bank: typeof saved.bank === "string" ? saved.bank : "",
    group: typeof saved.group === "string" ? saved.group : "",
    status: saved.status === "published" || saved.status === "draft" ? saved.status : "",
    archived: saved.archived === true,
    showBanks: saved.showBanks === true,
  };
}

export function useProblemBankFilters(accountId: string, bankId = "all") {
  return useCatalogFilterPreferences(`campus-judge:problem-bank-filters:v1:${accountId}:${bankId}`, defaults, readFilters);
}

"use client";

import { useEffect, useState } from "react";

const defaults = { query: "", bank: "", group: "", status: "", archived: false, showBanks: false };
type Filters = typeof defaults;

export function useProblemBankFilters(accountId: string, bankId = "all") {
  const key = `campus-judge:problem-bank-filters:v1:${accountId}:${bankId}`;
  const [stored, setStored] = useState({ key: "", filters: defaults });
  const filters = stored.key === key ? stored.filters : defaults;

  useEffect(() => {
    let filters = defaults;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved) {
        filters = {
          query: typeof saved.query === "string" ? saved.query : "",
          bank: typeof saved.bank === "string" ? saved.bank : "",
          group: typeof saved.group === "string" ? saved.group : "",
          status: saved.status === "published" || saved.status === "draft" ? saved.status : "",
          archived: saved.archived === true,
          showBanks: saved.showBanks === true,
        };
      }
    } catch {
      // The page still filters when browser storage is unavailable.
    }
    setStored({ key, filters });
  }, [key]);

  function changeFilters(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setStored({ key, filters: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Keep the selection for the current visit.
    }
  }

  return { filters, changeFilters };
}

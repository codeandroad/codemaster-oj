"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { inputClass } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import {
  acslPreferenceKey,
  catalogPreferenceKeys,
  catalogPreferenceQuery,
  restoreCatalogPreferences,
} from "./catalog-preferences";
import {
  acslCatalogFilters,
  acslCatalogHref,
  acslCatalogItems,
  acslDivisions,
  acslFilterKeys,
  acslRoundLabel,
  acslSeasons,
} from "./model";

type CatalogItem = {
  id: string;
  season: string;
  division: string;
  round: number;
};
type FilterPatch = Partial<Record<keyof typeof acslFilterKeys, string>>;

export function useAcslCatalogState<T extends CatalogItem>({
  items: allItems,
  baseHref,
  accountId,
  schoolId,
}: {
  items: T[];
  baseHref: string;
  accountId: string;
  schoolId: string;
}) {
  const search = useSearchParams();
  const seasons = acslSeasons(allItems);
  const storageKey = acslPreferenceKey(accountId, schoolId);
  const searchText = search.toString();
  const seasonsText = JSON.stringify(seasons);
  useEffect(() => {
    try {
      const availableSeasons: string[] = JSON.parse(seasonsText);
      const current = new URLSearchParams(searchText);
      const restored = restoreCatalogPreferences(
        searchText,
        localStorage.getItem(storageKey),
        availableSeasons,
      );
      if (restored !== null) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?${restored}${window.location.hash}`,
        );
      } else if (catalogPreferenceKeys.some((key) => current.has(key))) {
        localStorage.setItem(
          storageKey,
          catalogPreferenceQuery(current, availableSeasons),
        );
      }
    } catch {
      // The URL remains authoritative when browser storage is unavailable.
    }
  }, [searchText, seasonsText, storageKey]);
  const filters = acslCatalogFilters(search, seasons);
  const items = acslCatalogItems(allItems, filters);
  const matchingSeasons = acslSeasons(items);
  const visibleSeasons = matchingSeasons.slice(0, filters.seasonsShown);
  const visibleCount = items.filter((item) =>
    visibleSeasons.includes(item.season),
  ).length;
  const catalogHref = acslCatalogHref(baseHref, search);

  function changeFilters(patch: FilterPatch) {
    const [pathname, query] = acslCatalogHref(
      baseHref,
      new URLSearchParams(window.location.search),
    ).split("?");
    const params = new URLSearchParams(query);
    if (!("seasonsShown" in patch)) params.delete(acslFilterKeys.seasonsShown);
    for (const [key, value] of Object.entries(patch)) {
      const name = acslFilterKeys[key as keyof typeof acslFilterKeys];
      if (value) params.set(name, value);
      else params.delete(name);
    }
    if (!params.has(acslFilterKeys.seasonsShown))
      params.set(acslFilterKeys.seasonsShown, "1");
    try {
      localStorage.setItem(storageKey, catalogPreferenceQuery(params, seasons));
    } catch {
      // The explicit reset also works without local storage.
    }
    window.history.replaceState(
      null,
      "",
      `${pathname}${params.size ? `?${params}` : ""}`,
    );
  }

  return {
    filters,
    seasons,
    items,
    matchingSeasons,
    visibleSeasons,
    visibleCount,
    catalogHref,
    changeFilters,
  };
}

export function AcslCatalogFilters({
  filters,
  seasons,
  onChange,
}: {
  filters: ReturnType<typeof acslCatalogFilters>;
  seasons: string[];
  onChange: (patch: FilterPatch) => void;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <div className="flex flex-wrap items-end gap-3">
      {[
        {
          name: "division" as const,
          label: tx("Division", "组别"),
          value: filters.division,
          options: acslDivisions.map((value) => ({ value, label: value })),
        },
        {
          name: "season" as const,
          label: tx("Season", "学年"),
          value: filters.season,
          options: seasons.map((value) => ({ value, label: value })),
        },
        {
          name: "round" as const,
          label: tx("Contest", "轮次"),
          value: filters.round,
          options: [1, 2, 3, 4].map((value) => ({
            value: String(value),
            label: acslRoundLabel({ round: value }, locale),
          })),
        },
      ].map((filter) => (
        <label
          key={filter.name}
          className="min-w-32 flex-1 text-xs font-medium sm:flex-none"
        >
          <span>{filter.label}</span>
          <select
            className={`${inputClass} mt-1`}
            data-od-id={`acsl-filter-${filter.name}`}
            value={filter.value}
            onChange={(event) =>
              onChange({ [filter.name]: event.target.value })
            }
          >
            <option value="">{tx("All", "全部")}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {Boolean(filters.division || filters.season || filters.round) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ division: "", season: "", round: "" })}
        >
          {tx("Reset filters", "重置筛选")}
        </Button>
      )}
    </div>
  );
}

// Only catalog preferences belong here; never store answers or grading data.
export const catalogPreferenceKeys = [
  "acslDivision",
  "acslSeason",
  "acslRound",
  "acslSeasons",
] as const;

export function acslPreferenceKey(accountId: string, schoolId: string) {
  return `campus:acsl:catalog:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(schoolId)}`;
}

export function catalogPreferenceQuery(
  search: URLSearchParams,
  seasons: string[],
) {
  const result = new URLSearchParams();
  const division = search.get("acslDivision") ?? "";
  const season = search.get("acslSeason") ?? "";
  const round = search.get("acslRound") ?? "";
  const shown = Number(search.get("acslSeasons"));
  if (["Elementary", "Junior", "Intermediate", "Senior"].includes(division))
    result.set("acslDivision", division);
  if (seasons.includes(season)) result.set("acslSeason", season);
  if (["1", "2", "3", "4"].includes(round)) result.set("acslRound", round);
  result.set(
    "acslSeasons",
    String(
      Number.isSafeInteger(shown) && shown > 0
        ? Math.min(shown, Math.max(1, seasons.length))
        : 1,
    ),
  );
  return result.toString();
}

export function restoreCatalogPreferences(
  search: string,
  saved: string | null,
  seasons: string[],
) {
  const result = new URLSearchParams(search);
  // An explicit URL describes the whole selection, including omitted = All.
  if (catalogPreferenceKeys.some((key) => result.has(key)) || !saved)
    return null;
  const preferences = new URLSearchParams(
    catalogPreferenceQuery(new URLSearchParams(saved), seasons),
  );
  for (const [key, value] of preferences) result.set(key, value);
  return result.toString();
}

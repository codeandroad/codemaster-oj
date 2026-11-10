import type { AcslDiagrams } from "./diagram-model";

export type AcslLanguage = "en" | "zh";
export type LocalizedText = Record<AcslLanguage, string>;
export type AcslAssets = Record<AcslLanguage, string[]>;
export type AcslDraft = { selectedOptionIds: string[]; revision: number };
export type AcslSubmission = {
  id: string;
  selectedOptionIds: string[];
  correct: boolean;
  createdAt: string;
};
export type AcslQuestion = {
  id: string;
  number: number;
  type: "single" | "multiple";
  topic: LocalizedText;
  statement: LocalizedText;
  statementAssets?: AcslAssets;
  statementDiagrams?: AcslDiagrams;
  options: { id: string; text: LocalizedText; diagrams?: AcslDiagrams }[];
  draft: AcslDraft;
  requiresReview: boolean;
  lastSubmission: AcslSubmission | null;
};
export type AcslPaperSummary = {
  id: string;
  versionId: string;
  slug: string;
  title: LocalizedText;
  division: string;
  season: string;
  round: number;
  roundLabel?: LocalizedText;
  questionCount: number;
  answeredCount: number;
  correctCount: number | null;
  graded: boolean;
  score: number | null;
  maxScore: number;
  gradeId: string | null;
  gradedAt: string | null;
  writtenPointsAwarded?: number;
  programmingPointsAwarded?: number;
  pointRules?: { writtenPerCorrect: number; programming: number };
  hasProgramming?: boolean;
  programmingSolved: boolean;
};
export type AcslPaper = AcslPaperSummary & {
  writtenRevision: string;
  changedQuestionIds: string[];
  writtenRevisionAt: string | null;
  historicalWrittenVersion: boolean;
  questions: AcslQuestion[];
  programming: { id: string; title: string; solved: boolean } | null;
};
export type AcslCatalog = { enabled: boolean; items: AcslPaperSummary[] };

export const acslDivisions = [
  "Elementary",
  "Junior",
  "Intermediate",
  "Senior",
] as const;
export const acslFilterKeys = {
  division: "acslDivision",
  season: "acslSeason",
  round: "acslRound",
  seasonsShown: "acslSeasons",
} as const;

export function acslCatalogHref(
  baseHref: string,
  search: Pick<URLSearchParams, "get">,
) {
  const [pathname, query] = baseHref.split("?");
  const params = new URLSearchParams(query);
  for (const key of [
    "paperId",
    "questionId",
    "coding",
    "review",
    "reviewMode",
    "explanation",
  ])
    params.delete(key);
  for (const key of [...Object.values(acslFilterKeys), "contentLanguage"]) {
    const value = search.get(key);
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function acslCatalogFilters(
  search: Pick<URLSearchParams, "get">,
  seasons: string[],
) {
  const division = search.get(acslFilterKeys.division) ?? "";
  const season = search.get(acslFilterKeys.season) ?? "";
  const round = search.get(acslFilterKeys.round) ?? "";
  const seasonsShown = Number(search.get(acslFilterKeys.seasonsShown));
  return {
    division: acslDivisions.some((value) => value === division) ? division : "",
    season: seasons.includes(season) ? season : "",
    round: ["1", "2", "3", "4"].includes(round) ? round : "",
    seasonsShown:
      Number.isSafeInteger(seasonsShown) && seasonsShown > 0
        ? Math.min(seasonsShown, Math.max(1, seasons.length))
        : 1,
  };
}

export function acslSeasons(items: Pick<AcslPaperSummary, "season">[]) {
  return [...new Set(items.map((item) => item.season))].sort((left, right) =>
    right.localeCompare(left, "en", { numeric: true }),
  );
}

export function acslCatalogItems<
  T extends Pick<AcslPaperSummary, "id" | "season" | "division" | "round">,
>(items: T[], filters: { division: string; season: string; round: string }) {
  const divisionOrder = (division: string) => {
    const index = acslDivisions.findIndex((value) => value === division);
    return index < 0 ? acslDivisions.length : index;
  };
  return items
    .filter(
      (item) =>
        (!filters.division || item.division === filters.division) &&
        (!filters.season || item.season === filters.season) &&
        (!filters.round || String(item.round) === filters.round),
    )
    .sort(
      (left, right) =>
        right.season.localeCompare(left.season, "en", { numeric: true }) ||
        divisionOrder(left.division) - divisionOrder(right.division) ||
        left.round - right.round ||
        left.id.localeCompare(right.id),
    );
}

export function acslRoundLabel(
  paper: Pick<AcslPaperSummary, "round" | "roundLabel">,
  language: AcslLanguage,
) {
  return (
    paper.roundLabel?.[language] ||
    (language === "en" ? `Contest ${paper.round}` : `第 ${paper.round} 轮`)
  );
}

export function acslHref(
  baseHref: string,
  paperId?: string,
  questionId?: string,
  programming = false,
  language?: AcslLanguage,
) {
  const [pathname, query] = baseHref.split("?");
  const params = new URLSearchParams(query);
  for (const key of [
    "paperId",
    "questionId",
    "coding",
    "review",
    "reviewMode",
    "explanation",
  ])
    params.delete(key);
  if (paperId) params.set("paperId", paperId);
  if (questionId) params.set("questionId", questionId);
  if (programming) params.set("coding", "1");
  if (language) params.set("contentLanguage", language);
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function sameSelection(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

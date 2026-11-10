import type { AcslLanguage, AcslPaper, AcslPaperSummary } from "./model";

export type AcslReviewMode = "all" | "wrong";
type StagePaper = Pick<
  AcslPaperSummary,
  "graded" | "hasProgramming" | "programmingSolved" | "writtenPointsAwarded"
> &
  Partial<Pick<AcslPaper, "programming" | "questions">> & {
    programmingPointsAwarded?: number;
  };

const awarded = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Completion and rewards come from saved results, never from predicted points. */
export function acslStageSummary(paper: StagePaper) {
  const hasProgramming =
    paper.programming === undefined
      ? paper.hasProgramming !== false
      : paper.programming !== null;
  const writtenPoints = awarded(paper.writtenPointsAwarded);
  const programmingPoints = awarded(paper.programmingPointsAwarded);
  return {
    hasProgramming,
    complete: paper.graded && (!hasProgramming || paper.programmingSolved),
    wrongQuestionIds: paper.graded
      ? (paper.questions ?? [])
          .filter((question) => question.lastSubmission?.correct === false)
          .map((question) => question.id)
      : [],
    writtenPoints,
    programmingPoints,
    pointsAwarded: writtenPoints + programmingPoints,
  };
}

export function acslReviewHref(
  baseHref: string,
  paperId: string,
  mode: AcslReviewMode = "all",
  language?: AcslLanguage,
) {
  const [path, query] = baseHref.split("?");
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
  params.set("paperId", paperId);
  params.set("review", "1");
  if (mode === "wrong") params.set("reviewMode", "wrong");
  if (language) params.set("contentLanguage", language);
  return `${path}?${params}`;
}

import type { SubmissionLanguage } from "@/lib/production-api";

export type SolutionArticle = { id: string; title: string; body: string; programmingLanguage?: SubmissionLanguage | null };
export type DraftArticle = Omit<SolutionArticle, "id"> & { id?: string };
export type SolutionDraft = { body: string; solutions?: DraftArticle[] };
export type OriginalSolution = Pick<SolutionArticle, "body" | "programmingLanguage">;
export type InheritedSolution = SolutionDraft & { versionId: string };
export type SolutionLanguageFilter = SubmissionLanguage | "general" | "all";

export function referenceSolutionDraft(source: OriginalSolution, title: string): SolutionDraft {
  return { body: source.body, solutions: [{ title, ...source }] };
}

export function sameSolutionDraft(a: SolutionDraft, b: SolutionDraft) {
  if (a.body !== b.body || a.solutions?.length !== b.solutions?.length) return false;
  return a.solutions?.every((item, index) => {
    const other = b.solutions?.[index];
    return item.id === other?.id && item.title === other?.title && item.body === other?.body
      && (item.programmingLanguage ?? null) === (other?.programmingLanguage ?? null);
  }) ?? true;
}

// Match the server's canonical bundle size, including generated IDs and language metadata.
export function solutionDraftBytes(draft: SolutionDraft) {
  const [primary, ...other] = draft.solutions ?? [];
  if (!primary) return 0;
  const alternatives = other.map(({ id, title, body, programmingLanguage }) => ({
    id: id ?? "00000000-0000-0000-0000-000000000000", title: title.trim(), body,
    ...(programmingLanguage ? { programmingLanguage } : {}),
  }));
  const details = { primaryTitle: primary.title.trim(),
    ...(primary.programmingLanguage ? { primaryLanguage: primary.programmingLanguage } : {}), alternatives };
  return new TextEncoder().encode(JSON.stringify({ body: draft.body, details })).length;
}

export function solutionDraftError(draft: SolutionDraft) {
  if (!draft.body.trim() || draft.solutions?.some(item => !item.title.trim() || !item.body.trim())
    || draft.solutions?.length === 0) return "required";
  if (solutionDraftBytes(draft) > 512 * 1024) return "size";
  return null;
}

export function solutionsForLanguage(solutions: SolutionArticle[], language: SolutionLanguageFilter) {
  return solutions.filter(solution => language === "all" || !solution.programmingLanguage
    || solution.programmingLanguage === language);
}

export function selectSolution(solutions: SolutionArticle[], language: SolutionLanguageFilter, selectedId?: string) {
  const visible = solutionsForLanguage(solutions, language);
  return visible.find(solution => solution.id === selectedId)
    ?? visible.find(solution => solution.programmingLanguage === language) ?? visible[0];
}

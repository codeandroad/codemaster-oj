import { solutionDraftBytes, type SolutionDraft, type DraftArticle } from "./solution-model.ts";

export function appendHistoricalSolution(current: SolutionDraft, article: DraftArticle, fallbackTitle: string) {
  const existing = current.solutions?.length ? current.solutions
    : current.body.trim() ? [{ title: fallbackTitle, body: current.body }] : [];
  const normalized = (body: string) => body.replaceAll("\r\n", "\n").trim();
  if (existing.some(item => normalized(item.body) === normalized(article.body)
    && (item.programmingLanguage ?? null) === (article.programmingLanguage ?? null))) return { error: "duplicate" } as const;
  if (existing.length >= 10) return { error: "count" } as const;
  if (!article.body.trim() || !article.title.trim()) return { error: "required" } as const;
  if (article.title.length > 120 || article.body.length > 200_000) return { error: "size" } as const;
  // Historical article IDs belong to another content bundle. Let the server
  // assign a new identity, preserving every existing article and its order.
  const solutions = [...existing, { title: article.title, body: article.body,
    ...(article.programmingLanguage ? { programmingLanguage: article.programmingLanguage } : {}) }];
  const draft: SolutionDraft = { body: solutions[0].body, solutions };
  if (solutionDraftBytes(draft) > 512 * 1024) return { error: "size" } as const;
  return { draft } as const;
}

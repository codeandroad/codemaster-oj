import type { SolutionDraft } from "./solution-alternatives-editor";

export function appendHistoricalSolution(current: SolutionDraft, article: { title: string; body: string }, fallbackTitle: string) {
  const existing = current.solutions?.length ? current.solutions
    : current.body.trim() ? [{ title: fallbackTitle, body: current.body }] : [];
  const normalized = (body: string) => body.replaceAll("\r\n", "\n").trim();
  if (existing.some(item => normalized(item.body) === normalized(article.body))) return { error: "duplicate" } as const;
  if (existing.length >= 10) return { error: "count" } as const;
  if (!article.body.trim() || !article.title.trim()) return { error: "required" } as const;
  if (article.title.length > 120 || article.body.length > 200_000) return { error: "size" } as const;
  // Historical article IDs belong to another content bundle. Let the server
  // assign a new identity, preserving every existing article and its order.
  const solutions = [...existing, { title: article.title, body: article.body }];
  const draft: SolutionDraft = { body: solutions[0].body, solutions };
  const details = { primaryTitle: solutions[0].title.trim(), alternatives: solutions.slice(1).map(item => ({
    id: "id" in item && item.id ? item.id : "00000000-0000-0000-0000-000000000000", title: item.title.trim(), body: item.body,
  })) };
  if (new TextEncoder().encode(JSON.stringify({ body: draft.body, details })).length > 512 * 1024) return { error: "size" } as const;
  return { draft } as const;
}

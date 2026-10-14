export interface StudentDraft { code: string; receivedCode: string; updatedAt: string; }
import type { SubmissionLanguage } from "@/lib/production-api";
const prefix = "campus-judge:draft:";
const selectionPrefix = "campus-judge:draft-language:";
export function workspaceDraftContext({ originalSubmissionId, timedPracticeId, assignmentId, learningPathId, chapterId }: {
  originalSubmissionId?: string | null;
  timedPracticeId?: string | null;
  assignmentId?: string | null;
  learningPathId?: string | null;
  chapterId?: string | null;
}) {
  if (originalSubmissionId) return `review:${originalSubmissionId}`;
  if (timedPracticeId) return `timed:${timedPracticeId}`;
  if (assignmentId) return `assignment:${assignmentId}`;
  if (learningPathId && chapterId) return `learning:${learningPathId}:${chapterId}`;
  return "practice";
}
export function draftKey(userId: string, problemId: string, versionId: string, context: string, language: "python" | "cpp" | "javascript" = "python") { return `${prefix}${userId}:${context}:${problemId}:${versionId}${language === "python" ? "" : `:${language}`}`; }
const selectionKey = (userId: string, problemId: string, versionId: string, context: string) => `${selectionPrefix}${userId}:${context}:${problemId}:${versionId}`;
export function readDraftLanguage(userId: string, problemId: string, versionId: string, context: string): SubmissionLanguage | null { try { const value = sessionStorage.getItem(selectionKey(userId, problemId, versionId, context)); return value === "python" || value === "cpp" || value === "javascript" ? value : null; } catch { return null; } }
export function saveDraftLanguage(userId: string, problemId: string, versionId: string, context: string, language: SubmissionLanguage) { try { sessionStorage.setItem(selectionKey(userId, problemId, versionId, context), language); } catch { /* Language selection remains usable without session storage. */ } }
export function readDraft(key: string): StudentDraft | null {
  if (typeof window === "undefined") return null;
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); return value && typeof value.code === "string" && typeof value.receivedCode === "string" ? value : null; } catch { return null; }
}
export function saveDraft(key: string, draft: StudentDraft): boolean { try { sessionStorage.setItem(key, JSON.stringify(draft)); return true; } catch { return false; } }
export function hasTimedDraft(userId: string, practiceId: string, problemId: string, versionId: string) { return (["python", "cpp", "javascript"] as const).some(language => { const draft = readDraft(draftKey(userId, problemId, versionId, `timed:${practiceId}`, language)); return Boolean(draft && draft.code.trim() && draft.code !== draft.receivedCode); }); }

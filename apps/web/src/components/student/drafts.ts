export interface StudentDraft { code: string; receivedCode: string; updatedAt: string; }
import type { SubmissionLanguage } from "@/lib/production-api";
import { submissionLanguage, supportedLanguages } from "./languages.ts";

export type WorkspaceSubmission = { code: string; language: string | null };

export function initialWorkspaceLanguage(
  selected: SubmissionLanguage | null,
  latest: WorkspaceSubmission | null,
  fallback: SubmissionLanguage,
  read: (language: SubmissionLanguage) => StudentDraft | null,
  requiredLanguage: SubmissionLanguage | null = null,
): SubmissionLanguage {
  if (requiredLanguage) return requiredLanguage;
  if (latest) {
    const languages = selected ? [selected, ...supportedLanguages.filter(language => language !== selected)] : supportedLanguages;
    const unsaved = languages.find(language => {
      const draft = read(language);
      return draft && draft.code !== draft.receivedCode;
    });
    return unsaved ?? submissionLanguage(latest.language);
  }
  return selected ?? fallback;
}

export function workspaceEditorCode(
  language: SubmissionLanguage,
  draft: StudentDraft | null,
  latest: WorkspaceSubmission | null,
  starter: string,
): Pick<StudentDraft, "code" | "receivedCode"> {
  if (latest && language === submissionLanguage(latest.language)) {
    return {
      code: draft && draft.code !== draft.receivedCode ? draft.code : latest.code,
      receivedCode: latest.code,
    };
  }
  return { code: draft?.code ?? starter, receivedCode: draft?.receivedCode ?? starter };
}
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

// Current teaching follows one exercise, so unsent work follows it too. Retain
// old storage entries and recover the newest draft only within the same user,
// problem, activity context and language. Correction snapshots use readDraft.
function currentDraftEntries(userId: string, problemId: string, context: string) {
  const entries: { version: string; language: SubmissionLanguage; draft: StudentDraft }[] = [];
  if (typeof window === "undefined") return entries;
  const scope = `${prefix}${userId}:${context}:${problemId}:`;
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(scope)) continue;
      const match = /^(current|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(cpp|javascript))?$/i.exec(key.slice(scope.length));
      if (!match) continue;
      const draft = readDraft(key);
      if (draft) entries.push({ version: match[1], language: (match[2] ?? "python") as SubmissionLanguage, draft });
    }
  } catch { /* A storage restriction must not prevent opening the workspace. */ }
  return entries.sort((a, b) => (Date.parse(b.draft.updatedAt) || 0) - (Date.parse(a.draft.updatedAt) || 0));
}
export function readCurrentDraft(userId: string, problemId: string, context: string, language: SubmissionLanguage): StudentDraft | null {
  return readDraft(draftKey(userId, problemId, "current", context, language))
    ?? currentDraftEntries(userId, problemId, context).find(entry => entry.language === language)?.draft ?? null;
}
export function readCurrentDraftLanguage(userId: string, problemId: string, context: string): SubmissionLanguage | null {
  return readDraftLanguage(userId, problemId, "current", context)
    ?? currentDraftEntries(userId, problemId, context).map(entry => readDraftLanguage(userId, problemId, entry.version, context) ?? entry.language)[0]
    ?? null;
}
export function hasTimedDraft(userId: string, practiceId: string, problemId: string, versionId: string) { return (["python", "cpp", "javascript"] as const).some(language => { const draft = readCurrentDraft(userId, problemId, `timed:${practiceId}`, language) ?? readDraft(draftKey(userId, problemId, versionId, `timed:${practiceId}`, language)); return Boolean(draft && draft.code.trim() && draft.code !== draft.receivedCode); }); }

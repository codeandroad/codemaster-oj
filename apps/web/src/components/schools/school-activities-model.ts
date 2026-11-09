export type ActivityKind = "assignment" | "timed";
export type ActivityProblem = { id: string; versionId: string; title: string; position: number; points: number };
export type ActivityGradeItem = ActivityProblem & { status: string; solved: boolean; score: number; attempts: number; activityAttempts: number; inherited: boolean };
export type ActivityGrade = { items: ActivityGradeItem[]; score: number; total: number; solved: number; attempted: number };
export type ActivityAttempt = { id: string; startedAt: string; deadlineAt: string | null; finishedAt: string | null };
export type SchoolActivity = {
  id: string; schoolId: string; kind: ActivityKind; title: string; description: string;
  state: "Draft" | "Published" | "Archived"; phase: string; revision: number;
  startsAt: string | null; endsAt: string | null; durationMinutes: number | null;
  publishedAt: string | null; resultsPublishedAt: string | null; canManage: boolean; participantCount: number;
  canPreview?: boolean; preview?: boolean;
  problems: ActivityProblem[]; attempt: ActivityAttempt | null; grade: ActivityGrade | null; identityIds?: string[]; classIds?: string[];
};
export type ActivityOptions = {
  problems: { problemId: string; versionId: string; title: string; bankName: string; bankId: string }[];
  students: { id: string; name: string; number: string; activated: boolean; classIds: string[] }[];
  classes: { id: string; name: string }[];
};
export type ActivityReport = { activity: SchoolActivity; items: { id: string; name: string; number: string; attempt: ActivityAttempt | null; grade: ActivityGrade }[] };
export function activityDateInput(value: string | null) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : "";
}
export function activityDateValue(value: string) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : null;
}
export function moveActivityProblem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= items.length || target >= items.length) return [...items];
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

/** Escape CSV text and neutralize spreadsheet formulas in editable names/IDs. */
export function activityCsvCell(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+@-]|^[\t\r]/.test(raw) ? "'" + raw : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

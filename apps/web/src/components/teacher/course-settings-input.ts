export class CourseSettingsInputError extends Error {
  code: string;
  section: "details" | "access";
  constructor(code: string, section: "details" | "access") { super(code); this.code = code; this.section = section; }
}
interface CourseSettingsDraft {
  title: string; description: string; category: string; estimatedMinutes: number;
  difficulty: "beginner" | "intermediate" | "advanced"; coverKey: "python" | "algorithms" | "general";
  coverImage: string; authorName: string; authoredAt: string; accessScope: "school" | "classes";
  classIds: string[]; availableFrom: string; availableUntil: string; listed: boolean;
}
export const courseCoverMaxBytes = 512 * 1024;
export function courseCoverByteLength(value: string) {
  const match = value.match(/^data:image\/(?:png|jpeg|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/);
  if (!match?.[1]) throw new CourseSettingsInputError("COVER", "details");
  try {
    const binary = atob(match[1]);
    if (!binary.length || btoa(binary) !== match[1]) throw new Error();
    return binary.length;
  } catch { throw new CourseSettingsInputError("COVER", "details"); }
}
export function courseSettingsInput(draft: CourseSettingsDraft) {
  const fail = (code: string, section: "details" | "access" = "details"): never => { throw new CourseSettingsInputError(code, section); };
  const title = draft.title.trim(), category = draft.category.trim(), authorName = draft.authorName.trim();
  if (!title || title.length > 200) fail("TITLE");
  if (!category || category.length > 100) fail("CATEGORY");
  if (!Number.isFinite(draft.estimatedMinutes) || !Number.isInteger(draft.estimatedMinutes) || draft.estimatedMinutes < 1 || draft.estimatedMinutes > 10080) fail("MINUTES");
  if (authorName.length > 120) fail("AUTHOR");
  if (draft.description.length > 4000) fail("DESCRIPTION");
  function timestamp(value: string, code: string, section: "details" | "access", required = false) {
    if (!value) { if (required) fail(code, section); return null; }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) fail(code, section);
    const normalized = value.length === 16 ? `${value}:00` : value;
    const date = new Date(`${normalized}+08:00`);
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19) !== normalized) fail(code, section);
    return date.toISOString();
  }
  const authoredAt = timestamp(draft.authoredAt, "AUTHORED_AT", "details", true);
  const availableFrom = timestamp(draft.availableFrom, "AVAILABLE_FROM", "access"), availableUntil = timestamp(draft.availableUntil, "AVAILABLE_UNTIL", "access");
  if (availableFrom && availableUntil && availableFrom >= availableUntil) fail("WINDOW", "access");
  const classIds = draft.accessScope === "classes" ? [...new Set(draft.classIds)] : [];
  if (draft.accessScope === "classes" && (!classIds.length || classIds.length > 50)) fail("CLASSES", "access");
  const coverImage = draft.coverImage || null;
  if (coverImage && courseCoverByteLength(coverImage) > courseCoverMaxBytes) fail("COVER_LIMIT");
  return { ...draft, title, category, authorName, authoredAt, coverImage, classIds, availableFrom, availableUntil };
}

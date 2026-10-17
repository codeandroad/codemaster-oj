export interface Paper4ActivityDraft {
  title: string;
  activityKind: "practice" | "exam";
  participants: string[];
  classIds: string[];
  startsAt: string;
  endsAt: string;
}

export function paper4ActivityInput(draft: Paper4ActivityDraft, now = Date.now()) {
  const title = draft.title.trim();
  if (!title || title.length > 200) throw new Error("ACTIVITY_TITLE");
  const participants = [...new Set(draft.participants)];
  if (!participants.length || participants.some(id => !id.trim())) throw new Error("ACTIVITY_AUDIENCE");
  if (participants.length > 500) throw new Error("ACTIVITY_AUDIENCE_LIMIT");
  if (draft.activityKind === "exam" && (!draft.startsAt || !draft.endsAt)) throw new Error("ACTIVITY_EXAM_WINDOW");
  function time(value: string) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("ACTIVITY_TIME");
    const date = new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`);
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) !== (value.length === 16 ? `${value}:00` : value)) throw new Error("ACTIVITY_TIME");
    return date.toISOString();
  }
  const startsAt = time(draft.startsAt), endsAt = time(draft.endsAt);
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error("ACTIVITY_WINDOW_ORDER");
  if (endsAt && Date.parse(endsAt) <= now) throw new Error("ACTIVITY_WINDOW_ENDED");
  const classIds = [...new Set(draft.classIds)];
  return { title, activityKind: draft.activityKind, participants, classIds, classId: classIds[0] ?? null, startsAt, endsAt };
}

export function paper4BatchActivityInput(paperIds: string[], draft: Omit<Paper4ActivityDraft, "title">, now = Date.now()) {
  if (!paperIds.length || paperIds.length > 100 || new Set(paperIds).size !== paperIds.length || paperIds.some(id => !id.trim())) throw new Error("ACTIVITY_PAPERS");
  const input = paper4ActivityInput({ ...draft, title: "Paper 4 activity" }, now);
  return { paperIds: [...paperIds], activityKind: input.activityKind, participants: input.participants, classIds: input.classIds, classId: input.classId, startsAt: input.startsAt, endsAt: input.endsAt };
}

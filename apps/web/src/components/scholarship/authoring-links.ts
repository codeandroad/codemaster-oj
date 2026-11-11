import type { AssistanceKind } from "./assistance";

export function contentAuthoringHref(target: {
  targetType: "problem" | "paper4";
  targetId: string;
  versionId?: string | null;
  kind?: AssistanceKind;
  questionKey?: string | null;
}, admin = false) {
  const workspace = admin ? "admin" : "teacher";
  const query = new URLSearchParams({ tab: "solutions", kind: target.kind ?? "FULL_SOLUTION" });
  if (target.versionId) query.set(target.targetType === "problem" ? "solutionVersionId" : "versionId", target.versionId);
  if (target.questionKey) query.set("questionKey", target.questionKey);
  return target.targetType === "problem"
    ? `/${workspace}/problems/${encodeURIComponent(target.targetId)}/edit?${query}`
    : `/${workspace}/paper4/${encodeURIComponent(target.targetId)}?${query}`;
}

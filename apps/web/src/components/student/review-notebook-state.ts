export function reviewNotebookState(
  originalStatus: string | undefined,
  correctionStatus: string | undefined,
  hasTeacherFeedback: boolean,
) {
  if (originalStatus === "AC") return hasTeacherFeedback ? "Feedback received" : "Resolved";
  if (correctionStatus === "AC") return "Resolved";
  return correctionStatus ? "Retried" : "Needs review";
}

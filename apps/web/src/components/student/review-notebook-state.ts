export type ReviewNotebookState = "Needs review" | "Retried" | "Resolved" | "Feedback received";
export type ReviewNotebookFilter = "All" | ReviewNotebookState;

export function reviewNotebookState(
  originalStatus: string | undefined,
  correctionStatus: string | undefined,
  hasTeacherFeedback: boolean,
): ReviewNotebookState {
  if (originalStatus === "AC") return hasTeacherFeedback ? "Feedback received" : "Resolved";
  if (correctionStatus === "AC") return "Resolved";
  return correctionStatus ? "Retried" : "Needs review";
}

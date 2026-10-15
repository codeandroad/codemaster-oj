export type ReviewStatus = "pending" | "approved" | "rejected" | "revoked";

export interface ReviewVersionState {
  isCurrent: boolean;
  publishedAt: string | null;
  schoolVisibleAt: string | null;
  bankVisibility: "school" | "private";
  validationStatus: string;
  rankReviewStatus: ReviewStatus;
}

export function reviewVersionActions(version: ReviewVersionState) {
  const awaitingDecision = version.isCurrent && Boolean(version.publishedAt) &&
    version.bankVisibility === "school" &&
    (version.rankReviewStatus === "pending" || version.rankReviewStatus === "rejected");
  return {
    canApprove: awaitingDecision && version.validationStatus === "AC",
    canReject: awaitingDecision && version.rankReviewStatus === "pending",
    // Pre-review public versions from the legacy migration retain student
    // access. Rejecting the current version removes that access; only an
    // approved or historical public version uses the withdrawal action.
    canWithdraw: !awaitingDecision && version.rankReviewStatus !== "revoked" &&
      Boolean(version.publishedAt) && version.bankVisibility === "school" &&
      Boolean(version.schoolVisibleAt),
  };
}

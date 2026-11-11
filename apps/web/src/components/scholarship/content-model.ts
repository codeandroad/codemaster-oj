import type { AssistanceKind } from "./assistance";
import type { SolutionDraft, OriginalSolution, InheritedSolution } from "./solution-alternatives-editor";
import type { SolutionVersion } from "./solution-context";

export type ContentTarget =
  | { problemId: string; versionId: string }
  | { paperId: string; versionId: string; questionKey: string };

export interface AssistanceContent extends SolutionDraft {
  id: string;
  versionId: string;
  kind: AssistanceKind;
  language: string;
  status: string;
  contentHash?: string;
  hasPendingSolutions?: boolean;
  publishedAt?: string;
}

export interface ContentResponse {
  items: AssistanceContent[];
  originalSolution?: OriginalSolution;
  inheritedSolution?: InheritedSolution;
  versions?: SolutionVersion[];
  recommendedVersionId?: string | null;
  selectionRequired?: boolean;
  sharedSolution?: {
    shared: true;
    contentId: string | null;
    legacySources: LegacySolutionSource[];
  };
}

export type LegacySolutionSource = SolutionDraft & {
  contentId: string;
  createdAt: string;
  status: string;
  pending?: SolutionDraft | null;
};

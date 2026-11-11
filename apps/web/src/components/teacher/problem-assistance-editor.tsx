"use client";

import { useCallback, useState } from "react";
import { useLocale } from "@/components/locale-context";
import type { AssistanceKind } from "@/components/scholarship/assistance";
import { ContentEditor } from "@/components/scholarship/content-editor";

/** Mount once per problem so changing editor tabs preserves a solution draft. */
export function ProblemAssistanceEditor({
  problemId,
  versionId,
  initialKind = "FULL_SOLUTION",
  externalBusy = false,
  hasUnsavedProblemChanges = false,
  onPendingChange,
}: {
  problemId: string;
  versionId: string;
  initialVersionId?: string;
  initialKind?: AssistanceKind;
  externalBusy?: boolean;
  hasUnsavedProblemChanges?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { locale } = useLocale();
  // Old solutionVersionId links still open this one problem-level editor.
  const [selection, setSelection] = useState<{ sourceVersion: string; selectedVersion: string }>();
  const [kind, setKind] = useState<AssistanceKind>(initialKind);
  const [pending, setPending] = useState(false);
  const reportPending = useCallback((next: boolean) => {
    setPending(next);
    onPendingChange?.(next);
  }, [onPendingChange]);
  const chooseVersion = useCallback((next: string) => setSelection({ sourceVersion: versionId, selectedVersion: next }), [versionId]);
  const chosenVersion = selection?.sourceVersion === versionId ? selection.selectedVersion : undefined;
  const selectedVersion = chosenVersion ?? versionId;

  return <div className="min-w-0 space-y-3">
    {hasUnsavedProblemChanges && <p className="text-sm text-muted-foreground">{locale === "en"
      ? "The problem has unsaved changes. You can edit the published student solutions below. To use updated reference code or solution notes, save the problem draft first."
      : "题目还有未保存的修改。你可以直接编辑下方已有的学生题解；如需使用修改后的参考代码或题解素材，请先保存题目草稿。"}</p>}
    <ContentEditor
      key={problemId}
      target={{ problemId, versionId: selectedVersion }}
      kind={kind}
      onKindChange={setKind}
      contentPending={pending}
      onPendingChange={reportPending}
      onVersionChange={chooseVersion}
      autoSelect={!chosenVersion}
      externalBusy={externalBusy}
    />
  </div>;
}

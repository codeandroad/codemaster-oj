"use client";

import { useEffect } from "react";
import { useLocale } from "@/components/locale-context";
import { input, panel, State } from "@/components/teacher/shared";
import type { AssistanceKind } from "./assistance";
import { ContentForm } from "./content-form";
import type { ContentTarget } from "./content-model";
import { useContentResource } from "./content-resource";
import { SolutionUsageSummary } from "./solution-usage-summary";

export type { ContentResponse, ContentTarget, AssistanceContent } from "./content-model";

const kinds: AssistanceKind[] = ["FULL_TRANSLATION", "FULL_SOLUTION"];
function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => locale === "en" ? en : zh;
}
function kindName(kind: AssistanceKind, tx: (zh: string, en: string) => string) {
  return kind === "FULL_TRANSLATION" ? tx("中文题面", "Chinese translation") : tx("完整题解与参考代码", "Full solution and reference code");
}

export function ContentEditor({
  target,
  kind,
  onKindChange,
  contentPending,
  onPendingChange,
  onVersionChange,
  autoSelect = false,
  showKindSelect = true,
  externalBusy = false,
}: {
  target: ContentTarget;
  kind: AssistanceKind;
  onKindChange: (kind: AssistanceKind) => void;
  contentPending: boolean;
  onPendingChange: (pending: boolean) => void;
  onVersionChange: (versionId: string) => void;
  autoSelect?: boolean;
  showKindSelect?: boolean;
  externalBusy?: boolean;
}) {
  const tx = useText(),
    contents = useContentResource(
      `scholarship/contents?${new URLSearchParams(target)}`,
    );
  const content = contents.data?.items.find(
    (item) =>
      item.kind === kind &&
      item.language === (kind === "FULL_TRANSLATION" ? "zh-CN" : ""),
  );
  useEffect(() => {
    if (!autoSelect || contents.loading || contents.error || !contents.data) return;
    onVersionChange(contents.data.recommendedVersionId || target.versionId);
  }, [autoSelect, contents.loading, contents.error, contents.data, onVersionChange, target.versionId]);
  const shared = kind === "FULL_SOLUTION" && "problemId" in target;
  // Retain the mounted form while reference metadata refreshes after saving a
  // problem snapshot. Its unsaved solution draft belongs to the problem.
  const readyToEdit = contents.data && (shared || !autoSelect);
  return (
    <section className={`${panel} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {kind === "FULL_TRANSLATION" ? tx("中文题面", "Chinese translation") : tx("学生题解", "Student solutions")}
        </h2>
        {showKindSelect && <select
          aria-label={tx("辅助类型", "Assistance type")}
          className={`${input} max-w-64`}
          disabled={contentPending || externalBusy}
          value={kind}
          onChange={(event) => onKindChange(event.target.value as AssistanceKind)}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {kindName(value, tx)}
            </option>
          ))}
        </select>}
      </div>
      <p className="text-xs text-muted-foreground">
        {kind === "FULL_TRANSLATION" ? tx(
          "在此维护学生阅读的中文题面。先保存草稿，核对内容后审核发布。",
          "Maintain the Chinese problem text students read. Save a draft, check its content, then review and publish.",
        ) : "problemId" in target ? tx(
          "在此修改学生看到的完整题解、参考代码和多种解法。先保存草稿，核对后审核发布；审核期间学生继续看到已发布内容。",
          "Edit the explanations, reference code and approaches students read. Save a draft, review it, then publish. Students continue to see the published content during review.",
        ) : tx(
          "在此维护这道大题的解题说明和参考代码。先保存草稿，核对内容后审核发布。",
          "Maintain this question’s explanation and reference code. Save a draft, check its content, then review and publish.",
        )}
      </p>
      <State resource={contents} />
      {shared && contents.data && <SolutionUsageSummary versions={contents.data.versions ?? []} />}
      {readyToEdit && contents.data && (
        <ContentForm
          key={`${kind}:${shared && "problemId" in target ? target.problemId : target.versionId}`}
          kind={kind}
          target={target}
          content={content}
          originalSolution={contents.data.originalSolution}
          legacySources={shared ? contents.data.sharedSolution?.legacySources : undefined}
          disabled={externalBusy || autoSelect || contents.loading || Boolean(contents.error)}
          reload={contents.reload}
          onPendingChange={onPendingChange}
          onSaved={next => contents.setData(previous => ({
            ...previous,
            items: [...(previous?.items.filter(item => item.id !== next.id) ?? []), next],
            versions: previous?.versions?.map(version => version.versionId === target.versionId ? {
              ...version, solutionStatus: next.kind === "FULL_SOLUTION" ? next.status : version.solutionStatus,
              hasPendingSolutions: next.kind === "FULL_SOLUTION" ? Boolean(next.hasPendingSolutions) : version.hasPendingSolutions,
            } : version),
          }))}
        />
      )}
    </section>
  );
}


"use client";

import { Send } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { useRefreshWorkspaceData } from "@/components/workspace-data";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { isPlatformProblem, teacherPlatformProblemSummaries } from "./platform-problem-source";
import type { useAction } from "./shared";

type Result = { problemId: string } & (
  { status: "submitted" | "pending" } | { status: "skipped"; code: string }
);

export function PlatformProblemReviewAction({ selected, action, onSubmitted }: {
  selected: readonly ProductionProblem[];
  action: ReturnType<typeof useAction>;
  onSubmitted: (ids: ReadonlySet<string>) => void;
}) {
  const { locale } = useLocale();
  const refresh = useRefreshWorkspaceData();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const platformProblems = selected.filter(isPlatformProblem);
  const items = platformProblems.flatMap(problem => problem.canRequestReview && problem.versionId && problem.editRevision != null
    ? [{ problemId: problem.id, expectedVersionId: problem.versionId, expectedRevision: problem.editRevision }]
    : []);
  if (!platformProblems.length) return null;

  const checking = platformProblems.some(problem => problem.draftValidationStatus === "Waiting" || problem.draftValidationStatus === "Judging");
  const hint = items.length
    ? tr("仅提交本页所选且已通过参考解验证的草稿。", "Send validated drafts selected on this page.") : undefined;

  return <>
    <Button type="button" variant="secondary" size="sm" disabled={action.busy || !items.length} title={hint}
      onClick={() => void action.run(async () => {
        const { items: results } = await productionApi<{ items: Result[] }>("platform/source-problems/request-review-batch", {
          method: "POST", body: { items },
        });
        const submitted = results.filter(item => item.status === "submitted").length;
        const alreadyPending = results.filter(item => item.status === "pending").length;
        const skipped = platformProblems.length - submitted - alreadyPending;
        await refresh?.(teacherPlatformProblemSummaries);
        onSubmitted(new Set(results.filter(item => item.status !== "skipped").map(item => item.problemId)));
        const summary = submitted ? [tr(`已提交 ${submitted} 道题供平台审核`, `Sent ${submitted} problems for platform review`)] : [];
        if (alreadyPending) summary.push(tr(`${alreadyPending} 道已在审核中`, `${alreadyPending} already awaiting review`));
        if (skipped) summary.push(tr(`跳过 ${skipped} 道`, `${skipped} skipped`));
        const message = summary.join(tr("，", ". ")) + tr("。", ".");
        const presentationRequired = results.some(item => item.status === "skipped" && item.code === "PRESENTATION_REVIEW_REQUIRED");
        const feedback = presentationRequired
          ? message + tr(" 请在相应题目的编辑页核对公开英文题面。", " Check the public English statement in the affected problem editors.")
          : message;
        if (!submitted && !alreadyPending) throw new Error(feedback);
        return feedback;
      })}>
      <Send size={15} aria-hidden="true" />
      {tr("批量提交平台审核", "Send selected for platform review")} ({items.length})
    </Button>
    {!items.length && <span className="text-xs text-muted-foreground">{tr("本页所选题目没有可提交的已验证草稿。", "No validated drafts in this page's selection are ready for review.")}</span>}
    {checking && <Button type="button" variant="ghost" size="sm" disabled={action.busy}
      onClick={() => void refresh?.(teacherPlatformProblemSummaries)}>
      {tr("刷新验证结果", "Refresh validation")}
    </Button>}
  </>;
}

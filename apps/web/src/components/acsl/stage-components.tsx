"use client";

import { CheckCircle2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AcslPaper } from "./model";
import { acslStageSummary, type AcslReviewMode } from "./stage-model";

export function AcslResultSummary({ paper }: { paper: AcslPaper }) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const stage = acslStageSummary(paper);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <div className="space-y-3" data-od-id="acsl-result-summary">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-sm text-muted-foreground">
            {tx("Written section", "笔试")}
          </dt>
          <dd className="mt-1 font-semibold" data-od-id="acsl-result-written">
            {paper.graded ? (
              <>
                {tx("Score", "成绩")}{" "}
                {paper.score === null ? "—" : number(paper.score)} /{" "}
                {number(paper.maxScore)}
              </>
            ) : (
              tx(
                `Not submitted · ${paper.answeredCount}/${paper.questionCount} answers saved`,
                `待交卷 · 已保存 ${paper.answeredCount}/${paper.questionCount} 题`,
              )
            )}
          </dd>
        </div>
        {stage.hasProgramming && (
          <div className="rounded-md border border-border p-3">
            <dt className="text-sm text-muted-foreground">
              {tx("Programming", "编程题")}
            </dt>
            <dd
              className={`mt-1 font-semibold ${paper.programmingSolved ? "text-success" : "text-muted-foreground"}`}
              data-od-id="acsl-result-programming"
            >
              {paper.programmingSolved
                ? tx("Passed", "已通过")
                : tx("Not passed yet", "尚未通过")}
            </dd>
          </div>
        )}
      </dl>
      {stage.pointsAwarded > 0 && (
        <div className="text-sm" data-od-id="acsl-result-points">
          <p className="font-semibold text-success">
            {tx("Points earned", "获得积分")} +{number(stage.pointsAwarded)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[
              stage.writtenPoints > 0
                ? tx(
                    `Written +${number(stage.writtenPoints)}`,
                    `笔试 +${number(stage.writtenPoints)}`,
                  )
                : "",
              stage.programmingPoints > 0
                ? tx(
                    `Programming +${number(stage.programmingPoints)}`,
                    `编程 +${number(stage.programmingPoints)}`,
                  )
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}

export function AcslStageResultDialog({
  paper,
  open,
  onOpenChange,
  onReview,
  onProgramming,
  onWritten,
  onClose,
}: {
  paper: AcslPaper;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (mode: AcslReviewMode) => void;
  onProgramming: () => void;
  onWritten?: () => void;
  onClose?: () => void;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const stage = acslStageSummary(paper);
  if (!paper.graded && !paper.programmingSolved) return null;
  function dismiss() {
    onOpenChange(false);
    onClose?.();
  }
  function navigate(action: () => void) {
    onOpenChange(false);
    action();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => (value ? onOpenChange(true) : dismiss())}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        data-od-id="acsl-stage-result-dialog"
      >
        <div className="pr-7">
          <DialogTitle className="flex items-start gap-2 leading-6">
            <CheckCircle2
              className="mt-0.5 shrink-0 text-success"
              size={20}
              aria-hidden="true"
            />
            {stage.complete
              ? tx("Paper completed", "整卷已完成")
              : paper.graded
                ? tx("Written section submitted", "笔试已交卷")
                : tx("Programming passed", "编程题已通过")}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {paper.title[locale]}
          </DialogDescription>
        </div>
        <AcslResultSummary paper={paper} />
        <div className="flex flex-wrap gap-2">
          {paper.graded && stage.wrongQuestionIds.length > 0 && (
            <Button
              onClick={() => navigate(() => onReview("wrong"))}
              data-od-id="acsl-stage-review-wrong"
            >
              {tx("Review incorrect answers", "复盘错题")} (
              {stage.wrongQuestionIds.length})
            </Button>
          )}
          {paper.graded && (
            <Button
              variant={stage.wrongQuestionIds.length ? "secondary" : "default"}
              onClick={() => navigate(() => onReview("all"))}
              data-od-id="acsl-stage-review-all"
            >
              {tx("Review all questions", "全部题目解析")}
            </Button>
          )}
          {stage.hasProgramming && !paper.programmingSolved && (
            <Button
              variant="secondary"
              onClick={() => navigate(onProgramming)}
              data-od-id="acsl-stage-continue-programming"
            >
              {tx("Continue programming", "继续编程")}
            </Button>
          )}
          {!paper.graded && onWritten && (
            <Button
              onClick={() => navigate(onWritten)}
              data-od-id="acsl-stage-continue-written"
            >
              {tx("Continue written section", "继续笔试")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={dismiss}
            data-od-id="acsl-stage-close"
          >
            {tx("Close", "关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

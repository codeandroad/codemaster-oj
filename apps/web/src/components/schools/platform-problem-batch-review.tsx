"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, input, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import { canReviewProblem, problemReviewTarget, type PlatformProblemRow, type ProblemReviewDecision } from "./platform-problem-model";

export function PlatformProblemBatchReview({ rows, onClose, onSaved }: {
  rows: PlatformProblemRow[];
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [decision, setDecision] = useState<ProblemReviewDecision | "">("");
  const pending = useRef(false), cancel = useRef<HTMLButtonElement>(null), action = useAction();
  const targets = decision ? rows.flatMap(row => {
    const target = canReviewProblem(row, decision) && problemReviewTarget(row);
    return target ? [target] : [];
  }) : [];
  const labels = { approve: tx("审核并向全平台公开", "Approve platform-wide access"), reject: tx("驳回全平台公开申请", "Reject platform-wide access requests"), withdraw: tx("撤下全平台公开", "Withdraw platform-wide access") };
  const skipped = rows.length - targets.length;

  function submit() {
    if (!decision || !targets.length || pending.current) return;
    pending.current = true;
    void action.run(async () => {
      const { reviewedCount } = await productionApi<{ reviewedCount: number }>("platform/problem-publications/batch", {
        method: "POST",
        body: { decision, items: targets.map(({ id, schoolId, versionId }) => ({ problemId: id, schoolId, versionId })) },
      });
      onSaved(reviewedCount);
    }).finally(() => { pending.current = false; });
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-auto overscroll-contain sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}>
      <DialogTitle>{tx("批量管理全平台公开", "Manage platform-wide access in bulk")}</DialogTitle>
      <DialogDescription>{tx("此处管理公开练习区。向全平台公开后，所有已登录用户均可练习所列题目的已发布内容。", "This controls the public practice catalog. Platform-wide access lets any signed-in user practice the published content of the listed problems.")}</DialogDescription>
      <label className="grid gap-1 text-sm font-medium">{tx("审核操作", "Review decision")}
        <select className={input} value={decision} disabled={action.busy} onChange={event => { setDecision(event.target.value as typeof decision); action.clear(); }}>
          <option value="">{tx("请选择", "Choose a decision")}</option>
          {(Object.keys(labels) as ProblemReviewDecision[]).map(value => <option key={value} value={value} disabled={!rows.some(row => canReviewProblem(row, value))}>{labels[value]}</option>)}
        </select>
      </label>
      {decision && <div className="space-y-2">
        <p role="status" className="text-sm">{tx(`将处理 ${targets.length} 道题目，${skipped} 道不适用此操作。`, `${targets.length} problems will be updated. ${skipped} are ineligible for this decision.`)}</p>
        <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm">{targets.map(target => <li key={target.id} className="break-words">{target.title} <span className="font-mono text-xs text-muted-foreground">{target.id.slice(0, 8)}</span></li>)}</ul>
      </div>}
      <Feedback action={action}/>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancel} type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{tx("取消", "Cancel")}</Button>
        <Button type="button" disabled={action.busy || !targets.length} onClick={submit}>{action.busy ? tx("正在审核…", "Reviewing…") : decision ? labels[decision] : tx("确认审核", "Confirm review")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

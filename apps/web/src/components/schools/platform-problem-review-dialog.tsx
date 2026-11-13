"use client";
import { useRef } from "react";
import { useLocale } from "@/components/locale-context";
import { MathContent } from "@/components/math-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import type { Problem } from "./school-practice-types";

export function PlatformProblemReviewDialog({ problem, onClose, onSaved }: { problem: Problem; onClose: () => void; onSaved: () => void }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const action = useAction(), pending = useRef(false);
  function decide(decision: "approve" | "reject" | "withdraw") {
    if (pending.current) return;
    pending.current = true;
    void action.run(async () => {
      const suffix = decision === "approve" ? "" : `/${problem.id}/${decision}`;
      await productionApi(`platform/problem-publications${suffix}`, { method: "POST", body: { schoolId: problem.schoolId, problemId: problem.id, versionId: problem.versionId } });
      onSaved(); onClose();
    }).finally(() => { pending.current = false; });
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-auto sm:max-w-3xl">
    <DialogTitle>{problem.title}</DialogTitle><DialogDescription>{tx("公开后，所有登录用户均可练习当前已发布版本。下方仅展示公开题干和样例。", "Publishing lets any signed-in user practice the current published version. The preview shows the statement and samples.")}</DialogDescription>
    {problem.definition && <><MathContent content={problem.definition.statement} />{problem.definition.samples.map((sample, index) => <pre key={index} className="overflow-auto rounded bg-surface-subtle p-3 text-sm">{tx("输入", "Input")}: {sample.input}{"\n"}{tx("预期输出", "Expected")}: {sample.expected}</pre>)}</>}
    <Feedback action={action} /><div className="flex flex-wrap justify-end gap-2">
      {problem.publicRequestStatus === "pending" && !problem.platformPublished && <Button type="button" variant="secondary" disabled={action.busy} onClick={() => decide("reject")}>{tx("驳回", "Reject")}</Button>}
      <Button type="button" disabled={action.busy} onClick={() => decide(problem.platformPublished ? "withdraw" : "approve")}>{problem.platformPublished ? tx("从公开区下架", "Withdraw public access") : tx("审核并公开", "Approve and publish")}</Button>
    </div>
  </DialogContent></Dialog>;
}

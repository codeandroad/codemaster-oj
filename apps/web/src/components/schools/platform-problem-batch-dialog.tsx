"use client";
import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, input, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import type { PlatformProblemBank, PlatformProblemRow } from "./platform-problem-model";
export type ProblemBatchOperation = { action: "archive" | "restore" | "move"; rows: PlatformProblemRow[] };

export function PlatformProblemBatchDialog({ operation, banks, onClose, onSaved }: { operation: ProblemBatchOperation; banks: PlatformProblemBank[]; onClose: () => void; onSaved: () => void }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [bankId, setBankId] = useState(operation.rows[0]?.source?.bankId ?? ""), action = useAction(), pending = useRef(false);
  const labels = { archive: tx("删除题目", "Delete problems"), restore: tx("恢复题目", "Restore problems"), move: tx("更改分类", "Change category") };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <DialogTitle>{labels[operation.action]}</DialogTitle>
    <DialogDescription>{operation.action === "archive" ? tx(`将删除所选 ${operation.rows.length} 道平台题目，并移出可用列表。题目版本、提交与成绩保留，可在“已删除”中恢复。`, `Delete ${operation.rows.length} selected platform problems from active lists. Versions, submissions, and results are retained; restore them from Deleted.`) : operation.action === "restore" ? tx(`恢复所选 ${operation.rows.length} 道平台题目。公开范围仍由平台管理员明确设置。`, `Restore ${operation.rows.length} selected platform problems. Platform administrators continue to manage public visibility explicitly.`) : tx(`为所选 ${operation.rows.length} 道平台题目更改分类；题目 ID、版本及原题库关联保留。`, `Change the category of ${operation.rows.length} platform problems, preserving their IDs, versions, and original bank links.`)}</DialogDescription>
    <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm">{operation.rows.map(row => <li key={row.id} className="break-words">{row.title}</li>)}</ul>
    {operation.action === "archive" && <p className="text-sm text-muted-foreground">{tx("如题目仍关联课程、作业或训练，须先解除这些关联后才能删除。", "Remove links from courses, assignments, and practice activities before deleting a referenced problem.")}</p>}
    {operation.action === "move" && <label className="grid gap-1 text-sm font-medium">{tx("目标分类", "Destination category")}<select aria-label={tx("目标分类", "Destination category")} className={input} value={bankId} disabled={action.busy} onChange={event => setBankId(event.target.value)}><option value="">{tx("未分类", "Unclassified")}</option>{banks.filter(bank => !bank.archivedAt).map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>}
    <Feedback action={action} />
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{tx("取消", "Cancel")}</Button><Button type="button" disabled={action.busy} onClick={() => { if (pending.current) return; pending.current = true; void action.run(async () => {
      await productionApi("platform/source-problems/batch", { method: "POST", body: { action: operation.action, problemIds: operation.rows.map(row => row.id), ...(operation.action === "move" ? { bankId: bankId || null } : {}) } }); onSaved(); onClose();
    }).finally(() => { pending.current = false; }); }}>{action.busy ? tx("处理中…", "Working…") : labels[operation.action]}</Button></div>
  </DialogContent></Dialog>;
}

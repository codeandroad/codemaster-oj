"use client";
import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, input, area, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import type { PlatformProblemBank } from "./platform-problem-model";

export function PlatformProblemBanks({ banks, onClose, onSaved }: { banks: PlatformProblemBank[]; onClose: () => void; onSaved: () => void }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [editing, setEditing] = useState<PlatformProblemBank | "new" | null>(null), [name, setName] = useState(""), [description, setDescription] = useState("");
  const action = useAction(), pending = useRef(false);
  function edit(bank: PlatformProblemBank | "new") { setEditing(bank); setName(bank === "new" ? "" : bank.name); setDescription(bank === "new" ? "" : bank.description ?? ""); action.clear(); }
  function run(operation: () => Promise<void>, message: string) {
    if (pending.current) return;
    pending.current = true;
    void action.run(async () => { await operation(); onSaved(); return message; }).finally(() => { pending.current = false; });
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
    <DialogTitle>{tx("管理平台分类", "Manage platform categories")}</DialogTitle>
    <DialogDescription>{tx("分类用于组织平台题目。更改分类不影响原题库关联、题目版本或学习记录。只有空分类可以归档。", "Categories organize platform problems. Category changes preserve original bank links, versions, and learner history. Only empty categories can be archived.")}</DialogDescription>
    <Feedback action={action} />
    {editing ? <form aria-label={tx("编辑平台分类", "Edit platform category")} className="space-y-3" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; run(async () => {
      await productionApi(`platform/problem-banks${editing === "new" ? "" : `/${editing.id}`}`, { method: editing === "new" ? "POST" : "PATCH", body: { name: name.trim(), description: description.trim(), ...(editing !== "new" ? { revision: editing.revision } : {}) } }); setEditing(null);
    }, tx("分类已保存。", "Category saved.")); }}>
      <label className="grid gap-1 text-sm font-medium">{tx("分类名称", "Category name")}<input name="name" className={input} value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={action.busy} /></label>
      <label className="grid gap-1 text-sm font-medium">{tx("说明", "Description")}<textarea name="description" className={area} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} disabled={action.busy} /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={() => setEditing(null)}>{tx("取消", "Cancel")}</Button><Button type="submit" disabled={action.busy}>{tx("保存分类", "Save category")}</Button></div>
    </form> : <>
      <div className="flex justify-end"><Button type="button" size="sm" disabled={action.busy} onClick={() => edit("new")}>{tx("新建分类", "New category")}</Button></div>
      <ul className="divide-y divide-border">{banks.map(bank => <li key={bank.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{bank.name}{bank.archivedAt && <span className="ml-2 text-xs font-normal text-muted-foreground">{tx("已归档", "Archived")}</span>}</p>{bank.description && <p className="mt-1 break-words text-xs text-muted-foreground">{bank.description}</p>}<p className="mt-1 text-xs text-muted-foreground">{tx(`${bank.problemCount ?? 0} 道题目，${bank.archivedProblemCount ?? 0} 道已删除`, `${bank.problemCount ?? 0} active, ${bank.archivedProblemCount ?? 0} deleted problems`)}</p></div><div className="flex gap-2">
        {!bank.archivedAt && <Button type="button" size="sm" variant="ghost" disabled={action.busy} onClick={() => edit(bank)}>{tx("编辑", "Edit")}</Button>}
        <Button type="button" size="sm" variant="secondary" disabled={action.busy || !bank.archivedAt && bank.problemCount + (bank.archivedProblemCount ?? 0) > 0} title={!bank.archivedAt && bank.problemCount + (bank.archivedProblemCount ?? 0) > 0 ? tx("请先将题目（包括已删除题目）移至其他分类。", "Move the problems, including deleted ones, to another category first.") : undefined} onClick={() => run(async () => { await productionApi(`platform/problem-banks/${bank.id}/${bank.archivedAt ? "restore" : "archive"}`, { method: "POST", body: { revision: bank.revision } }); }, bank.archivedAt ? tx("分类已恢复。", "Category restored.") : tx("分类已归档。", "Category archived."))}>{bank.archivedAt ? tx("恢复", "Restore") : tx("归档", "Archive")}</Button>
      </div></li>)}</ul>
      {!banks.length && <p className="py-5 text-center text-sm text-muted-foreground">{tx("暂无分类。新建分类后可用于创建、导入与整理题目。", "No categories yet. Create one to organize new and imported problems.")}</p>}
    </>}
  </DialogContent></Dialog>;
}

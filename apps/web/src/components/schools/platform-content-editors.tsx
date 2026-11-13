"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type Editor = { accountId: string; schoolId: string; name: string; username: string; schoolName: string; active?: boolean };

export function PlatformContentEditors({ kind, id, title, onClose }: { kind: "course" | "problem"; id: string; title: string; onClose: () => void }) {
  const text = useSchoolText(), action = useMutation();
  const endpoint = `platform/content-editors/${kind}/${id}`;
  const current = useData<{ items: Editor[] }>(endpoint);
  const [query, setQuery] = useState("");
  const candidates = useData<{ items: Editor[] }>(query.trim().length >= 2 ? `platform/content-editor-candidates?q=${encodeURIComponent(query.trim())}` : "");
  const change = (person: Editor, method: "POST" | "DELETE") => action.run(async () => {
    await productionApi(endpoint, { method, body: { accountId: person.accountId, schoolId: person.schoolId } });
    current.reload(); action.success(text("Editing permissions updated.", "编辑授权已更新。"));
  });
  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <DialogTitle>{text("Editing permissions", "编辑授权")} · {title}</DialogTitle>
    <DialogDescription>{text("Authorize a school administrator or teacher to edit this item. Publishing and access settings remain with platform administrators. Permissions stop when revoked or the school role ends.", "授权指定学校的管理员或老师编辑此项内容。发布和开放范围由平台管理员管理；撤销授权或学校身份失效后，编辑权限随即失效。")}</DialogDescription>
    <Feedback action={action}/>
    <Loading resource={current}><ul className="divide-y divide-border">{current.data?.items.map(person => <li key={`${person.accountId}:${person.schoolId}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0 break-words text-sm">{person.name} · {person.username}<p className="text-xs text-muted-foreground">{person.schoolName}{person.active === false && ` · ${text("Inactive", "已失效")}`}</p></div>
      <Button size="sm" variant="secondary" disabled={action.busy} onClick={() => void change(person, "DELETE")}>{text("Revoke", "撤销授权")}</Button>
    </li>)}</ul>{!current.data?.items.length && <p className="text-sm text-muted-foreground">{text("No delegated editors.", "尚未授权其他编辑者。")}</p>}</Loading>
    <label className="grid gap-2 text-sm">{text("Find an administrator or teacher", "搜索管理员或老师")}<input className={inputClass} value={query} onChange={e => setQuery(e.target.value)} placeholder={text("Name or username (at least 2 characters)", "姓名或用户名（至少 2 个字符）")}/></label>
    {query.trim().length >= 2 && <Loading resource={candidates}><ul className="divide-y divide-border">{candidates.data?.items.map(person => {
      const granted = current.data?.items.some(item => item.accountId === person.accountId && item.schoolId === person.schoolId);
      return <li key={`${person.accountId}:${person.schoolId}`} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0 break-words text-sm">{person.name} · {person.username}<p className="text-xs text-muted-foreground">{person.schoolName}</p></div><Button size="sm" disabled={action.busy || granted} onClick={() => void change(person, "POST")}>{granted ? text("Authorized", "已授权") : text("Authorize editing", "授权编辑")}</Button></li>;
    })}</ul>{!candidates.data?.items.length && <p className="text-sm text-muted-foreground">{text("No eligible staff found.", "没有找到符合条件的管理员或老师。")}</p>}</Loading>}
  </DialogContent></Dialog>;
}

"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type Editor = {
  accountId: string; schoolId: string; name: string; username: string; schoolName: string; active?: boolean;
  resourceIds?: string[];
  inheritedResources?: { resourceId: string; courseId: string; courseTitle: string }[];
};
type Props = { kind: "course" | "problem"; title: string; onClose: () => void } & ({ id: string; resourceIds?: string[] } | { id?: string; resourceIds: string[] });

export function PlatformContentEditors({ kind, id, resourceIds, title, onClose }: Props) {
  const text = useSchoolText(), action = useMutation(), searchId = useId();
  const ids = [...new Set(resourceIds ?? (id ? [id] : []))];
  const batch = resourceIds !== undefined;
  const endpoint = `platform/content-editors/${kind}/${batch ? "batch" : id}`;
  const current = useData<{ items: Editor[] }>(`${endpoint}${batch ? `?resourceIds=${encodeURIComponent(ids.join(","))}` : ""}`);
  const [query, setQuery] = useState("");
  const candidates = useData<{ items: Editor[] }>(query.trim().length >= 2 ? `platform/content-editor-candidates?q=${encodeURIComponent(query.trim())}` : null);
  const change = (person: Editor, method: "POST" | "DELETE") => action.run(async () => {
    await productionApi(endpoint, { method, body: { accountId: person.accountId, schoolId: person.schoolId, ...(batch ? { resourceIds: ids } : {}) } });
    current.reload(); action.success(text("Editing permissions updated.", "编辑授权已更新。"));
  });
  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <DialogTitle>{text("Editing permissions", "编辑授权")} · {title}</DialogTitle>
    <DialogDescription>{kind === "course"
      ? text("Course editors can also edit platform problems currently linked to these courses. Removing a link, revoking the grant, or ending the school role removes that inherited permission. Publishing, access settings, and further delegation remain with platform administrators.", "课程编辑授权同时覆盖课程当前关联的平台题目。取消关联、撤销授权或学校身份失效后，相应权限随即失效。发布、开放范围和继续授权仍由平台管理员管理。")
      : text("Authorize school administrators or teachers to edit the selected problems. Course permissions also apply to their linked platform problems. Publishing, access settings, and further delegation remain with platform administrators.", "授权学校管理员或老师编辑所选题目。课程编辑授权也覆盖其关联的平台题目。发布、开放范围和继续授权仍由平台管理员管理。")}</DialogDescription>
    {batch && <p className="text-sm text-muted-foreground">{text(`${ids.length} items selected. Changes apply to all selected items.`, `已选择 ${ids.length} 项；操作将应用于全部所选内容。`)}</p>}
    <div aria-live="polite"><Feedback action={action}/></div>
    <Loading resource={{ ...current, loading: current.pending }}><ul className="divide-y divide-border">{current.data?.items.map(person => {
      const direct = person.resourceIds?.length ?? 0;
      const courses = [...new Map((person.inheritedResources ?? []).map(link => [link.courseId, link.courseTitle])).values()];
      return <li key={`${person.accountId}:${person.schoolId}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="min-w-0 flex-1 basis-40 break-words text-sm">{person.name} · {person.username}<p className="text-xs text-muted-foreground">{person.schoolName}{person.active === false && ` · ${text("Inactive", "已失效")}`}</p>
          {direct > 0 && <p className="mt-1 text-xs text-muted-foreground">{text(`Direct permission: ${direct}/${ids.length} items`, `直接授权：${direct}/${ids.length} 项`)}</p>}
          {courses.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{text("Via course: ", "来自课程：")}{courses.join("、")}{text(". Manage this permission from the course.", "；请在对应课程中管理此授权。")}</p>}
        </div>
        {direct > 0 && <Button type="button" size="sm" variant="secondary" disabled={action.busy} onClick={() => void change(person, "DELETE")}>{text("Revoke direct permission", "撤销直接授权")}</Button>}
      </li>;
    })}</ul>{!current.data?.items.length && <p className="text-sm text-muted-foreground">{text("No delegated editors.", "尚未授权其他编辑者。")}</p>}</Loading>
    <search className="grid gap-2 text-sm" aria-label={text("Find an editor", "搜索编辑者")}>
      <label htmlFor={searchId}>{text("Find an administrator or teacher (at least 2 characters)", "搜索管理员或老师（至少 2 个字符）")}</label>
      <input id={searchId} name="editorQuery" type="search" className={inputClass} value={query} maxLength={100} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e => setQuery(e.target.value)} placeholder={text("Name or username", "姓名或用户名")}/>
    </search>
    {query.trim().length >= 2 && <Loading resource={{ ...candidates, loading: candidates.pending }}><ul className="divide-y divide-border">{candidates.data?.items.map(person => {
      const existing = current.data?.items.find(item => item.accountId === person.accountId && item.schoolId === person.schoolId);
      const granted = ids.length > 0 && ids.every(resourceId => existing?.resourceIds?.includes(resourceId));
      return <li key={`${person.accountId}:${person.schoolId}`} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0 flex-1 basis-40 break-words text-sm">{person.name} · {person.username}<p className="text-xs text-muted-foreground">{person.schoolName}</p></div><Button type="button" size="sm" disabled={action.busy || current.pending || !!current.error || granted || ids.length === 0 || ids.length > 200} onClick={() => void change(person, "POST")}>{granted ? text("Authorized", "已授权") : batch ? text("Authorize all selected", "授权全部所选") : text("Authorize editing", "授权编辑")}</Button></li>;
    })}</ul>{!candidates.data?.items.length && <p className="text-sm text-muted-foreground">{text("No eligible staff found.", "没有找到符合条件的管理员或老师。")}</p>}</Loading>}
  </DialogContent></Dialog>;
}

"use client";

import { useState } from "react";
import { useData } from "@/components/admin/common";
import { State, date } from "@/components/student/shared";
import { useSchoolText } from "./school-ui";

type Group = { id:string; name:string; problemIds:string[] };
type Exercise = { id:string; title:string };
type Import = { id:string; kind:string; filename:string|null; createdAt:string };

export function CatalogGroups({base}:{base:string}) {
  const text=useSchoolText();
  const [open,setOpen]=useState(false);
  const groups=useData<{items:Group[]}>(open?`${base}/problem-groups`:null);
  const exercises=useData<{items:Exercise[]}>(open?(base==="platform"?"platform/source-problems?view=summary":`${base}/problems`):null);
  const [selected,setSelected]=useState("");
  const group=groups.data?.items.find(row=>row.id===selected)??groups.data?.items[0];
  const titles=new Map(exercises.data?.items.map(row=>[row.id,row.title]));
  return <details className="rounded-md border border-border bg-surface p-3" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{text("Problem groups","题组")}</summary>
    {open&&<State data={groups}>{group?<div className="mt-2 space-y-2">
      <select aria-label={text("Problem group","题组")} value={group.id} onChange={e=>setSelected(e.target.value)}>
        {groups.data?.items.map(row=><option key={row.id} value={row.id}>{row.name} ({row.problemIds.length})</option>)}
      </select>
      <ol className="max-h-64 list-inside list-decimal overflow-y-auto text-sm">{group.problemIds.map(id=><li key={id}>{titles.get(id)??id}</li>)}</ol>
    </div>:<p>{text("No groups yet.","暂无题组。")}</p>}</State>}
  </details>;
}

export function SchoolImportHistory({schoolId}:{schoolId:string}) {
  const text=useSchoolText();
  const [open,setOpen]=useState(false);
  const history=useData<{items:Import[]}>(open?`schools/${schoolId}/import-history`:null);
  return <details className="rounded-md border border-border bg-surface p-3" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{text("Import history","导入记录")}</summary>
    {open&&<State data={history}><ul className="mt-2 space-y-1 text-sm">{history.data?.items.map(row=>
      <li key={row.kind+row.id}>{date(row.createdAt)} · {row.filename||(row.kind==="problem_bank"?text("Problem bank","题库"):row.kind==="roster"?text("Class roster","班级名单"):text("Identities","身份档案"))}</li>)}</ul>
      {history.data?.items.length===0&&<p>{text("No imports yet.","暂无导入。")}</p>}</State>}
  </details>;
}

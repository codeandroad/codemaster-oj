"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { State, panel, useData, useRefreshOnReturn, kindLabel } from "@/components/student/data-state";
import { useLocale } from "@/components/locale-context";
import { useSchoolText } from "./school-ui";

const zone = "Asia/Shanghai";
const beijingDate = new Intl.DateTimeFormat("sv-SE", {timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"});
const beijingTime = new Intl.DateTimeFormat("en-GB", {timeZone:zone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
type Entry = {id:string; createdAt:string; kind:string; title:string; activity:string | null; status:string; language:string; origin:"school"|"shared"|"classroom"; canViewCode:boolean};
type History = {studentName:string; total:number; pageSize:number; items:Entry[]};

function AttemptCode({path}: {path:string}) {
  const code = useData<{code:string | null}>(path);
  const text = useSchoolText();
  return <State data={code}>{code.data && (code.data.code == null
    ? <p>{text("Source unavailable", "没有保存当次代码")}</p>
    : <pre className="mt-2 max-h-96 overflow-auto rounded border border-border bg-surface-subtle p-3 text-sm" tabIndex={0}><code>{code.data.code}</code></pre>)}</State>;
}

function DailyEntries({base, date}: {base:string; date:string}) {
  const [page,setPage] = useState(1);
  const {version,refresh}=useRefreshOnReturn();
  const text=useSchoolText();
  return <><Button variant="secondary" className="mt-3" onClick={refresh}>{text("Refresh records","刷新记录")}</Button><HistoryPage key={page+":"+version} base={base} date={date} page={page} setPage={setPage}/></>;
}

function HistoryPage({base,date,page,setPage}: {base:string;date:string;page:number;setPage:(page:number)=>void}) {
  const {locale} = useLocale();
  const text = useSchoolText();
  const query = "?date="+encodeURIComponent(date);
  const history = useData<History>(base+query+"&page="+page);
  const [open,setOpen] = useState<string | null>(null);
  const data = history.data;
  return <State data={history}>{data && <>
    <p className="my-4 text-sm text-muted-foreground">{text(`${data.studentName} · ${data.total} records`, `${data.studentName} · 共 ${data.total} 条记录`)}</p>
    {!data.items.length && <p>{text("No judging records on this date.", "该日期没有判题记录。")}</p>}
    <ol className="divide-y divide-border">{data.items.map(item => <li key={item.id} className="py-3">
      <div
        className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 rounded text-left text-sm ">
        <time dateTime={item.createdAt} className="font-mono">{beijingTime.format(new Date(item.createdAt))}</time>
        <span className="min-w-32 flex-1"><strong>{item.title}</strong>{item.activity && <span className="block text-xs text-muted-foreground">{item.activity}</span>}</span>
        <span>{item.origin==="shared" ? text("Public practice · Shared by student","公开练习 · 学生分享") : item.origin==="classroom" ? text("Public problem · Classroom practice","公开题目 · 课堂练习") : text("School practice","校内练习")}</span>
        <span>{kindLabel(item.kind,locale)}</span><strong>{item.status}</strong>
        {item.canViewCode ? <button type="button" aria-expanded={open===item.id} onClick={()=>setOpen(open===item.id ? null : item.id)} className="text-primary underline">
          {open===item.id ? text("Hide code","收起代码") : text("View code","查看代码")}</button> : <span>{text("Summary only","仅分享摘要")}</span>}
      </div>
      {item.canViewCode && open===item.id && <div className="mt-2"><span className="text-xs text-muted-foreground">{item.language}</span>
        <AttemptCode key={item.id} path={base+"/"+encodeURIComponent(item.id)+query}/></div>}
    </li>)}</ol>
    {data.total>data.pageSize && <nav aria-label={text("Judging history pages","判题记录分页")} className="mt-4 flex items-center justify-end gap-2 text-sm">
      <Button variant="secondary" disabled={page===1} onClick={()=>setPage(page-1)}>{text("Previous","上一页")}</Button>
      <span>{page} / {Math.ceil(data.total/data.pageSize)}</span>
      <Button variant="secondary" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(page+1)}>{text("Next","下一页")}</Button>
    </nav>}
  </>}</State>;
}

export function StudentJudgingHistory({schoolId,profileId}: {schoolId:string;profileId:string}) {
  const text = useSchoolText();
  const router = useRouter();
  const search = useSearchParams();
  const date = search.get("judgeDate") ?? beijingDate.format(new Date());
  const params = new URLSearchParams(search);
  params.delete("judgingHistory"); params.delete("judgeDate");
  const profileHref = "/schools?"+params;
  return <section className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold">{text("Complete judging history","完整判题记录")}</h1>
      <AppLink href={profileHref} className={buttonVariants({variant:"secondary"})}>{text("Back to student profile","返回学生主页")}</AppLink>
    </div>
    <label className="mt-5 flex flex-wrap items-center gap-3 text-sm font-medium">
      {text("Date (Beijing time)", "日期（北京时间）")}
      <input type="date" value={date} className="rounded border border-border bg-surface px-3 py-2" onChange={event=>{
        const next = event.currentTarget.value;
        if (next) router.replace(profileHref+"&judgingHistory=1&judgeDate="+encodeURIComponent(next),{scroll:false});
      }}/>
    </label>
    <DailyEntries key={[schoolId,profileId,date].join("/")} base={`schools/${schoolId}/submissions/students/${profileId}`} date={date}/>
  </section>;
}

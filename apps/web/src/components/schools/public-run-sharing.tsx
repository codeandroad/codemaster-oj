"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Feedback, State, kindLabel, panel, useData, useMutation } from "@/components/student/data-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { schoolDisplayName, type School, useSchoolText } from "./school-ui";

const beijingDay = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const beijingTime = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",timeStyle:"medium",hourCycle:"h23"});
const control = "ml-2 rounded border border-input bg-background px-2 py-1";
type Run = {id:string; title:string; createdAt:string; status:string; kind:string; language:string; visibility:"private"|"summary"|"code"|"classroom"};

export function PublicRunSharing({backHref,initialSchool}:{backHref:string;initialSchool?:string|null}) {
  const text=useSchoolText(), {locale}=useLocale(), router=useRouter(), pathname=usePathname(), search=useSearchParams();
  const schools=useData<{items:School[]}>("schools");
  const members=schools.data?.items.filter(s=>s.roles.includes("student")) ?? [];
  const [chosen,setChosen]=useState(initialSchool ?? "");
  const school=members.find(s=>s.id===chosen);
  const date=search.get("date") ?? beijingDay.format(new Date());
  return <section className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-xl font-bold">{text("Public practice run sharing","公开练习记录与分享")}</h1>
      <AppLink href={backHref} className={buttonVariants({variant:"secondary"})}>{text("Back to submissions","返回提交记录")}</AppLink>
    </div>
    <div className="my-4 flex flex-wrap items-center gap-4 text-sm">
      <label>{text("Date (Beijing time)","日期（北京时间）")}
        <input type="date" className={control} value={date} onChange={e=>{
          if (!e.target.value) return;
          const next=new URLSearchParams(search); next.set("date",e.target.value); router.replace(pathname+"?"+next,{scroll:false});
        }}/>
      </label>
      <State data={schools}><label>{text("Share with","接收学校")}
        <select className={control} value={school?.id ?? ""} onChange={e=>setChosen(e.target.value)}>
          <option value="">{text("Choose a school","选择学校")}</option>
          {members.map(s=><option key={s.id} value={s.id}>{schoolDisplayName(s,locale)}</option>)}
        </select>
      </label></State>
    </div>
    <RunSelection key={date+":"+(school?.id ?? "")} date={date} school={school}/>
  </section>;
}

function OwnCode({id}:{id:string}) {
  const text=useSchoolText();
  const resource=useData<{code:string|null}>("practice/run-sharing/"+id.split(":").join("/"));
  return <State data={resource}>{resource.data && <pre className="my-2 max-h-80 overflow-auto rounded bg-surface-subtle p-3 text-sm" tabIndex={0}><code>{resource.data.code ?? text("Source unavailable","没有保存当次代码")}</code></pre>}</State>;
}

function RunSelection({date,school}:{date:string;school?:School}) {
  const text=useSchoolText(), {locale}=useLocale();
  const records=useData<{items:Run[]}>("practice/run-sharing?"+new URLSearchParams({date,...(school && {schoolId:school.id})}));
  const action=useMutation();
  const [checked,setChecked]=useState<string[]>([]), [includeCode,setIncludeCode]=useState(false), [open,setOpen]=useState("");
  const items=records.data?.items ?? [];
  const selectable=items.filter(run=>run.visibility!=="classroom");
  const selected=selectable.filter(run=>checked.includes(run.id));
  const labels={private:text("Not shared","未分享"),summary:text("Summary shared","已分享摘要"),code:text("Summary and code shared","已分享摘要及代码"),classroom:text("Classroom run","课堂练习")};
  function update(visibility:"summary"|"code"|"private") {
    if (!school || !selected.length) return;
    void action.run(async()=>{
      const result=await productionApi<{updated:number}>("practice/run-sharing",{method:"POST",
        body:{schoolId:school.id,date,records:selected.map(r=>r.id),visibility}});
      action.success(visibility==="private" ? text(`Sharing withdrawn for ${result.updated} runs.`,`已撤回所选 ${result.updated} 条记录的分享。`) :
        text(`Shared ${result.updated} runs with ${schoolDisplayName(school,locale)}.`,`已向${schoolDisplayName(school,locale)}分享 ${result.updated} 条记录。`));
      setChecked([]); setIncludeCode(false); records.reload();
    });
  }
  return <State data={records}><fieldset disabled={action.busy || records.loading} className="space-y-3">
    <legend className="mb-2 font-semibold">{text(`Runs on this date (${items.length})`,`当天判题记录（${items.length} 条）`)}</legend>
    {items.length===0 ? <p>{text("No public practice runs on this date.","当天没有公开练习判题记录。")}</p> : <>
      {school && selectable.length>0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox"
        checked={selected.length===selectable.length} onChange={e=>setChecked(e.target.checked ? selectable.map(r=>r.id) : [])}/>
        {text("Select all personal runs currently listed","全选当天已有的个人练习记录")}</label>}
      <ul className="divide-y divide-border">{items.map(run=><li key={run.id} className="py-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <label className="flex min-w-48 flex-1 items-baseline gap-2">
            {school && run.visibility!=="classroom" && <input type="checkbox" checked={checked.includes(run.id)}
              onChange={e=>setChecked(e.target.checked ? [...checked,run.id] : checked.filter(id=>id!==run.id))}/>}
            <time className="font-mono" dateTime={run.createdAt}>{beijingTime.format(new Date(run.createdAt))}</time>
            <strong>{run.title}</strong></label>
          <span>{kindLabel(run.kind,locale)} · {run.language} · {run.status}</span>
          {(school || run.visibility==="classroom") && <span>{labels[run.visibility]}</span>}
          <button type="button" className="text-primary underline" aria-expanded={open===run.id} onClick={()=>setOpen(open===run.id?"":run.id)}>
            {open===run.id?text("Hide code","收起代码"):text("View code","查看代码")}</button>
        </div>
        {open===run.id && <OwnCode id={run.id}/>}
      </li>)}</ul>
      {school && selectable.length>0 && <div className="space-y-3 border-t border-border pt-3 text-sm">
        <p>{text(`Administrators at ${schoolDisplayName(school,locale)} will see the selected runs’ times, problems, run types, languages and results. You can withdraw sharing here.`,
          `${schoolDisplayName(school,locale)}的管理员将看到所选记录的时间、题目、运行类型、语言和结果。你可以在这里撤回分享。`)}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeCode} onChange={e=>setIncludeCode(e.target.checked)}/>
          {text("Also share the code from each selected run","同时分享所选记录的当次代码")}</label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!selected.length} onClick={()=>update(includeCode?"code":"summary")}>{text(`Share selected (${selected.length})`,`分享所选记录（${selected.length}）`)}</Button>
          <Button variant="secondary" disabled={!selected.some(r=>r.visibility!=="private")} onClick={()=>update("private")}>{text("Withdraw sharing","撤回分享")}</Button>
        </div>
      </div>}
    </>}
  </fieldset><Feedback action={action}/></State>;
}

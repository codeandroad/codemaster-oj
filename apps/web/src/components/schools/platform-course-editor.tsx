"use client";

import { useMemo, useState } from "react";
import { Loading, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { CreatePath, LearningEditorForm, platformLearningPath } from "@/components/teacher/learning";
import { useSchoolText } from "./school-ui";
import type { PlatformCourse } from "./platform-course-model";

// Platform and school authors share the full chapter editor; only transport
// and publication capabilities differ.
export function PlatformCourseEditor({ course, onClose, onSaved }: {course:PlatformCourse;onClose:()=>void;onSaved:(course:PlatformCourse)=>void}) {
 const text=useSchoolText(),[created,setCreated]=useState<PlatformCourse|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[refreshError,setRefreshError]=useState("");
 const value=created??course,initial=useMemo(()=>value.id?platformLearningPath(value):null,[value]);
 const refresh=()=>{setRefreshError("");void productionApi<PlatformCourse>(`platform/courses/${value.id}`).then(setCreated).catch(reason=>setRefreshError(apiMessage(reason)));};
 if(!initial)return <CreatePath platform onClose={onClose} onCreated={async id=>{setCreated(await productionApi<PlatformCourse>(`platform/courses/${id}`));}}/>;
 return <div className="space-y-4"><Button type="button" variant="ghost" disabled={busy} onClick={()=>{if(dirty&&!window.confirm(text("Discard unsaved changes?","放弃尚未保存的修改？")))return;onSaved(value);onClose();}}>← {text("Back to courses","返回课程")}</Button><h2 className="break-words text-lg font-semibold">{value.title}</h2>{refreshError&&<p role="alert" className="text-sm text-destructive">{refreshError}<Button type="button" size="sm" variant="ghost" onClick={refresh}>{text("Reload","重新加载")}</Button></p>}<LearningEditorForm key={value.id} initial={initial} onSaved={refresh} onDirtyChange={setDirty} onBusyChange={setBusy}/></div>;
}

export function PlatformCourseEditorLoader({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:()=>void}) {
 const resource=useData<PlatformCourse>(`platform/courses/${encodeURIComponent(id)}`);
 return <Loading resource={resource}>{resource.data&&<PlatformCourseEditor course={resource.data} onClose={onClose} onSaved={onSaved}/>}</Loading>;
}

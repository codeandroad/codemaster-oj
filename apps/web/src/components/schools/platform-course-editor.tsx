"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loading, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { CreatePath, LearningEditorForm, platformLearningPath, type CourseProblemEditorSelection } from "@/components/teacher/learning";
import { adjacentProblemRows, type CourseProblemEditorEntry, type ProblemEditorTab } from "@/components/teacher/problem-editor-navigation";
import { useSchoolText } from "./school-ui";
import type { PlatformCourse } from "./platform-course-model";
import { PlatformProblemEditor } from "./platform-problems";

// Platform and school authors share the full chapter editor; only transport
// and publication capabilities differ.
export function PlatformCourseEditor({ course, onClose, onSaved, showTopicEditor = true }: {course:PlatformCourse;showTopicEditor?:boolean;onClose:()=>void;onSaved:(course:PlatformCourse)=>void}) {
 const text=useSchoolText(),[created,setCreated]=useState<PlatformCourse|null>(null),[refreshError,setRefreshError]=useState("");
 const [problemEditor, setProblemEditor] = useState<(CourseProblemEditorSelection & { tab?: ProblemEditorTab }) | null>(null);
 const problemView = useRef<HTMLDivElement>(null);
 const value=created??course,initial=useMemo(()=>value.id?platformLearningPath(value):null,[value]);
 const refresh=()=>{setRefreshError("");void productionApi<PlatformCourse>(`platform/courses/${value.id}`).then(fresh=>{setCreated(fresh);onSaved(fresh);}).catch(reason=>setRefreshError(apiMessage(reason)));};
 useEffect(() => { if (problemEditor) problemView.current?.focus(); }, [problemEditor]);
 const { previous, next } = problemEditor ? adjacentProblemRows(problemEditor.exercises, problemEditor.exercise.id) : {};
 const target = (exercise?: CourseProblemEditorEntry) => exercise && ({
   title: exercise.title,
   select: (tab?: ProblemEditorTab) => setProblemEditor(current => current && { ...current, exercise, tab }),
 });
 if(!initial)return <CreatePath platform onClose={onClose} onCreated={async id=>{const fresh=await productionApi<PlatformCourse>(`platform/courses/${id}`);setCreated(fresh);onSaved(fresh);}}/>;
 return <>
   <div hidden={!!problemEditor} className="space-y-4">
     {refreshError&&<p role="alert" className="text-sm text-destructive">{refreshError}<Button type="button" size="sm" variant="ghost" onClick={refresh}>{text("Reload","重新加载")}</Button></p>}
     <LearningEditorForm key={value.id} initial={initial} onSaved={refresh} onBack={onClose}
       onEditPlatformProblem={setProblemEditor} showTopicEditor={showTopicEditor}/>
   </div>
   {problemEditor && <div ref={problemView} tabIndex={-1}>
     <PlatformProblemEditor id={problemEditor.exercise.problemId} editorKey={problemEditor.exercise.id} initialTab={problemEditor.tab}
       navigation={{ previous: target(previous), next: target(next), repeatAfterSolutions: true }}
       closeLabel={text("Back to chapter", "返回章节")} onClose={() => {
       setProblemEditor(null);
       problemEditor.returnToExercise(problemEditor.exercise);
       refresh();
     }}/>
   </div>}
 </>;
}

export function PlatformCourseEditorLoader({id,onClose,onSaved,showTopicEditor}:{id:string;showTopicEditor:boolean;onClose:()=>void;onSaved:()=>void}) {
 const resource=useData<PlatformCourse>(`platform/courses/${encodeURIComponent(id)}`);
 return <Loading resource={resource}>{resource.data&&<PlatformCourseEditor course={resource.data} showTopicEditor={showTopicEditor} onClose={onClose} onSaved={onSaved}/>}</Loading>;
}

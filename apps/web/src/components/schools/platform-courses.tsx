"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Feedback, Loading, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import { productionApi } from "@/lib/production-api";
import { PlatformContentEditors } from "./platform-content-editors";
import { PlatformCourseEditor } from "./platform-course-editor";
import { PlatformCourseAdmissions } from "./platform-course-admissions";
import { courseAudiencePolicy } from "./platform-course-admission-model";
import type { PlatformCourse } from "./platform-course-model";
import { useSchoolText } from "./school-ui";

export function PlatformCourses() {
  const text = useSchoolText();
  const params = useSearchParams(), courseId = params.get("courseId");
  const courses = useData<{ items: PlatformCourse[]; canManage: boolean }>("platform/courses?view=summary");
  const action = useMutation();
  const [editor, setEditor] = useState<PlatformCourse | null>(null);
  const [grant, setGrant] = useState<PlatformCourse | null>(null);
  const [selected,setSelected]=useState<string[]>([]),[batchGrant,setBatchGrant]=useState<string[]|null>(null);
  const items=courses.data?.items??[],selectedIds=selected.filter(id=>items.some(course=>course.id===id));
  const {getRange}=useRangeSelection(items,JSON.stringify(items.map(course=>course.id)));
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    await action.run(work);
    pending.current = false;
  };
  function navigateToCourse(id?: string, view?: "admissions") {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("courseId", id); else url.searchParams.delete("courseId");
    if (view) url.searchParams.set("view", view); else url.searchParams.delete("view");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }
  function close() { setEditor(null); if (courseId) navigateToCourse(); requestAnimationFrame(() => trigger.current?.focus()); }
  function saved(course: PlatformCourse) { close(); courses.reload(); action.success(text(`Saved ${course.title}.`, `已保存「${course.title}」。`)); }
  async function change(course: PlatformCourse, operation: string) {
    await run(async () => {
      await productionApi(`platform/courses/${course.id}/${operation}`, { method: "POST", body: { expectedRevision: course.revision, sourceVersion: course.sourceVersion } });
      action.success(text("Course updated.", "课程已更新。")); courses.reload();
    });
  }
  if (courseId && params.get("view") === "admissions") return <PlatformCourseAdmissions key={courseId} courseId={courseId} onBack={() => { close(); courses.reload(); }}/>
  if (courseId) return <PlatformCourseDetail key={courseId} id={courseId} onClose={close} onSaved={saved}/>;
  if (editor) return <PlatformCourseEditor key={`${editor.id}:${editor.revision}`} course={editor} onClose={close} onSaved={saved}/>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{text("Manage platform courses, audiences and admission requirements.", "管理平台课程、开放范围与准入条件。")}</p>
      {courses.data?.canManage && <Button size="sm" disabled={action.busy} onClick={event => {
        trigger.current = event.currentTarget;
        setEditor({ id: "", title: "", description: "", category: "Programming", authorName: text("Platform administrator", "平台管理员"), estimatedMinutes: 60, requiredLanguage: null, revision: 0, sourceVersion: "", published: false, archived: false, audienceScope: "all", schoolIds: [], studentIds: [], schools: [], students: [], chapters: [], chapterCount: 0 });
      }}><Plus size={15}/>{text("Create course", "新建课程")}</Button>}</div>
    <Feedback action={action}/>
    {courses.data?.canManage&&items.length>0&&<div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3">
      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={selectedIds.length===items.length} onChange={event=>setSelected(event.target.checked?items.map(course=>course.id):[])}/>{text("Select all courses","选择全部课程")}</label>
      <span className="text-sm text-muted-foreground">{text(`${selectedIds.length} selected`, `已选择 ${selectedIds.length} 项`)}</span>
      <Button type="button" size="sm" variant="secondary" disabled={!selectedIds.length||selectedIds.length>200} onClick={()=>setBatchGrant(selectedIds)}>{text("Authorize selected courses","批量编辑授权")}</Button>
      {selectedIds.length>200&&<span role="status" className="text-sm text-muted-foreground">{text("Select up to 200 courses at a time.","每次最多选择 200 门课程。")}</span>}
    </div>}
    <Loading resource={courses}><ul className="divide-y divide-border rounded-lg border border-border bg-surface">{courses.data?.items.map(course => <li key={course.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
      {courses.data?.canManage&&<input type="checkbox" aria-label={text(`Select ${course.title}`,`选择「${course.title}」`)} className="size-4 shrink-0 accent-primary" checked={selectedIds.includes(course.id)} onChange={event=>{const range=getRange(course.id,event);const checked=event.currentTarget.checked;setSelected(ids=>range||checked?[...new Set([...ids,...(range??[course.id])])]:ids.filter(id=>id!==course.id));}}/>}
      <div className="min-w-0 flex-1"><h2 className="break-words text-sm font-semibold">{course.title}</h2><p className="mt-1 text-xs text-muted-foreground">
        {course.archived ? text("Archived", "已归档") : course.published ? text("Published", "已发布") : text("Draft", "未发布")} · {courseAudiencePolicy(course).scope === "all" ? text("All registered users", "所有注册用户") : text("Custom audience", "自定义范围")} · {text(`${course.chapterCount} chapters`, `${course.chapterCount} 章`)}
      </p></div><div className="flex flex-wrap gap-2">
        {!course.archived && <Button size="sm" variant="secondary" disabled={action.busy} onClick={event => { trigger.current = event.currentTarget; navigateToCourse(course.id); }}>{text("Edit", "编辑")}</Button>}
        {courses.data?.canManage && <><Button size="sm" variant="ghost" onClick={() => setGrant(course)}>{text("Editors", "编辑授权")}</Button>
        <Button size="sm" variant="secondary" disabled={action.busy} onClick={event => { trigger.current = event.currentTarget; navigateToCourse(course.id, "admissions"); }}>{text("Learning applications", "学习申请")}{course.pendingApplications ? ` (${course.pendingApplications})` : ""}</Button>
        {!course.archived && <Button size="sm" variant="secondary" disabled={action.busy} onClick={() => void change(course, course.published ? "unpublish" : "publish")}>{course.published ? text("Withdraw", "下架") : text("Publish", "发布")}</Button>}
        <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void change(course, course.archived ? "restore" : "archive")}>{course.archived ? text("Restore", "恢复") : text("Archive", "归档")}</Button></>}
      </div>
    </li>)}</ul>{!courses.data?.items.length && <p className="py-6 text-sm text-muted-foreground">{text("No platform courses yet. Create your first course.", "暂无可编辑的平台课程。")}</p>}</Loading>
    {grant && <PlatformContentEditors kind="course" id={grant.id} title={grant.title} onClose={() => setGrant(null)}/>}
    {batchGrant&&<PlatformContentEditors kind="course" resourceIds={batchGrant} title={text(`${batchGrant.length} courses`,`${batchGrant.length} 门课程`)} onClose={()=>setBatchGrant(null)}/>}
  </div>;
}

function PlatformCourseDetail({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (course: PlatformCourse) => void }) {
  const detail = useData<PlatformCourse>(`platform/courses/${encodeURIComponent(id)}`), text = useSchoolText();
  return <>
    {(detail.error || detail.loading) && <Button variant="ghost" onClick={onClose}>{text("Back to courses", "返回课程列表")}</Button>}
    <Loading resource={detail}>{detail.data && (detail.data.archived
      ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{text("Restore this archived course before editing it.", "此课程已归档，恢复后方可编辑。")}</p><Button variant="secondary" onClick={onClose}>{text("Back to courses", "返回课程列表")}</Button></div>
      : <PlatformCourseEditor key={`${detail.data.id}:${detail.data.revision}`} course={detail.data} onClose={onClose} onSaved={onSaved}/>)}</Loading>
  </>;
}

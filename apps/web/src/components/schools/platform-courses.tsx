"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Feedback, Loading, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { PlatformCourseEditor } from "./platform-course-editor";
import type { PlatformCourse } from "./platform-course-model";
import { useSchoolText } from "./school-ui";

export function PlatformCourses() {
  const text = useSchoolText();
  const courses = useData<{ items: PlatformCourse[] }>("platform/courses");
  const action = useMutation();
  const [editor, setEditor] = useState<PlatformCourse | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    await action.run(work);
    pending.current = false;
  };
  function close() { setEditor(null); requestAnimationFrame(() => trigger.current?.focus()); }
  async function change(course: PlatformCourse, operation: string) {
    await run(async () => {
      await productionApi(`platform/courses/${course.id}/${operation}`, { method: "POST", body: { expectedRevision: course.revision, sourceVersion: course.sourceVersion } });
      action.success(text("Course updated.", "课程已更新。")); courses.reload();
    });
  }
  if (editor) return <PlatformCourseEditor key={`${editor.id}:${editor.revision}`} course={editor} onClose={close} onSaved={saved => {
    close(); courses.reload(); action.success(text(`Saved ${saved.title}.`, `已保存「${saved.title}」。`));
  }}/>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{text("Create platform courses and choose who can study them.", "发布与管理平台课程，选择全平台、指定学校或指定学生开放。")}</p>
      <Button size="sm" disabled={action.busy} onClick={event => {
        trigger.current = event.currentTarget;
        setEditor({ id: "", title: "", description: "", category: "Programming", authorName: text("Platform administrator", "平台管理员"), estimatedMinutes: 60, requiredLanguage: null, revision: 0, sourceVersion: "", published: false, archived: false, audienceScope: "all", schoolIds: [], studentIds: [], schools: [], students: [], chapters: [], chapterCount: 0 });
      }}><Plus size={15}/>{text("Create course", "新建课程")}</Button></div>
    <Feedback action={action}/>
    <Loading resource={courses}><ul className="divide-y divide-border rounded-lg border border-border bg-surface">{courses.data?.items.map(course => <li key={course.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1"><h2 className="break-words text-sm font-semibold">{course.title}</h2><p className="mt-1 text-xs text-muted-foreground">
        {course.archived ? text("Archived", "已归档") : course.published ? text("Published", "已发布") : text("Draft", "未发布")} · {course.audienceScope === "all" ? text("Everyone", "全平台") : course.audienceScope === "schools" ? text(`${course.schoolIds.length} schools`, `${course.schoolIds.length} 所学校`) : text(`${course.studentIds.length} students`, `${course.studentIds.length} 名学生`)} · {text(`${course.chapterCount} chapters`, `${course.chapterCount} 章`)}
      </p></div><div className="flex flex-wrap gap-2">
        {!course.archived && <Button size="sm" variant="secondary" disabled={action.busy} onClick={event => { trigger.current = event.currentTarget; void run(async () => setEditor(await productionApi<PlatformCourse>(`platform/courses/${course.id}`))); }}>{text("Edit", "编辑")}</Button>}
        {!course.archived && <Button size="sm" variant="secondary" disabled={action.busy} onClick={() => void change(course, course.published ? "unpublish" : "publish")}>{course.published ? text("Withdraw", "下架") : text("Publish", "发布")}</Button>}
        <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => void change(course, course.archived ? "restore" : "archive")}>{course.archived ? text("Restore", "恢复") : text("Archive", "归档")}</Button>
      </div>
    </li>)}</ul>{!courses.data?.items.length && <p className="py-6 text-sm text-muted-foreground">{text("No platform courses yet. Create your first course.", "暂无平台课程，可新建第一门课程。")}</p>}</Loading>
  </div>;
}

"use client";

import { CourseSectionsEditor, ChapterSectionSelect } from "@/components/course-sections-editor";
import { parseCourseSections, validateChapterSections, orderCourseChapters, courseChapterNeighbor } from "@/components/course-sections";
import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useDirty } from "@/components/teacher/shared";
import { CourseProgrammingLanguageField } from "@/components/teacher/course-programming-language-field";
import { LessonContent } from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import { PlatformCourseAudience } from "./platform-course-audience";
import type { PlatformChapter, PlatformCourse } from "./platform-course-model";
import { useSchoolText } from "./school-ui";

export function PlatformCourseEditor({ course, onSaved, onClose }: {
  course: PlatformCourse; onSaved: (course: PlatformCourse) => void; onClose: () => void;
}) {
  const text = useSchoolText();
  const [draft, setDraft] = useState(course);
  const [selected, setSelected] = useState(0), [preview, setPreview] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const action = useMutation();
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(course);
  useDirty(dirty);
  const update = (patch: Partial<PlatformCourse>) => setDraft(value => ({ ...value, ...patch }));
  const chapter = draft.chapters[selected];
  function changeChapter(patch: Partial<PlatformChapter>) {
    update({ chapters: draft.chapters.map((value, index) => index === selected ? { ...value, ...patch } : value) });
  }
  function move(offset: -1 | 1) {
    const chapters = [...draft.chapters], next = courseChapterNeighbor(chapters, selected, offset);
    if (next < 0) return;
    [chapters[selected], chapters[next]] = [chapters[next], chapters[selected]];
    update({ chapters }); setSelected(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    await action.run(async () => {
      parseCourseSections(draft.sections ?? []);
      validateChapterSections(draft.sections, draft.chapters);
      const saved = await productionApi<PlatformCourse>(course.id ? `platform/courses/${course.id}` : "platform/courses", {
        method: course.id ? "PATCH" : "POST", body: {
          ...draft, chapters: orderCourseChapters(draft.sections, draft.chapters), requestId, expectedRevision: course.revision, sourceVersion: course.sourceVersion,
          schoolIds: draft.audienceScope === "schools" ? draft.schools.map(item => item.id) : [],
          studentIds: draft.audienceScope === "students" ? draft.students.map(item => item.id) : [],
        },
      });
      onSaved(saved);
    });
    saving.current = false;
  }
  return <form onSubmit={event => void save(event)} className="space-y-5" aria-busy={action.busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{course.id ? text("Edit platform course", "编辑平台课程") : text("Create platform course", "新建平台课程")}</h2>
      <div className="flex gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={() => {
        if (!dirty || window.confirm(text("Discard unsaved changes?", "放弃尚未保存的修改？"))) onClose();
      }}>{text("Back", "返回")}</Button><Button type="submit" disabled={action.busy}>{action.busy ? text("Saving…", "正在保存…") : text("Save course", "保存课程")}</Button></div>
    </div>
    <Feedback action={action}/>
    {course.published && <p className="text-xs text-muted-foreground">{text("Changes to a published course take effect when saved.", "已发布课程的修改保存后立即生效。")}</p>}
    <fieldset disabled={action.busy} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.65fr)]">
      <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <label className="grid gap-2 text-sm font-semibold">{text("Course title", "课程名称")}<input className={inputClass} required maxLength={200} value={draft.title} onChange={event => update({ title: event.target.value })}/></label>
        <label className="grid gap-2 text-sm font-semibold">{text("Description", "课程简介")}<textarea className={`${inputClass} h-24 py-2`} maxLength={4000} value={draft.description} onChange={event => update({ description: event.target.value })}/></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">{text("Category", "课程分类")}<input className={inputClass} required maxLength={100} value={draft.category} onChange={event => update({ category: event.target.value })}/></label>
          <label className="grid gap-2 text-sm font-semibold">{text("Displayed author", "显示作者")}<input className={inputClass} maxLength={200} value={draft.authorName} onChange={event => update({ authorName: event.target.value })}/></label></div>
        <CourseProgrammingLanguageField className={inputClass} value={draft.requiredLanguage} onChange={requiredLanguage => update({ requiredLanguage })}/>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4"><PlatformCourseAudience scope={draft.audienceScope} onScope={audienceScope => update({ audienceScope })}
        selected={draft.audienceScope === "schools" ? draft.schools : draft.students}
        onSelected={items => update(draft.audienceScope === "schools" ? { schools: items } : { students: items })}/></div>
    </fieldset>
    <CourseSectionsEditor sections={draft.sections ?? []} chapters={draft.chapters} onChange={sections => update({ sections })} disabled={action.busy}/>
    <fieldset disabled={action.busy} className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{text("Chapters", "课程章节")}</h3><Button type="button" size="sm" variant="secondary" disabled={draft.chapters.length >= 100} onClick={() => {
        update({ chapters: [...draft.chapters, { title: text("New chapter", "新章节"), content: "", sectionKey: chapter?.sectionKey ?? draft.sections?.[0]?.key ?? null }] }); setSelected(draft.chapters.length); setPreview(false);
      }}><Plus size={15}/>{text("Add chapter", "添加章节")}</Button></div>
      {!chapter ? <p className="text-sm text-muted-foreground">{text("Add a chapter to start writing.", "添加章节，开始编写课程。")}</p> : <>
        <label className="grid gap-2 text-sm">{text("Chapter directory", "章节目录")}<select className={inputClass} value={selected} onChange={event => setSelected(Number(event.target.value))}>{orderCourseChapters(draft.sections, draft.chapters).map((item, index) => <option key={item.id ?? index} value={draft.chapters.indexOf(item)}>{index + 1}. {item.title}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={courseChapterNeighbor(draft.chapters, selected, -1) < 0} onClick={() => move(-1)}><ArrowUp size={14}/>{text("Move up", "上移")}</Button><Button type="button" size="sm" variant="ghost" disabled={courseChapterNeighbor(draft.chapters, selected, 1) < 0} onClick={() => move(1)}><ArrowDown size={14}/>{text("Move down", "下移")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { if (window.confirm(text("Remove this chapter from the course?", "从课程中移除该章节？"))) { update({ chapters: draft.chapters.filter((_, index) => index !== selected) }); setSelected(Math.max(0, selected - 1)); } }}><Trash2 size={14}/>{text("Remove chapter", "移除章节")}</Button>
          <Button type="button" size="sm" variant="secondary" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? text("Edit content", "编辑正文") : text("Preview", "预览正文")}</Button></div>
        <label className="grid gap-2 text-sm font-semibold">{text("Chapter title", "章节标题")}<input className={inputClass} maxLength={200} required value={chapter.title} onChange={event => changeChapter({ title: event.target.value })}/></label>
        <ChapterSectionSelect sections={draft.sections ?? []} value={chapter.sectionKey} onChange={sectionKey => changeChapter({ sectionKey })} disabled={action.busy}/>
        {preview ? <div className="min-w-0 overflow-x-auto"><LessonContent content={chapter.content}/></div> : <label className="grid gap-2 text-sm font-semibold">{text("Chapter content (Markdown)", "章节正文（Markdown）")}<textarea className={`${inputClass} min-h-80 py-3 font-mono leading-6`} maxLength={100000} value={chapter.content} onChange={event => changeChapter({ content: event.target.value })}/></label>}
      </>}
    </fieldset>
  </form>;
}

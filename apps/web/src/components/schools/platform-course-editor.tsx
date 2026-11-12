"use client";

import { CourseSectionsEditor, ChapterSectionSelect } from "@/components/course-sections-editor";
import { parseCourseSections, validateChapterSections, orderCourseChapters, courseChapterNeighbor } from "@/components/course-sections";
import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useDirty } from "@/components/teacher/shared";
import { CourseProgrammingLanguageField } from "@/components/teacher/course-programming-language-field";
import { LearningChapterContent } from "@/components/student/learning-course-reader";
import { ChapterContentEditor, ChapterEditingLanguageControl } from "@/components/teacher/chapter-content-editor";
import { findOriginalLanguage, chapterEditorFields, type ChapterEditingLanguage, type ChapterEditorValue } from "@/components/teacher/chapter-editor-model";
import { useCourseLanguage } from "@/components/course-language";
import { localizedChapter, parseCourseLocalizations, parseChapterLocalizations, type CourseLanguage } from "@/components/course-localization";
import { courseAcslReferences, parseCourseAcslReferences } from "@/components/course-acsl";
import { CourseAcslEditor } from "@/components/teacher/course-acsl-editor";
import { productionApi } from "@/lib/production-api";
import { PlatformCourseAudience } from "./platform-course-audience";
import { activeAdmissionRules, courseAudiencePolicy, courseAudiencePolicyForSave } from "./platform-course-admission-model";
import { PlatformCourseDetailsEditor } from "./platform-course-details-editor";
import type { PlatformChapter, PlatformCourse } from "./platform-course-model";
import { useSchoolText } from "./school-ui";

function originalFields(chapter?: PlatformChapter) {
  return { title: chapter?.title ?? "", content: chapter?.content ?? "", objective: chapter?.objective ?? "", checkpoint: chapter?.checkpoint ?? "", checkpointAnswer: chapter?.checkpointAnswer ?? "" };
}

export function PlatformCourseEditor({ course, onSaved, onClose }: {
  course: PlatformCourse; onSaved: (course: PlatformCourse) => void; onClose: () => void;
}) {
  const text = useSchoolText();
  const { language, setLanguage } = useCourseLanguage();
  const [draft, setDraft] = useState(() => ({ ...course, audiencePolicy: courseAudiencePolicy(course) }));
  const [chapterKeys, setChapterKeys] = useState(() => course.chapters.map((chapter, index) => chapter.id ?? `initial-${index}`));
  const [originalLanguages, setOriginalLanguages] = useState(() => new Map<string, CourseLanguage | null>(course.chapters.map((chapter, index) => [chapter.id ?? `initial-${index}`, findOriginalLanguage(originalFields(chapter), chapter.localizations)])));
  const [editingSelection, setEditingSelection] = useState<{ key: string; language: ChapterEditingLanguage } | null>(null);
  const [selected, setSelected] = useState(0), [preview, setPreview] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const action = useMutation();
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...course, audiencePolicy: courseAudiencePolicy(course) });
  useDirty(dirty);
  const update = (patch: Partial<PlatformCourse>) => setDraft(value => ({ ...value, ...patch, audiencePolicy: patch.audiencePolicy ?? value.audiencePolicy }));
  const chapter = draft.chapters[selected];
  const chapterKey = chapterKeys[selected];
  const original = originalFields(chapter);
  const originalLanguage = originalLanguages.get(chapterKey) ?? null;
  const editingLanguage = editingSelection?.key === chapterKey ? editingSelection.language
    : chapter?.localizations?.en && chapter.localizations.zh ? language : originalLanguage ?? "original";
  const previewFields = chapterEditorFields(original, chapter?.localizations, editingLanguage) ?? original;
  const changeEditingLanguage = (next: ChapterEditingLanguage) => {
    setEditingSelection({ key: chapterKey, language: next });
    if (next !== "original") setLanguage(next);
  };
  const updateChapterContent = (value: ChapterEditorValue) => {
    if (originalLanguage && !value.localizations?.[originalLanguage]) setOriginalLanguages(previous => new Map(previous).set(chapterKey, null));
    changeChapter({ ...value.original, localizations: value.localizations });
  };
  function changeChapter(patch: Partial<PlatformChapter>) {
    update({ chapters: draft.chapters.map((value, index) => index === selected ? { ...value, ...patch } : value) });
  }
  function move(offset: -1 | 1) {
    const chapters = [...draft.chapters], next = courseChapterNeighbor(chapters, selected, offset);
    if (next < 0) return;
    [chapters[selected], chapters[next]] = [chapters[next], chapters[selected]];
    const keys = [...chapterKeys]; [keys[selected], keys[next]] = [keys[next], keys[selected]]; setChapterKeys(keys);
    update({ chapters }); setSelected(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    await action.run(async () => {
      parseCourseSections(draft.sections ?? []);
      validateChapterSections(draft.sections, draft.chapters);
      const policy = courseAudiencePolicyForSave(draft.audiencePolicy);
      if (!activeAdmissionRules(policy).length) throw new Error(text("Choose at least one course audience.", "请至少选择一项课程开放范围。"));
      if (activeAdmissionRules(policy).some(rule => !Number.isSafeInteger(rule.minimumPoints) || rule.minimumPoints < 0)) throw new Error(text("Minimum points must be a non-negative integer.", "最低积分须为不小于 0 的整数。"));
      const saved = await productionApi<PlatformCourse>(course.id ? `platform/courses/${course.id}` : "platform/courses", {
        method: course.id ? "PATCH" : "POST", body: {
          ...draft, localizations: parseCourseLocalizations(draft.localizations ?? {}),
          chapters: orderCourseChapters(draft.sections, draft.chapters).map(chapter => ({ ...chapter,
            localizations: parseChapterLocalizations(chapter.localizations ?? {}), acslLinks: parseCourseAcslReferences(courseAcslReferences(chapter.acslLinks)),
          })), requestId, expectedRevision: course.revision, sourceVersion: course.sourceVersion,
          audiencePolicy: policy, audienceScope: undefined, schoolIds: undefined, studentIds: undefined,
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
        <PlatformCourseDetailsEditor course={{ title: draft.title, description: draft.description, localizations: draft.localizations }} onChange={update} disabled={action.busy}/>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">{text("Category", "课程分类")}<input className={inputClass} required maxLength={100} value={draft.category} onChange={event => update({ category: event.target.value })}/></label>
          <label className="grid gap-2 text-sm font-semibold">{text("Displayed author", "显示作者")}<input className={inputClass} maxLength={200} value={draft.authorName} onChange={event => update({ authorName: event.target.value })}/></label></div>
        <CourseProgrammingLanguageField className={inputClass} value={draft.requiredLanguage} onChange={requiredLanguage => update({ requiredLanguage })}/>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4"><PlatformCourseAudience courseId={course.id} policy={draft.audiencePolicy}
        onChange={audiencePolicy => update({ audiencePolicy })} schools={draft.schools} accounts={draft.students}
        onSchools={schools => update({ schools })} onAccounts={students => update({ students })} disabled={action.busy} dirty={dirty}/></div>
    </fieldset>
    <CourseSectionsEditor sections={draft.sections ?? []} chapters={draft.chapters} onChange={sections => update({ sections })} disabled={action.busy}/>
    <fieldset disabled={action.busy} className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{text("Chapters", "课程章节")}</h3><Button type="button" size="sm" variant="secondary" disabled={draft.chapters.length >= 100} onClick={() => {
        update({ chapters: [...draft.chapters, { title: text("New chapter", "新章节"), content: "", sectionKey: chapter?.sectionKey ?? draft.sections?.[0]?.key ?? null }] }); setChapterKeys([...chapterKeys, crypto.randomUUID()]); setSelected(draft.chapters.length); setPreview(false);
      }}><Plus size={15}/>{text("Add chapter", "添加章节")}</Button></div>
      {!chapter ? <p className="text-sm text-muted-foreground">{text("Add a chapter to start writing.", "添加章节，开始编写课程。")}</p> : <>
        <label className="grid gap-2 text-sm">{text("Chapter directory", "章节目录")}<select className={inputClass} value={selected} onChange={event => setSelected(Number(event.target.value))}>{orderCourseChapters(draft.sections, draft.chapters).map((item, index) => <option key={item.id ?? index} value={draft.chapters.indexOf(item)}>{index + 1}. {localizedChapter(item, language).title}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={courseChapterNeighbor(draft.chapters, selected, -1) < 0} onClick={() => move(-1)}><ArrowUp size={14}/>{text("Move up", "上移")}</Button><Button type="button" size="sm" variant="ghost" disabled={courseChapterNeighbor(draft.chapters, selected, 1) < 0} onClick={() => move(1)}><ArrowDown size={14}/>{text("Move down", "下移")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { if (window.confirm(text("Remove this chapter from the course?", "从课程中移除该章节？"))) { update({ chapters: draft.chapters.filter((_, index) => index !== selected) }); setChapterKeys(chapterKeys.filter((_, index) => index !== selected)); setSelected(Math.max(0, selected - 1)); } }}><Trash2 size={14}/>{text("Remove chapter", "移除章节")}</Button>
          <Button type="button" size="sm" variant="secondary" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? text("Edit content", "编辑内容") : text("Student preview", "学生预览")}</Button></div>
        <ChapterSectionSelect sections={draft.sections ?? []} value={chapter.sectionKey} onChange={sectionKey => changeChapter({ sectionKey })} disabled={action.busy}/>
        {preview ? <div className="min-w-0 space-y-4">
          <ChapterEditingLanguageControl original={original} localizations={chapter.localizations} originalLanguage={originalLanguage} language={editingLanguage} onLanguageChange={changeEditingLanguage} disabled={action.busy} preview/>
          {editingLanguage !== "original" && !chapter.localizations?.[editingLanguage] && <p role="status" className="text-sm text-muted-foreground">{text("Translation unavailable; showing the original content.", "暂无此语言译文，显示原有内容。")}</p>}
          <LearningChapterContent chapter={previewFields} language={editingLanguage === "original" ? originalLanguage ?? undefined : editingLanguage}/>
        </div> : <ChapterContentEditor original={original} localizations={chapter.localizations} originalLanguage={originalLanguage} language={editingLanguage} onLanguageChange={changeEditingLanguage} onChange={updateChapterContent} disabled={action.busy}/>}
        <CourseAcslEditor platform links={chapter.acslLinks ?? []} onChange={acslLinks => changeChapter({ acslLinks })} disabled={action.busy}/>
      </>}
    </fieldset>
  </form>;
}

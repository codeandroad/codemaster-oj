"use client";

import type { CourseSection } from "@/components/course-sections";

import { useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Feedback, Loading, useData, useMutation } from "@/components/admin/common";
import { CourseAccessSummary, courseSourceName } from "@/components/course-access";
import type { CourseLocalizations, ChapterLocalizations } from "@/components/course-localization";
import { LearningCourseReader } from "@/components/student/learning-course-reader";
import { CoursePracticeReturn } from "@/components/student/course-practice-return";
import { CourseAcslPractice } from "@/components/student/course-acsl-practice";
import type { CourseAcslLink } from "@/components/course-acsl";
import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse } from "@/components/course-localization";
import { PlatformCourseAdmissionGate } from "./platform-course-admission-gate";
import type { LearnerAdmissionRule } from "./platform-course-admission-model";
import { AppLink } from "@/components/navigation";
import { useCourseProgressRefresh } from "@/components/student/course-progress-refresh";
import { LearningCourseList, LearningCourseRow, learningCourseTitleClass } from "@/components/student/learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "@/components/student/learning-course-search";
import { courseSearchHref, filterCourseCatalog } from "@/components/student/learning-course-search-model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi, type SubmissionLanguage } from "@/lib/production-api";
import { useSchoolError, useSchoolText } from "./school-ui";

export type PublicCourseEntry = {
  id: string;
  title: string;
  description: string;
  localizations?: CourseLocalizations;
  sections?: CourseSection[];
  chapterCount: number;
  completedChapters?: number;
  totalExercises?: number;
  completedExercises?: number;
  category?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  coverKey?: string;
  ownerScope?: "school" | "platform";
  sourceSchool?: string;
  revision: number;
  accessScope?: "school" | "classes";
  admission: "direct" | "apply" | "pending" | "rejected" | "invite" | "requirements" | "denied";
  admissionRules?: LearnerAdmissionRule[];
};

type CourseDetail = {
  id: string;
  title: string;
  description: string;
  requiredLanguage?: SubmissionLanguage | null;
  localizations?: CourseLocalizations;
  sections?: CourseSection[];
  revision: number;
  ownerScope?: "school" | "platform";
  sourceSchool?: string;
  authorName?: string;
  authoredAt?: string;
  totalExercises: number;
  completedExercises: number;
  chapters: {
    id: string;
    title: string;
    body: string;
    objective?: string;
    checkpoint?: string;
    checkpointAnswer?: string;
    acslLinks?: CourseAcslLink[];
    localizations?: ChapterLocalizations;
    sectionKey?: string | null;
    read: boolean;
    problems: { problemId: string; versionId: string; title: string; solved: boolean }[];
  }[];
  completedChapters: number;
  canTrackProgress: boolean;
};

export function courseAdmissionLabel(admission: PublicCourseEntry["admission"], text: ReturnType<typeof useSchoolText>, chapterCount?: number) {
  const labels: Record<PublicCourseEntry["admission"], [string, string]> = {
    pending: ["Awaiting review", "待审核"],
    rejected: ["Application declined", "申请未通过"],
    apply: ["Application required", "需申请"],
    invite: ["Invitation required", "需邀请码"],
    requirements: ["Learning requirements not met", "尚未达到学习门槛"],
    denied: ["Not eligible", "不符合开放范围"],
    direct: ["Open for study", "可直接学习"],
  };
  const label = text(...labels[admission]);
  return chapterCount === undefined ? label : `${label} · ${text(`${chapterCount} chapters`, `${chapterCount} 章`)}`;
}

export function useCourseAdmissionDialog(detailHref: (id: string) => string, reload: () => void) {
  const router = useRouter();
  const action = useMutation();
  const [selected, setSelected] = useState<PublicCourseEntry | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const opening = useRef(false);

  async function openCourse(event: MouseEvent<HTMLButtonElement>, id: string) {
    if (opening.current) return;
    opening.current = true;
    trigger.current = event.currentTarget;
    await action.run(async () => {
      const entry = await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(id)}/entry`);
      if (entry.admission === "direct") router.push(detailHref(id));
      else setSelected(entry);
    });
    opening.current = false;
  }

  return { busy: action.busy, openCourse, feedback: <Feedback action={action}/>,
    dialog: selected && <CourseAdmissionDialog entry={selected} onUpdated={entry => {
      if (entry.admission === "direct") {
        setSelected(null);
        router.push(detailHref(entry.id));
      } else setSelected(entry);
      reload();
    }} onClose={() => setSelected(null)} returnFocus={() => trigger.current?.focus()}/> };
}

export function PublicCourseCatalog({ courseHref, showSearch = true }: { courseHref: (id: string) => string; showSearch?: boolean }) {
  const text = useSchoolText();
  const { language } = useCourseLanguage();
  const catalog = useData<{ courses: PublicCourseEntry[] }>("practice/catalog");
  useCourseProgressRefresh(catalog);
  const [catalogQuery, setQuery] = useCourseCatalogQuery();
  const query = showSearch ? catalogQuery : "";
  const courses = filterCourseCatalog((catalog.data?.courses ?? []).map(course => localizedCourse(course, language)), query);
  const detailHref = (id: string) => courseSearchHref(courseHref(id), query);
  const { busy, openCourse, feedback, dialog } = useCourseAdmissionDialog(detailHref, catalog.reload);

  return <div className="space-y-3">
    {showSearch && <CourseCatalogSearch query={query} onSearch={setQuery}/>}
    {feedback}
    <Loading resource={catalog}>
      <LearningCourseList empty={!courses.length ? (query
        ? text("No courses match this search.", "没有符合搜索条件的课程。")
        : text("No public courses yet.", "暂无公开课程。")) : undefined}>
        {courses.map(course => {
          const title = course.admission === "direct"
            ? <AppLink href={detailHref(course.id)} className={learningCourseTitleClass}>{course.title}</AppLink>
            : <button type="button" className={learningCourseTitleClass} disabled={busy}
                onClick={event => void openCourse(event, course.id)}>{course.title}</button>;
          const reading = course.admission === "direct" && course.completedChapters !== undefined
            ? { value: course.completedChapters, total: course.chapterCount }
            : undefined;
          return <LearningCourseRow key={course.id} course={course} title={title} source={courseSourceName(course)}
            status={courseAdmissionLabel(course.admission, text, reading ? undefined : course.chapterCount)} reading={reading}
            practice={course.admission === "direct" && course.totalExercises !== undefined ? { value: course.completedExercises ?? 0, total: course.totalExercises } : undefined} />;
        })}
      </LearningCourseList>
    </Loading>
    {dialog}
  </div>;
}

type AdmissionDialogProps = {
  entry: PublicCourseEntry;
  onUpdated: (entry: PublicCourseEntry) => void;
  onClose: () => void;
  returnFocus?: () => void;
};
function CourseAdmissionDialog(props: AdmissionDialogProps) {
  return props.entry.ownerScope === "platform" ? <PlatformCourseAdmissionGate {...props}/> : <SchoolCourseAdmissionDialog {...props}/>;
}

function SchoolCourseAdmissionDialog({ entry, onUpdated, onClose, returnFocus }: AdmissionDialogProps) {
  const text = useSchoolText();
  const action = useMutation();
  const submitting = useRef(false);
  const source = courseSourceName(entry);
  const description = entry.admission === "pending"
    ? text("The school is reviewing your application.", "学校正在审核你的申请。")
    : entry.admission === "rejected"
      ? text("The school declined your application for this course.", "学校未批准你加入这门课程。")
      : entry.accessScope === "classes"
        ? text("Students in the eligible classes can enter directly. You can apply to study this course.", "指定班级的学生可以直接进入。你可以申请加入这门课程。")
        : text("Students with school access can enter directly. You can apply to study this course.", "具备校内权限的学生可以直接进入。你可以申请加入这门课程。");

  async function apply() {
    if (submitting.current) return;
    submitting.current = true;
    await action.run(async () => {
      const updated = await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(entry.id)}/applications`, {
        method: "POST",
        body: { expectedRevision: entry.revision },
      });
      onUpdated(updated);
    });
    submitting.current = false;
  }

  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
      if (!returnFocus) return;
      event.preventDefault();
      returnFocus();
    }}>
      <DialogTitle className="pr-7">{entry.title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {entry.description && <p className="whitespace-pre-wrap break-words text-sm">{entry.description}</p>}
      {source && <p className="text-xs text-muted-foreground">{source}</p>}
      <Feedback action={action}/>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={action.busy}>{text("Close", "关闭")}</Button>
        {entry.admission === "apply" && <Button disabled={action.busy} onClick={() => void apply()}>{action.busy ? text("Submitting…", "正在提交…") : text("Apply to join", "申请加入")}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

export function PublicCoursePage({ id, homeHref }: { id: string; homeHref: string }) {
  const router = useRouter();
  const schoolId = useSearchParams().get("schoolId");
  const entry = useData<PublicCourseEntry>(`practice/courses/${encodeURIComponent(id)}/entry`);
  const [updated, setUpdated] = useState<PublicCourseEntry | null>(null);
  const course = updated ?? entry.data;
  const [query] = useCourseCatalogQuery();
  const catalogHref = courseSearchHref(homeHref, query);
  return <>
    <Loading resource={entry}>
      {course?.admission === "direct" ? <CourseReader key={`${id}:${schoolId ?? "legacy"}`} id={id} courseQuery={query}/>
        : course && <CourseAdmissionDialog entry={course} onUpdated={setUpdated} onClose={() => router.replace(catalogHref)}/>}
    </Loading>
  </>;
}

function CourseReader({ id, courseQuery }: { id: string; courseQuery: string }) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const location = useSearchParams(), pathname = usePathname();
  const { language } = useCourseLanguage();
  const schoolId = location.get("schoolId") ?? "00000000-0000-4000-8000-000000000052";
  const schoolQuery = location.has("schoolId") ? `?${new URLSearchParams({ schoolId })}` : "";
  const course = useData<CourseDetail>(`practice/courses/${encodeURIComponent(id)}${schoolQuery}`);
  useCourseProgressRefresh(course);
  const chapterHref = (chapterId: string) => {
    const query = new URLSearchParams(location.toString());
    query.set("chapterId", chapterId);
    return `${pathname}?${query}`;
  };
  return <Loading resource={course}>{course.data && <LearningCourseReader
    course={{ ...course.data, chapterCount: course.data.chapters.length, taskCount: course.data.totalExercises,
      completedTasks: course.data.completedExercises }}
    chapters={course.data.chapters.map(chapter => ({
      id: chapter.id, title: chapter.title, sectionKey: chapter.sectionKey, content: chapter.body,
      objective: chapter.objective, checkpoint: chapter.checkpoint, checkpointAnswer: chapter.checkpointAnswer,
      localizations: chapter.localizations, completed: chapter.read,
      problems: chapter.problems.map(problem => ({ id: problem.problemId, title: problem.title, completed: problem.solved,
        href: `/practice/problems?${new URLSearchParams({ problemId: problem.problemId, versionId: problem.versionId,
          publicCourseId: id, publicChapterId: chapter.id, ...(courseQuery && { courseQ: courseQuery }) })}`,
      })),
    }))}
    selectedChapterId={location.get("chapterId")} chapterHref={chapterHref} scrollKey={`public:${id}`}
    metadata={<CourseAccessSummary course={course.data} showAuthor
      accessLabel={[text("Public course", "公开课程"), courseSourceName(course.data)].filter(Boolean).join(" · ")}/>}
    relatedActivities={course.data.ownerScope === "platform" ? <CoursePracticeReturn schoolId={schoolId}/> : undefined}
    extraPractice={chapterId => {
      if (course.data?.ownerScope !== "platform") return null;
      const links = course.data.chapters.find(chapter => chapter.id === chapterId)?.acslLinks ?? [];
      return links.length ? <CourseAcslPractice links={links} schoolId={schoolId} legacy={schoolId === "00000000-0000-4000-8000-000000000052"}
        courseHref={courseLanguageHref(`/practice/courses/${encodeURIComponent(id)}?${new URLSearchParams({ schoolId, chapterId })}`, language)}/> : null;
    }}
    canTrackProgress={course.data.canTrackProgress}
    onRead={async chapterId => {
      try {
        await productionApi(`practice/courses/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/read${schoolQuery}`, {
          method: "POST", body: { read: true, expectedRevision: course.data!.revision },
        });
        course.reload();
      } catch (error) { throw localError(error); }
    }}
  />}</Loading>;
}

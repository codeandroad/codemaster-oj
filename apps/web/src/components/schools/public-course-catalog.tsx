"use client";

import { useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Feedback, Loading, useData, useMutation } from "@/components/admin/common";
import { CourseAccessSummary, courseSourceName } from "@/components/course-access";
import type { CourseLocalizations, ChapterLocalizations } from "@/components/course-localization";
import { LearningCourseReader } from "@/components/student/learning-course-reader";
import { AppLink } from "@/components/navigation";
import { useCourseProgressRefresh } from "@/components/student/course-progress-refresh";
import { LearningCourseList, LearningCourseRow, learningCourseTitleClass } from "@/components/student/learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "@/components/student/learning-course-search";
import { courseSearchHref, filterCourseCatalog } from "@/components/student/learning-course-search-model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi, type SubmissionLanguage } from "@/lib/production-api";
import { useSchoolError, useSchoolText } from "./school-ui";

type PublicCourseEntry = {
  id: string;
  title: string;
  description: string;
  localizations?: CourseLocalizations;
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
  admission: "direct" | "apply" | "pending" | "rejected";
};

type CourseDetail = {
  id: string;
  title: string;
  description: string;
  requiredLanguage?: SubmissionLanguage | null;
  localizations?: CourseLocalizations;
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
    localizations?: ChapterLocalizations;
    read: boolean;
    problems: { problemId: string; versionId: string; title: string; solved: boolean }[];
  }[];
  completedChapters: number;
  canTrackProgress: boolean;
};

export function PublicCourseCatalog({ courseHref, showSearch = true }: { courseHref: (id: string) => string; showSearch?: boolean }) {
  const text = useSchoolText();
  const router = useRouter();
  const catalog = useData<{ courses: PublicCourseEntry[] }>("practice/catalog");
  useCourseProgressRefresh(catalog);
  const [catalogQuery, setQuery] = useCourseCatalogQuery();
  const query = showSearch ? catalogQuery : "";
  const courses = filterCourseCatalog(catalog.data?.courses ?? [], query);
  const detailHref = (id: string) => courseSearchHref(courseHref(id), query);
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

  return <div className="space-y-3">
    {showSearch && <CourseCatalogSearch query={query} onSearch={setQuery}/>}
    <Feedback action={action}/>
    <Loading resource={catalog}>
      <LearningCourseList empty={!courses.length ? (query
        ? text("No courses match this search.", "没有符合搜索条件的课程。")
        : text("No public courses yet.", "暂无公开课程。")) : undefined}>
        {courses.map(course => {
          const admission = course.admission === "pending" ? text("Awaiting review", "待审核")
            : course.admission === "rejected" ? text("Application declined", "申请未通过")
              : course.admission === "apply" ? text("Application required", "需申请")
                : text("Open for study", "可直接学习");
          const title = course.admission === "direct"
            ? <AppLink href={detailHref(course.id)} className={learningCourseTitleClass}>{course.title}</AppLink>
            : <button type="button" className={learningCourseTitleClass} disabled={action.busy}
                onClick={event => void openCourse(event, course.id)}>{course.title}</button>;
          const reading = course.admission === "direct" && course.completedChapters !== undefined
            ? { value: course.completedChapters, total: course.chapterCount }
            : undefined;
          const chapterLabel = text(`${course.chapterCount} chapters`, `${course.chapterCount} 章`);
          return <LearningCourseRow key={course.id} course={course} title={title} source={courseSourceName(course)}
            status={reading ? admission : `${admission} · ${chapterLabel}`} reading={reading}
            practice={course.admission === "direct" && course.totalExercises !== undefined ? { value: course.completedExercises ?? 0, total: course.totalExercises } : undefined} />;
        })}
      </LearningCourseList>
    </Loading>
    {selected && <CourseAdmissionDialog entry={selected} onUpdated={entry => {
      if (entry.admission === "direct") {
        setSelected(null);
        router.push(detailHref(entry.id));
      } else setSelected(entry);
      catalog.reload();
    }} onClose={() => setSelected(null)} returnFocus={() => trigger.current?.focus()}/>}
  </div>;
}

function CourseAdmissionDialog({ entry, onUpdated, onClose, returnFocus }: {
  entry: PublicCourseEntry;
  onUpdated: (entry: PublicCourseEntry) => void;
  onClose: () => void;
  returnFocus?: () => void;
}) {
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
  const entry = useData<PublicCourseEntry>(`practice/courses/${encodeURIComponent(id)}/entry`);
  const [updated, setUpdated] = useState<PublicCourseEntry | null>(null);
  const course = updated ?? entry.data;
  const [query] = useCourseCatalogQuery();
  const catalogHref = courseSearchHref(homeHref, query);
  return <>
    <Loading resource={entry}>
      {course?.admission === "direct" ? <CourseReader id={id} courseQuery={query}/>
        : course && <CourseAdmissionDialog entry={course} onUpdated={setUpdated} onClose={() => router.replace(catalogHref)}/>}
    </Loading>
  </>;
}

function CourseReader({ id, courseQuery }: { id: string; courseQuery: string }) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const course = useData<CourseDetail>(`practice/courses/${encodeURIComponent(id)}`);
  useCourseProgressRefresh(course);
  const location = useSearchParams(), pathname = usePathname();
  const chapterHref = (chapterId: string) => {
    const query = new URLSearchParams(location.toString());
    query.set("chapterId", chapterId);
    return `${pathname}?${query}`;
  };
  return <Loading resource={course}>{course.data && <LearningCourseReader
    course={{ ...course.data, chapterCount: course.data.chapters.length, taskCount: course.data.totalExercises,
      completedTasks: course.data.completedExercises }}
    chapters={course.data.chapters.map(chapter => ({
      id: chapter.id, title: chapter.title, content: chapter.body, localizations: chapter.localizations, completed: chapter.read,
      problems: chapter.problems.map(problem => ({ id: problem.problemId, title: problem.title, completed: problem.solved,
        href: `/practice/problems?${new URLSearchParams({ problemId: problem.problemId, versionId: problem.versionId,
          publicCourseId: id, publicChapterId: chapter.id, ...(courseQuery && { courseQ: courseQuery }) })}`,
      })),
    }))}
    selectedChapterId={location.get("chapterId")} chapterHref={chapterHref} scrollKey={`public:${id}`}
    metadata={<CourseAccessSummary course={course.data} showAuthor
      accessLabel={[text("Public course", "公开课程"), courseSourceName(course.data)].filter(Boolean).join(" · ")}/>}
    canTrackProgress={course.data.canTrackProgress}
    onRead={async chapterId => {
      try {
        await productionApi(`practice/courses/${encodeURIComponent(id)}/chapters/${encodeURIComponent(chapterId)}/read`, {
          method: "POST", body: { read: true, expectedRevision: course.data!.revision },
        });
        course.reload();
      } catch (error) { throw localError(error); }
    }}
  />}</Loading>;
}

"use client";

import { CourseAdmissionDialog, courseAdmissionLabel, useCourseAdmissionDialog, type PublicCourseEntry } from "./course-admission";
export { courseAdmissionLabel, useCourseAdmissionDialog, type PublicCourseEntry } from "./course-admission";

import type { CourseSection } from "@/components/course-sections";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loading, useData } from "@/components/admin/common";
import { CourseAccessSummary, courseSourceName } from "@/components/course-access";
import type { CourseLocalizations, ChapterLocalizations } from "@/components/course-localization";
import { LearningCourseReader } from "@/components/student/learning-course-reader";
import { CoursePracticeReturn } from "@/components/student/course-practice-return";
import { CourseAcslPractice } from "@/components/student/course-acsl-practice";
import type { CourseAcslLink } from "@/components/course-acsl";
import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse } from "@/components/course-localization";
import { AppLink } from "@/components/navigation";
import { useCourseProgressRefresh } from "@/components/student/course-progress-refresh";
import { LearningCourseList, LearningCourseRow, learningCourseTitleClass } from "@/components/student/learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "@/components/student/learning-course-search";
import { courseSearchHref, filterCourseCatalog } from "@/components/student/learning-course-search-model";
import { productionApi, type SubmissionLanguage } from "@/lib/production-api";
import { useSchoolError, useSchoolText } from "./school-ui";

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

export function PublicCourseCatalog({ courseHref, showSearch = true }: { courseHref: (id: string) => string; showSearch?: boolean }) {
  const text = useSchoolText();
  const { language } = useCourseLanguage();
  const catalog = useData<{ courses: PublicCourseEntry[] }>("practice/courses");
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

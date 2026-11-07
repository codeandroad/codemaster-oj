"use client";

import type { ReactNode } from "react";
import { LearningCover, courseDifficulties } from "@/components/learning-course";
import { useLocale } from "@/components/locale-context";

export const learningCourseTitleClass = "text-left text-primary hover:underline focus-visible:underline";

type CourseSummary = {
  coverKey?: string;
  coverImage?: string | null;
  category?: string;
  difficulty?: keyof typeof courseDifficulties;
  description: string;
};

type ProgressCount = { value: number; total: number };

export function LearningCourseList({ children, empty }: { children: ReactNode; empty?: string }) {
  return <ul className="divide-y divide-border border border-border bg-surface panel-shadow">
    {empty ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</li> : children}
  </ul>;
}

export function LearningCourseRow({ course, title, source, status, reading, practice }: {
  course: CourseSummary;
  title: ReactNode;
  source?: string;
  status?: string;
  reading?: ProgressCount;
  practice?: ProgressCount;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const difficulty = course.difficulty && (locale === "en"
    ? { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" }[course.difficulty]
    : courseDifficulties[course.difficulty]);
  const metadata = [source, course.category, difficulty].filter(Boolean).join(" · ");
  return <li className="grid min-w-0 gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-surface-subtle sm:grid-cols-[88px_minmax(0,1fr)] lg:grid-cols-[88px_minmax(0,1fr)_240px] lg:items-center">
    <div aria-hidden="true" className="hidden h-[50px] w-[88px] overflow-hidden rounded border border-border bg-surface-subtle sm:block">
      <LearningCover coverKey={course.coverKey} coverImage={course.coverImage} />
    </div>
    <div className="min-w-0">
      {metadata && <p className="text-xs text-muted-foreground">{metadata}</p>}
      <h2 className="mt-1 break-words text-base font-semibold">{title}</h2>
      {course.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground lg:line-clamp-1">{course.description}</p>}
    </div>
    <div className="min-w-0 space-y-2 sm:col-start-2 lg:col-auto">
      {status && <p className="text-xs font-medium text-muted-foreground lg:text-right">{status}</p>}
      {(reading || practice) && <div className={practice ? "grid grid-cols-2 gap-3" : undefined}
        role="group" aria-label={text("课程进度", "Course progress")}>
        {reading && <CourseProgress label={text("章节阅读", "Chapters read")} empty={text("暂无章节", "No chapters")} count={reading} />}
        {practice && <CourseProgress label={text("练习完成", "Practice completed")} empty={text("暂无练习", "No practice")} count={practice} />}
      </div>}
    </div>
  </li>;
}

function CourseProgress({ label, empty, count }: { label: string; empty: string; count: ProgressCount }) {
  return <div className="min-w-0 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 font-medium">{count.total ? `${count.value}/${count.total}` : empty}</span>
    </div>
    {count.total > 0 && <progress aria-label={label} max={count.total} value={Math.min(count.value, count.total)} className="mt-2 h-1.5 w-full accent-primary" />}
  </div>;
}

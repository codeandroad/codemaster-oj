"use client";

import { BookOpen, ArrowRight } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { CourseLanguageControl, useCourseLanguage } from "@/components/course-language";
import { localizedCourse } from "@/components/course-localization";
import { acslLearningHref } from "@/components/course-acsl-navigation";
import { AppLink } from "@/components/navigation";
import { buttonVariants } from "@/components/ui/button";
import type { AcslLearningCourse } from "./model";

/** These courses span seasons; paper filters intentionally do not apply here. */
export function AcslCatalogLearningCourses({ courses, catalogHref, schoolId }: {
  courses: AcslLearningCourse[]; catalogHref: string; schoolId: string;
}) {
  const { locale } = useLocale(), { language, setLanguage } = useCourseLanguage();
  const tx = (en: string, zh: string) => locale === "en" ? en : zh;
  const available = courses.flatMap(course => {
    const href = acslLearningHref(course.href, catalogHref, schoolId, language);
    return course.ownerScope === "platform" && href ? [{ ...localizedCourse(course, language), href }] : [];
  });
  if (!available.length) return null;
  return <section aria-labelledby="acsl-learning-title" className="space-y-3" data-od-id="acsl-learning-courses">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="acsl-learning-title" className="flex items-center gap-2 font-semibold"><BookOpen size={18} aria-hidden="true"/>{tx("Topic learning", "专题学习")}</h2>
      <CourseLanguageControl language={language} onChange={setLanguage}/>
    </div>
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">
      {available.map(course => <article key={course.courseId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center" data-od-id="acsl-learning-course" data-course-id={course.courseId}>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{tx("CodeMaster · Published by the platform", "CodeMaster · 平台发布")}</p>
          <h3 className="break-words font-semibold"><AppLink href={course.href} className="hover:text-primary hover:underline focus-visible:underline">{course.title}</AppLink></h3>
          {course.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{course.description}</p>}
          <div className="mt-3 grid max-w-lg gap-3 sm:grid-cols-2">
            <CourseProgress label={tx("Chapters read", "已读章节")} value={course.completedChapters} total={course.chapterCount}/>
            {course.totalExercises > 0 && <CourseProgress label={tx("Practice completed", "完成练习")} value={course.completedExercises} total={course.totalExercises}/>}
          </div>
        </div>
        <AppLink href={course.href} className={buttonVariants({ variant: "secondary", size: "sm" })} data-od-id="acsl-learning-open">
          {course.completedChapters || course.completedExercises ? tx("Continue learning", "继续学习") : tx("Start learning", "开始学习")}<ArrowRight size={14} aria-hidden="true"/>
        </AppLink>
      </article>)}
    </div>
  </section>;
}

function CourseProgress({ label, value, total }: { label: string; value: number; total: number }) {
  return <div className="min-w-0">
    <p className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{label}</span><span className="tabular-nums">{value}/{total}</span></p>
    <progress aria-label={label} value={value} max={Math.max(1, total)} className="mt-1 block h-1.5 w-full overflow-hidden rounded-full accent-primary"/>
  </div>;
}

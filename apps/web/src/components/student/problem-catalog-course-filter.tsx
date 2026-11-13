"use client";

import { useLocale } from "@/components/locale-context";
import { input } from "./shared";
import styles from "./problems-page.module.css";

type CourseOption = { id: string; title: string; localizations?: Partial<Record<"en" | "zh", { title: string }>> };

export type ProblemCatalogResult<T> = {
  items: T[];
  courseId?: string | null;
  courses?: CourseOption[];
};

export const problemCourseFilterKey = "problemCourse";
export const publicProblemCourseFilterKey = "publicProblemCourse";

export function ProblemCatalogCourseFilter({ courses, value, onChange }: {
  courses?: CourseOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { locale } = useLocale();
  const label = locale === "zh" ? "关联课程" : "Linked course";
  const options = (courses ?? []).map(course => ({
    id: course.id,
    title: course.localizations?.[locale]?.title || course.title,
  })).sort((a, b) => a.title.localeCompare(b.title, locale));
  return <select
    aria-label={label}
    title={label}
    className={`${styles.courseFilter} ${input} !w-auto max-w-56 sm:max-w-64 !h-[34px] max-md:!h-11`}
    value={value}
    onChange={event => onChange(event.currentTarget.value)}
    data-od-id="problem-catalog-course-filter"
  >
    <option value="">{locale === "zh" ? "全部课程" : "All courses"}</option>
    {value && !options.some(course => course.id === value) &&
      <option value={value} disabled>{courses
        ? locale === "zh" ? "所选课程暂不可用" : "Selected course unavailable"
        : locale === "zh" ? "所选课程" : "Selected course"}</option>}
    {options.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
  </select>;
}

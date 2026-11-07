"use client";
import { useSchoolText } from "./school-ui";
import type { SchoolCourse } from "./school-courses-model";
export function SchoolCourseMeta({ course }: { course: SchoolCourse }) {
  const text = useSchoolText();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        {course.accessScope === "school"
          ? text("School-wide", "全校可见")
          : text("Selected classes", "指定班级")}
      </span>
      <span>{course.category}</span>
      {course.authorName && (
        <span>
          {text("Author: ", "作者：")}
          {course.authorName}
        </span>
      )}
      <span>
        {text(
          `${course.estimatedMinutes} min`,
          `${course.estimatedMinutes} 分钟`,
        )}
      </span>
    </div>
  );
}

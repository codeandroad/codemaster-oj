import { ApiError } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

export type CourseChapter = {
  id: string;
  title: string;
  body: string;
  read?: boolean;
  problems?: CourseProblem[];
};
export type CourseProblem = {
  problemId: string;
  versionId: string;
  title?: string;
  available?: boolean;
  solved?: boolean;
};
export type CourseProperties = {
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  coverKey: "python" | "algorithms" | "general";
  coverImage: string | null;
  estimatedMinutes: number;
  authorName: string;
  authoredAt: string | null;
};
export type SchoolCourse = CourseProperties & {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "unpublished";
  revision: number;
  publishedRevision: number | null;
  hasUnpublishedChanges: boolean;
  chapterCount: number;
  completedChapters: number;
  canManage: boolean;
  archived: boolean;
  accessScope: "school" | "classes";
  completedExercises: number;
  totalExercises: number;
};
export type CourseDetail = SchoolCourse & {
  chapters: CourseChapter[];
  accessScope: "school" | "classes";
  classIds: string[];
  canTrackProgress: boolean;
  isPreview?: boolean;
};
export type CourseInput = CourseProperties &
  Pick<
    CourseDetail,
    "title" | "description" | "accessScope" | "classIds" | "chapters"
  >;
export type CoursePage<T> = { items: T[]; page: number; hasMore: boolean };

export function useCourseError(editing = false) {
  const text = useSchoolText();
  return (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === "COURSE_PROBLEM_UNAVAILABLE")
        return new Error(
          text(
            "A linked practice version is no longer published. Update the chapter's practice selection before saving or publishing.",
            "关联练习版本已下架或发生变化，请先更新章节配套练习再保存或发布。",
          ),
        );
      if (error.status === 409)
        return new Error(
          editing
            ? text(
                "This course has changed. Your edits are still here. Review the latest course before trying again.",
                "课程已发生变化。当前修改仍保留，请核对最新课程后重试。",
              )
            : text(
                "This course has changed. Refresh it before trying again.",
                "课程已发生变化，请刷新后重试。",
              ),
        );
      if (error.status === 401)
        return new Error(
          text(
            "Your session has expired. Sign in again.",
            "登录已过期，请重新登录。",
          ),
        );
      if (error.status === 403 || error.status === 404)
        return new Error(
          text(
            "This course or class is no longer available to you. Refresh the school workspace.",
            "你已无法访问此课程或班级，请刷新学校工作区。",
          ),
        );
      if (error.status === 400)
        return new Error(
          text(
            "Check the course details, chapter content and selected classes before trying again.",
            "请核对课程信息、章节正文及所选班级后重试。",
          ),
        );
    }
    return new Error(
      text(
        "The request could not be completed. Check your connection and retry.",
        "操作未能完成，请检查网络后重试。",
      ),
    );
  };
}

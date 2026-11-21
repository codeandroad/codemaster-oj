"use client";

import { useData } from "@/components/student/shared";
import { StudentDashboardView } from "@/components/student/dashboard-view";
import type { CampusUser } from "@/lib/production-api";
import { useSchoolText, type School } from "./school-ui";
import type { CourseDetail, CoursePage, SchoolCourse } from "./school-courses-model";
import type { SchoolActivity } from "./school-activities-model";

export type SchoolSubmission = {
  id: string;
  problemId: string;
  problemTitle: string;
  language: string;
  state: string;
  createdAt: string;
  status: string;
  score: number | null;
};
type SubmissionPage = {
  items: SchoolSubmission[];
  page: number;
  hasMore: boolean;
};

export function SchoolStudentDashboard({ school, user }: { school: School; user: CampusUser }) {
  const text = useSchoolText();
  const base = `schools/${school.id}`;
  const href = (section: string, detail: Record<string, string> = {}) =>
    `/schools?${new URLSearchParams({ schoolId: school.id, section, ...detail })}`;
  const assignments = useData<{ items: SchoolActivity[] }>(`${base}/activities?kind=assignment`);
  const submissions = useData<SubmissionPage>(`${base}/submissions`);
  const courses = useData<CoursePage<SchoolCourse>>(`${base}/courses`);

  const assignmentItems = assignments.data?.items ?? [];
  const deadline = (activity: SchoolActivity) => activity.endsAt ? Date.parse(activity.endsAt) : Infinity;
  const assignment = assignmentItems.filter(item => item.phase === "Open")
    .sort((a, b) => deadline(a) - deadline(b))[0] ?? assignmentItems[0];
  const next = assignment?.problems.find(problem => !assignment.grade?.items.find(item => item.id === problem.id)?.solved);
  const path = courses.data?.items.find(item => item.completedChapters < item.chapterCount) ?? courses.data?.items[0];
  const pathDetail = useData<CourseDetail>(path ? `${base}/courses/${path.id}` : "");

  return <StudentDashboardView
    heading={text(`Hello, ${user.name}`, `你好，${user.name}`)}
    assignmentState={assignments}
    assignment={assignment ? {
      title: assignment.title,
      href: href("assignments", { activityId: assignment.id }),
      continueHref: next && assignment.phase !== "Upcoming"
        ? href("assignments", { activityId: assignment.id, problemId: next.id })
        : undefined,
      dueAt: assignment.endsAt,
      solved: assignment.grade?.solved ?? 0,
      attempted: assignment.grade?.items.filter(item => item.activityAttempts > 0).length ?? 0,
      count: assignment.problems.length,
      score: assignment.grade?.score ?? null,
      maxScore: assignment.grade?.total ?? assignment.problems.reduce((sum, problem) => sum + problem.points, 0),
    } : undefined}
    courseState={courses}
    coursesHref={href("courses")}
    course={path ? {
      title: path.title,
      href: href("courses", { courseId: path.id }),
      completedChapters: path.completedChapters,
      chapterCount: path.chapterCount,
      chapters: pathDetail.data?.id === path.id ? pathDetail.data.chapters.map(chapter => ({
        title: chapter.title,
        href: href("courses", { courseId: path.id, chapterId: chapter.id }),
        completed: Boolean(chapter.read),
      })) : [],
    } : undefined}
    submissionsState={submissions}
    submissionsHref={href("submissions")}
    submissions={(submissions.data?.items ?? []).map(submission => ({
      id: submission.id,
      problemId: submission.problemId,
      title: submission.problemTitle,
      href: href("submissions", { submissionId: submission.id }),
      status: submission.status,
      score: submission.score,
    }))}
  />;
}

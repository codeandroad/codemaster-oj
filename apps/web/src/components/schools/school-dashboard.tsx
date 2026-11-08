"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AppLink as Link } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/page-chrome";
import { useLocale } from "@/components/locale-context";
import { date, State, useData } from "@/components/student/shared";
import { StudentDashboardView } from "@/components/student/dashboard-view";
import type { CampusUser } from "@/lib/production-api";
import { useSchoolText, type School } from "./school-ui";
import type { CourseDetail, CoursePage, SchoolCourse } from "./school-courses-model";
import type { SchoolActivity } from "./school-activities-model";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { SchoolSubmissionDetail } from "./school-submission-detail";

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
const panel = "overflow-hidden rounded-lg border border-border bg-surface";

export function SchoolStudentDashboard({ school, user }: { school: School; user: CampusUser }) {
  const text = useSchoolText();
  const base = `schools/${school.id}`;
  const href = (section: string, detail: Record<string, string> = {}) =>
    `/schools?${new URLSearchParams({ schoolId: school.id, section, ...detail })}`;
  const assignments = useData<{ items: SchoolActivity[] }>(`${base}/activities?kind=assignment`);
  const timed = useData<{ items: SchoolActivity[] }>(`${base}/activities?kind=timed`);
  const submissions = useData<SubmissionPage>(`${base}/submissions`);
  const courses = useData<CoursePage<SchoolCourse>>(`${base}/courses`);

  const assignmentItems = assignments.data?.items ?? [];
  const deadline = (activity: SchoolActivity) => activity.endsAt ? Date.parse(activity.endsAt) : Infinity;
  const assignment = assignmentItems.filter(item => item.phase === "Open")
    .sort((a, b) => deadline(a) - deadline(b))[0] ?? assignmentItems[0];
  const next = assignment?.problems.find(problem => !assignment.grade?.items.find(item => item.id === problem.id)?.solved);
  const path = courses.data?.items.find(item => item.completedChapters < item.chapterCount) ?? courses.data?.items[0];
  const pathDetail = useData<CourseDetail>(path ? `${base}/courses/${path.id}` : "");
  const practice = timed.data?.items.filter(item => ["Upcoming", "Open"].includes(item.phase) && !item.attempt)
    .sort((a, b) => Date.parse(a.startsAt ?? "") - Date.parse(b.startsAt ?? ""))[0];

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
    practiceState={timed}
    practice={practice ? {
      title: practice.title,
      href: href("timed", { activityId: practice.id }),
      startsAt: practice.startsAt,
      endsAt: practice.endsAt,
      count: practice.problems.length,
      durationMinutes: practice.durationMinutes,
    } : undefined}
  />;
}

function SubmissionRows({
  schoolId,
  rows,
}: {
  schoolId: string;
  rows: SchoolSubmission[];
}) {
  const text = useSchoolText(),
    { locale } = useLocale();
  const searchParams = useSearchParams();
  const detailHref = (id: string) => {
    const params = new URLSearchParams({ schoolId, section: "submissions", submissionId: id });
    if (searchParams.get("section") === "submissions" && searchParams.has("submissionPage")) {
      params.set("submissionPage", searchParams.get("submissionPage")!);
    }
    return `/schools?${params}`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-subtle text-muted-foreground">
          <tr>
            <th className="px-4 py-2">ID</th>
            <th className="px-4 py-2">{text("Problem", "题目")}</th>
            <th className="px-4 py-2">{text("Status", "状态")}</th>
            <th className="px-4 py-2">{text("Score", "得分")}</th>
            <th className="px-4 py-2">{text("Submitted", "提交时间")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => (
            <tr key={job.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={detailHref(job.id)} className="font-semibold text-primary hover:underline" title={job.id}>{job.id.slice(0, 8)}</Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={detailHref(job.id)}
                >
                  {job.problemTitle}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={job.status} />
              </td>
              <td className="px-4 py-3">
                {job.score === null ? "—" : `${job.score}/100`}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                {date(job.createdAt, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="p-5 text-sm text-muted-foreground">
          {text("No formal submissions yet.", "暂无正式提交。")}
        </p>
      )}
    </div>
  );
}

export function SchoolSubmissions({ schoolId }: { schoolId: string }) {
  const searchParams = useSearchParams();
  const rawPage = Number(searchParams.get("submissionPage") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1;
  const submissionId = searchParams.get("submissionId");
  if (submissionId) return <SchoolSubmissionDetail key={`${schoolId}:${submissionId}`} schoolId={schoolId} submissionId={submissionId} backHref={`${schoolWorkspaceHref(schoolId, "submissions")}&submissionPage=${page}`} />;
  return <SchoolSubmissionList key={`${schoolId}:${page}`} schoolId={schoolId} page={page} />;
}

function SchoolSubmissionList({ schoolId, page }: { schoolId: string; page: number }) {
  const text = useSchoolText();
  const router = useRouter();
  const data = useData<SubmissionPage>(
      `schools/${schoolId}/submissions?page=${page}`,
    );
  const setPage = (value: number) => router.push(`${schoolWorkspaceHref(schoolId, "submissions")}&submissionPage=${value}`, { scroll: false });
  return (
    <section className={panel}>
      <State data={data}>
        <SubmissionRows schoolId={schoolId} rows={data.data?.items ?? []} />
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span>
            {text("Page", "第")} {page}
            {text("", " 页")}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={data.loading || page === 1}
              onClick={() => setPage(page - 1)}
            >
              {text("Previous", "上一页")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={data.loading || !data.data?.hasMore}
              onClick={() => setPage(page + 1)}
            >
              {text("Next", "下一页")}
            </Button>
          </div>
        </div>
      </State>
    </section>
  );
}

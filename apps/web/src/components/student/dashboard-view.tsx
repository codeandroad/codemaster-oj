import { ArrowRight, CalendarClock, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { isPending } from "@/lib/production-api";
import { Empty, State, panel } from "./shared";

type DashboardState = Parameters<typeof State>[0]["data"];
type DashboardItem = { title: string; href: string };
type DashboardAssignment = DashboardItem & {
  continueHref?: string;
  dueAt: string | null;
  solved: number;
  attempted: number;
  count: number;
  score: number | null;
  maxScore: number;
  pending?: boolean;
};
type DashboardCourse = DashboardItem & {
  completedChapters: number;
  chapterCount: number;
  chapters: (DashboardItem & { completed: boolean })[];
};
type DashboardPractice = DashboardItem & {
  startsAt: string | null;
  endsAt: string | null;
  count: number;
  durationMinutes: number | null;
};
type DashboardSubmission = DashboardItem & {
  id: string;
  problemId: string;
  status: string;
  score: number | null | undefined;
  sourceLabel?: string;
};

export function Progress({ percent, label, complete = false }: { percent: number; label?: string; complete?: boolean }) {
  const value = Math.max(0, Math.min(100, percent));
  return <div
    className="h-2 overflow-hidden rounded-full bg-muted"
    role={label ? "progressbar" : undefined}
    aria-label={label}
    aria-valuenow={label ? Math.round(value) : undefined}
  ><div className={`h-full ${complete ? "bg-success" : "bg-primary"}`} style={{ width: `${value}%` }} /></div>;
}

export function StudentDashboardView({
  heading, assignmentState, assignment, courseState, course, coursesHref,
  submissionsState, submissions, submissionsHref, practiceState, practice,
}: {
  heading: string;
  assignmentState: DashboardState;
  assignment?: DashboardAssignment;
  courseState: DashboardState;
  course?: DashboardCourse;
  coursesHref: string;
  submissionsState: DashboardState;
  submissions: DashboardSubmission[];
  submissionsHref: string;
  practiceState: DashboardState;
  practice?: DashboardPractice;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const displayDate = (value: string | null) => value ? new Intl.DateTimeFormat(text("zh-CN", "en-US"), {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
  }).format(new Date(value)) : "—";
  const latest = [...new Map(submissions.map(row => [row.problemId, row] as const).reverse()).values()];
  const needsReview = latest.filter(row => !["AC", "Submitted"].includes(row.status) && !isPending(row.status) && !/system.?error/i.test(row.status));
  const review = needsReview[0];
  const percent = assignment?.count ? assignment.solved / assignment.count * 100 : 0;
  const complete = Boolean(assignment && assignment.count > 0 && assignment.solved === assignment.count);
  const continueHref = complete ? undefined : assignment?.continueHref;
  const statusLabel = (status: string) => locale === "zh"
    ? ({ Waiting: "等待中", Judging: "评测中", "System Error": "系统错误", Submitted: "已提交" }[status] ?? status)
    : status;
  return <>
    <PageHeader title={heading} />
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <State data={assignmentState}>
          {assignment ? <section className="border border-border bg-surface panel-shadow">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{text("作业进度", "Assignment progress")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 text-lg font-bold [overflow-wrap:anywhere]"><AppLink href={assignment.href} className="hover:text-primary hover:underline focus-visible:underline">{assignment.title}</AppLink></h2>
                  {complete && <StatusPill status="Completed" icon={<Check size={13} />} />}
                </div>
              </div>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${complete ? "text-success" : "text-primary"}`}>{Math.round(percent)}%</span>
            </div>
            <div className="p-5">
              <Progress percent={percent} complete={complete} label={text("必做题进度", "Required problem progress")} />
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
                <span>{assignment.solved}/{assignment.count} {text("必做题已解决", "required solved")} · {assignment.attempted}/{assignment.count} {text("本作业已提交", "submitted here")}</span>
                <span>{assignment.score == null && assignment.pending ? text("等待有效结果", "Waiting for valid result") : assignment.score ?? 0}/{assignment.maxScore} {text("分", "points")}</span>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <span className="flex items-center gap-2 text-sm"><CalendarClock size={16} className="text-warning" />{text("截止", "Due")} {displayDate(assignment.dueAt)} · Asia/Shanghai</span>
                <div className="flex gap-2">
                  <AppLink href={assignment.href} className={buttonVariants({ variant: complete ? "primary" : "secondary" })}>
                    {text("查看作业", "View assignment")}
                    {complete && <ArrowRight size={15} aria-hidden />}
                  </AppLink>
                  {continueHref && <AppLink href={continueHref} className={buttonVariants()}>{text("继续做题", "Continue")} <ArrowRight size={15} aria-hidden /></AppLink>}
                </div>
              </div>
            </div>
          </section> : <Empty title={text("暂无进行中的作业", "No current assignments")} description={text("老师发布的作业会显示在这里，可先从题库开始练习。", "Assignments from your teacher appear here. You can start with the problem library.")} />}
        </State>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">{text("需要订正", "Needs review")}</h2>
            <span className="text-xs text-muted-foreground">{needsReview.length} {text("项", "items")}</span>
          </div>
          <State data={submissionsState}>
            {review ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border border-warning/25 bg-surface p-4 panel-shadow">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-warning-soft text-warning"><CircleAlert size={17} /></span>
                <div>
                  <AppLink href={review.href} className="font-semibold hover:text-primary hover:underline focus-visible:underline">{review.title}</AppLink>
                  <p className="mt-1 text-sm text-muted-foreground">{text("最近结果：", "Latest result:")} {review.status} · {review.score == null ? "—" : `${Number(review.score).toFixed(2)}/100`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{text("重试前请检查边界情况。", "Check edge cases before retrying.")}</p>
                </div>
              </div>
              <AppLink href={review.href} className={buttonVariants({ variant: "secondary" })}>{text("订正", "Review")} <ChevronRight size={15} /></AppLink>
            </div> : <div className={`${panel} text-sm text-muted-foreground`}>{text("目前没有需要订正的已完成评测。", "No completed evaluations need correction.")}</div>}
          </State>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">{text("最近提交", "Recent submissions")}</h2>
            <AppLink href={submissionsHref} className="text-sm font-semibold text-primary">{text("查看全部", "View all")}</AppLink>
          </div>
          <State data={submissionsState}>
            {submissions.length ? <div className="overflow-hidden border border-border bg-surface panel-shadow">
              {submissions.slice(0, 3).map(row => <AppLink key={row.id} href={row.href} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0 hover:bg-surface-subtle md:grid-cols-[110px_minmax(0,1fr)_150px_92px_24px]">
                <span className="truncate font-mono text-xs font-semibold text-primary" title={row.id}>{row.id}</span>
                <span className="truncate font-semibold">{row.title}</span>
                <span className="hidden truncate text-muted-foreground md:block">{row.sourceLabel || "—"}</span>
                <StatusPill status={statusLabel(row.status)} />
                <ChevronRight size={15} className="hidden text-muted-foreground md:block" />
              </AppLink>)}
            </div> : <Empty title={text("暂无正式提交", "No formal submissions yet")} />}
          </State>
        </section>
      </div>
      <aside className="space-y-5">
        <State data={courseState}>
          {course ? <section className={panel}>
            <p className="text-xs font-semibold uppercase text-muted-foreground">{text("当前课程", "Current path")}</p>
            <h2 className="mt-2 font-bold"><AppLink href={course.href} className="hover:text-primary hover:underline focus-visible:underline">{course.title}</AppLink></h2>
            <p className="mt-1 text-sm text-muted-foreground">{course.completedChapters}/{course.chapterCount} {text("章已阅读", "chapters read")}</p>
            <div className="mt-4 space-y-3 text-sm">
              {course.chapters.slice(0, 3).map(chapter => <div key={chapter.href} className={`flex items-center gap-2 ${chapter.completed ? "text-success" : "text-muted-foreground"}`}>
                {chapter.completed ? <CheckCircle2 size={16} /> : <span className="h-4 w-4 shrink-0 rounded-full border border-border-strong" />}
                <AppLink href={chapter.href} className="hover:text-primary hover:underline focus-visible:underline">{chapter.title}</AppLink>
              </div>)}
            </div>
            <AppLink href={course.href} className="mt-5 block border-t border-border pt-4 text-sm font-semibold text-primary">{text("继续学习", "Continue learning")}</AppLink>
          </section> : <section className={panel}>
            <h2 className="font-bold">{text("课程", "Courses")}</h2>
            <p className="mt-3 text-sm text-muted-foreground">{text("老师发布的章节会显示在这里。", "Published chapters from your teacher appear here.")}</p>
            <AppLink href={coursesHref} className="mt-4 block text-sm font-semibold text-primary">{text("查看课程", "View paths")}</AppLink>
          </section>}
        </State>
        <State data={practiceState}>
          {practice && <section className={panel}>
            <div className="flex items-center gap-2"><Clock3 size={18} className="text-primary" /><h2 className="font-bold">{text("即将开始的限时训练", "Next timed practice")}</h2></div>
            <p className="mt-4 text-sm font-semibold"><AppLink href={practice.href} className="hover:text-primary hover:underline focus-visible:underline">{practice.title}</AppLink></p>
            <p className="mt-1 text-sm text-muted-foreground">{displayDate(practice.startsAt)}–{displayDate(practice.endsAt)}</p>
            <p className="text-xs text-muted-foreground">Asia/Shanghai · {practice.count} {text("题", "problems")} · {practice.durationMinutes} {text("分钟", "min")}</p>
            <AppLink href={practice.href} className="mt-4 block border-t border-border pt-4 text-sm font-semibold text-primary">{text("查看规则", "View rules")}</AppLink>
          </section>}
        </State>
      </aside>
    </div>
  </>;
}

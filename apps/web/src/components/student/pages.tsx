"use client";

import {StudentProblemFilter} from "./problem-filter";
import {StudentSubmissionFilter} from "./submission-filter";
import dynamic from "next/dynamic";

import { StudentScholarshipRule } from "@/components/scholarship/teaching-page";
import { AppLink } from "@/components/navigation";
import { LearnerResourceScope } from "@/components/schools/learner-resource-scope";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark, CalendarClock, Check, CheckCircle2, CircleAlert, Code2, KeyRound, MessageSquareText, NotebookPen, Pencil, ShieldCheck, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { isPending, productionApi, type Assignment, type AuthResponse, type CampusUser, type ProductionProblem, type ReviewEntry, type SchoolClass, type Submission } from "@/lib/production-api";
import { CodeBlock, Empty, Feedback, ResultPanel, ResultScore, State, Tabs, input, kindLabel, panel, shortId, textarea, useData, useMutation, useSubmission } from "./shared";
import { StudentClasses, StudentClass } from "./classes";
import { StudentLearningDetail, StudentLearningList, type LearningPath } from "./learning";
import { StudentTimedDetail, StudentTimedList, type TimedPractice } from "./timed";
import { StudentWorkspace } from "./workspace";
import { Progress, StudentDashboardView } from "./dashboard-view";
import { StudentAssignmentCard } from "./activity-cards";
import { AssignmentCompletionDialog } from "./assignment-completion";
export { Progress } from "./dashboard-view";
import { ProblemCatalogSearch } from "./problem-catalog-search";
import problemStyles from "./problems-page.module.css";
const StudentPaper4List = dynamic(() => import("@/components/paper4/student-paper4").then(module => module.StudentPaper4List));
const StudentPaper4Detail = dynamic(() => import("@/components/paper4/student-paper4").then(module => module.StudentPaper4Detail));
import { genderLabel } from "@/lib/gender";
import { languageInfo, submissionLanguage } from "./languages";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { reviewNotebookState } from "./review-notebook-state";

function ui(locale: AppLocale, chinese: string, english: string) { return locale === "en" ? english : chinese; }
function displayDate(value: string | null | undefined, locale: AppLocale) { return value ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—"; }
const notebookFilters = ["All", "Needs review", "Retried", "Resolved", "Feedback received"];
function notebookStateLabel(locale: AppLocale, value: string) { return ({ "Feedback received": ui(locale, "收到反馈", "Feedback received"), All: ui(locale, "全部", "All"), "Needs review": ui(locale, "需要订正", "Needs review"), Retried: ui(locale, "已重试", "Retried"), Resolved: ui(locale, "已解决", "Resolved") } as Record<string, string>)[value] ?? value; }
function submissionKindLabel(locale: AppLocale, kind: string) { return locale === "zh" ? kindLabel(kind, locale) : kind === "submit" ? "Formal submission" : kind === "correction" ? "Correction" : kind === "samples" ? "Public sample run" : "Custom input run"; }
function statusLabel(locale: AppLocale, status: string) {
  const labels: Record<string, string> = { Waiting: "等待中", Judging: "评测中", Executed: "已运行", "System Error": "系统错误", "Not started": "未开始", NotStarted: "未开始", Unavailable: "不可用", NotSubmitted: "未提交", Open: "进行中", Ended: "已结束" };
  return locale === "zh" ? labels[status] ?? status : status;
}

export function StudentPages({ pathname, user }: { pathname: string; user: CampusUser }) {
  const { locale } = useLocale();
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/") return <StudentDashboard user={user}/>;
  if (pathname === "/student/profile" || pathname === "/teacher/profile") return <AlignedProfile user={user} teacher={pathname.startsWith("/teacher")}/>;
  if (parts[1] === "problems") return parts[2] ? <StudentWorkspace id={parts[2]} user={user}/> : <LearnerResourceScope section="problems" schoolHref="/student/problems"><StudentProblems/></LearnerResourceScope>;
  if (parts[1] === "paper4") return parts[2] ? <StudentPaper4Detail paperId={parts[2]} user={user}/> : <StudentPaper4List/>;
  if (parts[1] === "classes") return parts[2] ? <StudentClass id={parts[2]}/> : <StudentClasses/>;
  if (parts[1] === "assignments") return parts[2] ? <StudentAssignment id={parts[2]} user={user}/> : <StudentAssignments user={user}/>;
  if (parts[1] === "submissions") return parts[2] ? <StudentSubmission id={parts[2]} user={user}/> : <LearnerResourceScope section="submissions" schoolHref="/student/submissions"><StudentSubmissions user={user}/></LearnerResourceScope>;
  if (parts[1] === "review-notebook") return parts[2] ? <StudentReview id={parts[2]} user={user}/> : <LearnerResourceScope section="review-notebook" schoolHref="/student/review-notebook"><StudentNotebook user={user}/></LearnerResourceScope>;
  if (parts[1] === "learning-paths") return parts[2] ? <StudentLearningDetail id={parts[2]} chapterId={parts[4]}/> : <LearnerResourceScope section="courses" schoolHref="/student/learning-paths"><StudentLearningList/></LearnerResourceScope>;
  if (parts[1] === "timed-practice") return parts[2] ? <StudentTimedDetail id={parts[2]} user={user}/> : <StudentTimedList/>;
  return <Empty title={ui(locale, "页面不存在", "Page not found")} description={ui(locale, "请使用左侧导航返回学习页面。", "Use the navigation to return to a learning page.")}/>;
}
function formal(items: Submission[]) { return items.filter(s => ["submit", "correction"].includes(s.kind)); }
function gradeFor(assignment: Assignment, identityId?: string) { return assignment.grades?.find(g => !identityId || g.identityId === identityId); }
function assignmentProgress(assignment: Assignment, identityId?: string) {
  const grade = gradeFor(assignment, identityId), max = assignment.problems.reduce((sum, p) => sum + p.points, 0);
  const results = new Map(grade?.problems.map(problem => [problem.problemId, problem]));
  const required = assignment.problems.map(problem => results.get(problem.problemId));
  const attempted = required.filter(p => p && (p.assignmentAttempts != null ? p.assignmentAttempts > 0 : p.hasAssignmentSubmission ?? Boolean(p.submissionId))).length;
  const solved = required.filter(p => p?.status === "AC").length;
  const complete = required.length > 0 && solved === required.length;
  return { grade, max, attempted, solved, complete, percent: required.length ? solved / required.length * 100 : 0 };
}
function sourceLabel(submission: Submission, assignments: Assignment[] = [], locale: AppLocale = "en") { return submission.originalSubmissionId ? ui(locale, "订正", "Correction") : submission.assignmentId ? assignments.find(a => a.id === submission.assignmentId)?.title ?? ui(locale, "作业", "Assignment") : submission.timedPracticeId ? ui(locale, "限时训练", "Timed Practice") : ui(locale, "题库练习", "Practice library"); }
function score(submission: Submission) { return submission.score == null || isPending(submission.status) || /system.?error/i.test(submission.status) ? "—" : `${Number(submission.score).toFixed(2)}/100`; }

export function StudentDashboard({ user }: { user: CampusUser }) {
  const { locale } = useLocale();
  const [initialNow] = useState(() => Date.now());
  const assignments = useData<{ items: Assignment[]; serverNow?: string }>("assignments");
  const submissions = useData<{ items: Submission[] }>(`submissions?identityId=${user.identityId}&kind=submit,correction`);
  const paths = useData<{ items: LearningPath[] }>("learning-paths");
  const timed = useData<{ items: TimedPractice[] }>("timed-practices");
  const now = assignments.data?.serverNow ? new Date(assignments.data.serverNow).getTime() : initialNow;
  const ownAssignments = assignments.data?.items.filter(a => !a.grades || a.grades.some(g => g.identityId === user.identityId)) ?? [];
  const current = ownAssignments.filter(a => new Date(a.dueAt).getTime() >= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? ownAssignments[0];
  const progress = current ? assignmentProgress(current, user.identityId) : null;
  const next = current?.problems.find(p => progress?.grade?.problems.find(g => g.problemId === p.problemId)?.status !== "AC");
  const path = paths.data?.items.find(p => p.completedChapters < p.chapterCount) ?? paths.data?.items[0];
  const practice = timed.data?.items.find(p => ["Published", "Running"].includes(p.status) && !p.attempt);
  const pathDetail = useData<LearningPath>(path ? `learning-paths/${path.id}` : "");

  return <StudentDashboardView
    heading={ui(locale, `你好，${user.name}`, `Hello, ${user.name}`)}
    assignmentState={assignments}
    assignment={current && progress ? {
      title: current.title,
      href: `/student/assignments/${current.id}`,
      continueHref: next ? problemHref(next, { assignmentId: current.id, sourceLabel: current.title }) : undefined,
      dueAt: current.dueAt,
      solved: progress.solved,
      attempted: progress.attempted,
      count: current.problems.length,
      score: progress.grade?.score ?? null,
      maxScore: progress.max,
      pending: progress.grade?.pending,
    } : undefined}
    courseState={paths}
    coursesHref="/student/learning-paths"
    course={path ? {
      title: path.title,
      href: `/student/learning-paths/${path.id}`,
      completedChapters: path.completedChapters,
      chapterCount: path.chapterCount,
      chapters: pathDetail.data?.id === path.id ? (pathDetail.data.chapters ?? []).map(chapter => ({
        title: chapter.title,
        href: `/student/learning-paths/${path.id}/chapters/${chapter.id}`,
        completed: Boolean(chapter.completed),
      })) : [],
    } : undefined}
    submissionsState={submissions}
    submissionsHref="/student/submissions"
    submissions={formal(submissions.data?.items ?? []).map(submission => ({
      id: submission.id,
      problemId: submission.problemId,
      title: submission.problemTitle,
      href: `/student/submissions/${submission.id}`,
      status: submission.status,
      score: submission.score,
      sourceLabel: sourceLabel(submission, assignments.data?.items, locale),
    }))}
    practiceState={timed}
    practice={practice ? {
      title: practice.title,
      href: `/student/timed-practice/${practice.id}`,
      startsAt: practice.startsAt,
      endsAt: practice.endsAt,
      count: practice.problems.length,
      durationMinutes: practice.durationMinutes,
    } : undefined}
  />;
}
export function problemHref(problem: { problemId: string; versionId?: string }, context: Record<string, string> = {}) { const params = new URLSearchParams({ ...(problem.versionId ? { versionId: problem.versionId } : {}), ...context }); return `/student/problems/${problem.problemId}${params.size ? `?${params}` : ""}`; }

interface ProgressProblem extends ProductionProblem { ownProgress?: { status: string; bestScore: number | null; formalCount: number; lastSubmissionId: string | null; lastSubmittedAt: string | null }; }
export function StudentProblems() {
  const { locale } = useLocale();
  const problems = useData<{ items: ProgressProblem[] }>("problems"), favorites = useData<{ items: string[] }>("problem-favorites");
  const [query, setQuery] = useState(""), [topic, setTopic] = useState(""), [status, setStatus] = useState(""), [mode, setMode] = useState(""), [savedOnly, setSavedOnly] = useState(false);
  const action = useMutation();
  const topics = [...new Set(problems.data?.items.flatMap(p => p.tags ?? []) ?? [])];
  const details = (p: ProgressProblem) => ({ bestScore: p.ownProgress?.bestScore, status: p.ownProgress ? p.ownProgress.status === "NotStarted" ? "Not started" : p.ownProgress.status : "Unavailable" });
  const visible = problems.data?.items.filter(p => `${p.id} ${p.title} ${p.tags?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (!topic || p.tags?.includes(topic)) && (!status || details(p).status === status) && (!mode || p.mode === mode) && (!savedOnly || favorites.data?.items.includes(p.id))) ?? [];
  return <div className={problemStyles.page}>
    <PageHeader title={ui(locale, "题目", "Problems")}/>
    <div className={problemStyles.toolbar}>
      <ProblemCatalogSearch value={query} onChange={setQuery} label={ui(locale, "搜索编号、标题或专题", "Search ID, title, or topic")}/>
      <StudentProblemFilter topics={topics} topic={topic} status={status} mode={mode} savedOnly={savedOnly} onTopic={setTopic} onStatus={setStatus} onMode={setMode} onSaved={setSavedOnly}/>
    </div>
    <Feedback action={action}/>
    <State data={problems}>{!problems.data?.items.length ? <Empty title={ui(locale, "暂无可练习题目", "No problems are available")} description={ui(locale, "老师尚未开放题目；如有疑问请联系老师。", "Your teacher has not made problems available for this class. Please contact your teacher if this looks incorrect.")}/> : !visible.length ? <Empty title={ui(locale, "没有匹配的题目", "No matching problems")} description={ui(locale, "请尝试其他编号、标题、专题或筛选条件。", "Try a different ID, title, topic, or filter.")}/> : <div className={problemStyles.tableWrap}>
      <table className={problemStyles.table}>
        <colgroup><col style={{width:"3%"}}/><col style={{width:"12.5%"}}/><col style={{width:"8%"}}/><col style={{width:"24.5%"}}/><col style={{width:"16%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"6%"}}/></colgroup>
        <thead><tr>{["", ui(locale, "完成状态", "Your status"), "ID", ui(locale, "标题", "Title"), ui(locale, "专题", "Topic"), ui(locale, "难度", "Level"), ui(locale, "题目形式", "Interface"), ui(locale, "最佳成绩", "Best"), ui(locale, "操作", "Action")].map((text, i) => <th key={i} scope="col">{text}</th>)}</tr></thead>
        <tbody>{visible.map(p => {
          const detail = details(p), saved = favorites.data?.items.includes(p.id), tags = p.tags?.join(" · ") || "—";
          const href = problemHref({ problemId: p.id, versionId: p.versionId });
          return <tr key={p.id}>
            <td><button type="button" aria-label={saved ? ui(locale, `取消收藏 ${p.title}`, `Remove bookmark ${p.title}`) : ui(locale, `收藏 ${p.title}`, `Bookmark ${p.title}`)} aria-pressed={Boolean(saved)} disabled={action.busy || favorites.loading || Boolean(favorites.error)} onClick={() => action.run(async () => { await productionApi(`problem-favorites/${p.id}`, { method: "PUT", body: { favorite: !saved } }); favorites.reload(); })} className={`${problemStyles.bookmark} ${saved ? "text-primary" : "text-muted-foreground"}`}><Bookmark size={15} fill={saved ? "currentColor" : "none"}/></button></td>
            <td><StatusPill status={statusLabel(locale, detail.status)}/></td>
            <td title={p.id} className="font-mono text-xs font-semibold">{shortId(p.id)}</td>
            <td><AppLink href={href} title={p.title} className={`${problemStyles.title} font-semibold text-primary hover:underline focus-visible:underline`}>{p.title}</AppLink></td>
            <td title={tags} className="text-muted-foreground"><span className={problemStyles.truncate}>{tags}</span></td>
            <td className="text-muted-foreground"><span className={problemStyles.truncate}>{(p as ProductionProblem & {difficulty?:string}).difficulty || "—"}</span></td>
            <td><span className={problemStyles.mode}>{p.mode === "function" ? ui(locale, "函数题", "Function") : ui(locale, "标准输入输出", "Standard I/O")}</span></td>
            <td className="font-semibold">{detail.bestScore == null ? "—" : `${Number(detail.bestScore).toFixed(2)}/100`}</td>
            <td><AppLink href={href} className={`${problemStyles.open} font-semibold text-primary hover:underline focus-visible:underline`}>{ui(locale, "打开", "Open")}</AppLink></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}</State>
    {favorites.error && <p role="alert" className="text-sm text-destructive">{ui(locale, "收藏加载失败：", "Could not load bookmarks: ")}{favorites.error}</p>}
    <p className={problemStyles.count}>{ui(locale, `显示 ${visible.length} / ${problems.data?.items.length ?? 0} 道题`, `Showing ${visible.length} of ${problems.data?.items.length ?? 0} problems`)}</p>
  </div>;
}

export function StudentAssignments({ user }: { user: CampusUser }) {
  const { locale } = useLocale();
  const [initialNow] = useState(() => Date.now());
  const [showArchived, setShowArchived] = useState(false);
  const assignments = useData<{ items: Assignment[]; serverNow?: string }>(showArchived ? "assignments?archived=true" : "assignments"), classes = useData<{ items: SchoolClass[] }>("classes");
  const now = assignments.data?.serverNow ? new Date(assignments.data.serverNow).getTime() : initialNow;
  const visible = assignments.data?.items.filter(a => Boolean(a.archived) === showArchived &&
    (!a.grades || a.grades.some(g => g.identityId === user.identityId))) ?? [];
  return <>
    <PageHeader title={ui(locale, "作业", "Assignments")} />
    <div className="mt-5 flex gap-2" role="group" aria-label={ui(locale, "作业状态", "Assignment status")}>
      <Button variant={showArchived ? "secondary" : "primary"} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>{ui(locale, "当前作业", "Current")}</Button>
      <Button variant={showArchived ? "primary" : "secondary"} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>{ui(locale, "历史归档", "Archived")}</Button>
    </div>
    <State data={assignments} empty={assignments.data && !assignments.data.items.length ? ui(locale, "暂无作业", "No assignments yet") : undefined}>
      <div className="mt-5 grid gap-4">
        {visible.map(assignment => {
          const progress = assignmentProgress(assignment, user.identityId);
          const ended = new Date(assignment.dueAt).getTime() < now;
          const status = assignment.archived ? ui(locale, "已归档", "Archived")
            : progress.grade?.pending ? "Judging"
            : ended ? ui(locale, "已截止", "Ended")
            : ui(locale, "进行中", "Open");
          return <StudentAssignmentCard
            key={assignment.id}
            title={assignment.title}
            href={`/student/assignments/${assignment.id}`}
            status={status}
            archived={assignment.archived}
            audience={assignment.classNames?.join(" / ") || assignment.classes?.map(item => item.name).join(" / ") ||
              assignment.className || classes.data?.items.find(c => c.id === assignment.classId)?.name || ui(locale, "按学生名单布置", "Direct assignment")}
            course={assignment.coursePathId && assignment.courseTitle ? {
              href: `/student/learning-paths/${assignment.coursePathId}`, title: assignment.courseTitle,
            } : undefined}
            dueAt={assignment.dueAt}
            active={!assignment.archived && !ended}
            problemCount={assignment.problems.length}
            score={progress.grade?.score ?? null}
            maxScore={progress.max}
            pending={progress.grade?.pending}
            attempted={progress.attempted}
            solved={progress.solved}
          />;
        })}
      </div>
    </State>
    <section className={`${panel} mt-6`}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 text-success" size={18} />
        <div>
          <h2 className="font-bold">{ui(locale, "成绩计算规则", "Score display rule")}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{ui(locale, "订正提交单独显示，不会覆盖原作业成绩。", "Correction submissions are displayed separately. Later corrections do not overwrite the original assignment score.")}</p>
        </div>
      </div>
    </section>
  </>;
}
export function StudentAssignment({ id, user }: { id: string; user: CampusUser }) {
  const { locale } = useLocale();
  const [completionOpen, setCompletionOpen] = useState(false);
  const assignment = useData<Assignment>(`assignments/${id}`), submissions = useData<{ items: Submission[] }>(`submissions?assignmentId=${encodeURIComponent(id)}&identityId=${user.identityId}&kind=submit,correction`), classes = useData<{ items: SchoolClass[] }>("classes");
  const a = assignment.data, p = a ? assignmentProgress(a, user.identityId) : null, formalSubmissions = formal(submissions.data?.items ?? []);
  const needsCorrection = formalSubmissions.find(s => s.kind === "submit" && s.status === "WA" && p?.grade?.problems.find(g => g.problemId === s.problemId)?.status !== "AC");
  return <State data={assignment}>{a && p && <>
    {completionOpen && a.completion && <AssignmentCompletionDialog assignment={{ id: a.id, title: a.title, completion: a.completion }}
      onDismiss={() => setCompletionOpen(false)} />}
    <StudentScholarshipRule activityType="assignment" activityId={id}/>
    <section className={panel}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">{shortId(a.id)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-bold [overflow-wrap:anywhere]">{a.title}</h1>
            {p.complete && <StatusPill status="Completed" icon={<Check size={13} />} />}
            {p.complete && a.completion && <Button type="button" size="sm" variant="ghost" onClick={() => setCompletionOpen(true)}>
              {ui(locale, "查看完成统计", "View completion stats")}
            </Button>}
          </div>
          {a.coursePathId && a.courseTitle && <p className="mt-2 text-sm"><AppLink href={`/student/learning-paths/${a.coursePathId}`} className="font-semibold text-primary hover:underline focus-visible:underline">{ui(locale, "关联课程：", "Course: ")}{a.courseTitle} →</AppLink></p>}
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{a.classNames?.join(" / ") || a.classes?.map(item => item.name).join(" / ") || a.className || classes.data?.items.find(c => c.id === a.classId)?.name || ui(locale, "按学生名单布置", "Direct assignment")} · {ui(locale, "截止", "Due")} {displayDate(a.dueAt, locale)} Asia/Shanghai</p>
        </div>
        <div className="sm:text-right">
          <div className="text-3xl font-bold">{p.grade?.score == null && p.grade?.pending ? ui(locale, "等待判题", "Waiting for judging") : p.grade?.score ?? 0}/{p.max}</div>
          <div className="text-xs text-muted-foreground">{p.attempted}/{a.problems.length} {ui(locale, "本作业已提交", "submitted here")} · {p.solved}/{a.problems.length} {ui(locale, "已解决", "solved")}</div>
        </div>
      </div>
      <div className="mt-5"><Progress percent={p.percent} complete={p.complete} label={ui(locale, "必做题进度", "Required problem progress")} /></div>
    </section>
    <div className="@container mt-6">
      <div className="grid items-start gap-5 @min-[73rem]:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="min-w-0 border border-border bg-surface panel-shadow">
          <div className="border-b border-border px-4 py-3">
            <h2 id="assignment-required-problems" className="font-bold">{ui(locale, "必做题目", "Required problems")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{ui(locale, "提交次数仅统计本作业内的正式提交；其他入口通过可直接计入完成。", "Counts show formal submissions in this assignment; AC elsewhere can count toward completion.")}</p>
          </div>
          <div
            className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            role="region"
            aria-labelledby="assignment-required-problems"
            tabIndex={0}
          >
            <table className="w-full text-left text-sm [&_td]:p-2.5 [&_th]:px-2.5 [&_th]:py-3">
              <thead className="whitespace-nowrap bg-surface-subtle text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-px text-center">{ui(locale, "序号", "No.")}</th>
                  <th scope="col" className="min-w-52">{ui(locale, "题目", "Problem")}</th>
                  <th scope="col" className="w-px">{ui(locale, "状态", "Status")}</th>
                  <th scope="col" className="w-px text-right">{ui(locale, "最佳成绩", "Best")}</th>
                  <th scope="col" className="w-px text-right">{ui(locale, "本作业提交", "Submissions")}</th>
                  <th scope="col" className="w-px text-right">{ui(locale, "首次 AC 积分", "First AC points")}</th>
                  <th scope="col" className="w-px text-right">{ui(locale, "额外奖学金", "Extra Scholarship")}</th>
                  <th scope="col" className="w-px">{ui(locale, "操作", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {a.problems.map((problem, index) => {
                  const result = p.grade?.problems.find(r => r.problemId === problem.problemId);
                  const attempts = result?.assignmentAttempts ?? (submissions.loading || submissions.error ? null : formalSubmissions.filter(s => s.problemId === problem.problemId && s.kind === "submit").length);
                  const href = problemHref(problem, { assignmentId: id, sourceLabel: a.title });
                  return <tr key={problem.problemId} className="border-t border-border hover:bg-surface-subtle">
                    <td className="whitespace-nowrap text-center tabular-nums text-muted-foreground">{index + 1}</td>
                    <td className="[overflow-wrap:anywhere]"><AppLink href={href} className="font-semibold text-primary hover:underline focus-visible:underline">{problem.title}</AppLink></td>
                    <td className="whitespace-nowrap">
                      <StatusPill status={result?.status ?? ui(locale, "未开始", "Not started")}/>
                      {result?.completionSource === "other_entry" && <span className="mt-1 block text-xs text-muted-foreground">{ui(locale, "其他入口已通过", "Passed elsewhere")}</span>}
                    </td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">{result?.score == null ? "—" : `${(result.score * problem.points / 100).toFixed(2)}/${problem.points}`}</td>
                    <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                      {result?.completionSource === "other_entry" && attempts === 0
                        ? <span title={ui(locale, "沿用其他入口的 AC，本作业未新增提交。", "AC credited from another entry; no submission was created here.")}>{ui(locale, "免重做", "Not required")}</span>
                        : attempts ?? "—"}
                    </td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">+{problem.firstAcPoints ?? 10}</td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">+{problem.rewardPoints ?? 0}</td>
                    <td className="whitespace-nowrap"><AppLink href={href} className="font-semibold text-primary hover:underline focus-visible:underline">{ui(locale, "打开", "Open")}</AppLink></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="space-y-5">
          <section className={panel}>
            <h2 className="flex items-center gap-2 font-bold"><CalendarClock size={17} className="text-primary"/>{ui(locale, "作业规则", "Assignment rules")}</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
              <li>{ui(locale, "正式提交会生成提交记录。", "Formal submissions create records.")}</li>
              <li>{ui(locale, "样例运行和自定义运行不影响成绩。", "Sample and custom runs do not affect score.")}</li>
              <li>{ui(locale, "以截止前收到的最高有效分数计分。同一版本在其他入口的正式 AC 可直接计入满分，无需重做；不会新增提交或发放作业奖学金。", "Use the highest valid score received before the deadline. A formal AC on the same version elsewhere earns full credit without another submission or assignment Scholarship.")}</li>
              <li>{ui(locale, "隐藏测试不会公开输入或预期答案。", "Hidden tests do not reveal inputs or expected answers.")}</li>
              <li>{ui(locale, "订正结果与原成绩分开记录。", "Correction results remain separate.")}</li>
              <li>{ui(locale, "经管理员公开审核的题目，其首次有效 AC 可获得排行积分。作业额外奖学金要求在截止前正式提交并通过，受每周上限约束。", "The first valid AC on an administrator-approved public problem earns leaderboard points. Assignment Scholarship requires a formal AC before the deadline and is subject to the weekly cap.")}</li>
            </ul>
          </section>
          {needsCorrection && <section className="border border-warning/25 bg-surface p-5 panel-shadow">
            <div className="flex gap-3">
              <CircleAlert className="mt-0.5 text-warning" size={18}/>
              <div>
                <h2 className="font-bold">{ui(locale, "需要订正", "Needs review")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{ui(locale, "重试前请检查边界情况。", "Review edge cases before retrying.")}</p>
                <AppLink href={`/student/submissions/${needsCorrection.id}`} className="mt-3 inline-flex text-sm font-semibold text-primary">{ui(locale, "查看提交 ", "Open submission ")}<ArrowRight size={14}/></AppLink>
              </div>
            </div>
          </section>}
        </aside>
      </div>
    </div>
    <section className="mt-6 border border-border bg-surface panel-shadow">
      <div className="border-b border-border px-4 py-3"><h2 className="font-bold">{ui(locale, "相关正式提交", "Related formal submissions")}</h2></div>
      <SubmissionRows items={formalSubmissions}/>
      <div className="border-t border-border bg-surface-subtle px-4 py-3 text-xs text-muted-foreground">{ui(locale, "订正结果不会覆盖原作业成绩。", "Correction results do not overwrite the original assignment score.")}</div>
    </section>
  </>}</State>;
}
export function SubmissionRows({ items }: { items: Submission[] }) { const { locale } = useLocale(); return items.length ? <div className="divide-y divide-border">{items.map(s => <AppLink key={s.id} href={`/student/submissions/${s.id}`} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm hover:bg-surface-subtle md:grid-cols-[110px_minmax(0,1fr)_120px_100px_24px]"><span className="font-mono text-xs font-semibold text-primary">{s.id}</span><span className="font-semibold">{s.problemTitle}</span><StatusPill status={statusLabel(locale, s.status)}/><span className="hidden font-semibold md:block">{score(s)}</span><ArrowRight size={14} className="hidden text-muted-foreground md:block"/></AppLink>)}</div> : <p className="p-5 text-sm text-muted-foreground">{ui(locale, "暂无正式提交。", "No formal submissions yet.")}</p>; }

export function StudentSubmissions({ user }: { user: CampusUser }) {
  const { locale } = useLocale();
  const [verdict, setVerdict] = useState(""), [context, setContext] = useState(""), [cursors, setCursors] = useState<(string | null)[]>([null]);
  const query = new URLSearchParams({ identityId: user.identityId, kind: "submit,correction", limit: "50", ...(verdict ? { status: verdict } : {}), ...(context ? { context } : {}), ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}) });
  const submissions = useData<{ items: Submission[]; nextCursor: string | null }>(`submissions?${query}`), assignments = useData<{ items: Assignment[] }>("assignments");
  const visible = formal(submissions.data?.items ?? []);
  function filter(setValue: (value: string) => void, value: string) { setValue(value); setCursors([null]); }
  return <><PageHeader eyebrow={ui(locale, "学习记录", "Your activity")} title={ui(locale, "提交记录", "Submissions")} description={ui(locale, "这里只列出正式提交，不包含样例或自定义运行。", "Formal submissions only. Sample and custom runs are not listed here.")}/><div className="mt-5 flex flex-wrap items-center gap-2 border border-border bg-surface p-3 panel-shadow"><StudentSubmissionFilter verdict={verdict} context={context} onVerdict={value => filter(setVerdict, value)} onContext={value => filter(setContext, value)}/></div><State data={submissions}>{visible.length ? <div className="mt-4 overflow-x-auto border border-border bg-surface panel-shadow"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>{[ui(locale, "提交编号", "Submission"), ui(locale, "题目", "Problem"), ui(locale, "来源", "Context"), ui(locale, "语言", "Language"), ui(locale, "判题结果", "Verdict"), ui(locale, "成绩", "Score"), ui(locale, "提交时间", "Submitted"), ui(locale, "操作", "Action")].map(t => <th key={t} className="px-4 py-3">{t}</th>)}</tr></thead><tbody>{visible.map(s => <tr key={s.id} className="border-t border-border hover:bg-surface-subtle"><td className="px-4 py-3 font-mono text-xs"><AppLink href={`/student/submissions/${s.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{s.id}</AppLink></td><td className="px-4 py-3"><AppLink href={`/student/submissions/${s.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{s.problemTitle}</AppLink></td><td className="max-w-[220px] px-4 py-3 text-muted-foreground">{sourceLabel(s, assignments.data?.items, locale)}</td><td className="px-4 py-3 text-muted-foreground">{languageInfo[submissionLanguage(s.language)].name}</td><td className="px-4 py-3"><StatusPill status={statusLabel(locale, s.status)}/></td><td className="px-4 py-3 font-semibold">{score(s)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{displayDate(s.createdAt, locale)}</td><td className="px-4 py-3"><AppLink href={`/student/submissions/${s.id}`} className="font-semibold text-primary">{ui(locale, "打开", "Open")}</AppLink></td></tr>)}</tbody></table></div> : <Empty title={ui(locale, "没有匹配的提交", "No matching submissions")} description={ui(locale, "调整筛选条件，或从题目工作区正式提交代码。", "Change the filters, or make a formal submission from a problem workspace.")}/>}</State>{submissions.data && <nav aria-label={ui(locale, "提交记录分页", "Submission history pages")} className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{ui(locale, `第 ${cursors.length} 页 · 本页 ${visible.length} 条`, `Page ${cursors.length} · ${visible.length} records on this page`)}</p><div className="flex gap-2"><Button variant="secondary" size="sm" aria-label={ui(locale, "上一页提交记录", "Previous submissions page")} disabled={submissions.loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>{ui(locale, "上一页", "Previous")}</Button><Button variant="secondary" size="sm" aria-label={ui(locale, "下一页提交记录", "Next submissions page")} disabled={submissions.loading || !submissions.data.nextCursor} onClick={() => { const next = submissions.data?.nextCursor; if (next) setCursors(values => [...values, next]); }}>{ui(locale, "下一页", "Next")}</Button></div></nav>}</>;
}
export function StudentSubmission({ id, user }: { id: string; user: CampusUser }) {
  const { locale } = useLocale();
  const router = useRouter();
  const polling = useSubmission(id), action = useMutation(), [notesOpen, setNotesOpen] = useState(false);
  const submission = polling.result, [notes, setNotes] = useState(["", "", ""]);
  const canCorrect = Boolean(submission && ["submit", "correction"].includes(submission.kind) && (!submission.timedPracticeId || submission.resultsVisible !== false && submission.score !== null) && !isPending(submission.status));
  return <>{!submission ? <div className={panel}><ResultPanel {...polling}/></div> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"><div className="min-w-0 space-y-5"><section className={`border-l-4 bg-surface p-5 panel-shadow ${submission.status === "AC" ? "border-success" : /system.?error/i.test(submission.status) ? "border-destructive" : "border-warning"}`}><p className="mb-2 text-xs text-muted-foreground">{submissionKindLabel(locale, submission.kind)} · {ui(locale, "只读记录", "Read-only record")}</p><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="flex min-w-0 gap-3">{submission.status === "AC" ? <CheckCircle2 className="mt-1 shrink-0 text-success"/> : <CircleAlert className="mt-1 shrink-0 text-warning"/>}<div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{submission.id}</h1>{submission.kind === "correction" && <span className="rounded bg-success-soft px-2 py-1 text-xs font-semibold text-success">{ui(locale, "订正结果", "Correction result")}</span>}</div><p className="mt-1 font-semibold">{submission.problemTitle}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{submission.message || (submission.kind === "correction" ? ui(locale, "此订正单独记录，不覆盖原活动成绩。", "This correction is recorded separately and does not overwrite the original activity score.") : ui(locale, "隐藏测试不会公开输入或预期答案。", "Hidden tests do not reveal their input or expected answer."))}</p></div></div><div className="sm:text-right"><ResultScore result={submission}/><div className="mt-2 text-xs text-muted-foreground">{submission.passed == null ? ui(locale, "结果不可用", "Results unavailable") : ui(locale, `${submission.passed}/${submission.total} 个测试通过`, `${submission.passed}/${submission.total} tests passed`)}</div></div></div>{polling.error && <p role="alert" className="mt-3 text-sm text-destructive">{polling.error}</p>}{isPending(submission.status) && <Button variant="secondary" className="mt-3" onClick={polling.reload}>{ui(locale, "刷新结果", "Refresh result")}</Button>}</section><section className={panel}><ResultPanel {...polling}/></section>{submission.reviews?.filter(r => !ownNote(r, user)).map(r => <section key={r.id} className="border border-border bg-info-soft p-4"><p className="text-xs font-bold uppercase text-primary">{ui(locale, "教师反馈", "Teacher feedback")}</p><p className="mt-1 whitespace-pre-wrap text-sm">{r.note}</p><p className="mt-2 text-xs text-muted-foreground">{r.authorName} · {displayDate(r.createdAt, locale)}</p></section>)}<section className="border border-border bg-surface panel-shadow"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 font-bold"><Code2 size={17}/>{ui(locale, " 已提交代码", " Submitted code")}</h2><span className="text-xs text-muted-foreground">{languageInfo[submissionLanguage(submission.language)].file} · {languageInfo[submissionLanguage(submission.language)].runtime}</span></div><CodeBlock code={submission.code} language={submissionLanguage(submission.language)}/></section></div><aside className="space-y-5"><section className={panel}><h2 className="font-bold">{ui(locale, "提交详情", "Submission details")}</h2><dl className="mt-4 space-y-3 text-sm">{[[ui(locale, "提交时间", "Submitted"), displayDate(submission.createdAt, locale)], [ui(locale, "来源", "Context"), sourceLabel(submission, [], locale)], [ui(locale, "题目版本", "Problem version"), submission.versionId ? shortId(submission.versionId) : "—"], [ui(locale, "语言", "Language"), languageInfo[submissionLanguage(submission.language)].runtime]].map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-muted-foreground">{key}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl></section>{canCorrect && <section className="space-y-2"><AppLink href={problemHref({ problemId: submission.problemId }, { originalSubmissionId: submission.originalSubmissionId ?? id, sourceLabel: "Review Notebook" })} className={`${buttonVariants()} w-full`}>{ui(locale, "重新尝试 ", "Try again ")}<ArrowRight size={15}/></AppLink><Button variant="secondary" className="w-full" onClick={() => setNotesOpen(true)}><NotebookPen size={15}/>{ui(locale, "加入订正本", "Add to Review Notebook")}</Button>{submission.originalSubmissionId && <AppLink href={`/student/submissions/${submission.originalSubmissionId}`} className={`${buttonVariants({ variant: "ghost" })} w-full`}>{ui(locale, "查看原提交", "View original")} {submission.originalSubmissionId}</AppLink>}</section>}<section className="border border-border bg-surface p-4 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">{ui(locale, "成绩说明", "Score note")}</strong><br/>{ui(locale, "订正结果与原活动成绩分开记录。", "Correction results remain separate from the original activity score.")}</section></aside></div>}<Dialog open={notesOpen} onOpenChange={setNotesOpen}><DialogContent className="fixed inset-y-0 left-auto right-0 h-full w-full max-w-[420px] translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none"><DialogTitle>{ui(locale, "订正本", "Review Notebook")}</DialogTitle><DialogDescription>{ui(locale, "记录错误原因、修改和下一次测试。笔记保存到当前提交，原成绩保持不变。", "Record the cause, change, and next test. Notes are saved to this submission without changing the original grade.")}</DialogDescription><form onSubmit={e => { e.preventDefault(); action.run(async () => { const entry = await productionApi<{ id: string }>("review-notebook", { method: "POST", body: { submissionId: id, note: ["What went wrong", "What I changed", "What I will test next"].map((label, i) => `${label}\n${notes[i]}`).join("\n\n") } }); router.push(`/student/review-notebook/${entry.id}`); }); }}>{["What went wrong", "What I changed", "What I will test next"].map((label, index) => <label key={label} className="mt-5 block text-sm font-semibold">{ui(locale, ["错误原因", "修改内容", "下次测试"][index], label)}<textarea aria-label={ui(locale, ["错误原因", "修改内容", "下次测试"][index], label)} value={notes[index]} onChange={e => setNotes(values => values.map((v, i) => i === index ? e.target.value : v))} rows={3} required={index === 0} maxLength={2500} className={`mt-2 ${textarea}`}/></label>)}<Button className="mt-5 w-full" disabled={action.busy}>{ui(locale, "保存订正记录", "Save correction record")}</Button><Feedback action={action}/></form></DialogContent></Dialog></>;
}

interface NotebookEntry extends ReviewEntry { status?: string; timedPracticeId?: string | null; authorIdentityId?: string; }
function ownNote(note: { authorIdentityId?: string; authorName?: string; teacherFeedback?: boolean }, user: CampusUser) {
  if (typeof note.teacherFeedback === "boolean") return !note.teacherFeedback;
  return note.authorIdentityId ? note.authorIdentityId === user.identityId : note.authorName === user.name;
}
function notebookGroups(entries: NotebookEntry[], submissions: Submission[], user: CampusUser) {
  const grouped = new Map<string, NotebookEntry[]>();
  for (const entry of entries) { const key = entry.originalSubmissionId ?? entry.submissionId; grouped.set(key, [...(grouped.get(key) ?? []), entry]); }
  return [...grouped.entries()].map(([originalId, notes]) => {
    const original = submissions.find(s => s.id === originalId), correction = submissions.find(s => s.kind === "correction" && s.originalSubmissionId === originalId);
    const originalStatus = original?.status ?? notes[0].originalStatus;
    const feedback = notes.find(note => !ownNote(note, user));
    const correctionStatus = correction?.status ?? notes.find(note => note.originalSubmissionId)?.status;
    const state = reviewNotebookState(originalStatus, correctionStatus, Boolean(feedback));
    return { originalId, original, originalStatus, correction, feedback, latest: notes[0], state };
  });
}
export function StudentNotebook({ user }: { user: CampusUser }) {
  const { locale } = useLocale();
  const notebook = useData<{ items: NotebookEntry[] }>("review-notebook"), submissions = useData<{ items: Submission[] }>(`submissions?identityId=${user.identityId}&kind=submit,correction`), assignments = useData<{ items: Assignment[] }>("assignments");
  const [filter, setFilter] = useState("All");
  const groups = notebookGroups(notebook.data?.items ?? [], submissions.data?.items ?? [], user), visible = groups.filter(g => filter === "All" || g.state === filter);
  return <><PageHeader eyebrow={ui(locale, "订正", "Correction")} title={ui(locale, "订正本", "Review Notebook")} description={ui(locale, "原活动成绩与后续订正分开记录。", "Original activity results and later corrections remain separate.")}/><Tabs items={notebookFilters.map(value => notebookStateLabel(locale, value))} value={notebookStateLabel(locale, filter)} onChange={value => setFilter(notebookFilters.find(state => notebookStateLabel(locale, state) === value) ?? "All")} label={ui(locale, "订正状态", "Correction status")}/><State data={notebook}>{visible.length ? <div className="mt-4 overflow-x-auto border border-border bg-surface panel-shadow"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>{[ui(locale, "题目", "Problem"), ui(locale, "来源活动", "Source activity"), ui(locale, "原始结果", "Original result"), ui(locale, "最近订正", "Latest correction"), ui(locale, "状态", "Status"), ui(locale, "教师反馈", "Teacher feedback"), ui(locale, "最近练习", "Latest practice"), ui(locale, "操作", "Action")].map(t => <th key={t} className="px-4 py-3">{t}</th>)}</tr></thead><tbody>{visible.map(group => <tr key={group.originalId} className="border-t border-border"><td className="px-4 py-3"><AppLink href={`/student/review-notebook/${group.latest.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{group.latest.problemTitle}</AppLink></td><td className="max-w-[200px] px-4 py-3">{group.original ? sourceLabel(group.original, assignments.data?.items, locale) : ui(locale, "提交", "Submission")}</td><td className="px-4 py-3"><StatusPill status={group.original ? `${statusLabel(locale, group.original.status)} · ${score(group.original)}` : group.originalStatus ? statusLabel(locale, group.originalStatus) : ui(locale, "不可用", "Not available")}/></td><td className="px-4 py-3"><StatusPill status={group.correction ? `${statusLabel(locale, group.correction.status)} · ${score(group.correction)}` : ui(locale, "未重试", "Not retried")}/></td><td className="px-4 py-3">{notebookStateLabel(locale, group.state)}</td><td className="max-w-[200px] px-4 py-3 text-muted-foreground">{group.feedback?.note || "—"}</td><td className="px-4 py-3 text-xs">{displayDate(group.correction?.createdAt ?? group.latest.createdAt, locale)}</td><td className="px-4 py-3"><AppLink href={`/student/review-notebook/${group.latest.id}`} className="font-semibold text-primary">{ui(locale, "打开", "Open")}</AppLink></td></tr>)}</tbody></table></div> : <Empty title={ui(locale, "暂无订正记录", "No correction records")} description={ui(locale, "从提交详情选择“加入订正本”，记录错误原因和下一次测试。", "Choose Add to Review Notebook from a submission to record the cause and next test.")}/>}</State></>;
}
function splitNotes(note: string) {
  const headings = ["What went wrong", "What I changed", "What I will test next"];
  return headings.map((heading, index) => { const start = note.indexOf(`${heading}\n`); if (start < 0) return index === 0 ? note : ""; const next = index < headings.length - 1 ? note.indexOf(`\n\n${headings[index + 1]}\n`, start) : -1; return note.slice(start + heading.length + 1, next >= 0 ? next : undefined); });
}
interface NotebookDetail extends NotebookEntry { relatedNotes: NotebookEntry[]; latestCorrectionId: string | null; }
export function StudentReview({ id, user }: { id: string; user: CampusUser }) {
  const notebook = useData<NotebookDetail>(`review-notebook/${encodeURIComponent(id)}`);
  const entry = notebook.data;
  const personalNote = entry?.relatedNotes.find(note => ownNote(note, user))?.note ?? (entry && ownNote(entry, user) ? entry.note : "");
  return <><State data={notebook}>{entry && <ReviewBody key={entry.id} entry={entry} personalNote={personalNote} user={user}/>}</State></>;
}
function ReviewBody({ entry, personalNote, user }: { entry: NotebookDetail; personalNote: string; user: CampusUser }) {
  const { locale } = useLocale();
  const router = useRouter();
  const originalId = entry.originalSubmissionId ?? entry.submissionId;
  const original = useSubmission(originalId), correction = useSubmission(entry.latestCorrectionId);
  const [notes, setNotes] = useState(() => splitNotes(personalNote)), action = useMutation();
  const teacherFeedback = entry.relatedNotes.filter(note => !ownNote(note, user));
  const feedbackOnly = reviewNotebookState(original.result?.status ?? entry.originalStatus, correction.result?.status, Boolean(teacherFeedback.length)) === "Feedback received";
  const feedbackPanel = <section className="mt-5 border border-border bg-info-soft p-5">
    <h2 className="flex items-center gap-2 font-bold"><MessageSquareText size={17}/>{ui(locale, "教师反馈", "Teacher feedback")}</h2>
    {teacherFeedback.length ? teacherFeedback.map(note => <div key={note.id} className="mt-3">
      <p className="whitespace-pre-wrap text-sm">{note.note}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note.authorName} · {displayDate(note.createdAt, locale)}</p>
    </div>) : <p className="mt-2 text-sm text-muted-foreground">{ui(locale, "暂无教师反馈。", "No teacher feedback yet.")}</p>}
  </section>;
  return <><PageHeader eyebrow={`${shortId(entry.id)} · ${feedbackOnly ? ui(locale, "教师反馈", "Teacher feedback") : ui(locale, "订正记录", "Correction record")}`} title={entry.problemTitle ?? ui(locale, "订正", "Correction")} description={feedbackOnly ? ui(locale, "原提交已通过。", "The original submission was accepted.") : ui(locale, "保留原活动成绩，订正结果独立记录。", "Original activity scores are preserved; correction results remain independent.")} action={feedbackOnly ? undefined : <AppLink href={problemHref({ problemId: entry.problemId }, { originalSubmissionId: originalId, sourceLabel: "Review Notebook", returnTo: `/student/review-notebook/${entry.id}` })} className={buttonVariants()}>{ui(locale, "重试题目", "Retry problem")} <ArrowRight size={15}/></AppLink>}/>{feedbackPanel}<div className="mt-5 grid gap-4 md:grid-cols-2"><section className={panel}><div className="text-xs font-semibold uppercase text-muted-foreground">{ui(locale, "原活动提交", "Original activity submission")}</div><div className="mt-2 flex items-center justify-between gap-2"><AppLink href={`/student/submissions/${originalId}`} className="font-mono font-bold text-primary">{originalId}</AppLink>{original.result ? <ResultScore result={original.result}/> : <span className="text-sm text-muted-foreground">{ui(locale, "加载中…", "Loading\u2026")}</span>}</div><p className="mt-2 text-xs text-muted-foreground">{ui(locale, "计入原活动成绩。", "Counts toward the original activity.")}</p></section><section className={panel}><div className="text-xs font-semibold uppercase text-muted-foreground">{ui(locale, "订正提交", "Correction submission")}</div><div className="mt-2 flex items-center justify-between gap-2">{correction.result ? <><AppLink href={`/student/submissions/${correction.result.id}`} className="font-mono font-bold text-primary">{correction.result.id}</AppLink><ResultScore result={correction.result}/></> : <span className="text-sm text-muted-foreground">{ui(locale, "暂无订正提交。", "No correction received yet.")}</span>}</div><p className="mt-2 text-xs text-muted-foreground">{ui(locale, "订正独立记录，不会覆盖原提交。", "Independent correction; does not overwrite the original.")}</p></section></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="min-w-0 border border-border bg-surface panel-shadow"><h2 className="border-b border-border px-4 py-3 font-bold"><Code2 className="mr-2 inline" size={17}/>{ui(locale, "代码对比", "Code comparison")}</h2><div className="grid divide-border sm:grid-cols-2 sm:divide-x"><CodeBlock label={`${originalId} · ${ui(locale, "原提交", "original")}`} code={original.result?.code ?? ""}/><CodeBlock label={`${correction.result?.id ?? ui(locale, "暂无提交", "No submission")} · ${ui(locale, "订正", "correction")}`} code={correction.result?.code ?? ""}/></div>{original.error && <p role="alert" className="p-4 text-sm text-destructive">{original.error}</p>}</section><form className={panel} onSubmit={event => { event.preventDefault(); action.run(async () => { const result = await productionApi<{ id: string }>("review-notebook", { method: "POST", body: { submissionId: correction.result?.id ?? originalId, note: ["What went wrong", "What I changed", "What I will test next"].map((heading, i) => `${heading}\n${notes[i]}`).join("\n\n") } }); action.success(ui(locale, "个人笔记已保存。", "Personal notes saved.")); if (result.id) router.push(`/student/review-notebook/${result.id}`); }); }}><h2 className="font-bold">{ui(locale, "个人笔记", "Personal notes")}</h2>{["What went wrong", "What I changed", "What I will test next"].map((label, index) => <label key={label} className="mt-4 block text-sm font-semibold">{ui(locale, ["错误原因", "修改内容", "下次测试"][index], label)}<textarea aria-label={ui(locale, ["错误原因", "修改内容", "下次测试"][index], label)} value={notes[index]} onChange={event => setNotes(values => values.map((v, i) => i === index ? event.target.value : v))} rows={2} required={index === 0} maxLength={2500} className={`mt-2 ${textarea}`}/></label>)}<Button type="submit" className="mt-3" disabled={action.busy}>{ui(locale, "保存笔记", "Save notes")}</Button><Feedback action={action}/></form></div></>;
}

export function AlignedProfile({ user, teacher = false, admin = false }: { user: CampusUser; teacher?: boolean; admin?: boolean }) {
  const { locale } = useLocale();
  const classes = useData<{ items: SchoolClass[] }>("classes"), [email, setEmail] = useState(user.email ?? ""), [draft, setDraft] = useState(user.email ?? ""), [editing, setEditing] = useState(false), [passwordOpen, setPasswordOpen] = useState(false);
  const emailAction = useMutation(), passwordAction = useMutation();
  return <><PageHeader eyebrow={ui(locale, "个人设置", "SETTINGS")} title={ui(locale, "个人设置", "Settings")} description={ui(locale, `查看身份信息，维护账号资料。姓名、${admin ? "身份编号" : teacher ? "工号和负责班级" : "学号和班级"}由管理员维护，如有错误请联系管理员修改。`, `Review your school identity and account. Your name, ${admin ? "identity number" : teacher ? "teacher ID and assigned classes" : "student ID and classes"} are managed by an administrator; contact them to correct errors.`)}/><div className="mt-5 grid gap-4 lg:grid-cols-2"><section className={panel}><div className="flex items-center justify-between"><h2 className="font-bold">{ui(locale, '身份信息', 'Identity information')}</h2><span className="rounded bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success">{ui(locale, '已激活', 'Activated')}</span></div><dl className="mt-4 space-y-3 text-sm">{[[ui(locale, "姓名", "Name"), user.name], [admin ? ui(locale, "身份编号", "Identity ID") : teacher ? ui(locale, "工号", "Teacher ID") : ui(locale, "学号", "Student ID"), user.number], [ui(locale, "性别", "Gender"), ui(locale, genderLabel(user.gender), ({ male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" } as Record<string, string>)[user.gender ?? ""] ?? "Not provided")], ...(!admin ? [[teacher ? ui(locale, "负责班级", "Assigned classes") : ui(locale, "所在班级", "Classes"), classes.data?.items.filter(c => (teacher ? c.teacherIds : c.studentIds).includes(user.identityId)).map(c => c.name).join("、") || (classes.loading ? ui(locale, "正在加载…", "Loading…") : ui(locale, "未分配", "Unassigned"))]] : []), [ui(locale, "激活时间", "Activated"), displayDate((user as CampusUser & {activatedAt?:string}).activatedAt, locale)]].map(([key, value]) => <div key={key} className="grid grid-cols-[110px_1fr]"><dt className="text-muted-foreground">{key}</dt><dd className="break-words font-semibold">{value}</dd></div>)}</dl>{!admin && classes.error && <p role="alert" className="mt-3 text-sm text-destructive">{classes.error}</p>}<p className="mt-4 border border-border bg-info-soft p-3 text-xs leading-5 text-muted-foreground">{ui(locale, '姓名、编号和班级由管理员统一维护；性别可在「个人资料」中修改。如身份信息有误，请联系管理员在「身份档案」中更正。', 'Names, IDs, and class membership are managed by an administrator. Gender can be changed on your profile. Contact an administrator to correct identity details.')}</p></section><section className={panel}><h2 className="font-bold">{ui(locale, '账号信息', 'Account information')}</h2><dl className="mt-4 space-y-3 text-sm"><div className="grid grid-cols-[110px_1fr]"><dt className="text-muted-foreground">{ui(locale, '用户名', 'Username')}</dt><dd className="font-mono font-semibold">{user.username}</dd></div><div className="grid grid-cols-[110px_1fr] items-start"><dt className="text-muted-foreground">{ui(locale, '联系邮箱', 'Contact email')}</dt><dd>{editing ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); emailAction.run(async () => { const result = await productionApi<AuthResponse>("auth/profile", { method: "PATCH", body: { email: draft.trim() } }); setEmail(result.user.email ?? ""); setEditing(false); emailAction.success(ui(locale, "联系邮箱已更新。", "Contact email updated.")); }); }}><label className="sr-only" htmlFor="profile-email">{ui(locale, '联系邮箱', 'Contact email')}</label><input id="profile-email" type="email" autoComplete="email" maxLength={254} value={draft} onChange={event => setDraft(event.target.value)} className={input}/><div className="flex gap-2"><Button type="submit" size="sm" disabled={emailAction.busy}>{ui(locale, '保存', 'Save')}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(email); }}><X size={14}/>{ui(locale, '取消', 'Cancel')}</Button></div></form> : <div className="flex flex-wrap items-center gap-2"><span className="break-all font-semibold">{email || ui(locale, "未设置", "Not set")}</span><Button size="sm" variant="ghost" onClick={() => { setEditing(true); setDraft(email); }}><Pencil size={13}/>{ui(locale, '修改', 'Edit')}</Button></div>}</dd></div></dl><Feedback action={emailAction}/><div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 font-bold"><KeyRound size={15} className="text-primary"/>{ui(locale, '修改密码', 'Change password')}</h3><Button size="sm" variant="secondary" aria-expanded={passwordOpen} onClick={() => setPasswordOpen(!passwordOpen)}>{passwordOpen ? ui(locale, "收起", "Collapse") : ui(locale, "修改密码", "Change password")}</Button></div>{passwordOpen && <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget, fields = new FormData(form); passwordAction.run(async () => { if (fields.get("newPassword") !== fields.get("confirmation")) throw new Error(ui(locale, "两次输入的新密码不一致。", "The new passwords do not match.")); await productionApi<AuthResponse>("auth/profile", { method: "PATCH", body: { currentPassword: fields.get("currentPassword"), newPassword: fields.get("newPassword") } }); form.reset(); passwordAction.success(ui(locale, "密码已修改，其他旧会话已撤销。", "Password changed; other old sessions revoked.")); }); }}>{[{ name: "currentPassword", label: ui(locale, "当前密码", "Current password") }, { name: "newPassword", label: ui(locale, "新密码", "New password") }, { name: "confirmation", label: ui(locale, "确认新密码", "Confirm new password") }].map(field => <label key={field.name} className="block text-sm font-semibold">{field.label}<input type="password" name={field.name} required minLength={field.name === "currentPassword" ? undefined : 8} maxLength={128} autoComplete={field.name === "currentPassword" ? "current-password" : "new-password"} className={`mt-1 ${input}`}/></label>)}<p className="text-xs text-muted-foreground">{ui(locale, '新密码至少 8 位。', 'New passwords must be at least 8 characters.')}</p><Button size="sm" type="submit" disabled={passwordAction.busy}>{ui(locale, '保存新密码', 'Save new password')}</Button><Feedback action={passwordAction}/></form>}</div><p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary"/>{ui(locale, '忘记密码或账号被禁用，请联系管理员在「账号与角色」中重置或启用。', 'If you forgot your password or your account is disabled, contact an administrator to reset or enable it.')}</p></section></div></>;
}

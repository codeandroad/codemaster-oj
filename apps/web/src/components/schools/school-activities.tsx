"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Download, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/page-chrome";
import { useLocale } from "@/components/locale-context";
import { StudentAssignmentCard, StudentTimedPracticeCard, StudentTimedPracticeTabs, timedPracticeCategoryLabel } from "@/components/student/activity-cards";
import { Progress } from "@/components/student/dashboard-view";
import { date, Empty, Feedback, State, useData, useMutation } from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import { PracticeProblem } from "./school-practice";
import { SchoolActivityScholarshipRule } from "./school-scholarship";
import { SchoolActivityEditor } from "./school-activity-editor";
import { useSchoolText, type School } from "./school-ui";
import { activityCsvCell, type ActivityKind, type ActivityReport, type SchoolActivity } from "./school-activities-model";

const panel = "overflow-hidden rounded-lg border border-border bg-surface";
const th = "whitespace-nowrap px-3 py-2.5 font-medium";
const td = "px-3 py-3";
const labels: Record<string, [string, string]> = { Draft: ["Draft", "草稿"], Published: ["Published", "已发布"], Archived: ["Archived", "已归档"], Upcoming: ["Upcoming", "未开始"], Open: ["Open", "进行中"], Ended: ["Ended", "已结束"] };

const timingCategories = ["Upcoming", "Available", "Completed"] as const;
type SchoolTimingCategory = (typeof timingCategories)[number];

export function SchoolActivities({ school, kind }: { school: School; kind: ActivityKind }) {
  const text = useSchoolText(), { locale } = useLocale(), search = useSearchParams(), router = useRouter();
  const activityId = search.get("activityId"), problemId = search.get("problemId");
  const creating = search.get("activityEdit") === "new", editing = search.get("activityEdit") === "1", report = search.get("activityReport") === "1";
  const archived = search.get("activityArchived") === "1", rawPage = Number(search.get("activityPage") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1;
  const timing = timingCategories.find(item => item.toLowerCase() === search.get("activityTiming")) ?? "Available";
  const base = `schools/${school.id}/activities`;
  const teaching = school.roles.some(r => r === "teacher" || r === "school_admin");
  const list = useData<{ items: SchoolActivity[]; page: number; hasMore: boolean; canCreate: boolean }>(teaching && !activityId && !creating ? `${base}?kind=${kind}&page=${page}&archived=${archived}` : "");
  const preview = search.get("activityPreview") === "1";
  const activityPath = activityId ? `${base}/${activityId}${preview ? "/preview" : ""}` : "";
  const detail = useData<SchoolActivity>(activityPath);
  const view = detail.data?.id === activityId && Boolean(detail.data.preview) === preview ? detail.data : null;
  function go(values: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(values)) if (value == null) params.delete(key); else params.set(key, value);
    router.push(`/schools?${params}`, { scroll: false });
  }
  const back = () => go({ activityId: null, problemId: null, activityEdit: null, activityReport: null, activityPreview: null });
  if (teaching && (creating || editing && view?.canManage)) return <SchoolActivityEditor key={`${school.id}:${kind}:${activityId ?? "new"}`} schoolId={school.id} kind={kind} activity={creating ? null : view} onCancel={creating ? back : () => go({ activityEdit: null })} onSaved={activity => { go({ activityId: activity.id, activityEdit: null, problemId: null }); detail.reload(); list.reload(); }}/>;
  if (activityId) return <>
    {preview && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3">
      <div>
        <p className="text-sm font-semibold">{text("Student view · Assignment preview", "学生视角 · 作业试做")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text("Your submissions and scores are private. You can try the saved assignment outside the student submission window.", "提交和得分仅本人可见，可在学生提交时段之外试做已保存的作业。")}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => go({ activityPreview: null, problemId: null })}>{text("Exit preview", "退出试做")}</Button>
    </div>}
    <State data={{ ...detail, data: view }}>{view && (problemId ?
      <PracticeProblem key={`${activityPath}:${problemId}`} path={`${activityPath}/problems/${problemId}`}
        jobPath={id => `${activityPath}/jobs/${id}`} onBack={() => { go({ problemId: null }); detail.reload(); }}
        backLabel={preview ? text("Back to preview", "返回试做") : text(kind === "timed" ? "Back to timed practice" : "Back to assignment", kind === "timed" ? "返回限时训练" : "返回作业")}
        navigation={{ currentId: problemId, items: view.problems, onSelect: id => go({ problemId: id }) }}/> :
      report && view.canManage ? <SchoolActivityReportView base={base} activityId={activityId} onBack={() => go({ activityReport: null })}/> :
      <SchoolActivityDetails activity={view} base={base} onBack={preview ? () => go({ activityPreview: null }) : back}
        onEdit={() => go({ activityEdit: "1" })} onReport={() => go({ activityReport: "1" })}
        onPreview={() => go({ activityPreview: "1", activityReport: null, activityEdit: null, problemId: null })}
        onProblem={id => go({ problemId: id })} reload={detail.reload}/>)}</State>
  </>;
  if (!teaching) return <>
    {kind === "timed" && <StudentTimedPracticeTabs categories={timingCategories} value={timing} onChange={value => {
      go({ activityTiming: value.toLowerCase(), activityPage: null, activityEdit: null });
    }} />}
    <SchoolStudentActivityCards
      key={`${school.id}:${kind}:${timing}:${page}`}
      schoolId={school.id}
      kind={kind}
      page={page}
      timing={timing}
      onPageChange={next => go({ activityPage: String(next), activityEdit: null })}
    />
  </>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{teaching && <>{[false, true].map(value => <Button key={String(value)} size="sm" variant={archived === value ? "default" : "secondary"} onClick={() => go({ activityArchived: value ? "1" : null, activityPage: null })}>{value ? text("Archived", "已归档") : text("Active", "使用中")}</Button>)}</>}</div><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={list.loading} onClick={list.reload} aria-label={text("Refresh activities", "刷新活动")}><RefreshCw size={15}/></Button>{teaching && <Button size="sm" onClick={() => go({ activityEdit: "new" })}><Plus size={16}/>{text(kind === "timed" ? "New timed practice" : "New assignment", kind === "timed" ? "新建限时训练" : "新建作业")}</Button>}</div></div>
    <State data={list}><section className={panel}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-subtle text-muted-foreground"><tr><th className={th}>{text("Title", "名称")}</th><th className={th}>{text("Status", "状态")}</th><th className={th}>{text("Problems", "题目")}</th><th className={th}>{teaching ? text("Students", "学生") : text("Progress", "进度")}</th><th className={th}>{text("Deadline", "截止时间")}</th><th className={th}>{text("Actions", "操作")}</th></tr></thead><tbody>{list.data?.items.map(a => <tr key={a.id} className="border-t border-border"><td className={td}><button className="text-left font-semibold text-primary hover:underline" onClick={() => go({ activityId: a.id })}>{a.title}</button>{a.kind === "timed" && <p className="mt-1 text-xs text-muted-foreground">{a.durationMinutes} {text("minutes", "分钟")}</p>}</td><td className={td}>{text(...(labels[a.phase] ?? [a.phase, a.phase]))}{a.resultsPublishedAt && <span className="mt-1 block text-xs text-success">{text("Results published", "成绩已公布")}</span>}</td><td className={td}>{a.problems.length}</td><td className={td}>{teaching ? a.participantCount : a.grade ? `${a.grade.solved}/${a.problems.length}` : a.attempt ? text("Started", "已开始") : "—"}</td><td className={`${td} text-muted-foreground`}>{date(a.endsAt, locale)}</td><td className={td}><Button size="sm" variant="ghost" onClick={() => go({ activityId: a.id })}>{text("Open", "打开")}<ArrowRight size={14}/></Button></td></tr>)}</tbody></table></div>{!list.data?.items.length && <p className="p-8 text-center text-sm text-muted-foreground">{text("No activities here yet.", "暂无活动。")}</p>}<div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2"><Button size="sm" variant="ghost" disabled={list.loading || (list.data?.page ?? 1) <= 1} onClick={() => go({ activityPage: String(Math.max(1, (list.data?.page ?? 1) - 1)) })}>{text("Previous", "上一页")}</Button><span className="text-sm tabular-nums">{list.data?.page ?? 1}</span><Button size="sm" variant="ghost" disabled={list.loading || !list.data?.hasMore} onClick={() => go({ activityPage: String((list.data?.page ?? 1) + 1) })}>{text("Next", "下一页")}</Button></div></section></State>
  </div>;
}

function SchoolStudentActivityCards({
  schoolId, kind, timing, page, onPageChange,
}: {
  schoolId: string;
  kind: ActivityKind;
  timing: SchoolTimingCategory;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useLocale();
  const text = useSchoolText();
  const params = new URLSearchParams({ kind, page: String(page) });
  if (kind === "timed") params.set("timingCategory", timing.toLowerCase());
  const list = useData<{ items: SchoolActivity[]; hasMore: boolean }>(`schools/${schoolId}/activities?${params}`);
  const items = list.data?.items ?? [];
  const href = (id: string) => {
    const params = new URLSearchParams({ schoolId, section: kind === "timed" ? "timed" : "assignments", activityId: id });
    if (kind === "timed") params.set("activityTiming", timing.toLowerCase());
    if (page > 1) params.set("activityPage", String(page));
    return `/schools?${params}`;
  };
  return <State data={list}>
    {items.length ? <div className="mt-5 grid gap-4">
      {items.map(activity => activity.kind === "timed" ? <StudentTimedPracticeCard
        key={activity.id}
        title={activity.title}
        href={href(activity.id)}
        status={timedPracticeCategoryLabel(locale, timing)}
        startsAt={activity.startsAt}
        endsAt={activity.endsAt}
        durationMinutes={activity.durationMinutes}
        problemCount={activity.problems.length}
        active={timing === "Available"}
      /> : <StudentAssignmentCard
        key={activity.id}
        title={activity.title}
        href={href(activity.id)}
        status={text(...(labels[activity.phase] ?? [activity.phase, activity.phase]))}
        dueAt={activity.endsAt}
        archived={activity.phase === "Archived"}
        problemCount={activity.problems.length}
        score={activity.grade?.score ?? null}
        maxScore={activity.grade?.total ?? activity.problems.reduce((sum, problem) => sum + problem.points, 0)}
        attempted={activity.grade?.items.filter(item => item.activityAttempts > 0).length ?? 0}
        solved={activity.grade?.solved ?? 0}
        active={activity.phase === "Open"}
      />)}
    </div> : <Empty title={kind === "timed"
      ? text(`No ${timing.toLowerCase()} practice`, `暂无${timedPracticeCategoryLabel(locale, timing)}的训练`)
      : text("No assignments yet", "暂无作业")}
    />}
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={list.loading} onClick={list.reload} aria-label={text("Refresh activities", "刷新活动")}><RefreshCw size={15} /></Button>
      {(page > 1 || list.data?.hasMore) && <>
        <Button size="sm" variant="ghost" disabled={list.loading || page === 1} onClick={() => onPageChange(page - 1)}>{text("Previous", "上一页")}</Button>
        <span className="text-sm tabular-nums">{page}</span>
        <Button size="sm" variant="ghost" disabled={list.loading || !list.data?.hasMore} onClick={() => onPageChange(page + 1)}>{text("Next", "下一页")}</Button>
      </>}
    </div>
  </State>;
}

function SchoolActivityDetails({ activity: a, base, onBack, onEdit, onReport, onPreview, onProblem, reload }: {
  activity: SchoolActivity; base: string; onBack: () => void; onEdit: () => void; onReport: () => void; onPreview: () => void; onProblem: (id: string) => void; reload: () => void;
}) {
  const text = useSchoolText(), { locale } = useLocale(), action = useMutation();
  const [confirmation, setConfirmation] = useState<"publish" | "archive" | "end" | "finish" | "publish-results" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const start = () => void action.run(async () => { await productionApi(`${base}/${a.id}/start`, { method: "POST" }); reload(); });
  const canEnter = a.canManage || a.phase !== "Upcoming" && (a.kind === "assignment" || !!a.resultsPublishedAt || a.phase === "Open" && !!a.attempt && !a.attempt.finishedAt && (!a.attempt.deadlineAt || now < +new Date(a.attempt.deadlineAt)));
  const problemCount = a.problems.length;
  const complete = a.kind === "assignment" && problemCount > 0 && a.grade?.solved === problemCount;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={15}/>{a.preview ? text("Back to assignment", "返回作业管理") : text(kindLabel(a.kind), a.kind === "timed" ? "限时训练" : "作业")}</Button><div className="flex flex-wrap gap-2">{a.canManage && <>{a.canPreview && <Button size="sm" variant="secondary" onClick={onPreview}>{text("Try as a student", "以学生视角试做")}</Button>}<Button size="sm" variant="secondary" onClick={onReport}>{text("Report", "报告")}</Button>{a.state === "Draft" && <><Button size="sm" variant="secondary" onClick={onEdit}>{text("Edit draft", "编辑草稿")}</Button><Button size="sm" onClick={() => setConfirmation("publish")}>{text("Publish", "发布")}</Button></>}{a.kind === "timed" && a.state === "Published" && !a.resultsPublishedAt && <><Button size="sm" variant="secondary" disabled={a.phase !== "Open"} onClick={() => setConfirmation("end")}>{text("End activity", "结束活动")}</Button><Button size="sm" disabled={a.phase !== "Ended"} onClick={() => setConfirmation("publish-results")}>{text("Publish results", "公布成绩")}</Button></>}{a.state !== "Archived" && <Button size="sm" variant="ghost" disabled={a.kind === "timed" && a.state === "Published" && !a.resultsPublishedAt} onClick={() => setConfirmation("archive")}>{text("Archive", "归档")}</Button>}</>}<Button size="sm" variant="ghost" onClick={reload} aria-label={text("Refresh activity", "刷新活动")}><RefreshCw size={15}/></Button></div></div><Feedback action={action}/>
    <section className={`${panel} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-primary">{a.id.slice(0, 8)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-bold [overflow-wrap:anywhere]">{a.title}</h1>
            {complete && <StatusPill status="Completed" icon={<Check size={13} />} />}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {!a.preview && (!complete || a.state === "Archived") && <>{text(...(labels[a.phase] ?? [a.phase, a.phase]))} · </>}
            {problemCount} {text("problems", "道题")} · {text("Due", "截止")} {date(a.endsAt, locale)}
            {a.kind === "timed" && ` · ${a.durationMinutes} ${text("min", "分钟")}`}
          </p>
        </div>
        {a.grade && <div className="text-right">
          {a.preview && <p className="text-sm text-muted-foreground">{text("Preview score", "试做得分")}</p>}
          <b className="text-3xl">{a.grade.score}/{a.grade.total}</b>
          <p className="mt-1 text-sm text-muted-foreground">{a.grade.solved}/{problemCount} {text("solved", "已通过")}</p>
        </div>}
      </div>
      {a.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{a.description}</p>}
      {a.grade && (a.kind === "assignment"
        ? <div className="mt-4"><Progress percent={problemCount ? a.grade.solved / problemCount * 100 : 0} complete={complete} label={text("Required problem progress", "必做题进度")} /></div>
        : <progress className="mt-4 h-2 w-full accent-primary" value={a.grade.solved} max={Math.max(1, problemCount)} />)}
    </section>
    <SchoolActivityScholarshipRule schoolId={a.schoolId} activityId={a.id} editable={a.canManage && a.state === "Draft"}/>
    {!a.canManage && a.kind === "timed" && <section className={`${panel} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}><p className="text-sm">{a.resultsPublishedAt ? text("Results published", "成绩已公布") : a.attempt?.finishedAt ? text("Attempt finished. Awaiting published results.", "答题已结束，等待教师公布成绩。") : a.attempt ? `${text("Your deadline", "个人截止时间")}: ${date(a.attempt.deadlineAt, locale)}` : text("Start when you are ready. Your personal timer starts immediately.", "准备好后开始，个人计时随即启动。")}</p>{!a.attempt && a.phase === "Open" && <Button size="sm" disabled={action.busy} onClick={start}>{text("Start timed practice", "开始限时训练")}</Button>}{a.attempt && !a.attempt.finishedAt && a.phase === "Open" && <Button size="sm" variant="secondary" onClick={() => setConfirmation("finish")}>{text("Finish attempt", "结束答题")}</Button>}</section>}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]"><section className={panel}><header className="border-b border-border px-4 py-3 font-semibold">{text("Required problems", "必做题目")}</header><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-subtle text-muted-foreground"><tr><th className={th}>#</th><th className={th}>{text("Problem", "题目")}</th><th className={th}>{text("Status", "状态")}</th><th className={th}>{text("Best", "最高分")}</th><th className={th}>{text("Attempts", "提交次数")}</th><th className={th}>{text("Action", "操作")}</th></tr></thead><tbody>{a.problems.map(p => { const g = a.grade?.items.find(item => item.id === p.id); return <tr key={p.id} className="border-t border-border"><td className={td}>{p.position}</td><td className={td}><button className="text-left font-semibold text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline" disabled={!canEnter} onClick={() => onProblem(p.id)}>{p.title}</button></td><td className={td}>{g ? <><StatusPill status={g.status}/>{g.inherited && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{text("Passed elsewhere; no repeat required", "已在其他入口通过，无需重复作答")}</p>}</> : "—"}</td><td className={td}>{g ? g.score : "—"}/{p.points}</td><td className={td}>{g ? <span title={text(`${g.activityAttempts} submissions in this activity`, `本活动提交 ${g.activityAttempts} 次`)}>{g.attempts}</span> : "—"}</td><td className={td}><Button size="sm" variant="ghost" disabled={!canEnter} onClick={() => onProblem(p.id)}>{text("Open", "打开")}</Button></td></tr>; })}</tbody></table></div></section><aside className={`${panel} space-y-3 p-4 text-sm leading-6 text-muted-foreground`}><h2 className="font-semibold text-foreground">{text("Activity rules", "活动规则")}</h2><p>{text("Sample and custom runs do not affect grades. Hidden tests remain private.", "样例与自定义运行不计成绩，隐藏测试保持私有。")}</p><p>{a.preview ? text("Your best preview submission counts. Preview submissions do not count toward grades, scholarship or rankings.", "试做取本次版本的最高分，不计入正式成绩、奖学金或排名。") : a.kind === "assignment" ? text("Best formal score before the deadline. Same-version formal AC elsewhere gives full credit without a new submission or an activity bonus.", "取截止前正式提交最高分。同版本在其他入口正式 AC 可计满分，不产生新提交或活动奖励。") : text("One attempt per student. The server applies your personal deadline. Formal results appear only after the teacher publishes them.", "每位学生一次答题，服务器执行个人有效截止时间，正式结果在教师公布后显示。")}</p><p>{a.preview ? text("Only submissions for this saved preview count toward attempts.", "次数只统计当前保存版本的试做提交。") : text("Attempts include relevant formal submissions; hover to see how many were made in this activity.", "次数包含有效正式提交，悬停可查看本活动中的提交次数。")}</p></aside></div>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !action.busy) setConfirmation(null); }}><DialogContent><DialogTitle>{confirmation === "publish" ? text("Publish activity", "发布活动") : confirmation === "publish-results" ? text("Publish results", "公布成绩") : confirmation === "archive" ? text("Archive activity", "归档活动") : text("End activity", "结束活动")}</DialogTitle><DialogDescription>{confirmation === "publish" ? text("Problem versions, recipients and rules will be frozen. Students can open it at its scheduled time.", "题目版本、学生名单及规则将冻结，学生可在开放时间进入。") : confirmation === "publish-results" ? text("This records the first published results for every assigned student. Wait for pending judging to finish first.", "将保存所有已分配学生的首次公布成绩。请先等待在途判题完成。") : confirmation === "archive" ? text("Remove it from active lists while preserving submissions and grades.", "从使用中列表移除，保留提交记录和成绩。") : text("New submissions will no longer be accepted. Received submissions are preserved.", "结束后不再接收新的提交，已接收的提交会保留。")}</DialogDescription><Feedback action={action}/><div className="flex justify-end gap-2"><Button variant="secondary" disabled={action.busy} onClick={() => setConfirmation(null)}>{text("Cancel", "取消")}</Button><Button disabled={action.busy} onClick={() => void action.run(async () => { await productionApi(`${base}/${a.id}/${confirmation}`, { method: "POST", body: { expectedRevision: a.revision } }); setConfirmation(null); reload(); })}>{text("Confirm", "确认")}</Button></div></DialogContent></Dialog>
  </div>;
}
const kindLabel = (kind: ActivityKind) => kind === "timed" ? "Timed practice" : "Assignments";

export function SchoolActivityReportView({ base, activityId, onBack }: { base: string; activityId: string; onBack: () => void }) {
  const text = useSchoolText(), { locale } = useLocale(), data = useData<ActivityReport>(`${base}/${encodeURIComponent(activityId)}/report`);
  function download() {
    if (!data.data) return;
    const rows = [["Student ID", "Name", "Score", "Total", "Solved", "Attempted"], ...data.data.items.map(item => [item.number, item.name, item.grade.score, item.grade.total, item.grade.solved, item.grade.attempted])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + rows.map(row => row.map(activityCsvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `activity-${activityId.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <div className="space-y-3"><div className="flex justify-between gap-2"><Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={15}/>{text("Back to activity", "返回活动")}</Button><Button size="sm" variant="secondary" disabled={!data.data} onClick={download}><Download size={15}/>{text("Export CSV", "导出 CSV")}</Button></div><State data={data}>{data.data && <><h1 className="text-lg font-bold">{data.data.activity.title} · {text("Report", "报告")}</h1><section className={panel}><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-subtle text-muted-foreground"><tr>{[text("Student ID", "学号"), text("Name", "姓名"), text("Score", "成绩"), text("Solved", "通过"), text("Started", "开始时间"), text("Deadline", "个人截止")].map(label => <th key={label} className={th}>{label}</th>)}</tr></thead><tbody>{data.data.items.map(item => <tr key={item.id} className="border-t border-border"><td className={`${td} font-mono text-xs`}>{item.number}</td><td className={td}>{item.name}</td><td className={td}>{item.grade.score}/{item.grade.total}</td><td className={td}>{item.grade.solved}/{item.grade.items.length}</td><td className={`${td} text-muted-foreground`}>{date(item.attempt?.startedAt, locale)}</td><td className={`${td} text-muted-foreground`}>{date(item.attempt?.deadlineAt, locale)}</td></tr>)}</tbody></table></div></section></>}</State></div>;
}

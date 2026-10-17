"use client";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import {useActivityDraft} from "./use-activity-draft";
import { StudentAudienceSelector } from "./student-audience-selector";
import { activityAudienceClassIds, type AudienceDirectory, type AudienceStudent } from "./student-audience";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import {
  productionApi,
  type SchoolClass,
  type Submission,
} from "@/lib/production-api";
import {validateActivity,validateTimedDates,activeParticipants} from "./activity-validation";
import { ProblemPicker } from "./problem-banks";
import { TeacherSubmissionDrawer } from "./assignments";
import { useLocale } from "@/components/locale-context";
import {
  date,
  Empty,
  Feedback,
  Field,
  input,
  link,
  localInput,
  Metric,
  Modal,
  move,
  panel,
  State,
  Table,
  Tabs,
  useAction,
  useData,
  useDirty,
} from "./shared";

interface TimedAttempt {
  id: string;
  status: "Active" | "Finished";
  startedAt: string;
  deadlineAt: string;
  finishedAt?: string | null;
  serverNow: string;
}
interface TimedProblem {
  problemId: string;
  versionId: string;
  title: string;
  points: number;
  firstAcPoints?: number;
  rewardPoints?: number;
  speedBonusPoints?: number;
  attemptBonusPoints?: number;
}
const rewardFields = ["rewardPoints", "speedBonusPoints", "attemptBonusPoints"] as const;
const rewardColumns = [
  { field: "rewardPoints", title: "训练 AC 奖励" },
  { field: "speedBonusPoints", title: "速度上限" },
  { field: "attemptBonusPoints", title: "尝试上限" },
] as const;
function practiceStatusLabel(status: string, locale: "zh" | "en") {
  if (locale === "en") return status === "ResultsPublished" ? "Results published" : status === "Published" ? "Assigned" : status;
  return ({ Draft: "草稿", Published: "已布置", Running: "进行中", Ended: "已结束", ResultsPublished: "成绩已发布", Archived: "已归档" } as Record<string, string>)[status] ?? status;
}
function rewardCap(problem: TimedProblem) {
  return (problem.rewardPoints ?? 0) + (problem.speedBonusPoints ?? 0) + (problem.attemptBonusPoints ?? 0);
}
function validateTimedRewards(problems: TimedProblem[]) {
  if (problems.some((problem) => rewardFields.some((field) => !Number.isInteger(problem[field] ?? 0) || (problem[field] ?? 0) < 0 || (problem[field] ?? 0) > 20))) {
    throw new Error("每题的固定、速度和尝试奖励上限都须为 0–20 的整数积分。");
  }
  if (problems.reduce((sum, problem) => sum + rewardCap(problem), 0) > 100) {
    throw new Error("本次训练全部题目的奖励上限合计最多 100 积分。");
  }
}
interface Practice {
  id: string;
  title: string;
  classId: string | null;
  classIds?: string[];
  classes?: { id: string; name: string }[];
  className?: string;
  coursePathId?: string | null;
  courseTitle?: string | null;
  description?: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  showVerdict: boolean;
  resultsPublished: boolean;
  forcedEndedAt?:string|null;
  resultsRevision?: number | null;
  serverNow: string;
  problems: TimedProblem[];
  participants?: {
    identityId: string;
    name: string;
    number: string;
    exempt: boolean;
    attempt: TimedAttempt | null;
  }[];
  grades?: {
    identityId: string;
    name: string;
    score: number | null;
    maxScore: number;
    pending: boolean;
    problems: {
      problemId: string;
      submissionId: string | null;
      score: number | null;
      status: string;
      rewardPoints?: number;
      speedBonusPointsEarned?: number;
      attemptBonusPointsEarned?: number;
      totalRewardPoints?: number;
      elapsedSeconds?: number | null;
      formalAttempts?: number;
    }[];
  }[];
}
export function TeacherTimedList() {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [showArchived,setShowArchived]=useState(false);
  const [confirm,setConfirm]=useState<Practice|null>(null);
  const action=useAction();
  const practices = useData<{ items: Practice[] }>(showArchived?"timed-practices?archived=true":"timed-practices"),
    classes = useData<{ items: SchoolClass[] }>("classes");
  return (
    <>
      <PageHeader
        eyebrow={tr("限时训练", "Timed practice")}
        title={tr("计时训练", "Timed practice")}
        description={tr("管理课堂测验与 ACSL 模拟训练，发布活动、跟进提交与开放成绩分别进行。", "Manage classroom quizzes and ACSL mock tests. Publishing, tracking submissions, and releasing results are separate actions.")}
        action={
          <Link
            href="/teacher/timed-practice/new/edit"
            className={buttonVariants()}
          >
            <Plus size={15} />
            {tr("新建计时训练", "New timed practice")}
          </Link>
        }
      />
      <div className="mt-5 flex gap-2"><Button variant={showArchived?"secondary":"default"} aria-pressed={!showArchived} onClick={()=>setShowArchived(false)}>{tr("使用中","Active")}</Button><Button variant={showArchived?"default":"secondary"} aria-pressed={showArchived} onClick={()=>setShowArchived(true)}>{tr("已归档","Archived")}</Button></div>
      <State resource={practices} />
      <Feedback action={action}/>
      <section className={`${panel} mt-4`}>
        <Table
          headers={[tr("活动", "Activity"), tr("班级", "Class"), tr("窗口", "Window"), tr("时长", "Duration"), tr("题数", "Problems"), tr("状态", "Status"), tr("操作", "Actions")]}
          min={900}
        >
          {practices.data?.items.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/teacher/timed-practice/${p.id}/edit`} className="font-semibold text-primary hover:underline focus-visible:underline">{p.title}</Link>
              </td>
              <td>
                {p.classes?.map(item => item.name).join(" / ") || p.className || classes.data?.items.find((x) => x.id === p.classId)?.name || tr("按学生名单", "Selected students")}
              </td>
              <td className="text-xs text-muted-foreground">
                {date(p.startsAt)}
                <br />
                {date(p.endsAt)}
              </td>
              <td>{p.durationMinutes} {tr("分钟", "min")}</td>
              <td>{p.problems.length}</td>
              <td>
                <StatusPill status={practiceStatusLabel(p.status, locale)} />
              </td>
              <td>
                <Link
                  href={`/teacher/timed-practice/${p.id}/edit`}
                  className={link}
                >
                  {p.status === "Draft" ? tr("编辑", "Edit") : tr("查看", "View")}
                </Link>
                <Link
                  href={`/teacher/timed-practice/${p.id}/progress`}
                  className={`${link} ml-4`}
                >
                  {tr("进行情况", "Progress")}
                </Link>
                <Button size="sm" variant="ghost" disabled={action.busy} onClick={()=>setConfirm(p)}>{showArchived?tr("恢复","Restore"):tr("归档","Archive")}</Button>
              </td>
            </tr>
          ))}
          {!practices.loading && !practices.data?.items.length && (
            <Empty columns={7}>
              {showArchived?tr("暂无已归档训练。","No archived timed practices."):tr("暂无训练。点击“新建计时训练”准备课堂活动。", "No timed practices yet. Create one to prepare a class activity.")}
            </Empty>
          )}
        </Table>
      </section>
      {confirm&&<Modal title={showArchived?tr("恢复限时训练","Restore timed practice"):tr("归档限时训练","Archive timed practice")} onClose={()=>setConfirm(null)}>
        <p className="text-sm text-muted-foreground">{showArchived?tr("恢复后训练会回到使用中列表；若所属班级已归档，请先恢复班级。","The practice returns to the active list. Restore its class first if needed."):tr("草稿可直接归档；已发布训练须先结束并公布成绩。尝试、成绩与积分记录会保留。","A draft may be archived immediately. Published practices require released results; attempts, grades, and points remain recorded.")}</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={()=>setConfirm(null)}>{tr("取消","Cancel")}</Button><Button disabled={action.busy} onClick={()=>void action.run(async()=>{await productionApi(`timed-practices/${confirm.id}/${showArchived?"restore":"archive"}`,{method:"POST",body:{}});setConfirm(null);practices.reload();return showArchived?tr("训练已恢复。","Practice restored."):tr("训练已归档。","Practice archived.");})}>{showArchived?tr("恢复","Restore"):tr("归档","Archive")}</Button></div>
      </Modal>}
    </>
  );
}
const tabs = ["基本信息", "题目与分值", "时间与规则", "反馈与发布"];
const englishTabs: Record<string, string> = {
  "基本信息": "Basic information",
  "题目与分值": "Problems and points",
  "时间与规则": "Timing and rules",
  "反馈与发布": "Feedback and publication",
};
export function TeacherTimedEditor({ id,userId }: { id: string;userId:string }) {
  const resource = useData<Practice>(
    id === "new" ? null : `timed-practices/${id}`,
  );
  return (
    <>
      <State resource={resource} />
      {(id === "new" || (!resource.loading && resource.data?.id === id)) && (
        <TimedEditor userId={userId} key={id} initial={id === "new" ? null : resource.data} />
      )}
    </>
  );
}
function TimedEditor({ initial,userId }: { initial: Practice | null;userId:string }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const router = useRouter(),
    classes = useData<{ items: SchoolClass[] }>("classes"),
    audience = useData<AudienceDirectory>("teaching/audience"),
    courses = useData<{ items: { id: string; title: string; published: boolean }[] }>("learning-paths"),
    [saved, setSaved] = useState(initial),
    [description, setDescription] = useState(initial?.description ?? ""),
    [coursePathId, setCoursePathId] = useState(initial?.coursePathId ?? ""),
    [participants, setParticipants] = useState(
      initial?.participants
        ?.filter((p) => !p.exempt)
        .map((p) => p.identityId) ?? [],
    ),
    [rosterOpen, setRosterOpen] = useState(false),
    [rosterParticipants,setRosterParticipants]=useState<string[]>([]),
    [tab, setTab] = useState(tabs[0]!),
    [title, setTitle] = useState(initial?.title ?? ""),
    [startsAt, setStarts] = useState(localInput(initial?.startsAt)),
    [endsAt, setEnds] = useState(localInput(initial?.endsAt)),
    [duration, setDuration] = useState(initial?.durationMinutes ?? 60),
    [showVerdict, setShowVerdict] = useState(initial?.showVerdict ?? false),
    [problems, setProblems] = useState<TimedProblem[]>(
      initial?.problems.map((problem) => ({
        ...problem,
        firstAcPoints: problem.firstAcPoints ?? 10,
        rewardPoints: problem.rewardPoints ?? 0,
        speedBonusPoints: problem.speedBonusPoints ?? 0,
        attemptBonusPoints: problem.attemptBonusPoints ?? 0,
      })) ?? [],
    ),
    [picker, setPicker] = useState(false),
    [modal, setModal] = useState<"preview" | "publish" | null>(null),
    action = useAction();
  const published = saved !== null && saved.status !== "Draft";
  const directory = audience.data?.items ?? [];
  const students: AudienceStudent[] = [...directory, ...(saved?.participants ?? []).filter(person => !directory.some(student => student.id === person.identityId)).map(person => ({ id: person.identityId, name: person.name, number: person.number, historical: true }))];
  const audienceClasses = audience.data?.classes ?? classes.data?.items ?? [];
  const classIds = audience.data ? activityAudienceClassIds(directory, participants, audience.data.classes.filter(item => item.canAssociate).map(item => item.id), saved ? saved.classIds ?? (saved.classId ? [saved.classId] : []) : undefined, activeParticipants(saved?.participants)) : saved?.classIds ?? (saved?.classId ? [saved.classId] : []);
  const classId = classIds[0] ?? "";
  const classSummary = classIds.map(id => (audienceClasses.find(item => item.id === id)?.name ?? saved?.classes?.find(item => item.id === id)?.name)).filter(Boolean).join(" / ") || tr("按学生名单布置", "Selected students");
  const save = async () => {
      if (published)
        throw new Error(
          "已发布训练的题目与时长已固定，请在进行情况页维护延期。",
        );
      validateTimedRewards(problems);
      validateActivity({title,classIds,problems,participants});
      const {start,end}=validateTimedDates(startsAt,endsAt,duration,0,true);
      const result = await productionApi<Practice>(
        saved ? `timed-practices/${saved.id}` : "timed-practices",
        {
          method: saved ? "PATCH" : "POST",
          body: {
            title,
            classIds,
            classId: classIds[0] ?? null,
            description,
            coursePathId: coursePathId || null,
            participants,
            startsAt: start,
            endsAt: end,
            durationMinutes: duration,
            showVerdict,
            problems: problems.map((p) => ({
              problemId: p.problemId,
              points: p.points,
              rewardPoints: p.rewardPoints ?? 0,
              speedBonusPoints: p.speedBonusPoints ?? 0,
              attemptBonusPoints: p.attemptBonusPoints ?? 0,
              ...(p.versionId ? {versionId:p.versionId}:{}),
            })),
          },
        },
      );
      draft.clear();
      setSaved(result);
      if (!saved) router.replace(`/teacher/timed-practice/${result.id}/edit`);
      return result;
    };
  const draft=useActivityDraft({storageKey:`campus-judge:activity-draft:v1:${userId}:timed:${initial?.id??"new"}`,editable:!published,snapshot:{title,description,coursePathId,classId,classIds,startsAt,endsAt,duration,showVerdict,problems,participants},recoveryDefaults:{classIds:[],coursePathId:""},onRestore:v=>{setTitle(v.title);setDescription(v.description);setCoursePathId(v.coursePathId??"");setStarts(v.startsAt);setEnds(v.endsAt);setDuration(v.duration);setShowVerdict(v.showVerdict);setProblems(v.problems.map(problem=>({...problem,firstAcPoints:problem.firstAcPoints??10,rewardPoints:problem.rewardPoints??0,speedBonusPoints:problem.speedBonusPoints??0,attemptBonusPoints:problem.attemptBonusPoints??0})));setParticipants(v.participants);}});
  useDirty(
    !published &&
      (title !== (saved?.title ?? "") ||
        description !== (saved?.description ?? "") ||
        coursePathId !== (saved?.coursePathId ?? "") ||
        JSON.stringify(classIds) !== JSON.stringify([...(saved?.classIds ?? (saved?.classId ? [saved.classId] : []))].sort()) ||
        startsAt !== localInput(saved?.startsAt) ||
        endsAt !== localInput(saved?.endsAt) ||
        duration !== (saved?.durationMinutes ?? 60) ||
        showVerdict !== (saved?.showVerdict ?? false) ||
        JSON.stringify(
          problems.map((p) => ({ problemId: p.problemId, points: p.points, rewardPoints: p.rewardPoints ?? 0, speedBonusPoints: p.speedBonusPoints ?? 0, attemptBonusPoints: p.attemptBonusPoints ?? 0 })),
        ) !==
          JSON.stringify(
            (saved?.problems ?? []).map((p) => ({
              problemId: p.problemId,
              points: p.points,
              rewardPoints: p.rewardPoints ?? 0,
              speedBonusPoints: p.speedBonusPoints ?? 0,
              attemptBonusPoints: p.attemptBonusPoints ?? 0,
            })),
          ) ||
        JSON.stringify([...participants].sort()) !==
          JSON.stringify(
            activeParticipants(saved?.participants).sort(),
          )),
  );
  return (
    <>
      <Link
        href="/teacher/timed-practice"
        className={`${link} mb-4 inline-block text-sm`}
      >
        ← {tr("计时训练", "Timed practice")}
      </Link>
      <PageHeader
        eyebrow={tr("活动编辑", "Edit activity")}
        title={saved?.title ?? tr("新建计时训练", "New timed practice")}
        description={tr("窗口、个人时长和取分规则由服务端执行，成绩开放另行确认。", "The server enforces the window, individual duration, and scoring rules. Results are released separately.")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal("preview")}>
              <Eye size={15} />
              {tr("学生预览", "Student preview")}
            </Button>
            <Button
              disabled={action.busy || published}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return tr("训练草稿已保存。", "Practice draft saved.");
                })
              }
            >
              {tr("保存草稿", "Save draft")}
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy || published}
              onClick={() => setModal("publish")}
            >
              {published ? tr("已布置", "Assigned") : tr("布置训练", "Assign practice")}
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      {draft.notice}
      {published&&<p className="mt-3 rounded-md border border-border bg-surface-subtle p-3 text-sm">{tr("已发布训练的题目、分值与规则已锁定。", "Problems, points, and rules are locked after publishing.")}<Link className={`${link} ml-2`} href={`/teacher/timed-practice/${saved?.id}/progress`}>{tr("进行情况 / 延期与豁免", "Progress / extensions and exemptions")}</Link></p>}
      <Tabs
        value={tr(tab, englishTabs[tab] ?? tab)}
        onChange={value => setTab(tabs.find(item => tr(item, englishTabs[item] ?? item) === value) ?? tabs[0]!)}
        items={tabs.map(item => tr(item, englishTabs[item] ?? item))}
      />
      <section className={`${panel} mt-4 p-5`}>
        {tab === "基本信息" && (
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label={tr("名称", "Name")}>
              <input
                value={title}
                disabled={published || action.busy}
                onChange={(e) => setTitle(e.target.value)}
                className={input}
              />
            </Field>
            <Field label={tr("适用学生", "Assigned students")}>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${tr("已选择", "Selected")} ${participants.length} ${tr("名学生", "students")}`}
                  className={input}
                />
                <Button
                  variant="secondary"
                  disabled={published || action.busy}
                  onClick={() => {setRosterParticipants([...participants]);setRosterOpen(true);}}
                >
                  {tr("选择名单", "Choose students")}
                </Button>
              </div>
            </Field>
            <Field label={tr("关联课程（可选）", "Linked course (optional)")}>
              <select className={input} value={coursePathId} disabled={published || action.busy || courses.loading} onChange={event => setCoursePathId(event.target.value)}>
                <option value="">{tr("不关联课程", "No linked course")}</option>
                {initial?.coursePathId && !courses.data?.items.some(course => course.id === initial.coursePathId && course.published) && <option value={initial.coursePathId} disabled>{initial.courseTitle || tr("原关联课程", "Previous course")}{tr("（当前不可用）", " (unavailable)")}</option>}
                {courses.data?.items.filter(course => course.published).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </Field>
            <Field label={tr("说明", "Description")}>
              <textarea
                value={description}
                disabled={published || action.busy}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background text-foreground p-3 text-sm"
              />
            </Field>
            <State resource={classes} />
          </div>
        )}
        {tab === "题目与分值" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <Button disabled={published || action.busy} onClick={() => setPicker(true)}>
                {tr("从题库与分组选择", "Choose from banks and groups")}
              </Button>
              <div className="text-right text-sm">
                <b>{problems.length} {tr("题", "problems")} · {problems.reduce((n, p) => n + p.points, 0)} {tr("分", "points")}</b>
                <p className="mt-1 text-xs text-muted-foreground">{tr("训练奖励上限", "Practice reward cap")} +{problems.reduce((sum, p) => sum + rewardCap(p), 0)} / 100 {tr("积分", "points")}</p>
              </div>
            </div>
            <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
              <p className="font-semibold">{tr("限时训练积分规则", "Timed-practice point rules")}</p>
              <p className="mt-1 text-muted-foreground">{tr("每题首次 AC 积分是全站一次性奖励，已在别处领取则不会重复；本训练的奖励仅在个人截止前 AC 且首次发布成绩时结算。训练奖励 = 固定 AC 奖励 + ⌊速度上限 × max(0, 预设训练时长 − 实际用时) ÷ 预设训练时长⌋ + ⌊尝试上限 ÷ 本题正式提交次数⌋。实际用时从服务器记录的训练开始到最终计分的有效 AC 提交接收计算，不使用截止倒计时余量；提交次数包括这次 AC。未 AC 不得训练奖励。三项上限跨全部题合计最多 100 积分，和训练成绩分值分开。", "First-AC points for each problem are awarded once across the site. Practice rewards settle only for AC before the individual deadline, when results are first published. Reward = fixed AC reward + floor(speed cap × max(0, planned duration − elapsed time) / planned duration) + floor(attempt cap / formal submission count). Elapsed time runs from the server-recorded start to receipt of the valid scored AC; it does not use countdown time remaining. Attempts include the AC submission. No AC means no practice reward. The combined cap across all problems is 100 points, separate from practice scores.")}</p>
              <p className="mt-1 text-muted-foreground">{tr("训练固定、速度及少尝试奖励只计个人积分；校级排名积分只来自管理员审核公开题的有效首次正式 AC，训练成绩公布后才结算。", "Fixed, speed, and attempt rewards count toward personal points only. School leaderboard points come only from valid first formal ACs on administrator-approved public problems, and settle after practice results are published.")}</p>
            </div>
            <Table headers={[tr("顺序", "Order"), tr("题目", "Problem"), tr("分值", "Score"), tr("首次 AC", "First AC"), tr("训练 AC 奖励", "Practice AC reward"), tr("速度上限", "Speed cap"), tr("尝试上限", "Attempt cap"), tr("操作", "Actions")]} min={1100}>
              {problems.map((p, i) => (
                <tr key={p.problemId}>
                  <td>{i + 1}</td>
                  <td>
                    <Link
                      href={`/teacher/problems/${p.problemId}/edit`}
                      className={link}
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td>
                    <input
                      aria-label={`${p.title} ${tr("分值", "score")}`}
                      disabled={published || action.busy}
                      type="number"
                      step="0.01"
                      value={p.points}
                      min={0.01}
                      max={1000}
                      onChange={(e) =>
                        setProblems((x) =>
                          x.map((item) =>
                            item.problemId === p.problemId
                              ? { ...item, points: Number(e.target.value) }
                              : item,
                          ),
                        )
                      }
                      className={`${input} w-24`}
                    />
                  </td>
                  <td className="whitespace-nowrap text-sm font-medium">+{p.firstAcPoints ?? 10}</td>
                  {rewardColumns.map(({ field, title }) => (
                    <td key={field}>
                      <input
                        aria-label={`${p.title} ${tr(title, title === "训练 AC 奖励" ? "practice AC reward" : title === "速度上限" ? "speed cap" : "attempt cap")} ${tr("积分", "points")}`}
                        disabled={published || action.busy}
                        type="number"
                        step={1}
                        min={0}
                        max={20}
                        value={p[field] ?? 0}
                        onChange={(event) => setProblems((current) => current.map((problem) => problem.problemId === p.problemId ? { ...problem, [field]: Number(event.target.value) } : problem))}
                        className={`${input} w-20`}
                      />
                    </td>
                  ))}
                  <td>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={tr("上移", "Move up")}
                        disabled={published || action.busy || i === 0}
                        onClick={() => setProblems(move(problems, i, -1))}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={tr("下移", "Move down")}
                        disabled={published || action.busy || i === problems.length - 1}
                        onClick={() => setProblems(move(problems, i, 1))}
                      >
                        <ArrowDown size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={tr("移除题目", "Remove problem")}
                        disabled={published || action.busy}
                        onClick={() =>
                          setProblems((x) =>
                            x.filter((item) => item.problemId !== p.problemId),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!problems.length && (
                <Empty columns={8}>{tr("请选择已发布题目。", "Choose published problems.")}</Empty>
              )}
            </Table>
          </>
        )}
        {tab === "时间与规则" && (
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label={tr("开始窗口（本机时区）", "Start window (local time zone)")}>
              <input
                disabled={published || action.busy}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {setStarts(e.target.value);action.clear();}}
                className={input}
              />
            </Field>
            <Field label={tr("结束窗口（本机时区）", "End window (local time zone)")}>
              <input
                disabled={published || action.busy}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {setEnds(e.target.value);action.clear();}}
                className={input}
              />
            </Field>
            <Field label={tr("个人时长（分钟）", "Individual duration (minutes)")}>
              <input
                disabled={published || action.busy}
                type="number"
                min={1}
                max={240}
                value={duration}
                onChange={(e) => {setDuration(Number(e.target.value));action.clear();}}
                className={input}
              />
            </Field>
            <Field label={tr("时区", "Time zone")}>
              <input
                readOnly
                value={Intl.DateTimeFormat().resolvedOptions().timeZone}
                className={input}
              />
            </Field>
            <Field label={tr("自测", "Self-test")}>
              <input
                readOnly
                value={tr("允许公开样例与自定义输入（活动窗口内）", "Public samples and custom input allowed during activity window")}
                className={input}
              />
            </Field>
            <Field label={tr("取分方式", "Scoring method")}>
              <input
                readOnly
                value={tr("每题最后一次正式接收提交", "Last formally received submission per problem")}
                className={input}
              />
            </Field>
          </div>
        )}
        {tab === "反馈与发布" && (
          <>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <section className="border border-border p-4">
                <b className="text-sm">{tr("反馈范围", "Feedback scope")}</b>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    disabled
                    type="checkbox"
                    checked
                    readOnly
                  />
                  {tr("实时显示 AC / WA 等判题状态；最终分数、隐藏测试与题解仍按发布规则开放", "Show AC / WA statuses live; final scores, hidden tests, and solutions follow publication rules.")}
                </label>
              </section>
              <Metric label={tr("成绩开放", "Results release")} value={tr("教师手动发布结果", "Teacher publishes results manually")} />
              <Metric label={tr("题解开放", "Solution release")} value={tr("成绩发布后按题目策略开放", "After results, per problem policy")} />
              <Metric label={tr("赛后订正", "Post-practice correction")} value={tr("独立记录，保留原活动成绩", "Tracked separately; original score remains")} />
            </div>
            {published && (
              <Link
                href={`/teacher/timed-practice/${saved?.id}/progress`}
                className={`${link} mt-5 inline-block`}
              >
                {tr("打开进行情况 / 成绩发布", "Open progress / publish results")}
              </Link>
            )}
          </>
        )}
      </section>
      {rosterOpen && <Modal title={tr("选择布置学生", "Select recipients")} onClose={() => setRosterOpen(false)}>
        <StudentAudienceSelector students={students} classes={audienceClasses} selectedIds={rosterParticipants} onChange={setRosterParticipants} loading={audience.loading} error={audience.error} onReload={audience.reload}/>
        <div className="mt-4 flex justify-end"><Button onClick={() => {setParticipants(rosterParticipants);setRosterOpen(false);}}>{tr("确认名单", "Confirm students")}</Button></div>
      </Modal>}
      {picker && (
        <ProblemPicker
          selected={problems.map((x) => x.problemId)}
          onClose={() => setPicker(false)}
          onAdd={(items) => {
            setProblems((x) => [
              ...x,
              ...items.map((p) => ({
                problemId: p.id,
                versionId: p.publishedVersionId ?? p.versionId ?? "",
                title: p.publishedTitle ?? p.title,
                points: 100,
                firstAcPoints: p.firstAcPoints ?? 10,
                rewardPoints: 0,
                speedBonusPoints: 0,
                attemptBonusPoints: 0,
              })),
            ]);
            setPicker(false);
          }}
        />
      )}
      {modal && (
        <Modal
          title={modal === "preview" ? tr("学生规则页预览", "Student rules preview") : tr("确认布置训练", "Assign this practice")}
          onClose={() => setModal(null)}
        >
          <h2 className="font-bold">{title || tr("未命名训练", "Untitled practice")}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{tr("学生名单", "Recipients")}</dt>
              <dd>
                {classSummary} · {participants.length} {tr("名学生", "students")}
              </dd>
            </div>
            {coursePathId && <div><dt className="text-muted-foreground">{tr("关联课程", "Linked course")}</dt><dd>{courses.data?.items.find(course => course.id === coursePathId)?.title || saved?.courseTitle || tr("课程", "Course")}</dd></div>}
            <div>
              <dt className="text-muted-foreground">{tr("时长", "Duration")}</dt>
              <dd>{duration} {tr("分钟", "min")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tr("题数 / 总分", "Problems / total score")}</dt>
              <dd>
                {problems.length} / {problems.reduce((n, p) => n + p.points, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tr("取分", "Scoring")}</dt>
              <dd>{tr("最后一次正式接收提交", "Last formally received submission")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{tr("训练奖励上限", "Practice reward cap")}</dt>
              <dd>+{problems.reduce((sum, problem) => sum + rewardCap(problem), 0)} {tr("积分（首次 AC 奖励另计）", "points (first-AC rewards separate)")}</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-border pt-3 text-sm">
            {problems.map((problem) => <p key={problem.problemId} className="py-1">{problem.title}: {tr("首次 AC", "first AC")} +{problem.firstAcPoints ?? 10} {tr("（全站一次）；训练固定", "(once site-wide); fixed practice reward")} +{problem.rewardPoints ?? 0}, {tr("速度最多", "speed up to")} +{problem.speedBonusPoints ?? 0}, {tr("少尝试最多", "fewer attempts up to")} +{problem.attemptBonusPoints ?? 0}</p>)}
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {tr("确认开始后固定个人截止时间，统一窗口与预设训练时长中先到的时间为准。草稿和自测不会计分。只有个人截止前最终计分的有效 AC 才能在首次发布成绩时领取训练奖励：固定积分 + ⌊速度上限 × max(0, 预设训练时长 − 实际用时) ÷ 预设训练时长⌋ + ⌊尝试上限 ÷ 本题正式提交次数⌋。实际用时按服务器开始到 AC 接收计算，不使用截止倒计时余量。首次 AC 积分全站只领取一次；成绩由教师另行发布。", "Starting fixes the individual deadline at the earlier of the activity window and planned duration. Drafts and self-tests do not score. Only a valid scored AC before the individual deadline earns practice rewards when results are first published: fixed points + floor(speed cap × max(0, planned duration − elapsed time) / planned duration) + floor(attempt cap / formal submission count). Elapsed time uses server start and AC receipt, not countdown time remaining. First-AC points are awarded only once site-wide; teachers publish results separately.")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{tr("上述训练额外奖励只进入个人积分，不计入校级积分排行榜。", "Practice bonuses count toward personal points only, not the school leaderboard.")}</p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>
              {tr("返回编辑", "Back to editor")}
            </Button>
            {modal === "publish" && (
              <Button
                disabled={
                  action.busy ||
                  !problems.length ||
                  !title ||
                  !participants.length ||
                  !startsAt ||
                  !endsAt
                }
                onClick={() =>
                  void action.run(async () => {
                    validateTimedRewards(problems);
                    validateActivity({title,classId,problems,participants,publish:true,timed:true});
                    validateTimedDates(startsAt,endsAt,duration);
                    const result = await save();
                    await productionApi(
                      `timed-practices/${result.id}/publish`,
                      { method: "POST" },
                    );
                    router.push(
                      `/teacher/timed-practice/${result.id}/progress`,
                    );
                    return tr("训练已布置。", "Practice assigned.");
                  })
                }
              >
                {tr("确认布置", "Assign")}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function TeacherTimedProgress({ id }: { id: string }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const resource = useData<Practice>(`timed-practices/${id}`),
    history = useData<{ items: Submission[] }>("submissions"),
    [operation, setOperation] = useState<
      "单独延期" | "结束活动" | "重判" | "发布成绩" | "豁免" | null
    >(null),
    [student, setStudent] = useState(""),
    [view, setView] = useState<Submission | null>(null),
    action = useAction(),
    practice = resource.data;
  const participants = practice?.participants ?? [],
    applicable = participants.filter((x) => !x.exempt),
    unstarted = applicable.filter((x) => !x.attempt).length,
    active = applicable.filter((x) => x.attempt?.status === "Active").length,
    submissions =
      history.data?.items.filter(
        (x) => x.timedPracticeId === id && x.kind === "submit",
      ) ?? [];
  return (
    <>
      <Link
        href="/teacher/timed-practice"
        className={`${link} mb-4 inline-block text-sm`}
      >
        ← {tr("计时训练", "Timed practice")}
      </Link>
      <PageHeader
        eyebrow={tr("进行情况", "Progress")}
        title={practice?.title ?? tr("训练进行情况", "Practice progress")}
        description={tr("最后正式接收时间表示服务器接收记录，不代表学生在线或正在编程。", "Last formal receipt is the server timestamp; it does not mean a student is online or coding.")}
        action={
          <div className="flex flex-wrap gap-2">
            {(["单独延期", "结束活动", "重判", "发布成绩"] as const).map(
              (x) => (
                <Button
                  key={x}
                  variant="secondary"
                  disabled={
                    action.busy ||
                    !practice ||
                    practice.status === "Draft" ||
                    (x === "结束活动" && (practice.status === "Ended" || practice.resultsPublished)) ||
                    (x === "单独延期" && (!!practice.forcedEndedAt || practice.resultsPublished || !participants.some(p=>p.attempt&&!p.exempt))) ||
                    (x === "重判" && !submissions.length) ||
                    (x === "发布成绩" && practice.status === "Archived")
                  }
                  onClick={() => setOperation(x)}
                >
                  {tr(x, ({"单独延期":"Extend student","结束活动":"End activity","重判":"Rejudge","发布成绩":"Publish results"} as Record<string,string>)[x] ?? x)}
                </Button>
              ),
            )}
            <Button
              variant="secondary"
              onClick={() => {
                resource.reload();
                history.reload();
              }}
            >
              {tr("刷新", "Refresh")}
            </Button>
          </div>
        }
      />
      <State resource={resource} />
      <State resource={history} />
      <Feedback action={action} />
      {practice && (
        <>
          <div className="mt-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Metric
              label={tr("未进入", "Not started")}
              value={`${unstarted} / ${applicable.length}`}
            />
            <Metric label={tr("进行中", "Active")} value={`${active} / ${applicable.length}`} />
            <Metric
              label={tr("已结束", "Finished")}
              value={`${applicable.length - unstarted - active} / ${applicable.length}`}
            />
            <Metric
              label={tr("需要处理", "Needs action")}
              value={`${submissions.filter((s) => s.status === "System Error").length} ${tr("个系统问题", "system errors")}`}
            />
          </div>
          <section className={`${panel} mt-5`}>
            <Table
              headers={[
                tr("学生", "Student"),
                tr("活动状态", "Activity status"),
                tr("已接收提交", "Received submissions"),
                tr("最后正式接收时间", "Last formal receipt"),
                tr("训练奖励积分", "Practice reward points"),
                tr("需要处理", "Needs action"),
              ]}
              min={900}
            >
              {participants.map((p) => {
                const grade = practice.grades?.find(
                  (x) => x.identityId === p.identityId,
                );
                return (
                  <tr key={p.identityId}>
                    <td>
                      <Link
                        href={`/teacher/reports?${new URLSearchParams({ activity: `timed:${id}`, studentId: p.identityId, studentName: p.name })}`}
                        className="font-semibold text-primary hover:underline focus-visible:underline"
                      >{p.name}</Link>
                      <p className="text-xs text-muted-foreground">
                        {p.number}
                      </p>
                      <button
                        disabled={action.busy || practice.resultsPublished || practice.status==="Archived"}
                        className={`${link} mt-1 text-xs disabled:opacity-50`}
                        onClick={() => {
                          setStudent(p.identityId);
                          setOperation("豁免");
                        }}
                      >
                        {p.exempt ? tr("取消豁免", "Remove exemption") : tr("设置豁免", "Exempt")}
                      </button>
                    </td>
                    <td>
                      <StatusPill
                        status={
                          p.exempt
                            ? tr("豁免", "Exempt")
                            : !p.attempt
                              ? tr("未进入", "Not started")
                              : p.attempt.status === "Active"
                                ? tr("进行中", "Active")
                                : tr("已结束", "Finished")
                        }
                      />
                    </td>
                    <td>
                      {grade?.problems.filter((x) => x.submissionId).length ??
                        0}{" "}
                      / {practice.problems.length}
                      <div className="mt-1 flex flex-wrap gap-2">
                        {grade?.problems
                          .filter((x) => x.submissionId)
                          .map((x) => (
                            <button
                              className={`${link} text-xs`}
                              key={x.problemId}
                              onClick={() => {
                                const found = history.data?.items.find(
                                  (s) => s.id === x.submissionId,
                                );
                                if (found) setView(found);
                              }}
                            >
                              {practice.problems.find(
                                (p) => p.problemId === x.problemId,
                              )?.title ?? tr("题目", "Problem")}
                            </button>
                          ))}
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {grade?.problems
                        .map((x) =>
                          history.data?.items.find(
                            (s) => s.id === x.submissionId,
                          ),
                        )
                        .filter((x): x is Submission => Boolean(x))
                        .sort((a, b) =>
                          b.createdAt.localeCompare(a.createdAt),
                        )[0]?.createdAt
                        ? date(
                            grade.problems
                              .map((x) =>
                                history.data?.items.find(
                                  (s) => s.id === x.submissionId,
                                ),
                              )
                              .filter((x): x is Submission => Boolean(x))
                              .sort((a, b) =>
                                b.createdAt.localeCompare(a.createdAt),
                              )[0]!.createdAt,
                          )
                        : "—"}
                    </td>
                    <td className="text-sm">
                      {grade?.pending ? tr("待有效判题", "Awaiting valid result") : grade ? `${practice.resultsPublished ? tr("已结算", "Settled") : tr("预计", "Estimated")} +${grade.problems.reduce((sum, problem) => sum + (problem.totalRewardPoints ?? 0), 0)}` : "—"}
                    </td>
                    <td>
                      {grade?.problems.some((x) => x.status === "System Error")
                        ? tr("System Error · 不计为答错", "System error · not counted as wrong")
                        : grade?.pending
                          ? tr("等待有效结果", "Awaiting valid result")
                          : "—"}
                    </td>
                  </tr>
                );
              })}
              {!participants.length && (
                <Empty columns={6}>{tr("暂无活动学生。", "No assigned students.")}</Empty>
              )}
            </Table>
          </section>
          <p className="mt-3 text-xs text-muted-foreground">
            {tr("显示", "Showing")} {participants.length} {tr("名学生；", "students;")}
            {participants.filter((x) => x.exempt).length} {tr("人豁免。成绩", "exempt. Results")}
            {practice.resultsPublished
              ? `${tr("已发布 · 第", "published · version")} ${practice.resultsRevision ?? 1}${locale === "zh" ? " 版" : ""}`
              : tr("未发布", "unpublished")}
            {locale === "zh" ? "。" : "."}
          </p>
        </>
      )}
      {operation && practice && (
        <Modal title={`${tr(operation, ({"单独延期":"Extend student","结束活动":"End activity","重判":"Rejudge","发布成绩":"Publish results","豁免":"Exemption"} as Record<string,string>)[operation] ?? operation)}${locale === "zh" ? "确认" : " confirmation"}`} onClose={() => setOperation(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(async () => {
                const reason = String(d.get("reason"));
                if (operation === "单独延期")
                  await productionApi(`timed-practices/${id}/extend`, {
                    method: "POST",
                    body: {
                      identityId: student,
                      deadlineAt: new Date(
                        String(d.get("deadline")),
                      ).toISOString(),
                      reason,
                    },
                  });
                if (operation === "豁免") {
                  const p = participants.find((x) => x.identityId === student);
                  await productionApi(`timed-practices/${id}/exempt`, {
                    method: "POST",
                    body: { identityId: student, exempt: !p?.exempt, reason },
                  });
                }
                if (operation === "结束活动")
                  await productionApi(`timed-practices/${id}/end`, {
                    method: "POST",
                    body: { reason },
                  });
                if (operation === "发布成绩")
                  await productionApi(`timed-practices/${id}/results`, {
                    method: "POST",
                    body: { reason },
                  });
                if (operation === "重判") {
                  const ids = d.getAll("submissions").map(String);
                  if (!ids.length)
                    throw new Error(tr("请选择需要重判的正式提交。", "Select formal submissions to rejudge."));
                  for (const submissionId of ids)
                    await productionApi(`submissions/${submissionId}/rejudge`, {
                      method: "POST",
                      body: { reason },
                    });
                }
                resource.reload();
                history.reload();
                setOperation(null);
                return operation === "重判"
                  ? tr("重判任务已提交。候选结果需单独确认，成绩不会自动发布。", "Rejudge job submitted. Candidate results require separate confirmation; grades will not be published automatically.")
                  : `${tr(operation, ({"单独延期":"Student extension","结束活动":"End activity","发布成绩":"Result publication","豁免":"Exemption"} as Record<string,string>)[operation] ?? operation)} ${tr("已执行。", "completed.")}`;
              });
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              {operation === "发布成绩"
                ? practice.resultsPublished
                  ? tr("将发布当前成绩的一个新修订版本，旧版记录保留。", "Publish a new revision of the current results; the previous version remains recorded.")
                  : tr("明确发布当前活动成绩；平台故障或未完成评测会阻止发布。", "Publish the current activity results. Platform errors or incomplete evaluations block publication.")
                : operation === "重判"
                  ? tr("重新评测所选正式提交，保留原记录，候选结果与成绩发布分别确认。", "Re-evaluate selected formal submissions while retaining original records. Candidate results and publication are confirmed separately.")
                  : operation === "结束活动"
                    ? tr("结束本活动所有适用学生的作答，已经接收的提交继续评测。", "End the activity for all assigned students. Already received submissions continue evaluating.")
                    : tr("只影响明确选择的学生，保留历史记录。", "Only the selected student is affected; history remains.")}
            </p>
            {(operation === "单独延期" || operation === "豁免") && (
              <Field label={tr("学生", "Student")}>
                <select
                  required
                  className={input}
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                >
                  <option value="">{tr("请选择学生", "Choose a student")}</option>
                  {participants.map((p) => (
                    <option
                      key={p.identityId}
                      value={p.identityId}
                      disabled={operation === "单独延期" && (!p.attempt || p.exempt)}
                    >
                      {p.name} · {p.number}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {operation === "单独延期" && (
              <Field label={tr("新的个人截止时间", "New individual deadline")}>
                <input
                  required
                  name="deadline"
                  type="datetime-local"
                  className={input}
                />
              </Field>
            )}
            {operation === "重判" && (
              <div className="max-h-64 overflow-y-auto border border-border">
                {submissions.map((s) => (
                  <label
                    key={s.id}
                    className="flex gap-2 border-b border-border p-3 text-sm"
                  >
                    <input type="checkbox" name="submissions" value={s.id} />
                    <span>
                      {s.studentName} · {s.problemTitle}
                      <p className="text-xs text-muted-foreground">
                        {s.id} · {s.status} · {date(s.createdAt)}
                      </p>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <Field label={tr("操作原因", "Reason for action")}>
              <textarea
                name="reason"
                required
                rows={3}
                className="w-full rounded-md border border-input bg-background text-foreground p-3 text-sm"
                maxLength={1000}
              />
            </Field>
            <Feedback action={action} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOperation(null)}
              >
                {tr("取消", "Cancel")}
              </Button>
              <Button
                disabled={action.busy}
                variant={operation === "结束活动" ? "danger" : "primary"}
              >
                {tr("确认", "Confirm ")}{tr(operation, ({"单独延期":"extension","结束活动":"end","重判":"rejudge","发布成绩":"publication","豁免":"exemption"} as Record<string,string>)[operation] ?? operation)}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {view && (
        <TeacherSubmissionDrawer
          id={view.id}
          title={`${view.studentName} · ${view.problemTitle}`}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
}

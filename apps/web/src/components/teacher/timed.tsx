"use client";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import {useActivityDraft} from "./use-activity-draft";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import {
  productionApi,
  type Person,
  type SchoolClass,
  type Submission,
} from "@/lib/production-api";
import {validateActivity,validateTimedDates,activeParticipants} from "./activity-validation";
import { ProblemPicker } from "./problem-banks";
import { TeacherSubmissionDrawer } from "./assignments";
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
  classId: string;
  className?: string;
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
  const practices = useData<{ items: Practice[] }>("timed-practices"),
    classes = useData<{ items: SchoolClass[] }>("classes");
  return (
    <>
      <PageHeader
        eyebrow="Timed Practice"
        title="计时训练"
        description="管理课堂测验与 ACSL 模拟训练，发布活动、跟进提交与开放成绩分别进行。"
        action={
          <Link
            href="/teacher/timed-practice/new/edit"
            className={buttonVariants()}
          >
            <Plus size={15} />
            新建计时训练
          </Link>
        }
      />
      <State resource={practices} />
      <section className={`${panel} mt-5`}>
        <Table
          headers={["活动", "班级", "窗口", "时长", "题数", "状态", "操作"]}
          min={900}
        >
          {practices.data?.items.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/teacher/timed-practice/${p.id}/edit`} className="font-semibold text-primary hover:underline focus-visible:underline">{p.title}</Link>
              </td>
              <td>
                {p.className ??
                  classes.data?.items.find((x) => x.id === p.classId)?.name}
              </td>
              <td className="text-xs text-muted-foreground">
                {date(p.startsAt)}
                <br />
                {date(p.endsAt)}
              </td>
              <td>{p.durationMinutes} 分钟</td>
              <td>{p.problems.length}</td>
              <td>
                <StatusPill status={p.status} />
              </td>
              <td>
                <Link
                  href={`/teacher/timed-practice/${p.id}/edit`}
                  className={link}
                >
                  {p.status === "Draft" ? "编辑" : "查看"}
                </Link>
                <Link
                  href={`/teacher/timed-practice/${p.id}/progress`}
                  className={`${link} ml-4`}
                >
                  进行情况
                </Link>
              </td>
            </tr>
          ))}
          {!practices.loading && !practices.data?.items.length && (
            <Empty columns={7}>
              暂无训练。点击“新建计时训练”准备课堂活动。
            </Empty>
          )}
        </Table>
      </section>
    </>
  );
}
const tabs = ["基本信息", "题目与分值", "时间与规则", "反馈与发布"];
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
  const router = useRouter(),
    classes = useData<{ items: SchoolClass[] }>("classes"),
    people = useData<{ items: Person[] }>("people"),
    [saved, setSaved] = useState(initial),
    [description, setDescription] = useState(initial?.description ?? ""),
    [participants, setParticipants] = useState(
      initial?.participants
        ?.filter((p) => !p.exempt)
        .map((p) => p.identityId) ?? [],
    ),
    [rosterOpen, setRosterOpen] = useState(false),
    [rosterParticipants,setRosterParticipants]=useState<string[]>([]),
    [tab, setTab] = useState(tabs[0]!),
    [title, setTitle] = useState(initial?.title ?? ""),
    [classId, setClassId] = useState(initial?.classId ?? ""),
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
  const published = saved !== null && saved.status !== "Draft",
    save = async () => {
      if (published)
        throw new Error(
          "已发布训练的题目与时长已固定，请在进行情况页维护延期。",
        );
      validateTimedRewards(problems);
      validateActivity({title,classId,problems,participants,timed:true});
      const {start,end}=validateTimedDates(startsAt,endsAt,duration,0,true);
      const result = await productionApi<Practice>(
        saved ? `timed-practices/${saved.id}` : "timed-practices",
        {
          method: saved ? "PATCH" : "POST",
          body: {
            title,
            classId,
            description,
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
  const draft=useActivityDraft({storageKey:`campus-judge:activity-draft:v1:${userId}:timed:${initial?.id??"new"}`,editable:!published,snapshot:{title,description,classId,startsAt,endsAt,duration,showVerdict,problems,participants},onRestore:v=>{setTitle(v.title);setDescription(v.description);setClassId(v.classId);setStarts(v.startsAt);setEnds(v.endsAt);setDuration(v.duration);setShowVerdict(v.showVerdict);setProblems(v.problems.map(problem=>({...problem,firstAcPoints:problem.firstAcPoints??10,rewardPoints:problem.rewardPoints??0,speedBonusPoints:problem.speedBonusPoints??0,attemptBonusPoints:problem.attemptBonusPoints??0})));setParticipants(v.participants);}});
  useDirty(
    !published &&
      (title !== (saved?.title ?? "") ||
        description !== (saved?.description ?? "") ||
        classId !== (saved?.classId ?? "") ||
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
        ← 计时训练
      </Link>
      <PageHeader
        eyebrow="活动编辑"
        title={saved?.title ?? "新建计时训练"}
        description="窗口、个人时长和取分规则由服务端执行，成绩开放另行确认。"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal("preview")}>
              <Eye size={15} />
              学生预览
            </Button>
            <Button
              disabled={action.busy || published}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return "训练草稿已保存。";
                })
              }
            >
              保存草稿
            </Button>
            <Button
              variant="secondary"
              disabled={action.busy || published}
              onClick={() => setModal("publish")}
            >
              {published ? "已发布" : "发布"}
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      {draft.notice}
      {published&&<p className="mt-3 rounded-md border border-border bg-surface-subtle p-3 text-sm">已发布训练的题目、分值与规则已锁定。<Link className={`${link} ml-2`} href={`/teacher/timed-practice/${saved?.id}/progress`}>进行情况 / 延期与豁免</Link></p>}
      <Tabs value={tab} onChange={setTab} items={tabs} />
      <section className={`${panel} mt-4 p-5`}>
        {tab === "基本信息" && (
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="名称">
              <input
                value={title}
                disabled={published || action.busy}
                onChange={(e) => setTitle(e.target.value)}
                className={input}
              />
            </Field>
            <Field label="班级">
              <select
                value={classId}
                disabled={published || action.busy}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setParticipants(
                    classes.data?.items.find((x) => x.id === e.target.value)
                      ?.studentIds ?? [],
                  );
                }}
                className={input}
              >
                <option value="">请选择班级</option>
                {classes.data?.items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="适用学生">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`已选择 ${participants.length} 名学生`}
                  className={input}
                />
                <Button
                  variant="secondary"
                  disabled={published || action.busy || !classId}
                  onClick={() => {setRosterParticipants([...participants]);setRosterOpen(true);}}
                >
                  选择名单
                </Button>
              </div>
            </Field>
            <Field label="说明">
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
                从题库与分组选择
              </Button>
              <div className="text-right text-sm">
                <b>{problems.length} 题 · {problems.reduce((n, p) => n + p.points, 0)} 分</b>
                <p className="mt-1 text-xs text-muted-foreground">训练奖励上限 +{problems.reduce((sum, p) => sum + rewardCap(p), 0)} / 100 积分</p>
              </div>
            </div>
            <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
              <p className="font-semibold">限时训练积分规则</p>
              <p className="mt-1 text-muted-foreground">每题首次 AC 积分是全站一次性奖励，已在别处领取则不会重复；本训练的奖励仅在个人截止前 AC 且首次发布成绩时结算。训练奖励 = 固定 AC 奖励 + ⌊速度上限 × max(0, 预设训练时长 − 实际用时) ÷ 预设训练时长⌋ + ⌊尝试上限 ÷ 本题正式提交次数⌋。实际用时从服务器记录的训练开始到最终计分的有效 AC 提交接收计算，不使用截止倒计时余量；提交次数包括这次 AC。未 AC 不得训练奖励。三项上限跨全部题合计最多 100 积分，和训练成绩分值分开。</p>
            </div>
            <Table headers={["顺序", "题目", "分值", "首次 AC", "训练 AC 奖励", "速度上限", "尝试上限", "操作"]} min={1100}>
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
                      aria-label={`${p.title} 分值`}
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
                        aria-label={`${p.title} ${title}积分`}
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
                        title="上移"
                        disabled={published || action.busy || i === 0}
                        onClick={() => setProblems(move(problems, i, -1))}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="下移"
                        disabled={published || action.busy || i === problems.length - 1}
                        onClick={() => setProblems(move(problems, i, 1))}
                      >
                        <ArrowDown size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="移除题目"
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
                <Empty columns={8}>请选择已发布题目。</Empty>
              )}
            </Table>
          </>
        )}
        {tab === "时间与规则" && (
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="开始窗口（本机时区）">
              <input
                disabled={published || action.busy}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {setStarts(e.target.value);action.clear();}}
                className={input}
              />
            </Field>
            <Field label="结束窗口（本机时区）">
              <input
                disabled={published || action.busy}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => {setEnds(e.target.value);action.clear();}}
                className={input}
              />
            </Field>
            <Field label="个人时长（分钟）">
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
            <Field label="时区">
              <input
                readOnly
                value={Intl.DateTimeFormat().resolvedOptions().timeZone}
                className={input}
              />
            </Field>
            <Field label="自测">
              <input
                readOnly
                value="允许公开样例与自定义输入（活动窗口内）"
                className={input}
              />
            </Field>
            <Field label="取分方式">
              <input
                readOnly
                value="每题最后一次正式接收提交"
                className={input}
              />
            </Field>
          </div>
        )}
        {tab === "反馈与发布" && (
          <>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <section className="border border-border p-4">
                <b className="text-sm">反馈范围</b>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    disabled
                    type="checkbox"
                    checked
                    readOnly
                  />
                  实时显示 AC / WA 等判题状态；最终分数、隐藏测试与题解仍按发布规则开放
                </label>
              </section>
              <Metric label="成绩开放" value="教师手动发布结果" />
              <Metric label="题解开放" value="成绩发布后按题目策略开放" />
              <Metric label="赛后订正" value="独立记录，保留原活动成绩" />
            </div>
            {published && (
              <Link
                href={`/teacher/timed-practice/${saved?.id}/progress`}
                className={`${link} mt-5 inline-block`}
              >
                打开进行情况 / 成绩发布
              </Link>
            )}
          </>
        )}
      </section>
      {rosterOpen && (
        <Modal title="适用学生" onClose={() => setRosterOpen(false)}>
          <div className="flex justify-between text-sm">
            <b>已选 {rosterParticipants.length}</b>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setRosterParticipants(
                    classes.data?.items.find((x) => x.id === classId)
                      ?.studentIds ?? [],
                  )
                }
              >
                选择全部
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRosterParticipants([])}
              >
                清空
              </Button>
            </div>
          </div>
          <State resource={people} />
          <div className="mt-4 max-h-72 overflow-auto border border-border">
            {people.data?.items
              .filter((p) =>
                classes.data?.items
                  .find((x) => x.id === classId)
                  ?.studentIds.includes(p.id),
              )
              .map((p) => (
                <label
                  key={p.id}
                  className="flex gap-3 border-b border-border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={rosterParticipants.includes(p.id)}
                    onChange={(e) =>
                      setRosterParticipants((x) =>
                        e.target.checked
                          ? [...x, p.id]
                          : x.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>
                    <b>{p.name}</b>
                    <p className="text-xs text-muted-foreground">{p.number}</p>
                  </span>
                </label>
              ))}
          </div>
          <Button className="mt-4" onClick={() => {setParticipants(rosterParticipants);setRosterOpen(false);}}>
            确认名单
          </Button>
        </Modal>
      )}
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
          title={modal === "preview" ? "学生规则页预览" : "确认发布训练"}
          onClose={() => setModal(null)}
        >
          <h2 className="font-bold">{title || "未命名训练"}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">班级</dt>
              <dd>
                {classes.data?.items.find((x) => x.id === classId)?.name ??
                  "尚未选择"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">时长</dt>
              <dd>{duration} 分钟</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">题数 / 总分</dt>
              <dd>
                {problems.length} / {problems.reduce((n, p) => n + p.points, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">取分</dt>
              <dd>最后一次正式接收提交</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">训练奖励上限</dt>
              <dd>+{problems.reduce((sum, problem) => sum + rewardCap(problem), 0)} 积分（首次 AC 奖励另计）</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-border pt-3 text-sm">
            {problems.map((problem) => <p key={problem.problemId} className="py-1">{problem.title}：首次 AC +{problem.firstAcPoints ?? 10}（全站一次）；训练固定 +{problem.rewardPoints ?? 0}、速度最多 +{problem.speedBonusPoints ?? 0}、少尝试最多 +{problem.attemptBonusPoints ?? 0}</p>)}
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            确认开始后固定个人截止时间，统一窗口与预设训练时长中先到的时间为准。草稿和自测不会计分。只有个人截止前最终计分的有效 AC 才能在首次发布成绩时领取训练奖励：固定积分 + ⌊速度上限 × max(0, 预设训练时长 − 实际用时) ÷ 预设训练时长⌋ + ⌊尝试上限 ÷ 本题正式提交次数⌋。实际用时按服务器开始到 AC 接收计算，不使用截止倒计时余量。首次 AC 积分全站只领取一次；成绩由教师另行发布。
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>
              返回编辑
            </Button>
            {modal === "publish" && (
              <Button
                disabled={
                  action.busy ||
                  !problems.length ||
                  !title ||
                  !classId ||
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
                    return "训练已发布。";
                  })
                }
              >
                确认发布
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function TeacherTimedProgress({ id }: { id: string }) {
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
        ← 计时训练
      </Link>
      <PageHeader
        eyebrow="进行情况"
        title={practice?.title ?? "训练进行情况"}
        description="最后正式接收时间表示服务器接收记录，不代表学生在线或正在编程。"
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
                  {x}
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
              刷新
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
              label="未进入"
              value={`${unstarted} / ${applicable.length}`}
            />
            <Metric label="进行中" value={`${active} / ${applicable.length}`} />
            <Metric
              label="已结束"
              value={`${applicable.length - unstarted - active} / ${applicable.length}`}
            />
            <Metric
              label="需要处理"
              value={`${submissions.filter((s) => s.status === "System Error").length} 个系统问题`}
            />
          </div>
          <section className={`${panel} mt-5`}>
            <Table
              headers={[
                "学生",
                "活动状态",
                "已接收提交",
                "最后正式接收时间",
                "训练奖励积分",
                "需要处理",
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
                        href={`/teacher/reports?${new URLSearchParams({ classId: practice.classId, activity: `timed:${id}`, studentId: p.identityId, studentName: p.name })}`}
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
                        {p.exempt ? "取消豁免" : "设置豁免"}
                      </button>
                    </td>
                    <td>
                      <StatusPill
                        status={
                          p.exempt
                            ? "Exempt"
                            : !p.attempt
                              ? "未进入"
                              : p.attempt.status === "Active"
                                ? "进行中"
                                : "已结束"
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
                              )?.title ?? "题目"}
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
                      {grade?.pending ? "待有效判题" : grade ? `${practice.resultsPublished ? "已结算" : "预计"} +${grade.problems.reduce((sum, problem) => sum + (problem.totalRewardPoints ?? 0), 0)}` : "—"}
                    </td>
                    <td>
                      {grade?.problems.some((x) => x.status === "System Error")
                        ? "System Error · 不计为答错"
                        : grade?.pending
                          ? "等待有效结果"
                          : "—"}
                    </td>
                  </tr>
                );
              })}
              {!participants.length && (
                <Empty columns={6}>暂无活动学生。</Empty>
              )}
            </Table>
          </section>
          <p className="mt-3 text-xs text-muted-foreground">
            显示 {participants.length} 名学生；
            {participants.filter((x) => x.exempt).length} 人豁免。成绩
            {practice.resultsPublished
              ? `已发布 · 第 ${practice.resultsRevision ?? 1} 版`
              : "未发布"}
            。
          </p>
        </>
      )}
      {operation && practice && (
        <Modal title={`${operation}确认`} onClose={() => setOperation(null)}>
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
                    throw new Error("请选择需要重判的正式提交。");
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
                  ? "重判任务已提交。候选结果需单独确认，成绩不会自动发布。"
                  : `${operation}已执行。`;
              });
            }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              {operation === "发布成绩"
                ? practice.resultsPublished
                  ? "将发布当前成绩的一个新修订版本，旧版记录保留。"
                  : "明确发布当前活动成绩；平台故障或未完成评测会阻止发布。"
                : operation === "重判"
                  ? "重新评测所选正式提交，保留原记录，候选结果与成绩发布分别确认。"
                  : operation === "结束活动"
                    ? "结束本活动所有适用学生的作答，已经接收的提交继续评测。"
                    : "只影响明确选择的学生，保留历史记录。"}
            </p>
            {(operation === "单独延期" || operation === "豁免") && (
              <Field label="学生">
                <select
                  required
                  className={input}
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                >
                  <option value="">请选择学生</option>
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
              <Field label="新的个人截止时间">
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
            <Field label="操作原因">
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
                取消
              </Button>
              <Button
                disabled={action.busy}
                variant={operation === "结束活动" ? "danger" : "primary"}
              >
                确认{operation}
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

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { AppLink as Link } from "./navigation";
import { PageHeader } from "./page-chrome";
import { Button } from "./ui/button";
import {
  apiMessage,
  productionApi,
  type Assignment,
  type CampusRole,
  type CampusUser,
  type ProductionProblem,
} from "@/lib/production-api";
import { State, useData } from "./student/shared";

interface RankedStudent {
  id: string;
  name: string;
  avatar?: string;
  points: number;
  rank: number;
  solvedProblems?: number;
  attempts?: number;
  acRate?: number | null;
}

type RankingPeriod = "all" | "month" | "week";
type OptionalField = "solvedProblems" | "attempts" | "acRate";
type VisibleFields = Record<OptionalField, boolean>;
interface LeaderboardContext {
  id: string;
  name: string;
  canManage: boolean;
  visibleFields: VisibleFields;
}
interface LeaderboardContextsResponse {
  items: LeaderboardContext[];
}
interface LeaderboardResponse {
  items: RankedStudent[];
  total: number;
  page: number;
  pageSize: number;
  me?: RankedStudent | null;
  classId: string;
  visibleFields: VisibleFields;
}

const allFieldsVisible: VisibleFields = { solvedProblems: true, attempts: true, acRate: true };
const fieldLabels: { field: OptionalField; label: string }[] = [
  { field: "solvedProblems", label: "解题数" },
  { field: "attempts", label: "提交次数" },
  { field: "acRate", label: "AC 率" },
];

const rankingPeriods: { value: RankingPeriod; label: string }[] = [
  { value: "all", label: "全部时间" },
  { value: "month", label: "本月" },
  { value: "week", label: "本周" },
];
const rankNumber = new Intl.NumberFormat("zh-CN");

function pageNumbers(current: number, last: number): (number | "…")[] {
  const visible = [...new Set([1, last, current - 1, current, current + 1])]
    .filter((value) => value >= 1 && value <= last)
    .sort((a, b) => a - b);
  return visible.flatMap((value, index) => {
    if (index === 0) return [value];
    const gap = value - visible[index - 1];
    return gap === 2 ? [value - 1, value] : gap > 2 ? ["…" as const, value] : [value];
  });
}

function LeaderboardRow({ person, current, visibleFields, workspace, classId }: { person: RankedStudent; current: boolean; visibleFields: VisibleFields; workspace: CampusRole; classId: string }) {
  return (
    <tr className={`border-t border-border ${current ? "bg-primary/6 hover:!bg-primary/10" : ""}`}>
      <td className={`px-5 py-4 font-semibold tabular-nums ${person.rank <= 3 ? "text-primary" : "text-muted-foreground"}`}>
        {rankNumber.format(person.rank)}
      </td>
      <td className="px-4 py-4">
        <Link
          href={`/${workspace}/people/${encodeURIComponent(person.id)}?${new URLSearchParams({ from: "points", classId })}`}
          className="inline-flex min-w-36 items-center gap-3 rounded-md text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {person.avatar ? (
            <Image src={person.avatar} unoptimized width={38} height={38} alt="" className="size-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-semibold text-primary">
              {person.name.trim().slice(0, 1) || "学"}
            </span>
          )}
          <span className="min-w-0 font-medium">
            {person.name}{current && <span className="ml-2 text-xs font-semibold text-primary">（我）</span>}
          </span>
        </Link>
      </td>
      <td className="px-4 py-4 text-right font-semibold tabular-nums">{rankNumber.format(person.points)}</td>
      {visibleFields.solvedProblems && <td className="px-4 py-4 text-right tabular-nums">{person.solvedProblems == null ? "—" : rankNumber.format(person.solvedProblems)}</td>}
      {visibleFields.attempts && <td className="px-4 py-4 text-right tabular-nums">{person.attempts == null ? "—" : rankNumber.format(person.attempts)}</td>}
      {visibleFields.acRate && <td className="px-5 py-4 text-right tabular-nums">{person.acRate == null ? "—" : `${Number.isInteger(person.acRate) ? person.acRate : person.acRate.toFixed(1)}%`}</td>}
    </tr>
  );
}

function LeaderboardForClass({
  user, context, staff, workspace, onContextUpdated,
}: {
  user: CampusUser;
  context: LeaderboardContext;
  staff: boolean;
  workspace: CampusRole;
  onContextUpdated: () => void;
}) {
  const [period, setPeriod] = useState<RankingPeriod>("all");
  const [page, setPage] = useState(1);
  const [draftFields, setDraftFields] = useState<VisibleFields>(context.visibleFields);
  const [savedFields, setSavedFields] = useState<VisibleFields>(context.visibleFields);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const pageSize = 10;
  const ranking = useData<LeaderboardResponse>(`points/leaderboard?classId=${encodeURIComponent(context.id)}&period=${period}&page=${page}&pageSize=${pageSize}`);
  const total = ranking.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  const me = ranking.data?.me;
  const showMe = me && !ranking.data?.items.some((person) => person.id === me.id);
  const visibleFields = staff ? allFieldsVisible : ranking.data?.visibleFields ?? context.visibleFields;
  const optionalCount = fieldLabels.filter(({ field }) => visibleFields[field]).length;
  const tableWidth = optionalCount === 3 ? "min-w-[700px]" : optionalCount === 2 ? "min-w-[580px]" : optionalCount === 1 ? "min-w-[500px]" : "min-w-[420px]";
  const dirtySettings = fieldLabels.some(({ field }) => draftFields[field] !== savedFields[field]);

  async function saveVisibleFields() {
    setSaving(true);
    setSettingsMessage("");
    setSettingsError(false);
    try {
      await productionApi(`points/leaderboard/contexts/${encodeURIComponent(context.id)}`, {
        method: "PATCH",
        body: { visibleFields: draftFields },
      });
      setSavedFields({ ...draftFields });
      setSettingsMessage("此班级的学生端排行榜字段已更新。");
      onContextUpdated();
      ranking.reload();
    } catch (error) {
      setSettingsMessage(apiMessage(error));
      setSettingsError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <p className="text-sm text-muted-foreground">按所选时间段入账积分排名，同分并列。</p>
        <div role="group" aria-label="排行榜时间范围" className="inline-flex rounded-md border border-border bg-surface-subtle p-1">
          {rankingPeriods.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => { setPeriod(option.value); setPage(1); }}
              className={`rounded px-3 py-2 text-sm font-medium ${period === option.value ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {staff && context.canManage && (
        <fieldset className="border-b border-border bg-surface-subtle px-5 py-4">
          <legend className="sr-only">{context.name}学生端排行榜字段</legend>
          <p className="text-sm font-semibold">学生端显示字段</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">仅影响此班级的学生视图；排名、昵称和积分始终显示。教师查看时保留全部统计。</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            {fieldLabels.map(({ field, label }) => (
              <label key={field} className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={saving}
                  checked={draftFields[field]}
                  onChange={(event) => { setDraftFields((value) => ({ ...value, [field]: event.target.checked })); setSettingsMessage(""); setSettingsError(false); }}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
            <Button type="button" size="sm" disabled={saving || !dirtySettings} onClick={() => void saveVisibleFields()}>
              {saving ? "正在保存…" : "保存显示设置"}
            </Button>
          </div>
          {settingsMessage && <p role={settingsError ? "alert" : "status"} className={`mt-2 text-sm ${settingsError ? "text-destructive" : "text-muted-foreground"}`}>{settingsMessage}</p>}
        </fieldset>
      )}
      {optionalCount > 0 && (
        <p className="border-b border-border px-5 py-3 text-xs leading-5 text-muted-foreground">
          {visibleFields.solvedProblems && "解题数为本时段首次 AC 的不同题目数。"}
          {visibleFields.attempts && "提交次数包含重复正式提交，不含样例运行、订正和未公布的限时训练提交。"}
          {visibleFields.acRate && "AC 率 = AC 的正式提交数 ÷ 已有有效判题结果的正式提交数；待评测和系统错误不计入比率。"}
        </p>
      )}
      <State data={ranking}>
        {ranking.loading ? (
          <p role="status" className="px-5 py-10 text-center text-sm text-muted-foreground">正在更新排行榜…</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={`w-full ${tableWidth} text-left text-sm`}>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-3">排名</th>
                    <th scope="col" className="px-4 py-3">学生</th>
                    <th scope="col" className="px-4 py-3 text-right">积分</th>
                    {visibleFields.solvedProblems && <th scope="col" className="px-4 py-3 text-right">解题数</th>}
                    {visibleFields.attempts && <th scope="col" className="px-4 py-3 text-right">提交次数</th>}
                    {visibleFields.acRate && <th scope="col" className="px-5 py-3 text-right">
                      <abbr title="AC 的正式提交数 ÷ 已有有效判题结果的正式提交数" className="cursor-help no-underline">AC 率 ⓘ</abbr>
                    </th>}
                  </tr>
                </thead>
                <tbody>
                  {ranking.data?.items.map((person) => <LeaderboardRow key={person.id} person={person} current={person.id === user.identityId} visibleFields={visibleFields} workspace={workspace} classId={context.id} />)}
                  {showMe && <LeaderboardRow person={me} current visibleFields={visibleFields} workspace={workspace} classId={context.id} />}
                </tbody>
              </table>
              {!ranking.data?.items.length && !showMe && <p className="px-5 py-8 text-center text-sm text-muted-foreground">此时间段暂无积分记录。</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
              <span>{total ? `显示 ${start}–${end} / ${rankNumber.format(total)} 名已获积分学生` : "暂无已获积分学生"}{showMe ? " · 我的数据单独显示" : ""}</span>
              <nav aria-label="排行榜分页" className="flex items-center gap-2">
                <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border border-border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50">‹</button>
                {pageNumbers(page, pages).map((number, index) => number === "…" ? (
                  <span key={`gap-${index}`} aria-hidden="true" className="px-1">…</span>
                ) : (
                  <button
                    key={number}
                    type="button"
                    aria-label={`第 ${number} 页`}
                    aria-current={page === number ? "page" : undefined}
                    onClick={() => setPage(number)}
                    className={`min-w-9 rounded px-2 py-1.5 tabular-nums ${page === number ? "bg-accent font-semibold text-foreground" : "hover:bg-surface-subtle"}`}
                  >
                    {number}
                  </button>
                ))}
                <button type="button" aria-label="下一页" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded border border-border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50">›</button>
              </nav>
            </div>
          </>
        )}
      </State>
    </>
  );
}

function Leaderboard({ user, staff, workspace }: { user: CampusUser; staff: boolean; workspace: CampusRole }) {
  const contexts = useData<LeaderboardContextsResponse>("points/leaderboard/contexts");
  const searchParams = useSearchParams();
  const requestedClassId = searchParams.get("classId");
  const [selectedClassId, setSelectedClassId] = useState(requestedClassId ?? "");
  useEffect(() => { setSelectedClassId(requestedClassId ?? ""); }, [requestedClassId]);
  const classes = contexts.data?.items ?? [];
  const selectedClass = classes.find((item) => item.id === selectedClassId) ?? classes[0];
  const selectClass = (id: string) => {
    setSelectedClassId(id);
    const next = new URLSearchParams(searchParams.toString());
    next.set("classId", id);
    window.history.replaceState(null, "", `?${next.toString()}`);
  };

  return (
    <section className="mt-5 w-full overflow-hidden rounded-lg border border-border bg-surface xl:w-3/5" aria-labelledby="leaderboard-heading">
      <div className="border-b border-border px-5 py-5">
        <h2 id="leaderboard-heading" className="text-lg font-semibold">学生积分榜</h2>
        <p className="mt-1 text-sm text-muted-foreground">以全站积分在班级内排名；各班级可分别设置学生看到的统计字段。</p>
      </div>
      <State data={contexts}>
        {!selectedClass ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">暂无可查看的班级排行榜。请联系教师确认班级成员身份。</p>
        ) : (
          <>
            <div className="border-b border-border px-5 py-3">
              {classes.length > 1 ? (
                <label className="inline-flex flex-wrap items-center gap-2 text-sm font-medium">
                  班级
                  <select
                    value={selectedClass.id}
                    onChange={(event) => selectClass(event.target.value)}
                    className="min-h-9 max-w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              ) : <p className="text-sm font-medium">班级：{selectedClass.name}</p>}
            </div>
            <LeaderboardForClass key={selectedClass.id} user={user} context={selectedClass} staff={staff} workspace={workspace} onContextUpdated={contexts.reload} />
          </>
        )}
      </State>
    </section>
  );
}

function assignmentProblemHref(assignmentId: string, problem: Assignment["problems"][number]) {
  const query = new URLSearchParams({
    returnTo: `/teacher/assignments/${assignmentId}/edit?tab=problems`,
  });
  if (problem.versionId) query.set("versionId", problem.versionId);
  return `/teacher/problems/${problem.problemId}/edit?${query.toString()}`;
}

export function PointsPage({ user, student = true, workspace = "student" }: { user: CampusUser; student?: boolean; workspace?: CampusRole }) {
  const me = useData<{ points: number }>(student ? "points/me" : "");
  const staff = user.roles.some((role) => role === "teacher" || role === "admin");
  const admin = user.roles.includes("admin");
  const problems = useData<{ items: ProductionProblem[] }>(admin ? "problems" : "");
  const assignments = useData<{ items: Assignment[] }>(staff ? "assignments" : "");
  const [assignmentId, setAssignmentId] = useState("");
  const [problemId, setProblemId] = useState("");
  const [points, setPoints] = useState(10);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const assignment = assignments.data?.items.find((item) => item.id === assignmentId);
  const assignmentBonus = assignment?.problems.reduce((sum, problem) => sum + (problem.rewardPoints ?? 0), 0) ?? 0;

  return (
    <>
      <PageHeader title="积分与奖励" description="首次正式通过题目获得积分；努力有记录，进步有回响。" />
      {student && <p className="mt-4">我的积分：<strong>{me.data?.points ?? "…"}</strong></p>}
      <p className="mt-2 text-sm text-muted-foreground">
        默认每题首次 AC 10 分。重复提交和样例运行不计分；作业和限时训练可设置额外奖励。未公开计时成绩公布后计分。
      </p>
      <Leaderboard user={user} staff={!student} workspace={workspace} />
      {staff && (
        <section className="mt-6 rounded border border-border bg-surface p-5">
          <h2 className="font-semibold">作业额外奖励</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            作业奖励在题目首次 AC 积分之外追加，每题最多 20 分、每份作业合计最多 100 分，学生每周任务奖励最多 200 分。已入账积分不变；设置请在对应作业的 Problems 页完成。
          </p>
          <State data={assignments}>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select
                aria-label="查看作业额外奖励"
                className="max-w-full rounded border border-border bg-surface p-2"
                value={assignmentId}
                onChange={(event) => setAssignmentId(event.target.value)}
              >
                <option value="">选择作业查看奖励</option>
                {assignments.data?.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              {assignment && <Link href={`/teacher/assignments/${assignment.id}/edit?tab=problems`} className="font-semibold text-primary hover:underline">前往 Problems 页编辑 →</Link>}
            </div>
            {assignment && (
              <div className="mt-4 overflow-x-auto rounded border border-border">
                <p className="border-b border-border bg-surface-subtle p-3 text-sm font-semibold">当前额外奖励合计 {assignmentBonus} / 100 积分</p>
                <table className="w-full text-left text-sm">
                  <thead><tr><th className="p-3">题目</th><th>首次 AC 积分</th><th>本作业额外奖励</th></tr></thead>
                  <tbody>
                    {assignment.problems.map((problem) => (
                      <tr key={problem.problemId} className="border-t border-border">
                        <td className="p-3"><Link href={assignmentProblemHref(assignment.id, problem)} className="font-semibold text-primary hover:underline">{problem.title ?? problem.problemId}</Link></td>
                        <td>+{problem.firstAcPoints ?? 10}</td>
                        <td>+{problem.rewardPoints ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </State>
        </section>
      )}
      {admin && (
        <section className="mt-6 rounded border border-border bg-surface p-5">
          <h2 className="font-semibold">题目首次 AC 积分设置</h2>
          <p className="mt-2 text-sm text-muted-foreground">默认每题 10 积分；管理员可按题目调整为 0–30 积分。已入账积分不变。</p>
          <State data={problems}>
            <form
              className="mt-4 flex flex-wrap items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void productionApi("points/rewards", {
                  method: "POST",
                  body: { problemId, assignmentId: null, points },
                }).then(() => {
                  setMessage("题目首次 AC 积分已保存。");
                  problems.reload();
                }).catch((error: Error) => setMessage(error.message)).finally(() => setBusy(false));
              }}
            >
              <select
                required
                aria-label="设置首次 AC 积分的题目"
                className="max-w-full rounded border border-border bg-surface p-2"
                value={problemId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setProblemId(nextId);
                  setPoints(problems.data?.items.find((problem) => problem.id === nextId)?.firstAcPoints ?? 10);
                }}
              >
                <option value="">选择题目</option>
                {problems.data?.items.filter((problem) => problem.canEdit).map((problem) => <option key={problem.id} value={problem.id}>{problem.title}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm">
                首次 AC 积分
                <input required type="number" min={0} max={30} step={1} value={points} onChange={(event) => setPoints(Number(event.target.value))} className="w-24 rounded border border-border bg-surface p-2" />
              </label>
              <Button disabled={busy || !problemId}>保存积分</Button>
            </form>
            {problemId && <p className="mt-2 text-xs text-muted-foreground">当前设置：{problems.data?.items.find((problem) => problem.id === problemId)?.firstAcPoints ?? 10} 积分</p>}
            <p role="status" className="mt-3 text-sm">{message}</p>
          </State>
        </section>
      )}
    </>
  );
}

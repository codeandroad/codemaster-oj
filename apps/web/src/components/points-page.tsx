"use client";

import { useState } from "react";
import Image from "next/image";
import { AppLink as Link } from "./navigation";
import { PageHeader } from "./page-chrome";
import { Button } from "./ui/button";
import {
  productionApi,
  type Assignment,
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
}

function assignmentProblemHref(assignmentId: string, problem: Assignment["problems"][number]) {
  const query = new URLSearchParams({
    returnTo: `/teacher/assignments/${assignmentId}/edit?tab=problems`,
  });
  if (problem.versionId) query.set("versionId", problem.versionId);
  return `/teacher/problems/${problem.problemId}/edit?${query.toString()}`;
}

export function PointsPage({ user, student = true }: { user: CampusUser; student?: boolean }) {
  const ranking = useData<{ items: RankedStudent[] }>("points/leaderboard");
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
      <PageHeader title="积分排行榜" description="首次正式通过题目获得积分；努力有记录，进步有回响。" />
      {student && <p className="mt-4">我的积分：<strong>{me.data?.points ?? "…"}</strong></p>}
      <p className="mt-2 text-sm text-muted-foreground">
        默认每题首次 AC 10 分。重复提交和样例运行不计分；作业可设置额外奖励。未公开计时成绩公布后计分。仅展示学生前 100 名，同分并列。
      </p>
      <State data={ranking}>
        <div className="mt-5 overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead><tr><th className="p-4">排名</th><th>学生</th><th>积分</th></tr></thead>
            <tbody>
              {ranking.data?.items.map((person) => (
                <tr key={person.id} className="border-t border-border">
                  <td className="p-4">{person.rank}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      {person.avatar && <Image src={person.avatar} unoptimized width={32} height={32} alt="" className="rounded-full" />}
                      {person.name}{person.id === user.identityId ? "（我）" : ""}
                    </span>
                  </td>
                  <td>{person.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ranking.data?.items.length && <p className="p-4 text-muted-foreground">暂无积分记录，完成一道题开始积累。</p>}
        </div>
      </State>
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

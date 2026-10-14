"use client";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import {
  productionApi,
  type SchoolClass,
  type Submission,
} from "@/lib/production-api";
import type { TeacherAssignment } from "./dashboard-classes";
import { TeacherSubmissionDrawer } from "./assignments";
import {
  date,
  Drawer,
  Empty,
  Feedback,
  Field,
  input,
  link,
  panel,
  State,
  Table,
  useAction,
  useData,
} from "./shared";

interface Report {
  classes: SchoolClass[];
  assignments: TeacherAssignment[];
  timedPractices?: { id: string; title: string; classId: string }[];
  summary: {
    participants: number;
    submittedStudents: number;
    pendingStudents: number;
    averagePercent: number | null;
  };
  metrics?: {
    notStarted: number;
    incomplete: number;
    repeatedFailures: number;
    waitingFeedback: number;
    denominator: number;
  };
  students: {
    identityId: string;
    name: string;
    assignments: {
      id: string;
      title: string;
      type?: string;
      score: number | null;
      maxScore: number;
      pending: boolean;
      problems: {
        problemId: string;
        submissionId: string | null;
        score: number | null;
        status: string;
      }[];
    }[];
    repeatedFailures?: number;
    repeatedFailureProblemIds?: string[];
    waitingFeedback?: boolean;
  }[];
  problems: {
    problemId: string;
    title: string;
    attempted: number;
    denominator: number;
    averagePercent: number | null;
  }[];
  submissions: (Submission & { identityId?: string })[];
}
export function TeacherReports() {
  const search = useSearchParams(),
    [classId, setClass] = useState(search.get("classId") ?? ""),
    [activity, setActivity] = useState(search.get("activity") ?? ""),
    [range, setRange] = useState("全部时间"),
    [drill, setDrill] = useState<{
      type: "metric" | "problem" | "student";
      id: string;
      title: string;
    } | null>(search.get("studentId") ? {
      type: "student",
      id: search.get("studentId")!,
      title: search.get("studentName") ?? "学生详情",
    } : null),
    [submission, setSubmission] = useState<string | null>(
      search.get("submissionId"),
    ),
    action = useAction();
  const [referenceTime] = useState(() => Date.now());
  const [kind, id] = activity.split(":");
  const params = new URLSearchParams({
    classId,
    assignmentId: kind === "assignment" ? (id ?? "") : "",
    timedPracticeId: kind === "timed" ? (id ?? "") : "",
  });
  if (range !== "全部时间")
    params.set(
      "since",
      new Date(
        referenceTime - (range === "最近 7 天" ? 7 : 30) * 86400000,
      ).toISOString(),
    );
  const query = params.toString(),
    resource = useData<Report>(`reports?${query}`),
    report = resource.data;
  const students = report?.students ?? [],
    denominator =
      report?.metrics?.denominator ?? report?.summary.participants ?? 0,
    notStarted =
      report?.metrics?.notStarted ??
      students.filter((s) =>
        s.assignments.every((a) => a.problems.every((p) => !p.submissionId)),
      ).length,
    incomplete =
      report?.metrics?.incomplete ??
      students.filter((s) =>
        s.assignments.some((a) => a.problems.some((p) => p.status !== "AC")),
      ).length;
  const metrics = [
    {
      label: "未开始",
      value: notStarted,
      id: "notStarted",
      note: "适用学生，排除豁免",
    },
    {
      label: "未全部完成",
      value: incomplete,
      id: "incomplete",
      note: "未完成当前活动全部题目",
    },
    {
      label: "反复未通过",
      value: report?.metrics?.repeatedFailures,
      id: "repeatedFailures",
      note: "同题至少 2 次有效非 AC",
    },
    {
      label: "等待教师反馈",
      value: report?.metrics?.waitingFeedback,
      id: "waitingFeedback",
      note: "订正笔记尚未收到教师反馈",
    },
  ];
  const drillStudents = students.filter((s) =>
    !drill
      ? true
      : drill.type === "student"
        ? s.identityId === drill.id
        : drill.type === "problem"
          ? s.assignments.some((a) =>
              a.problems.some((p) => p.problemId === drill.id),
            )
          : drill.id === "notStarted"
            ? s.assignments.every((a) =>
                a.problems.every((p) => !p.submissionId),
              )
            : drill.id === "incomplete"
              ? s.assignments.some((a) =>
                  a.problems.some((p) => p.status !== "AC"),
                )
              : drill.id === "repeatedFailures"
                ? Boolean(s.repeatedFailureProblemIds?.length)
                : Boolean(s.waitingFeedback),
  );
  return (
    <>
      <PageHeader
        eyebrow="Teaching Reports"
        title="教学报告"
        description="每项指标对应当前班级、活动与明确分母；平台错误单独展示。"
        action={
          <Button
            variant="secondary"
            disabled={resource.loading || action.busy || !report}
            onClick={() =>
              void action.run(async () => {
                const result = await productionApi<{
                  columns: string[];
                  rows: unknown[][];
                }>(`reports/export?${query}`);
                const csv = [result.columns, ...result.rows]
                  .map((row) =>
                    row
                      .map((value) => {
                        let v = String(value ?? "");
                        if (typeof value === "string" && /^[=+\-@\t\r]/.test(v))
                          v = `'${v}`;
                        return `"${v.replace(/"/g, '""')}"`;
                      })
                      .join(","),
                  )
                  .join("\r\n");
                const url = URL.createObjectURL(
                    new Blob(["\ufeff", csv], {
                      type: "text/csv;charset=utf-8",
                    }),
                  ),
                  a = document.createElement("a");
                a.href = url;
                a.download = "campus-judge-report.csv";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return "报告 CSV 已生成。";
              })
            }
          >
            导出 CSV
          </Button>
        }
      />
      <Feedback action={action} />
      <div
        className={`${panel} mt-5 grid grid-cols-3 gap-3 p-4 max-md:grid-cols-1`}
      >
        <Field label="班级">
          <select
            value={classId}
            onChange={(e) => {
              setClass(e.target.value);
              setActivity("");
            }}
            className={input}
          >
            <option value="">全部负责班级</option>
            {report?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="活动">
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            className={input}
          >
            <option value="">全部活动</option>
            {report?.assignments.map((a) => (
              <option key={a.id} value={`assignment:${a.id}`}>
                {a.title}（作业）
              </option>
            ))}
            {report?.timedPractices?.map((t) => (
              <option key={t.id} value={`timed:${t.id}`}>
                {t.title}（计时训练）
              </option>
            ))}
          </select>
        </Field>
        <Field label="活动创建时间">
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setActivity("");
            }}
            className={input}
          >
            {["全部时间", "最近 7 天", "最近 30 天"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
      </div>
      <State resource={resource} />
      <div className="mt-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        {metrics.map((m) => (
          <button
            key={m.id}
            className={`${panel} p-4 text-left hover:border-primary`}
            onClick={() =>
              setDrill({ type: "metric", id: m.id, title: m.label })
            }
          >
            <div className="text-xs font-semibold text-muted-foreground">
              {m.label}
            </div>
            <div className="mt-2 text-2xl font-bold">
              {m.value === undefined ? "—" : `${m.value} / ${denominator}`}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>
          </button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_360px] gap-5 max-lg:grid-cols-1">
        <section className={panel}>
          <Table
            headers={[
              "学生",
              "活动状态",
              "已正式提交",
              "反复未通过题",
              "原结果 / 订正",
            ]}
            min={760}
          >
            {students.map((s) => {
              const problems = s.assignments.flatMap((a) => a.problems),
                submitted = problems.filter((p) => p.submissionId).length,
                solved = problems.filter((p) => p.status === "AC").length;
              return (
                <tr key={s.identityId}>
                  <td>
                    <button
                      onClick={() =>
                        setDrill({
                          type: "student",
                          id: s.identityId,
                          title: s.name,
                        })
                      }
                      className="text-left font-semibold"
                    >
                      {s.name}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {s.identityId.slice(0, 8)}
                    </p>
                  </td>
                  <td>
                    <StatusPill
                      status={
                        solved === problems.length && problems.length
                          ? "Complete"
                          : submitted
                            ? "In progress"
                            : "Not started"
                      }
                    />
                  </td>
                  <td>
                    {submitted} / {problems.length}
                  </td>
                  <td>
                    {s.repeatedFailureProblemIds?.length ??
                      s.repeatedFailures ??
                      "—"}
                  </td>
                  <td>
                    <div className="space-y-1">
                      {s.assignments.map((a) => (
                        <button
                          key={a.id}
                          className="block text-left text-xs text-primary"
                          onClick={() =>
                            setDrill({
                              type: "student",
                              id: s.identityId,
                              title: `${s.name} · ${a.title}`,
                            })
                          }
                        >
                          {a.title} ·{" "}
                          {a.score === null
                            ? "待有效评测"
                            : `${a.score} / ${a.maxScore}`}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!students.length && !resource.loading && (
              <Empty columns={5}>
                当前筛选暂无适用学生。可调整班级或活动。
              </Empty>
            )}
          </Table>
        </section>
        <section className={`${panel} self-start p-5`}>
          <h2 className="font-bold">题目维度</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            分母为当前范围内明确分配的人次。
          </p>
          {report?.problems.map((p) => (
            <button
              key={p.problemId}
              className="mt-3 flex w-full justify-between gap-3 border-b border-border py-3 text-left text-sm"
              onClick={() =>
                setDrill({ type: "problem", id: p.problemId, title: p.title })
              }
            >
              <b>{p.title}</b>
              <span className="shrink-0 text-xs text-muted-foreground">
                {p.attempted} / {p.denominator} 已尝试
                <br />
                均分率{" "}
                {p.averagePercent === null
                  ? "—"
                  : `${p.averagePercent.toFixed(1)}%`}
              </span>
            </button>
          ))}
          <p className="mt-4 text-xs text-muted-foreground">
            平台错误不算学生答错；没有能力分或运行速度排名。
          </p>
        </section>
      </div>
      {drill && (
        <Drawer
          title={`报告下钻 · ${drill.title}`}
          onClose={() => setDrill(null)}
        >
          <p className="text-sm text-muted-foreground">
            筛选保持：
            {report?.classes.find((x) => x.id === classId)?.name ??
              "全部负责班级"}{" "}
            ·{" "}
            {report?.assignments.find((x) => x.id === id)?.title ??
              report?.timedPractices?.find((x) => x.id === id)?.title ??
              "全部活动"}{" "}
            · {range}
          </p>
          <div className="mt-5 space-y-3">
            {drillStudents.map((s) => (
              <section
                key={s.identityId}
                className="border border-border p-3 text-sm"
              >
                <b>{s.name}</b>
                {s.assignments.map((a) => (
                  <div key={a.id} className="mt-3 border-t border-border pt-3">
                    <Link
                      href={
                        a.type === "timed"
                          ? `/teacher/timed-practice/${a.id}/progress`
                          : `/teacher/assignments/${a.id}/progress`
                      }
                      className={link}
                    >
                      {a.title}
                    </Link>
                    {a.problems
                      .filter(
                        (p) =>
                          drill.type !== "problem" || p.problemId === drill.id,
                      )
                      .map((p) => (
                        <button
                          key={p.problemId}
                          disabled={!p.submissionId}
                          onClick={() => setSubmission(p.submissionId)}
                          className="mt-2 flex w-full justify-between border-b border-border py-2 text-left text-xs"
                        >
                          <span>
                            {report?.problems.find(
                              (x) => x.problemId === p.problemId,
                            )?.title ?? p.problemId.slice(0, 8)}
                          </span>
                          <span>
                            {p.status} ·{" "}
                            {p.score === null ? "待评测" : `${p.score}%`}
                          </span>
                        </button>
                      ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
          {!drillStudents.length && (
            <p className="mt-5 text-sm text-muted-foreground">
              当前指标没有匹配记录。
            </p>
          )}
          <h3 className="mt-5 font-bold">相关正式提交</h3>
          {report?.submissions
            .filter(
              (s) =>
                (drill.type !== "problem" || s.problemId === drill.id) &&
                drillStudents.some(
                  (student) => student.identityId === s.identityId,
                ),
            )
            .map((s) => (
              <button
                key={s.id}
                className="mt-3 flex w-full justify-between gap-3 border-b border-border pb-3 text-left text-sm"
                onClick={() => setSubmission(s.id)}
              >
                <span>
                  <b>
                    {s.studentName} · {s.id}
                  </b>
                  <p className="text-xs text-muted-foreground">
                    {date(s.createdAt)}
                  </p>
                </span>
                <StatusPill status={s.status} />
              </button>
            ))}
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => setDrill(null)}
          >
            返回报告筛选
          </Button>
        </Drawer>
      )}
      {submission && (
        <TeacherSubmissionDrawer
          id={submission}
          title="学生提交 · 代码 / 订正 / 反馈"
          onClose={() => setSubmission(null)}
        />
      )}
    </>
  );
}

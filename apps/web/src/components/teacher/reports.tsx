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
import { useLocale } from "@/components/locale-context";
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
  classes: (SchoolClass & { archived?: boolean })[];
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
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const statusLabel = (status: string) => locale === "en" ? status : ({"System Error":"系统错误", Submitted:"已提交", Waiting:"排队中", Judging:"评测中"} as Record<string,string>)[status] ?? status;
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
      label: tr("未开始", "Not started"),
      value: notStarted,
      id: "notStarted",
      note: tr("适用学生，排除豁免", "Eligible students, excluding exemptions"),
    },
    {
      label: tr("未全部完成", "Incomplete"),
      value: incomplete,
      id: "incomplete",
      note: tr("未完成当前活动全部题目", "Not all activity problems completed"),
    },
    {
      label: tr("反复未通过", "Repeated failures"),
      value: report?.metrics?.repeatedFailures,
      id: "repeatedFailures",
      note: tr("同题至少 2 次有效非 AC", "At least two valid non-AC attempts on one problem"),
    },
    {
      label: tr("等待教师反馈", "Awaiting teacher feedback"),
      value: report?.metrics?.waitingFeedback,
      id: "waitingFeedback",
      note: tr("订正笔记尚未收到教师反馈", "Correction notes awaiting teacher feedback"),
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
        eyebrow={tr("教学报告", "Teaching Reports")}
        title={tr("教学报告", "Teaching reports")}
        description={tr("每项指标对应当前班级、活动与明确分母；平台错误单独展示。", "Metrics use the selected class, activity, and a defined denominator. Platform errors are shown separately.")}
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
                return tr("报告 CSV 已生成。", "Report CSV generated.");
              })
            }
          >
            {tr("导出 CSV", "Export CSV")}
          </Button>
        }
      />
      <Feedback action={action} />
      <div
        className={`${panel} mt-5 grid grid-cols-3 gap-3 p-4 max-md:grid-cols-1`}
      >
        <Field label={tr("班级", "Class")}>
          <select
            value={classId}
            onChange={(e) => {
              setClass(e.target.value);
              setActivity("");
            }}
            className={input}
          >
            <option value="">{tr("全部使用中班级", "All active classes")}</option>
            {report?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.archived ? tr("（已归档）", " (archived)") : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("活动", "Activity")}>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            className={input}
          >
            <option value="">{tr("全部活动", "All activities")}</option>
            {report?.assignments.map((a) => (
              <option key={a.id} value={`assignment:${a.id}`}>
                {a.title} {tr("（作业）", "(assignment)")}
              </option>
            ))}
            {report?.timedPractices?.map((t) => (
              <option key={t.id} value={`timed:${t.id}`}>
                {t.title} {tr("（计时训练）", "(timed practice)")}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("活动创建时间", "Activity created")}>
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setActivity("");
            }}
            className={input}
          >
            {["全部时间", "最近 7 天", "最近 30 天"].map((x) => (
              <option key={x} value={x}>{tr(x, x === "全部时间" ? "All time" : x === "最近 7 天" ? "Last 7 days" : "Last 30 days")}</option>
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
      <div className="mt-5 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5 max-[1600px]:grid-cols-1">
        <section className={`${panel} min-w-0 [&_td]:px-3 [&_th]:px-3`}>
          <Table
            headers={[
              tr("学生", "Student"),
              tr("活动状态", "Activity status"),
              tr("已正式提交", "Formal submissions"),
              tr("反复未通过题", "Repeated failures"),
              tr("原结果 / 订正", "Original result / correction"),
            ]}
            min={720}
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
                          ? tr("完成", "Complete")
                          : submitted
                            ? tr("进行中", "In progress")
                            : tr("未开始", "Not started")
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
                            ? tr("待有效评测", "Awaiting valid evaluation")
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
                {tr("当前筛选暂无适用学生。可调整班级或活动。", "No eligible students match these filters. Try another class or activity.")}
              </Empty>
            )}
          </Table>
        </section>
        <section className={`${panel} min-w-0 self-start p-5`}>
          <h2 className="font-bold">{tr("题目维度", "Problem breakdown")}</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("分母为当前范围内明确分配的人次。", "The denominator counts assigned students in the selected scope.")}
          </p>
          {report?.problems.map((p) => (
            <button
              key={p.problemId}
              className="mt-3 flex w-full justify-between gap-3 border-b border-border py-3 text-left text-sm"
              onClick={() =>
                setDrill({ type: "problem", id: p.problemId, title: p.title })
              }
            >
              <b className="min-w-0 break-words">{p.title}</b>
              <span className="shrink-0 text-xs text-muted-foreground">
                {p.attempted} / {p.denominator} {tr("已尝试", "attempted")}
                <br />
                {tr("均分率", "Average score")} {" "}
                {p.averagePercent === null
                  ? "—"
                  : `${p.averagePercent.toFixed(1)}%`}
              </span>
            </button>
          ))}
          <p className="mt-4 text-xs text-muted-foreground">
            {tr("平台错误不算学生答错；没有能力分或运行速度排名。", "Platform errors do not count as student mistakes. There is no skill rating or runtime ranking.")}
          </p>
        </section>
      </div>
      {drill && (
        <Drawer
          title={`${tr("报告详情", "Report details")} · ${drill.title}`}
          onClose={() => setDrill(null)}
        >
          <p className="text-sm text-muted-foreground">
            {tr("当前筛选：", "Filters: ")}
            {report?.classes.find((x) => x.id === classId)?.name ??
              tr("全部负责班级", "All assigned classes")}{" "}
            ·{" "}
            {report?.assignments.find((x) => x.id === id)?.title ??
              report?.timedPractices?.find((x) => x.id === id)?.title ??
              tr("全部活动", "All activities")}{" "}
            · {tr(range, range === "全部时间" ? "All time" : range === "最近 7 天" ? "Last 7 days" : "Last 30 days")}
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
                            {statusLabel(p.status)} ·{" "}
                            {p.score === null ? tr("待评测", "Pending") : `${p.score}%`}
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
              {tr("当前指标没有匹配记录。", "No matching records for this metric.")}
            </p>
          )}
          <h3 className="mt-5 font-bold">{tr("相关正式提交", "Related formal submissions")}</h3>
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
                <StatusPill status={statusLabel(s.status)} />
              </button>
            ))}
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => setDrill(null)}
          >
            {tr("返回报告筛选", "Back to report filters")}
          </Button>
        </Drawer>
      )}
      {submission && (
        <TeacherSubmissionDrawer
          id={submission}
          title={tr("学生提交 · 代码 / 订正 / 反馈", "Student submission · Code / correction / feedback")}
          onClose={() => setSubmission(null)}
        />
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Feedback,
  date,
  input,
  useMutation,
} from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import type {
  SchoolPaper4Attempt,
  SchoolPaper4Job,
} from "./school-paper4-model";

export function SchoolPaper4Results({
  jobs,
  questionKey,
  visible,
}: {
  jobs: SchoolPaper4Job[];
  questionKey: string;
  visible: boolean;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const [selected, setSelected] = useState<string | null>(null);
  const items = jobs.filter(
    (job) =>
      !job.questions?.length ||
      job.questions.some((q) => q.key === questionKey),
  );
  const current = items.find((job) => job.id === selected) ?? items[0],
    question = current?.questions?.find((q) => q.key === questionKey);
  if (!current)
    return (
      <p className="p-3 text-sm text-muted-foreground">
        {tx(
          "运行公开测试，或提交整卷进行正式判题。",
          "Run public tests or submit the paper for formal judging.",
        )}
      </p>
    );
  const pending = ["queued", "leased"].includes(current.state);
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong
          className={
            current.status === "AC"
              ? "text-success"
              : current.status && current.status !== "AC"
                ? "text-destructive"
                : "text-muted-foreground"
          }
        >
          {pending
            ? tx("正在判题…", "Judging…")
            : (current.status ??
              (visible
                ? tx("已完成", "Completed")
                : tx("结果未公布", "Results not released")))}
        </strong>
        <select
          className="h-8 max-w-full rounded border border-input bg-background px-2 text-xs"
          aria-label={tx("运行记录", "Run history")}
          value={current.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {items.map((job) => (
            <option key={job.id} value={job.id}>
              {job.kind === "submit"
                ? tx("正式提交", "Submission")
                : tx("运行", "Run")}{" "}
              · {date(job.createdAt, locale)}
            </option>
          ))}
        </select>
      </div>
      {(question?.publicMessage || current.publicMessage) && (
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {question?.publicMessage || current.publicMessage}
        </p>
      )}
      {!!question?.stages?.length && (
        <div className="flex flex-wrap gap-2">
          {question.stages.map((stage) => (
            <span
              key={stage.stageKey}
              className={`rounded border px-2 py-1 text-xs ${stage.status === "AC" ? "border-success/30 text-success" : "border-border text-muted-foreground"}`}
            >
              {stage.stageKey} · {stage.status} · {stage.marks}/{stage.maxMarks}
            </span>
          ))}
        </div>
      )}
      {current.kind === "run" && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            {tx("运行输出", "Output")}
          </h3>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 font-mono text-xs">
            {question?.publicOutput ||
              current.publicOutput ||
              tx("（无输出）", "(No output)")}
          </pre>
        </div>
      )}
    </div>
  );
}

export function SchoolPaper4Marking({
  base,
  attempt,
  onReload,
}: {
  base: string;
  attempt: SchoolPaper4Attempt;
  onReload: () => void;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en),
    action = useMutation();
  const [edits, setEdits] = useState<
    Record<string, { marks: string; note: string }>
  >({});
  const marks = attempt.marks ?? [],
    manual = marks.filter((stage) => stage.judgeMode !== "auto"),
    staff = attempt.canManage;
  if (!marks.length) return null;
  return (
    <section className="mt-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {staff
            ? tx("评分与批阅", "Marks and review")
            : tx("公布成绩", "Published marks")}
        </h2>
        <span className="text-sm tabular-nums">
          {marks.reduce((sum, m) => sum + (m.marks ?? 0), 0)} /{" "}
          {attempt.definition.totalMarks}
        </span>
      </div>
      <div className="mt-2 divide-y divide-border">
        {marks.map((stage) => {
          const edit = edits[stage.stageKey] ?? {
            marks: stage.marks === null ? "" : String(stage.marks),
            note: stage.note ?? "",
          };
          return (
            <div
              key={stage.stageKey}
              className="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              <span className="min-w-24 flex-1 font-medium">
                {stage.title || stage.stageKey}
              </span>
              {staff && !attempt.releasedAt && stage.judgeMode !== "auto" ? (
                <>
                  <input
                    type="number"
                    aria-label={`${stage.title} ${tx("得分", "marks")}`}
                    className={`${input} !w-20`}
                    min={0}
                    max={stage.maxMarks}
                    value={edit.marks}
                    onChange={(e) =>
                      setEdits({
                        ...edits,
                        [stage.stageKey]: { ...edit, marks: e.target.value },
                      })
                    }
                  />
                  <span>/ {stage.maxMarks}</span>
                  <input
                    className={`${input} sm:!w-64`}
                    aria-label={`${stage.title} ${tx("教师私有批注", "private teacher note")}`}
                    placeholder={tx("教师私有批注", "Private teacher note")}
                    value={edit.note}
                    maxLength={4000}
                    onChange={(e) =>
                      setEdits({
                        ...edits,
                        [stage.stageKey]: { ...edit, note: e.target.value },
                      })
                    }
                  />
                </>
              ) : (
                <span className="tabular-nums">
                  {stage.marks ?? "—"} / {stage.maxMarks}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Feedback action={action} />
      {staff && !attempt.releasedAt && attempt.state === "submitted" && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {!!manual.length && (
            <Button
              size="sm"
              variant="secondary"
              disabled={
                action.busy ||
                manual.some(
                  (stage) =>
                    (edits[stage.stageKey]?.marks ??
                      (stage.marks === null ? "" : String(stage.marks))) === "",
                )
              }
              onClick={() =>
                void action.run(async () => {
                  await productionApi(`${base}/attempts/${attempt.id}/marks`, {
                    method: "PATCH",
                    body: {
                      marks: manual.map((stage) => ({
                        stageKey: stage.stageKey,
                        marks: Number(
                          edits[stage.stageKey]?.marks ?? stage.marks,
                        ),
                        note: edits[stage.stageKey]?.note ?? stage.note ?? "",
                      })),
                    },
                  });
                  onReload();
                  action.success(tx("评分已保存。", "Marks saved."));
                })
              }
            >
              {tx("保存评分", "Save marks")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await productionApi(
                  attempt.activityId
                    ? `${base}/activities/${attempt.activityId}/results/publish`
                    : `${base}/attempts/${attempt.id}/results/publish`,
                  { method: "POST" },
                );
                onReload();
                action.success(tx("成绩已公布。", "Results released."));
              })
            }
          >
            {attempt.activityId
              ? tx("公布本活动成绩", "Release activity results")
              : tx("公布成绩", "Release results")}
          </Button>
        </div>
      )}
    </section>
  );
}

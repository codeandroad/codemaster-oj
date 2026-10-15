"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { readProblemImport } from "./problem-package";
import { Feedback, useAction } from "./shared";

export interface CoursePractice {
  chapterId: string;
  problemId: string;
  versionId: string;
  title: string;
  bankId: string;
  validationStatus: string;
  published: boolean;
}

export function PythonPracticePanel({ id, bundle, disabled, onUpdated, onRefreshStatus }: {
  id: string;
  bundle: CoursePractice[];
  disabled: boolean;
  onUpdated: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef(onRefreshStatus);
  const [pending, setPending] = useState<{ name: string; document: unknown } | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const action = useAction();
  const validating = bundle.some(problem => ["Waiting", "Judging"].includes(problem.validationStatus));
  const ready = bundle.length > 0 && bundle.every(problem => problem.validationStatus === "AC");
  const published = bundle.length > 0 && bundle.every(problem => problem.published);

  useEffect(() => { refreshRef.current = onRefreshStatus; }, [onRefreshStatus]);
  useEffect(() => {
    if (!validating) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!stopped && document.visibilityState !== "hidden") {
        try { await refreshRef.current(); if (!stopped) setRefreshError(""); }
        catch { if (!stopped) setRefreshError(locale === "zh" ? "校验状态更新失败，正在重试；也可手动刷新。" : "Could not refresh validation status. Retrying; you can also refresh manually."); }
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3000);
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, validating, locale]);

  const readPackage = (file: File) => void action.run(async () => {
    setPending(null);
    if (file.size > 1048576) throw new Error(tr("配套题目包不能超过 1 MB。", "The practice package must be 1 MB or smaller."));
    const parsed = await readProblemImport(file);
    const document = JSON.parse(await file.text()) as { format?: string; version?: number };
    if (document.format !== "codemaster-python-practice" || document.version !== 1 || parsed.rows.length !== 20)
      throw new Error(tr("请选择 Python 配套 v1 题目包（20 道题）。", "Choose a Python practice v1 package with 20 problems."));
    setPending({ name: file.name, document });
    return tr("已读取 20 道练习，请确认导入。", "20 practices read. Confirm import.");
  });
  const statusLabel = (status: string) => locale === "en" ? status === "Waiting" ? "Queued" : status === "Judging" ? "Validating" : status === "AC" ? "Validated" : status : ({ Waiting: "排队中", Judging: "校验中", AC: "校验通过" } as Record<string, string>)[status] ?? status;

  return <section className="mt-4 rounded-lg border border-border bg-surface p-5" data-od-id="python-practice-panel">
    <h2 className="font-semibold">{tr("Python 配套判题练习", "Python companion practice")}</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{tr("完整 20 章示例每章对应 1 道题，每题含标准解答、公开样例和 5 个测试。生成后自动进入真实判题队列；全部通过后再发布并关联。请先保存章节修改。", "The 20-chapter example provides one problem per chapter, each with a reference solution, public samples, and five tests. Generated problems enter the real judge queue; publish and link them after all pass. Save chapter changes first.")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {!bundle.length ? <>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label={tr("Python 配套题目包", "Python practice package")} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) readPackage(file); }} />
        <Button variant="secondary" disabled={disabled || action.busy} onClick={() => fileRef.current?.click()}>{tr("导入配套题目包", "Import practice package")}</Button>
        <Button variant="secondary" disabled={disabled || action.busy} onClick={() => void action.run(async () => { await productionApi(`learning-paths/${id}/python-exercises`, { method: "POST", body: {} }); await onUpdated(); return tr("配套练习已创建，等待真实判题校验。", "Practices created; awaiting judge validation."); })}>{tr("生成 20 道练习并校验", "Generate and validate 20 practices")}</Button>
      </> : <>
        <Button variant="secondary" disabled={disabled || action.busy} onClick={() => void action.run(async () => { await onRefreshStatus(); setRefreshError(""); return tr("状态已刷新。", "Status refreshed."); })}>{tr("刷新校验状态", "Refresh validation status")}</Button>
        <Button variant="secondary" disabled={disabled || action.busy || !ready || published} onClick={() => void action.run(async () => { await productionApi(`learning-paths/${id}/python-exercises/publish`, { method: "POST", body: {} }); await onUpdated(); return tr("练习已发布并关联章节。", "Practices published and linked to chapters."); })}>{published ? tr("练习已发布并关联", "Practices published and linked") : tr("发布练习并关联", "Publish and link practices")}</Button>
      </>}
    </div>
    {pending && !bundle.length && <div className="mt-3 rounded border border-border p-3 text-sm">
      <p>{pending.name} · 20 {tr("道题 · 将创建独立题库，真实校验通过后才能发布关联", "problems · Creates a separate bank. Publish and link only after real validation passes.")}</p>
      <div className="mt-2 flex gap-2">
        <Button disabled={disabled || action.busy} onClick={() => void action.run(async () => { await productionApi(`learning-paths/${id}/python-exercises`, { method: "POST", body: { document: pending.document } }); setPending(null); await onUpdated(); return tr("20 道题已导入并进入判题校验队列。", "20 problems imported into the judge validation queue."); })}>{tr("确认导入 20 道练习", "Import 20 practices")}</Button>
        <Button variant="ghost" disabled={action.busy} onClick={() => setPending(null)}>{tr("取消", "Cancel")}</Button>
      </div>
    </div>}
    {bundle.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm">{bundle.filter(problem => problem.validationStatus === "AC").length} / {bundle.length} {tr("校验通过 · 展开题目状态", "validated · Show problem status")}</summary>
      <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-border">{bundle.map(problem => <li key={problem.problemId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><AppLink className="font-medium text-primary hover:underline" href={`/teacher/problems/${problem.problemId}/edit`}>{problem.title}</AppLink><span>{problem.published ? tr("已发布", "Published") : statusLabel(problem.validationStatus)}</span></li>)}</ul>
    </details>}
    {validating && <p className="mt-3 text-sm text-muted-foreground" role="status">{tr("正在等待判题结果，每 3 秒自动更新；关闭此页不影响后台校验。", "Waiting for judge results; updates every 3 seconds. Closing this page does not stop background validation.")}</p>}
    {refreshError && <p className="mt-3 text-sm text-warning" role="status">{refreshError}</p>}
    <Feedback action={action} />
  </section>;
}

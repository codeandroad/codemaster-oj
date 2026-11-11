"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, Save } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useNavigationBlocker } from "@/components/navigation";
import { inputClass } from "@/components/admin/common";
import { MathEditor } from "@/components/teacher/math-editor";
import { mathDiagnostics } from "@/components/teacher/math-diagnostics";
import { area } from "@/components/teacher/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiMessage, productionApi } from "@/lib/production-api";
import { contentBlocks } from "@/components/content-parser";
import { AcslRichContent } from "./rich-content";
import type { AcslLanguage } from "./model";
import { parseAcslDiagrams } from "./diagram-validation";
import { AcslTeacherDiagramEditor } from "./teacher-diagram-editor";
import {
  acslDiagramDrafts,
  acslInputWithDiagrams,
} from "./teacher-editor-model";
import {
  AcslTeacherQuestionPreview,
  AcslTeacherProgrammingPreview,
} from "./teacher-preview";
import {
  acslTeacherInput,
  type AcslTeacherInput,
  type AcslTeacherPaper,
} from "./teacher-model";

export function AcslTeacherEditor({
  schoolId,
  initialPaper,
  initialLanguage,
  onSaved,
  onCancel,
}: {
  schoolId: string;
  initialPaper: AcslTeacherPaper;
  initialLanguage: AcslLanguage;
  onSaved: (paper: AcslTeacherPaper) => void;
  onCancel: () => void;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [paper, setPaper] = useState(initialPaper);
  const [form, setForm] = useState(() => acslTeacherInput(initialPaper));
  const [diagrams, setDiagrams] = useState(() =>
    acslDiagramDrafts(acslTeacherInput(initialPaper)),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify([
      acslTeacherInput(initialPaper),
      acslDiagramDrafts(acslTeacherInput(initialPaper)),
    ]),
  );
  const [selected, setSelected] = useState(
    initialPaper.questions[0]?.id ?? "programming",
  );
  const [language, setLanguage] = useState(initialLanguage);
  const [preview, setPreview] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<"publish" | "discard" | "reload" | null>(
    null,
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const dirty = JSON.stringify([form, diagrams]) !== baseline;
  useNavigationBlocker(dirty || busy);
  useEffect(() => {
    if (!dirty && !busy) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);
  const question = form.questions.find((item) => item.id === selected);
  const originalQuestion = paper.questions.find((item) => item.id === selected);
  const path = `schools/${schoolId}/acsl/manage/${paper.id}`;
  const parsed = (key: string) => parseAcslDiagrams(diagrams[key]);
  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  function editQuestion(patch: Partial<AcslTeacherInput["questions"][number]>) {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((item) =>
        item.id === selected ? { ...item, ...patch } : item,
      ),
    }));
  }
  function diagramEditor(key: string, label: string) {
    return (
      <AcslTeacherDiagramEditor
        label={label}
        value={diagrams[key]}
        fieldName={key.replaceAll(":", "-")}
        language={language}
        disabled={busy}
        onChange={(value) =>
          setDiagrams((current) => ({ ...current, [key]: value }))
        }
      />
    );
  }
  function inputForSave() {
    let prepared: AcslTeacherInput;
    try {
      prepared = acslInputWithDiagrams(form, diagrams);
    } catch (cause) {
      throw new Error(
        tx("Invalid diagram JSON: ", "图形 JSON 无效：") +
          (cause instanceof Error ? cause.message : ""),
      );
    }
    function checkText(text: string, label: string, diagramIds?: string[]) {
      if (!text.trim())
        throw new Error(
          tx(`${label}: enter content.`, `${label}：请填写内容。`),
        );
      if (mathDiagnostics(text).length)
        throw new Error(
          tx(`${label}: fix the formula errors.`, `${label}：请修正公式错误。`),
        );
      for (const block of contentBlocks(text)) {
        if (block.kind !== "paragraph") continue;
        const marker = block.text.trim().match(/^\{\{diagram:([^}]+)\}\}$/);
        if (marker && !diagramIds?.includes(marker[1]))
          throw new Error(
            tx(
              `${label}: diagram ${marker[1]} is missing.`,
              `${label}：缺少图形 ${marker[1]}。`,
            ),
          );
      }
    }
    for (const lang of ["en", "zh"] as const) {
      checkText(prepared.title[lang], tx(`Title (${lang})`, `标题（${lang}）`));
      for (const item of prepared.questions) {
        const meta = paper.questions.find((q) => q.id === item.id)!;
        const prefix = tx(
          `Question ${meta.number} (${lang})`,
          `第 ${meta.number} 题（${lang}）`,
        );
        checkText(item.topic[lang], `${prefix} · ${tx("Topic", "主题")}`);
        checkText(
          item.statement[lang],
          `${prefix} · ${tx("Statement", "题干")}`,
          item.statementDiagrams?.[lang].map((d) => d.id),
        );
        checkText(
          item.explanation[lang],
          `${prefix} · ${tx("Explanation", "解析")}`,
          item.explanationDiagrams?.[lang].map((d) => d.id),
        );
        for (const option of item.options)
          checkText(
            option.text[lang],
            `${prefix} · ${option.id}`,
            option.diagrams?.[lang].map((d) => d.id),
          );
        if (
          !item.correctOptionIds.length ||
          (meta.type === "single" && item.correctOptionIds.length !== 1)
        )
          throw new Error(
            tx(
              `Question ${meta.number}: select the correct answer.`,
              `第 ${meta.number} 题：请选择正确答案。`,
            ),
          );
      }
      if (prepared.programming) {
        checkText(
          lang === "en"
            ? prepared.programming.statement
            : prepared.programming.statementZh,
          tx(`Programming statement (${lang})`, `编程题面（${lang}）`),
          prepared.programming.statementDiagrams?.[lang].map((d) => d.id),
        );
      }
    }
    if (prepared.programming && !prepared.programming.title.trim())
      throw new Error(tx("Enter the programming title.", "请填写编程题标题。"));
    return prepared;
  }
  function requestPublish() {
    if (pending.current || !dirty || conflict) return;
    setError("");
    try {
      inputForSave();
      setDialog("publish");
    } catch (cause) {
      fail(apiMessage(cause));
    }
  }
  async function publish() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const content = inputForSave();
      const payload = {
        ...content,
        expectedContentHash: paper.contentHash,
        reason: reason.trim() || undefined,
      };
      const signature = JSON.stringify(payload);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      const updated = await productionApi<AcslTeacherPaper>(path, {
        method: "PATCH",
        body: { ...payload, requestId: request.current.id },
      });
      setDialog(null);
      onSaved(updated);
    } catch (cause) {
      setDialog(null);
      setConflict(cause instanceof ApiError && cause.status === 409);
      fail(apiMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await productionApi<AcslTeacherPaper>(path);
      const next = acslTeacherInput(updated),
        nextDiagrams = acslDiagramDrafts(next);
      setPaper(updated);
      setForm(next);
      setDiagrams(nextDiagrams);
      setBaseline(JSON.stringify([next, nextDiagrams]));
      setReason("");
      setConflict(false);
      setDialog(null);
      request.current = null;
    } catch (cause) {
      setDialog(null);
      fail(apiMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  let previewInput: AcslTeacherInput | null = null;
  try {
    previewInput = acslInputWithDiagrams(form, diagrams);
  } catch {
    /* Invalid JSON is shown beside its editor. */
  }

  return (
    <div className="space-y-4" data-od-id="acsl-teacher-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => (dirty ? setDialog("discard") : onCancel())}
          data-od-id="acsl-edit-cancel"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {tx("Back to paper", "返回试卷")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={preview}
            onClick={() => setPreview((value) => !value)}
          >
            <Eye size={15} aria-hidden="true" />
            {preview ? tx("Edit fields", "编辑内容") : tx("Preview", "预览")}
          </Button>
          <Button
            disabled={!dirty || busy || conflict}
            onClick={requestPublish}
            data-od-id="acsl-edit-save"
          >
            <Save size={15} aria-hidden="true" />
            {busy
              ? tx("Saving…", "正在保存…")
              : tx("Publish revision", "发布修订")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {tx(
          "Edit this school's paper. Publishing keeps submitted answers, scores and awarded points unchanged. Judge tests and settings remain read only.",
          "编辑本校试卷。发布修订保留已交答卷、成绩和已获积分；判题测试与设置保持只读。",
        )}
      </p>
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
          data-od-id="acsl-edit-error"
        >
          <p>{error}</p>
          {conflict && (
            <>
              <p className="mt-2">
                {tx(
                  "Your edits are kept here. Load the latest paper to replace them, or copy your changes before reloading.",
                  "当前编辑仍保留在此处。可以先复制修改内容，再加载最新试卷替换本地编辑。",
                )}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={busy}
                onClick={() => setDialog("reload")}
                data-od-id="acsl-edit-reload"
              >
                {tx("Load latest paper", "加载最新试卷")}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
        {(["en", "zh"] as const).map((lang) => (
          <label key={lang} className="text-sm font-medium">
            {tx("Paper title", "试卷标题")} ·{" "}
            {lang === "en" ? "English" : "中文"}
            <input
              className={`${inputClass} mt-1`}
              value={form.title[lang]}
              disabled={busy}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: { ...current.title, [lang]: event.target.value },
                }))
              }
              data-od-id={`acsl-edit-title-${lang}`}
            />
          </label>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label={tx("Edit paper questions", "编辑试卷题目")}
          className="flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-3 lg:flex-col"
        >
          {paper.questions.map((item) => (
            <Button
              key={item.id}
              variant={selected === item.id ? "secondary" : "ghost"}
              size="sm"
              disabled={busy}
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
              data-od-id={`acsl-edit-question-${item.id}`}
            >
              {tx(`Question ${item.number}`, `第 ${item.number} 题`)}
            </Button>
          ))}
          {paper.programming && (
            <Button
              variant={selected === "programming" ? "secondary" : "ghost"}
              size="sm"
              disabled={busy}
              aria-pressed={selected === "programming"}
              onClick={() => setSelected("programming")}
              data-od-id="acsl-edit-programming"
            >
              {tx("Programming", "编程题")}
            </Button>
          )}
        </nav>
        <div className="min-w-0 space-y-4">
          {preview ? (
            <>
              <div className="flex gap-2">
                {(["en", "zh"] as const).map((lang) => (
                  <Button
                    key={lang}
                    size="sm"
                    variant={language === lang ? "primary" : "secondary"}
                    aria-pressed={language === lang}
                    onClick={() => setLanguage(lang)}
                  >
                    {lang === "en" ? "English" : "中文"}
                  </Button>
                ))}
              </div>
              {!previewInput ? (
                <p role="alert" className="text-sm text-destructive">
                  {tx(
                    "Fix the invalid diagram JSON before previewing.",
                    "请先修正无效的图形 JSON 再预览。",
                  )}
                </p>
              ) : selected === "programming" &&
                paper.programming &&
                previewInput.programming ? (
                <AcslTeacherProgrammingPreview
                  programming={{
                    ...paper.programming,
                    ...previewInput.programming,
                  }}
                  language={language}
                />
              ) : (
                originalQuestion && (
                  <AcslTeacherQuestionPreview
                    question={{
                      ...originalQuestion,
                      ...previewInput.questions.find(
                        (item) => item.id === selected,
                      )!,
                    }}
                    language={language}
                  />
                )
              )}
            </>
          ) : selected === "programming" &&
            form.programming &&
            paper.programming ? (
            <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
              <label className="block text-sm font-medium">
                {tx("Programming title", "编程题标题")}
                <input
                  className={`${inputClass} mt-1`}
                  value={form.programming.title}
                  disabled={busy}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      programming: {
                        ...current.programming!,
                        title: event.target.value,
                      },
                    }))
                  }
                  data-od-id="acsl-edit-programming-title"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {tx("Read-only judge", "只读判题设置")} ·{" "}
                {paper.programming.readOnlyJudge.testCount}{" "}
                {tx("formal tests", "组正式测试")} ·{" "}
                {paper.programming.samples.length} {tx("samples", "组样例")} ·{" "}
                {paper.programming.readOnlyJudge.timeLimitMs} ms ·{" "}
                {paper.programming.readOnlyJudge.memoryLimitMb} MB
              </p>
              <div className="grid gap-4 xl:grid-cols-2">
                {(["en", "zh"] as const).map((lang) => (
                  <MathEditor
                    key={lang}
                    label={`${tx("Programming statement", "编程题面")} · ${lang === "en" ? "English" : "中文"}`}
                    fieldName={`acsl-programming-${lang}`}
                    value={
                      lang === "en"
                        ? form.programming!.statement
                        : form.programming!.statementZh
                    }
                    disabled={busy}
                    rows={14}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        programming: {
                          ...current.programming!,
                          [lang === "en" ? "statement" : "statementZh"]: value,
                        },
                      }))
                    }
                    renderPreview={(value) => (
                      <AcslRichContent
                        content={value}
                        diagrams={parsed("programming:statement")?.[lang]}
                        language={lang}
                      />
                    )}
                  />
                ))}
              </div>
              {diagramEditor(
                "programming:statement",
                tx("Programming diagrams", "编程题图形"),
              )}
            </section>
          ) : (
            question &&
            originalQuestion && (
              <section className="min-w-0 space-y-5 rounded-lg border border-border bg-surface p-4">
                <h2 className="font-semibold">
                  {tx(
                    `Question ${originalQuestion.number}`,
                    `第 ${originalQuestion.number} 题`,
                  )}{" "}
                  ·{" "}
                  {originalQuestion.type === "single"
                    ? tx("Single choice", "单选题")
                    : tx("Multiple choice", "多选题")}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["en", "zh"] as const).map((lang) => (
                    <label key={lang} className="text-sm font-medium">
                      {tx("Topic", "主题")} ·{" "}
                      {lang === "en" ? "English" : "中文"}
                      <input
                        className={`${inputClass} mt-1`}
                        value={question.topic[lang]}
                        disabled={busy}
                        onChange={(event) =>
                          editQuestion({
                            topic: {
                              ...question.topic,
                              [lang]: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {(["en", "zh"] as const).map((lang) => (
                    <MathEditor
                      key={lang}
                      label={`${tx("Statement", "题干")} · ${lang === "en" ? "English" : "中文"}`}
                      fieldName={`acsl-statement-${lang}`}
                      value={question.statement[lang]}
                      disabled={busy}
                      onChange={(value) =>
                        editQuestion({
                          statement: { ...question.statement, [lang]: value },
                        })
                      }
                      renderPreview={(value) => (
                        <AcslRichContent
                          content={value}
                          diagrams={parsed(`${question.id}:statement`)?.[lang]}
                          language={lang}
                        />
                      )}
                    />
                  ))}
                </div>
                {diagramEditor(
                  `${question.id}:statement`,
                  tx("Statement diagrams", "题干图形"),
                )}
                <fieldset disabled={busy} className="space-y-3">
                  <legend className="mb-2 text-sm font-semibold">
                    {tx("Options and correct answer", "选项与正确答案")}
                  </legend>
                  {question.options.map((option) => (
                    <div
                      key={option.id}
                      className="space-y-3 rounded-md border border-border p-3"
                    >
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type={
                            originalQuestion.type === "single"
                              ? "radio"
                              : "checkbox"
                          }
                          name={`acsl-correct-${question.id}`}
                          checked={question.correctOptionIds.includes(
                            option.id,
                          )}
                          onChange={() =>
                            editQuestion({
                              correctOptionIds:
                                originalQuestion.type === "single"
                                  ? [option.id]
                                  : question.correctOptionIds.includes(
                                        option.id,
                                      )
                                    ? question.correctOptionIds.filter(
                                        (id) => id !== option.id,
                                      )
                                    : [...question.correctOptionIds, option.id],
                            })
                          }
                          className="size-4 accent-primary"
                          data-od-id={`acsl-edit-correct-${option.id}`}
                        />
                        {option.id} · {tx("Correct answer", "正确答案")}
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(["en", "zh"] as const).map((lang) => (
                          <label
                            key={lang}
                            className="block text-xs font-medium"
                          >
                            {option.id} · {lang === "en" ? "English" : "中文"}
                            <textarea
                              className={`${area} mt-1 min-h-20 resize-none`}
                              rows={2}
                              value={option.text[lang]}
                              onChange={(event) =>
                                editQuestion({
                                  options: question.options.map((item) =>
                                    item.id === option.id
                                      ? {
                                          ...item,
                                          text: {
                                            ...item.text,
                                            [lang]: event.target.value,
                                          },
                                        }
                                      : item,
                                  ),
                                })
                              }
                              data-od-id={`acsl-edit-option-${option.id}-${lang}`}
                            />
                          </label>
                        ))}
                      </div>
                      {diagramEditor(
                        `${question.id}:option:${option.id}`,
                        tx(
                          `Option ${option.id} diagrams`,
                          `选项 ${option.id} 图形`,
                        ),
                      )}
                    </div>
                  ))}
                </fieldset>
                <div className="grid gap-4 xl:grid-cols-2">
                  {(["en", "zh"] as const).map((lang) => (
                    <MathEditor
                      key={lang}
                      label={`${tx("Explanation", "解析")} · ${lang === "en" ? "English" : "中文"}`}
                      fieldName={`acsl-explanation-${lang}`}
                      value={question.explanation[lang]}
                      disabled={busy}
                      rows={10}
                      onChange={(value) =>
                        editQuestion({
                          explanation: {
                            ...question.explanation,
                            [lang]: value,
                          },
                        })
                      }
                      renderPreview={(value) => (
                        <AcslRichContent
                          content={value}
                          diagrams={
                            parsed(`${question.id}:explanation`)?.[lang]
                          }
                          language={lang}
                        />
                      )}
                    />
                  ))}
                </div>
                {diagramEditor(
                  `${question.id}:explanation`,
                  tx("Explanation diagrams", "解析图形"),
                )}
              </section>
            )
          )}
        </div>
      </div>
      <label className="block rounded-lg border border-border bg-surface p-4 text-sm font-medium">
        {tx("Reason for revision (optional)", "修订原因（选填）")}
        <textarea
          className={`${area} mt-2 min-h-20 resize-none`}
          rows={2}
          maxLength={2000}
          disabled={busy}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          data-od-id="acsl-edit-reason"
        />
      </label>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {dialog === "publish"
              ? tx("Publish this revision?", "发布本次修订？")
              : dialog === "reload"
                ? tx("Load the latest paper?", "加载最新试卷？")
                : tx("Discard unsaved edits?", "放弃未保存修改？")}
          </DialogTitle>
          <DialogDescription>
            {dialog === "publish"
              ? tx(
                  "The updated paper becomes available in this school. Students may need to review affected answers before submitting. Submitted papers keep their original questions, scores and points; no automatic regrading is performed.",
                  "修订将用于本校试卷。尚未交卷的学生可能需要重新核对受影响的答案；已交答卷保留交卷时的题目、成绩与积分，不会自动重判。",
                )
              : dialog === "reload"
                ? tx(
                    "This replaces your unsaved edits with the latest saved paper. Copy any changes you want to keep first.",
                    "这会用最新已保存试卷替换当前未保存编辑，请先复制需要保留的修改。",
                  )
                : tx(
                    "Your changes have not been published. Leave without saving them?",
                    "当前修改尚未发布，是否放弃修改并返回？",
                  )}
          </DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              autoFocus
              variant="secondary"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              {tx("Keep editing", "继续编辑")}
            </Button>
            <Button
              disabled={busy}
              data-od-id={
                dialog === "publish"
                  ? "acsl-edit-confirm-save"
                  : dialog === "reload"
                    ? "acsl-edit-confirm-reload"
                    : "acsl-edit-confirm-discard"
              }
              onClick={() =>
                dialog === "publish"
                  ? void publish()
                  : dialog === "reload"
                    ? void reload()
                    : onCancel()
              }
            >
              {dialog === "publish"
                ? busy
                  ? tx("Publishing…", "正在发布…")
                  : tx("Publish revision", "发布修订")
                : dialog === "reload"
                  ? tx("Load latest paper", "加载最新试卷")
                  : tx("Discard changes", "放弃修改")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

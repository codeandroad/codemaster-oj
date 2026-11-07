"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Save, Settings, Trash2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Feedback,
  State,
  date,
  input,
  textarea,
  useData,
  useMutation,
} from "@/components/student/shared";
import { CodeEditor } from "@/components/student/code-editor";
import {
  useWorkspaceSettings,
  WorkspaceSettingsDialog,
} from "@/components/student/workspace-settings";
import { productionApi, type CampusUser } from "@/lib/production-api";
import type {
  Paper4Question,
  Paper4RunnerCase,
} from "@/components/paper4/model";
import { PracticeToolbar } from "./school-practice-toolbar";
import {
  Paper4Field as Field,
  Paper4StageEditor,
  Paper4CaseEditor,
  Paper4FileMapEditor,
} from "./school-paper4-fields";
import {
  navigateSchoolPaper4,
  paper4DraftFrom,
  type SchoolPaper4Paper,
  type SchoolPaper4AttemptSummary,
} from "./school-paper4-model";

export function SchoolPaper4Editor({
  base,
  id,
  role,
  onBack,
  onReview,
}: {
  base: string;
  id: string;
  role: string;
  onBack: () => void;
  onReview: (id: string) => void;
}) {
  const paper = useData<SchoolPaper4Paper>(
      id === "new" ? "" : `${base}/papers/${id}`,
    ),
    auth = useData<{ user: CampusUser }>("auth/me");
  if (id === "new")
    return (
      <State data={auth}>
        {auth.data && (
          <PaperEditor
            base={base}
            paper={null}
            user={auth.data.user}
            role={role}
            onBack={onBack}
            onReview={onReview}
          />
        )}
      </State>
    );
  return (
    <State data={paper}>
      <State data={auth}>
        {paper.data && auth.data && (
          <PaperEditor
            key={`${paper.data.id}:${paper.data.revision}`}
            base={base}
            paper={paper.data}
            user={auth.data.user}
            role={role}
            onBack={onBack}
            onReview={onReview}
            onReload={paper.reload}
          />
        )}
      </State>
    </State>
  );
}
function PaperEditor({
  base,
  paper,
  user,
  role,
  onBack,
  onReview,
  onReload,
}: {
  base: string;
  paper: SchoolPaper4Paper | null;
  user: CampusUser;
  role: string;
  onBack: () => void;
  onReview: (id: string) => void;
  onReload?: () => void;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en),
    action = useMutation(),
    workspace = useWorkspaceSettings(user.id);
  const [draft, setDraft] = useState(() => paper4DraftFrom(paper)),
    [questionKey, setQuestionKey] = useState(draft.questions[0]?.key ?? "Q1"),
    [stageKey, setStageKey] = useState(""),
    [settings, setSettings] = useState(false);
  const [initial, setInitial] = useState(() => JSON.stringify(draft)),
    request = useRef(crypto.randomUUID());
  const dirty = JSON.stringify(draft) !== initial,
    disabled = action.busy || (!!paper && !paper.canManage);
  const attempts = useData<{ items: SchoolPaper4AttemptSummary[] }>(
    paper?.canManage ? `${base}/papers/${paper.id}/attempts` : "",
  );
  const question =
    draft.questions.find((q) => q.key === questionKey) ?? draft.questions[0]!;
  const autoStages = question.stages.filter((s) => s.judgeMode === "auto"),
    caseStage = autoStages.find((s) => s.id === stageKey) ?? autoStages[0],
    cases = caseStage ? (draft.runnerCases[caseStage.id] ?? []) : [];
  const total = draft.questions
    .flatMap((q) => q.stages)
    .reduce((sum, s) => sum + s.maxMarks, 0);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leave = () => {
    if (
      !dirty ||
      window.confirm(
        tx(
          "有未保存的修改，确定返回？",
          "There are unsaved changes. Leave this draft?",
        ),
      )
    )
      onBack();
  };
  const updateQuestion = (patch: Partial<Paper4Question>) =>
    setDraft((d) => {
      const questions = d.questions.map((q) =>
        q.key === question.key ? { ...q, ...patch } : q,
      );
      const stages = new Set(
        questions.flatMap((q) =>
          q.stages.filter((s) => s.judgeMode === "auto").map((s) => s.id),
        ),
      );
      return {
        ...d,
        questions,
        runnerCases: Object.fromEntries(
          Object.entries(d.runnerCases).filter(([id]) => stages.has(id)),
        ),
      };
    });
  const updateCases = (next: Paper4RunnerCase[]) => {
    if (caseStage)
      setDraft((d) => ({
        ...d,
        runnerCases: { ...d.runnerCases, [caseStage.id]: next },
      }));
  };
  const save = () =>
    void action.run(async () => {
      const result = await productionApi<SchoolPaper4Paper>(
        `${base}/papers${paper ? `/${paper.id}` : ""}`,
        {
          method: paper ? "PATCH" : "POST",
          body: {
            ...draft,
            requestId: request.current,
            expectedRevision: paper?.revision,
          },
        },
      );
      setInitial(JSON.stringify(draft));
      if (!paper) navigateSchoolPaper4({ paper4Id: result.id }, true);
      else onReload?.();
    });
  return (
    <div className="space-y-3">
      <PracticeToolbar
        title={paper?.title ?? tx("新建 Paper 4", "New Paper 4")}
        onBack={leave}
        backLabel={tx("返回试卷库", "Back to Paper 4")}
      />
      <Feedback action={action} />
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field label={tx("试卷名称", "Paper title")}>
            <input
              className={input}
              disabled={disabled}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              maxLength={200}
            />
          </Field>
          <Field label={tx("名称简写", "Short title")}>
            <input
              className={input}
              disabled={disabled}
              value={draft.shortTitle}
              placeholder="9618/41 mj 25"
              onChange={(e) =>
                setDraft((d) => ({ ...d, shortTitle: e.target.value }))
              }
              maxLength={60}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={tx("年份", "Year")}>
            <input
              className={input}
              type="number"
              disabled={disabled}
              min={2000}
              max={2100}
              value={draft.exam.examYear ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  exam: {
                    ...d.exam,
                    examYear: e.target.value ? Number(e.target.value) : null,
                  },
                }))
              }
            />
          </Field>
          <Field label={tx("考季", "Session")}>
            <select
              className={input}
              disabled={disabled}
              value={draft.exam.examSession ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  exam: {
                    ...d.exam,
                    examSession: (e.target.value ||
                      null) as typeof d.exam.examSession,
                  },
                }))
              }
            >
              <option value="">—</option>
              <option value="summer">May/June</option>
              <option value="autumn">October/November</option>
            </select>
          </Field>
          <Field label={tx("卷号", "Variant")}>
            <select
              className={input}
              disabled={disabled}
              value={draft.exam.examVariant ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  exam: {
                    ...d.exam,
                    examVariant: (e.target.value
                      ? Number(e.target.value)
                      : null) as typeof d.exam.examVariant,
                  },
                }))
              }
            >
              <option value="">—</option>
              {[41, 42, 43].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={tx("说明", "Description")}>
          <textarea
            className={textarea}
            rows={2}
            disabled={disabled}
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </Field>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {draft.questions.map((q) => (
              <Button
                key={q.key}
                size="sm"
                variant={question.key === q.key ? "default" : "secondary"}
                onClick={() => setQuestionKey(q.key)}
              >
                {q.key}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || draft.questions.length >= 3}
            onClick={() => {
              let n = 1;
              while (draft.questions.some((q) => q.key === `Q${n}`)) n++;
              const q: Paper4Question = {
                key: `Q${n}`,
                title: `Question ${n}`,
                statement: "",
                starterCode: "",
                initialFiles: {},
                outputFiles: [],
                stages: [
                  {
                    id: `Q${n}a`,
                    title: `${n}(a)`,
                    description: "",
                    maxMarks: 1,
                    judgeMode: "auto",
                  },
                ],
              };
              setDraft((d) => ({ ...d, questions: [...d.questions, q] }));
              setQuestionKey(q.key);
            }}
          >
            <Plus size={14} />
            {tx("大题", "Question")}
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label={tx("大题标题", "Question title")}>
              <input
                className={input}
                disabled={disabled}
                value={question.title}
                onChange={(e) => updateQuestion({ title: e.target.value })}
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || draft.questions.length === 1}
            aria-label={tx("删除大题", "Remove question")}
            onClick={() => {
              setDraft((d) => ({
                ...d,
                questions: d.questions.filter((q) => q.key !== question.key),
                runnerCases: Object.fromEntries(
                  Object.entries(d.runnerCases).filter(
                    ([key]) => !question.stages.some((s) => s.id === key),
                  ),
                ),
                referenceSolutions: Object.fromEntries(
                  Object.entries(d.referenceSolutions).filter(
                    ([key]) => key !== question.key,
                  ),
                ),
              }));
              setQuestionKey(
                draft.questions.find((q) => q.key !== question.key)!.key,
              );
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
        <Field label={tx("题干（Markdown）", "Statement (Markdown)")}>
          <textarea
            className={textarea}
            rows={8}
            disabled={disabled}
            value={question.statement}
            onChange={(e) => updateQuestion({ statement: e.target.value })}
          />
        </Field>
        <Field label={tx("初始代码", "Starter code")}>
          <textarea
            className={`${textarea} font-mono`}
            rows={4}
            disabled={disabled}
            value={question.starterCode}
            onChange={(e) => updateQuestion({ starterCode: e.target.value })}
          />
        </Field>
        <Paper4FileMapEditor
          tx={tx}
          label={tx("学生初始文件", "Student input files")}
          value={question.initialFiles}
          disabled={disabled}
          onChange={(initialFiles) => updateQuestion({ initialFiles })}
        />
        <Field
          label={tx(
            "输出文件（每行一个文件名）",
            "Output files (one filename per line)",
          )}
        >
          <textarea
            className={`${textarea} font-mono`}
            rows={2}
            disabled={disabled}
            value={question.outputFiles?.join("\n") ?? ""}
            onChange={(e) =>
              updateQuestion({
                outputFiles: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <h2 className="mb-3 mt-5 border-t border-border pt-4 font-semibold">
          {tx("评分阶段", "Marking stages")}
        </h2>
        <div className="space-y-3">
          {question.stages.map((stage, index) => (
            <Paper4StageEditor
              key={stage.id}
              stage={stage}
              index={index}
              tx={tx}
              disabled={disabled}
              canRemove={question.stages.length > 1}
              onChange={(patch) =>
                updateQuestion({
                  stages: question.stages.map((s) =>
                    s.id === stage.id ? { ...s, ...patch } : s,
                  ),
                })
              }
              onRemove={() =>
                updateQuestion({
                  stages: question.stages.filter((s) => s.id !== stage.id),
                })
              }
            />
          ))}
        </div>
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          disabled={disabled || question.stages.length >= 30}
          onClick={() =>
            updateQuestion({
              stages: [
                ...question.stages,
                {
                  id: `${question.key}s${crypto.randomUUID().slice(0, 8)}`,
                  title: "",
                  description: "",
                  maxMarks: 1,
                  judgeMode: "manual",
                },
              ],
            })
          }
        >
          <Plus size={14} />
          {tx("添加阶段", "Add stage")}
        </Button>
        <h2 className="mb-3 mt-5 border-t border-border pt-4 font-semibold">
          {tx("自动测试", "Automatic tests")}
        </h2>
        {caseStage ? (
          <>
            <label className="block text-sm font-medium">
              {tx("测试阶段", "Stage")}
              <select
                className={`${input} mt-1`}
                value={caseStage.id}
                onChange={(e) => setStageKey(e.target.value)}
              >
                {autoStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.id}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 space-y-3">
              {cases.map((test, index) => (
                <Paper4CaseEditor
                  key={index}
                  test={test}
                  index={index}
                  tx={tx}
                  disabled={disabled}
                  onChange={(patch) =>
                    updateCases(
                      cases.map((c, i) =>
                        i === index ? { ...c, ...patch } : c,
                      ),
                    )
                  }
                  onRemove={() =>
                    updateCases(cases.filter((_, i) => i !== index))
                  }
                />
              ))}
            </div>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              disabled={disabled || cases.length >= 12}
              onClick={() =>
                updateCases([
                  ...cases,
                  {
                    id: `case${cases.length + 1}`,
                    stdin: "",
                    inputFiles: {},
                    expectedStdout: "",
                    expectedFiles: {},
                    public: false,
                  },
                ])
              }
            >
              <Plus size={14} />
              {tx("添加测试", "Add case")}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tx(
              "每道大题至少需要一个自动阶段才能发布。",
              "Each question needs an automatic stage before publication.",
            )}
          </p>
        )}
        <div className="mb-2 mt-5 flex items-center justify-between border-t border-border pt-4">
          <h2 className="font-semibold">
            {tx("私有参考程序", "Private reference program")}
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setSettings(true)}>
            <Settings size={14} />
            {tx("编辑器设置", "Editor settings")}
          </Button>
        </div>
        <div className="h-72 overflow-hidden rounded-md border border-border">
          <CodeEditor
            idPrefix={`school-paper4-reference-${question.key}`}
            code={draft.referenceSolutions[question.key] ?? ""}
            language="python"
            readOnly={disabled}
            settings={workspace.settings}
            onEnableVim={() => workspace.update({ keyBinding: "vim" })}
            onChange={(code) =>
              setDraft((d) => ({
                ...d,
                referenceSolutions: {
                  ...d.referenceSolutions,
                  [question.key]: code,
                },
              }))
            }
            status={tx(
              "仅用于验证；题解需单独审核发布。",
              "Private validation code. Publish solutions separately after review.",
            )}
          />
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={
            total === 75
              ? "text-sm text-muted-foreground"
              : "text-sm text-warning"
          }
        >
          {tx("全卷总分", "Total marks")}: {total} / 75
        </span>
        <div className="flex flex-wrap gap-2">
          {paper && (
            <Button
              variant="secondary"
              disabled={disabled || dirty}
              onClick={() =>
                void action.run(async () => {
                  await productionApi(`${base}/papers/validate`, {
                    method: "POST",
                    body: {
                      requestId: crypto.randomUUID(),
                      items: [
                        { id: paper.id, expectedRevision: paper.revision },
                      ],
                    },
                  });
                  action.success(
                    tx(
                      "已进入验证队列，请返回列表查看结果。",
                      "Validation queued. Return to the list to see results.",
                    ),
                  );
                })
              }
            >
              {tx("验证参考程序", "Validate reference")}
            </Button>
          )}
          <Button
            disabled={disabled || total !== 75 || !draft.title.trim()}
            onClick={save}
          >
            <Save size={15} />
            {tx("保存草稿", "Save draft")}
          </Button>
        </div>
      </div>
      {role === "school_admin" && paper && (
        <p className="text-xs text-muted-foreground">
          {tx(
            "验证通过后，在试卷列表勾选并审核上架。",
            "After validation passes, select the paper in the list to review and publish.",
          )}
        </p>
      )}
      {paper?.canManage && (
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="font-semibold">
              {tx("学生答卷与批阅", "Student attempts and marking")}
            </h2>
            <Button size="sm" variant="ghost" onClick={attempts.reload}>
              {tx("刷新", "Refresh")}
            </Button>
          </div>
          <State data={attempts}>
            <div className="divide-y divide-border">
              {attempts.data?.items.map((a) => (
                <button
                  key={a.id}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-subtle"
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm(
                        tx(
                          "放弃未保存修改并打开答卷？",
                          "Leave unsaved changes and open this attempt?",
                        ),
                      )
                    )
                      onReview(a.id);
                  }}
                >
                  <span className="font-semibold text-primary">
                    {a.studentName ?? a.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.state} · {date(a.submittedAt, locale)}
                  </span>
                </button>
              ))}
              {!attempts.data?.items.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  {tx("暂无答卷。", "No attempts yet.")}
                </p>
              )}
            </div>
          </State>
        </section>
      )}
      <WorkspaceSettingsDialog
        open={settings}
        onOpenChange={setSettings}
        editorOnly
        initialSection="editor"
        settings={workspace.settings}
        update={workspace.update}
        reset={workspace.reset}
      />
    </div>
  );
}

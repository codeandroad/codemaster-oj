"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  List,
  Play,
  Save,
  Send,
  Settings,
} from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CodeEditor,
  type CodeEditorHandle,
} from "@/components/student/code-editor";
import { CopyCodeButton } from "@/components/student/copy-code-button";
import { FormatCodeIcon } from "@/components/student/format-code-icon";
import { downloadCode, formatCode } from "@/components/student/code-format";
import {
  useWorkspaceSettings,
  WorkspaceSettingsDialog,
} from "@/components/student/workspace-settings";
import {
  Feedback,
  State,
  date,
  useData,
  useMutation,
} from "@/components/student/shared";
import { Paper4OriginalQuestion } from "@/components/paper4/paper4-original-question";
import { Paper4Content } from "@/components/paper4/paper4-content";
import { productionApi, type CampusUser } from "@/lib/production-api";
import {
  SchoolAssistance,
  SchoolActivityScholarshipRule,
} from "./school-scholarship";
import {
  navigateSchoolPaper4,
  originalPaper,
  type SchoolPaper4Attempt,
  type SchoolPaper4Activity,
  type SchoolPaper4Job,
  type SchoolPaper4Paper,
} from "./school-paper4-model";
import {
  SchoolPaper4Marking,
  SchoolPaper4Results,
} from "./school-paper4-results";
import { useSchoolPaper4Save } from "./school-paper4-save";

type Props = {
  base: string;
  attemptId: string;
  role: string;
  onBack: () => void;
  onOpenPaper: (id: string) => Promise<void>;
  onOpenActivity: (id: string) => Promise<void>;
  activities: SchoolPaper4Activity[];
  papers: SchoolPaper4Paper[];
};
export function SchoolPaper4AttemptView(props: Props) {
  const data = useData<SchoolPaper4Attempt>(
      `${props.base}/attempts/${props.attemptId}`,
    ),
    auth = useData<{ user: CampusUser }>("auth/me");
  return (
    <State data={data}>
      <State data={auth}>
        {data.data && auth.data && (
          <PaperWorkspace
            key={props.attemptId}
            {...props}
            initialAttempt={data.data}
            user={auth.data.user}
          />
        )}
      </State>
    </State>
  );
}
function PaperWorkspace({
  base,
  initialAttempt,
  user,
  onBack,
  onOpenPaper,
  onOpenActivity,
  activities,
  papers,
}: Props & { initialAttempt: SchoolPaper4Attempt; user: CampusUser }) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en),
    search = useSearchParams(),
    action = useMutation();
  const [attempt, setAttempt] = useState(initialAttempt),
    [tab, setTab] = useState<"problem" | "translation" | "solution">("problem"),
    [stageId, setStageId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [listOpen, setListOpen] = useState(false),
    [submitOpen, setSubmitOpen] = useState(false),
    [formatting, setFormatting] = useState(false),
    [run, setRun] = useState<SchoolPaper4Job | null>(null);
  const { settings, update, reset } = useWorkspaceSettings(user.id),
    editor = useRef<CodeEditorHandle>(null),
    submitRequest = useRef(crypto.randomUUID());
  const questions = attempt.definition.questions,
    current =
      questions.find((q) => q.key === search.get("paper4Question")) ??
      questions[0]!;
  const stage = current.stages.find((item) => item.id === stageId),
    staff = !!attempt.canManage;
  const frozen =
    attempt.canEdit === false || staff || attempt.state !== "draft";
  const draft = useSchoolPaper4Save(base, initialAttempt, user.id, frozen),
    code = draft.codes[current.key] ?? current.starterCode;
  const navigationItems = attempt.activityId ? activities : papers,
    currentNavigationId = attempt.activityId ?? attempt.paperId,
    openNavigation = attempt.activityId ? onOpenActivity : onOpenPaper,
    index = navigationItems.findIndex((p) => p.id === currentNavigationId),
    previous = index > 0 ? navigationItems[index - 1] : null,
    next = index >= 0 ? navigationItems[index + 1] : null;
  const schoolId = base.split("/")[1],
    target = {
      type: "paper4" as const,
      paperId: attempt.paperId,
      questionKey: current.key,
      versionId: attempt.versionId,
      attemptId: attempt.id,
      ...(attempt.activityId ? { activityId: attempt.activityId } : {}),
    };
  const reload = async () => {
    setAttempt(
      await productionApi<SchoolPaper4Attempt>(
        `${base}/attempts/${attempt.id}`,
      ),
    );
  };
  const jobs = run
    ? [run, ...attempt.jobs.filter((job) => job.id !== run.id)]
    : attempt.jobs;
  const pending = jobs.some((job) => ["queued", "leased"].includes(job.state));
  useEffect(() => {
    if (!pending) return;
    let live = true;
    let fetching = false;
    const timer = setInterval(() => {
      if (fetching) return;
      fetching = true;
      void (async () => {
        const latest = await productionApi<SchoolPaper4Attempt>(
          `${base}/attempts/${attempt.id}`,
        );
        if (live) {
          setAttempt(latest);
          if (!latest.jobs.some((job) => ["queued", "leased"].includes(job.state))) {
            window.dispatchEvent(new Event("codemaster:school-scholarship-changed"));
          }
          if (run) {
            const updated = latest.jobs.find((job) => job.id === run.id);
            if (updated) setRun(updated);
          }
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          fetching = false;
        });
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base, attempt.id, pending, attempt.jobs, run]);
  const navigate = (operation: () => void | Promise<void>) =>
    void action.run(async () => {
      if (!frozen) await draft.saveAll();
      await operation();
    });
  const runCode = (stageKey?: string) =>
    void action.run(async () => {
      await draft.saveAll();
      const job = await productionApi<SchoolPaper4Job>(
        `${base}/attempts/${attempt.id}/run`,
        {
          method: "POST",
          body: {
            requestId: crypto.randomUUID(),
            questionKey: current.key,
            ...(stageKey ? { stageId: stageKey } : {}),
          },
        },
      );
      setRun({ ...job, kind: "run" });
      await reload();
    });
  const format = async () => {
    if (frozen || formatting) return;
    setFormatting(true);
    try {
      await action.run(async () => {
        const result = await formatCode(code, "python", settings.tabSize);
        draft.change(current.key, result);
        editor.current?.replaceCode(result);
        editor.current?.focus();
      });
    } finally {
      setFormatting(false);
    }
  };
  const submit = () =>
    void action.run(async () => {
      await draft.saveAll();
      const job = await productionApi<SchoolPaper4Job>(
        `${base}/attempts/${attempt.id}/submit`,
        { method: "POST", body: { requestId: submitRequest.current } },
      );
      setRun({ ...job, kind: "submit" });
      setAttempt((old) => ({ ...old, state: "submitted", canEdit: false }));
      setSubmitOpen(false);
      await reload();
    });
  const status =
    draft.status === "saved"
      ? tx("已保存到服务器", "Saved to server")
      : draft.status === "error"
        ? tx("保存失败", "Save failed")
        : tx("正在保存…", "Saving…");
  const actions = (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={frozen || action.busy || formatting}
        onClick={() => runCode()}
      >
        <Play size={14} />
        {tx("运行", "Run")}
      </Button>
      <Button
        size="sm"
        disabled={frozen || action.busy || formatting}
        onClick={() => setSubmitOpen(true)}
      >
        <Send size={14} />
        {tx("提交整卷", "Submit paper")}
      </Button>
    </>
  );
  return (
    <div className="space-y-2">
      <nav
        className="flex min-w-0 flex-wrap items-center gap-1"
        aria-label={tx("试卷导航", "Paper navigation")}
      >
        <Button size="sm" variant="ghost" onClick={() => setListOpen(true)}>
          <List size={17} />
          {tx("题目列表", "Problem list")}
        </Button>
        <span className="mx-1 h-5 border-l border-border" />
        <Button
          size="sm"
          variant="ghost"
          disabled={!previous || action.busy || staff}
          aria-label={tx("上一题", "Previous problem")}
          onClick={() =>
            previous && navigate(() => openNavigation(previous.id))
          }
        >
          <ChevronLeft size={17} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!next || action.busy || staff}
          aria-label={tx("下一题", "Next problem")}
          onClick={() => next && navigate(() => openNavigation(next.id))}
        >
          <ChevronRight size={17} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={action.busy}
          onClick={() => navigate(onBack)}
        >
          {tx("返回 Paper 4 练习", "Back to Paper 4 Practice")}
        </Button>
        <strong
          className="min-w-0 flex-1 truncate px-2 text-sm"
          title={attempt.paper.title}
        >
          {attempt.paper.shortTitle || attempt.paper.title}
        </strong>
        {attempt.endsAt && (
          <span className="text-xs text-muted-foreground">
            {tx("截止", "Due")} {date(attempt.endsAt, locale)}
          </span>
        )}
      </nav>
      {attempt.activityId && (
        <SchoolActivityScholarshipRule
          schoolId={schoolId}
          activityId={attempt.activityId}
          type="paper4_activity"
        />
      )}
      <Feedback action={action} />
      {draft.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/30 bg-surface p-2 text-sm text-destructive"
        >
          {draft.error}
          <Button
            size="sm"
            variant="secondary"
            disabled={action.busy}
            onClick={() => void action.run(draft.saveAll)}
          >
            {tx("重试保存", "Retry save")}
          </Button>
        </div>
      )}
      {draft.recovery && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface p-2 text-sm">
          <span>
            {tx(
              "此设备还有未同步的代码草稿。",
              "This device has an unsynced code draft.",
            )}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={draft.discard}>
              {tx("使用服务器版本", "Use server version")}
            </Button>
            <Button size="sm" onClick={draft.restore}>
              {tx("恢复草稿", "Restore draft")}
            </Button>
          </div>
        </div>
      )}
      <div className="grid min-w-0 gap-3 xl:h-[calc(100dvh-11rem)] xl:min-h-[36rem] xl:grid-cols-2">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-subtle px-2 py-1">
            {(
              [
                ["problem", tx("题目", "Problem"), FileText],
                ["translation", tx("中文题面", "Translation"), BookOpen],
                ["solution", tx("参考答案", "Solution"), BookOpen],
              ] as const
            )
              .filter(([key]) => !staff || key === "problem")
              .map(([key, label, Icon]) => (
                <Button
                  key={key}
                  size="sm"
                  variant="ghost"
                  className={
                    tab === key
                      ? "font-semibold text-primary"
                      : "text-muted-foreground"
                  }
                  onClick={() => setTab(key)}
                >
                  <Icon size={16} />
                  {label}
                </Button>
              ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {tx("大题", "Question")}
              <select
                className="h-8 min-w-0 max-w-80 rounded border border-input bg-background px-2 text-sm font-semibold text-foreground"
                value={current.key}
                onChange={(e) => {
                  setStageId("");
                  navigateSchoolPaper4(
                    { paper4Question: e.target.value },
                    true,
                  );
                }}
              >
                {questions.map((q, i) => (
                  <option key={q.key} value={q.key}>
                    {i + 1}. {q.title}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted-foreground">
              {staff
                ? tx("批阅答卷", "Review attempt")
                : attempt.activityKind === "exam"
                  ? tx("模拟考试", "Mock exam")
                  : tx("自由练习", "Practice")}{" "}
              ·{" "}
              {attempt.state === "draft"
                ? tx("进行中", "In progress")
                : tx("已提交", "Submitted")}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {tab === "problem" ? (
              <>
                <Paper4OriginalQuestion
                  key={`${attempt.versionId}:${current.key}`}
                  paper={originalPaper(attempt.paper, attempt.definition)}
                  question={current}
                  selectedStage={stage}
                />
                {!!Object.keys(current.initialFiles).length && (
                  <div className="my-3 flex flex-wrap gap-2">
                    {Object.entries(current.initialFiles).map(
                      ([name, content]) => (
                        <Button
                          key={name}
                          size="sm"
                          variant="secondary"
                          onClick={() => downloadCode(content, name)}
                        >
                          <Download size={13} />
                          {name}
                        </Button>
                      ),
                    )}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {current.stages.map((item) => (
                    <section
                      key={item.id}
                      className="border-t border-border pt-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          className="text-left text-sm font-semibold hover:text-primary"
                          onClick={() =>
                            setStageId(stageId === item.id ? "" : item.id)
                          }
                        >
                          {item.title} · {item.maxMarks} {tx("分", "marks")}
                        </button>
                        {item.judgeMode === "auto" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={frozen || action.busy}
                            onClick={() => runCode(item.id)}
                          >
                            <Play size={13} />
                            {tx("运行本阶段", "Run this stage")}
                          </Button>
                        )}
                      </div>
                      {item.description && (
                        <div className="mt-2 text-sm">
                          <Paper4Content content={item.description} />
                        </div>
                      )}
                      {item.judgeMode !== "auto" && (
                        <span className="text-xs text-muted-foreground">
                          {tx("教师批阅", "Teacher review")}
                        </span>
                      )}
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <SchoolAssistance
                key={`${current.key}:${tab}`}
                schoolId={schoolId}
                target={target}
                kind={
                  tab === "translation" ? "FULL_TRANSLATION" : "FULL_SOLUTION"
                }
              />
            )}
          </div>
        </section>
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <section className="flex min-h-[25rem] flex-[3] flex-col overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-surface-subtle px-3 py-1">
              <span className="text-sm font-semibold">
                Python 3{" "}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {current.key}.py
                </span>
              </span>
              <div className="flex items-center gap-1">
                <CopyCodeButton code={code} />
                <Button
                  size="sm"
                  variant="ghost"
                  title={tx("下载代码", "Download code")}
                  aria-label={tx("下载代码", "Download code")}
                  onClick={() => downloadCode(code, `${current.key}.py`)}
                >
                  <Download size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tx("格式化", "Format code")}
                  aria-label={tx("格式化", "Format code")}
                  disabled={frozen || formatting || action.busy}
                  onClick={() => void format()}
                >
                  <FormatCodeIcon />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tx("保存", "Save")}
                  aria-label={tx("保存", "Save")}
                  disabled={frozen || action.busy}
                  onClick={() => void action.run(draft.saveAll)}
                >
                  <Save size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tx("编辑器设置", "Editor settings")}
                  aria-label={tx("编辑器设置", "Editor settings")}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings size={15} />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <CodeEditor
                editorRef={editor}
                idPrefix="school-paper4"
                code={code}
                language="python"
                readOnly={frozen || action.busy || formatting}
                settings={settings}
                onEnableVim={() => update({ keyBinding: "vim" })}
                onChange={(value) => draft.change(current.key, value)}
                onFormat={() => void format()}
                status={frozen ? tx("只读答卷", "Read-only attempt") : status}
                actions={!frozen ? actions : undefined}
              />
            </div>
            {frozen && !staff && !attempt.activityId && (
              <div className="flex justify-end border-t border-border p-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(() => onOpenPaper(attempt.paperId))
                  }
                >
                  {tx("再次练习", "Practice again")}
                </Button>
              </div>
            )}
          </section>
          <section className="min-h-40 flex-[2] overflow-auto rounded-lg border border-border bg-surface">
            <h2 className="sticky top-0 border-b border-border bg-surface-subtle px-3 py-2 text-sm font-semibold">
              {tx("运行与判题结果", "Run and judge results")}
            </h2>
            <SchoolPaper4Results
              jobs={jobs}
              questionKey={current.key}
              visible={attempt.resultsVisible}
            />
          </section>
        </div>
      </div>
      <SchoolPaper4Marking
        key={`${attempt.id}:${attempt.revision}:${attempt.releasedAt ?? ""}`}
        base={base}
        attempt={attempt}
        onReload={() => void action.run(reload)}
      />
      <WorkspaceSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        editorOnly
        initialSection="editor"
        settings={settings}
        update={update}
        reset={reset}
      />
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogTitle>{tx("提交整卷", "Submit this paper")}</DialogTitle>
          <DialogDescription>
            {tx(
              "提交全部大题的已保存代码并正式判题。提交后本次答卷将只读；自由练习可再开始一次。",
              "Submit the saved code for every question for formal judging. This attempt becomes read-only; free practice can be started again.",
            )}
          </DialogDescription>
          <p className="text-sm">
            {questions.length} {tx("道大题", "questions")} ·{" "}
            {attempt.definition.totalMarks} {tx("分", "marks")}
          </p>
          <Feedback action={action} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => setSubmitOpen(false)}
            >
              {tx("取消", "Cancel")}
            </Button>
            <Button disabled={action.busy} onClick={submit}>
              {tx("确认提交", "Confirm submission")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-xl">
          <DialogTitle>
            {tx("Paper 4 题目列表", "Paper 4 problem list")}
          </DialogTitle>
          <DialogDescription>
            {tx(
              "当前筛选的校内试卷。大题通过题目区下拉框切换。",
              "Papers in the current school filter. Switch questions within this paper using the question selector.",
            )}
          </DialogDescription>
          <div className="max-h-[55vh] overflow-auto divide-y divide-border">
            {navigationItems.map((p) => (
              <button
                key={p.id}
                disabled={action.busy || staff}
                className={`block w-full px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-60 ${p.id === currentNavigationId ? "font-semibold text-primary" : ""}`}
                onClick={() => {
                  setListOpen(false);
                  navigate(() => openNavigation(p.id));
                }}
              >
                {("shortTitle" in p && p.shortTitle) || p.title}
                <span className="block truncate text-xs text-muted-foreground">
                  {p.title}
                </span>
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={action.busy}
            onClick={() => navigate(onBack)}
          >
            {tx("返回试卷列表", "Back to Paper 4 Practice")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

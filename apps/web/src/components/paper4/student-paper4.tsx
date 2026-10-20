"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Bookmark, CheckCircle2, ChevronLeft, ChevronRight, Code2, Download, FileCode2, FileText, HelpCircle, House, LayoutPanelLeft, List, Loader2, Maximize2, Play, RefreshCw, RotateCcw, Send, Settings } from "lucide-react";
import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { WorkspaceThemeProvider } from "@/components/ui/theme-context";
import { CodeEditor, type CodeEditorHandle } from "@/components/student/code-editor";
import type { EditorTheme } from "@/components/student/editor-themes";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "@/components/student/workspace-settings";
import { useWorkspaceLayout, PanelControls } from "@/components/student/workspace-panels";
import { ProblemListDrawer } from "@/components/student/problem-list-drawer";
import { problemNavigation, type NavigationProblem } from "@/components/student/problem-navigation";
import { panelIds, type WorkspacePanel } from "@/components/student/workspace-layout-model";
import { formatCode, downloadCode } from "@/components/student/code-format";
import { FormatCodeIcon } from "@/components/student/format-code-icon";
import { EditorShortcutsHint } from "@/components/student/editor-shortcuts";
import { displayBinding } from "@/components/student/editor-keymap";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { AccountMenu } from "@/components/account-menu";
import styles from "@/components/student/workspace.module.css";
import { State, useData } from "@/components/student/shared";
import { ApiError, apiMessage, clearProductionSession, productionApi, type CampusUser } from "@/lib/production-api";
import { paper4ClassNames, paper4Date, paper4ShortTitle, paper4Status, type Paper4Attempt, type Paper4File, type Paper4Paper, type Paper4PaperSummary, type Paper4Run, type Paper4Stage } from "./model";
import { Paper4Content } from "./paper4-content";
import { Paper4OriginalQuestion } from "./paper4-original-question";
import { Paper4Solutions } from "./paper4-solutions";
import { Paper4CatalogFilter } from "./catalog-filter";
import { filterPaper4Catalog, paper4PracticeHref } from "./paper4-catalog";
import { createPaper4EntryLoader } from "./paper4-entry";
import { createPaper4SaveState, paper4SaveReducer, paper4SaveSummary } from "./paper4-save-state";
import paperStyles from "./paper4-workspace.module.css";
import listStyles from "./student-paper4-list.module.css";
import { paper4LearningContext, paper4ChapterHref, paper4EntryKey, paper4InitialQuestion, type Paper4LearningContext } from "./paper4-learning-navigation";

const surface = "min-w-0 rounded-lg border border-border bg-surface panel-shadow";
const openPaper4Entry = createPaper4EntryLoader<Paper4Attempt>();

function isFreePractice(paper: Paper4Paper) {
  return paper.deliveryKind === "catalog" || (!paper.deliveryKind && !paper.classId && !paper.startsAt && !paper.endsAt);
}

export function StudentPaper4List() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope") === "activities" ? "activities" : "catalog";
  return <div className={listStyles.page}>
    <PageHeader title={tx("Paper 4 练习", "Paper 4 practice")}/>
    <StudentPaper4Collection key={scope} scope={scope} onScope={value => router.replace(value === "activities" ? "/student/paper4?scope=activities" : "/student/paper4")}/>
  </div>;
}

function StudentPaper4Collection({ scope, onScope }: { scope: "catalog" | "activities"; onScope: (scope: "catalog" | "activities") => void }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const papers = useData<{ items: Paper4PaperSummary[] }>(`paper4/papers?scope=${scope}`);
  const [year, setYear] = useState("");
  const [session, setSession] = useState("");
  const visible = filterPaper4Catalog(papers.data?.items ?? [], year, session);
  const activities = scope === "activities";
  return <>
    <div className={listStyles.toolbar}>
      <nav aria-label={tx("练习类型", "Practice type")} className={listStyles.tabs}>
        {(["catalog", "activities"] as const).map(value => <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)}>{value === "catalog" ? tx("自由练习", "Free practice") : tx("已布置活动", "Assigned activities")}</button>)}
      </nav>
      <Paper4CatalogFilter compact items={papers.data?.items ?? []} year={year} session={session} onYear={setYear} onSession={setSession}/>
      {!papers.loading && !papers.error && <span className={listStyles.count}>{tx(`${visible.length} 套试卷`, `${visible.length} papers`)}</span>}
    </div>
    <State data={papers}>{visible.length ? <div className={listStyles.tableWrap}>
      <table className={`${listStyles.table} ${activities ? listStyles.activities : ""}`} aria-label={activities ? tx("已布置的 Paper 4 活动", "Assigned Paper 4 activities") : tx("Paper 4 自由练习试卷", "Paper 4 free practice papers")} data-od-id="student-paper4-table">
        <colgroup><col className={listStyles.paperColumn}/><col className={listStyles.metaColumn}/><col className={activities ? listStyles.recipientColumn : listStyles.sessionColumn}/><col className={activities ? listStyles.scheduleColumn : listStyles.variantColumn}/><col className={listStyles.numberColumn}/><col className={listStyles.numberColumn}/><col className={listStyles.actionColumn}/></colgroup>
        <thead><tr>
          <th scope="col">{tx("试卷", "Paper")}</th>
          <th scope="col">{activities ? tx("活动类型", "Type") : tx("年份", "Year")}</th>
          <th scope="col">{activities ? tx("布置对象", "Assigned to") : tx("考季", "Session")}</th>
          <th scope="col">{activities ? tx("开放时间", "Availability") : tx("卷号", "Variant")}</th>
          <th scope="col" className={listStyles.numeric}>{tx("大题", "Questions")}</th>
          <th scope="col" className={listStyles.numeric}>{tx("总分", "Marks")}</th>
          <th scope="col">{tx("操作", "Action")}</th>
        </tr></thead>
        <tbody>{visible.map(paper => {
          const href = paper4PracticeHref(paper.id, scope);
          const recipients = paper4ClassNames(paper) || tx("按学生名单布置", "Direct assignment");
          const availability = paper.startsAt || paper.endsAt ? `${paper.startsAt ? paper4Date(paper.startsAt, locale) : tx("即日起", "Available now")} – ${paper.endsAt ? paper4Date(paper.endsAt, locale) : tx("无截止时间", "No deadline")}` : tx("不限时间", "No time limit");
          return <tr key={paper.id}>
            <td><AppLink href={href} title={paper.title} className={listStyles.title}>{paper.title}</AppLink></td>
            <td>{activities ? (paper.activityKind === "exam" ? tx("模拟考试", "Mock exam") : tx("练习任务", "Practice task")) : paper.examYear ?? "—"}</td>
            <td>{activities ? <span className={listStyles.truncate} title={recipients}>{recipients}</span> : paper.examSession === "summer" ? tx("夏季", "May/June") : paper.examSession === "autumn" ? tx("秋季", "October/November") : "—"}</td>
            <td>{activities ? <span className={listStyles.truncate} title={availability}>{availability}</span> : paper.examVariant ?? "—"}</td>
            <td className={listStyles.numeric}>{paper.questionCount}</td>
            <td className={listStyles.numeric}>{paper.totalMarks}</td>
            <td><AppLink href={href} className={listStyles.open} aria-label={tx(`打开${activities ? "活动" : "练习"}：${paper.title}`, `Open ${activities ? "activity" : "practice"}: ${paper.title}`)}>{tx("打开", "Open")}<ChevronRight size={14} aria-hidden="true"/></AppLink></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <section className={listStyles.empty}>
      <h2>{year || session ? tx("没有符合筛选条件的试卷", "No papers match these filters") : activities ? tx("暂无已布置活动", "No assigned activities are available") : tx("暂无上架的自由练习", "No free practice is available")}</h2>
      <p>{year || session ? tx("请调整年份或考季后重试。", "Try another year or exam session.") : activities ? tx("教师布置给你的练习和模拟考试会显示在这里，不要求先加入班级。", "Practice and mock exams assigned to you appear here. Class membership is not required.") : tx("已上架的试卷面向全校学生开放。", "Published practice papers are open to every student.")}</p>
    </section>}</State>
  </>;
}

export function StudentPaper4Detail({ paperId, user }: { paperId: string; user: CampusUser }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const search = useSearchParams();
  const versionId = search.get("versionId")?.toLowerCase() || undefined;
  const requestedQuestion = search.get("question");
  const learningContext = paper4LearningContext(search);
  const [attempt, setAttempt] = useState<Paper4Attempt | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(""); setAttempt(null);
    const endpoint = `paper4/papers/${encodeURIComponent(paperId)}/attempt`;
    const query = versionId ? `?${new URLSearchParams({ versionId })}` : "";
    void openPaper4Entry(paper4EntryKey(user.id, paperId, versionId), {
      existing: () => productionApi<Paper4Attempt>(`${endpoint}${query}`),
      start: () => productionApi<Paper4Attempt>(endpoint, { method: "POST", body: versionId ? { versionId } : {} }),
      missing: reason => reason instanceof ApiError && reason.status === 404 && (reason.code === "ATTEMPT_NOT_FOUND" || reason.message === "尚未开始当前版本"),
    }).then(value => { if (active) setAttempt(value); }).catch(reason => { if (active) setError(apiMessage(reason)); });
    return () => { active = false; };
  }, [paperId, user.id, versionId, retry]);
  if (attempt?.paperId === paperId && (!versionId || (attempt.versionId ?? attempt.paper.versionId)?.toLowerCase() === versionId)) return <Paper4Workspace key={`${attempt.id}:${requestedQuestion ?? ""}`} attempt={attempt} user={user} initialQuestionKey={requestedQuestion} courseQuestionKey={search.get("courseQuestion")} learningContext={learningContext} onRestart={async () => {
    const next = await productionApi<Paper4Attempt>(`paper4/papers/${encodeURIComponent(paperId)}/attempt`, { method: "POST", body: { restart: true, versionId: versionId ?? attempt.versionId ?? attempt.paper.versionId } });
    setAttempt(next);
  }}/>;
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
    <div className="mb-4 flex flex-wrap gap-3">{learningContext && <AppLink href={paper4ChapterHref(learningContext)} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} aria-hidden="true"/>{tx("返回章节", "Return to chapter")}</AppLink>}<AppLink href={search.get("scope") === "activities" ? "/student/paper4?scope=activities" : "/student/paper4"} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary"><FileCode2 size={16} aria-hidden="true"/>{tx("Paper 4 练习", "Paper 4 Practice")}</AppLink></div>
    <section className="rounded-lg border border-border bg-surface p-5 panel-shadow">{error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="secondary" className="mt-4" onClick={() => setRetry(value => value + 1)}>{tx("重试", "Retry")}</Button></> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>{tx("正在打开答题工作区…", "Opening your workspace…")}</p>}</section>
  </main>;
}

function Paper4Workspace({ attempt: initialAttempt, user, initialQuestionKey, courseQuestionKey, learningContext, onRestart }: { attempt: Paper4Attempt; user: CampusUser; initialQuestionKey?: string | null; courseQuestionKey?: string | null; learningContext: Paper4LearningContext | null; onRestart: () => Promise<void> }) {
  const { locale } = useLocale();
  const router = useRouter();
  const tx = useCallback((zh: string, en: string) => locale === "en" ? en : zh, [locale]);
  const [attempt, setAttempt] = useState(initialAttempt);
  const questions = attempt.paper.questions;
  const freePractice = isFreePractice(attempt.paper);
  const libraryScope = freePractice ? "catalog" : "activities";
  const library = useData<{ items: Paper4PaperSummary[] }>(`paper4/papers?scope=${libraryScope}`);
  const initialQuestion = paper4InitialQuestion(questions, initialQuestionKey);
  const courseQuestion = learningContext && courseQuestionKey ? questions.find(question => question.key === courseQuestionKey) : null;
  const [questionKey, setQuestionKey] = useState(initialQuestion?.key ?? "");
  const [leftTab, setLeftTab] = useState<"problem" | "solutions">("problem");
  const [solutionTheme, setSolutionTheme] = useState<EditorTheme>("github-dark");
  const [stageId, setStageId] = useState(initialQuestion?.stages[0]?.id ?? "");
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const [saveState, dispatchSave] = useReducer(paper4SaveReducer, codes, createPaper4SaveState);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Paper4Run | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsScope, setSettingsScope] = useState<"workspace" | "editor">("workspace");
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [problemListOpen, setProblemListOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<CodeEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const statementBodyRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const widthDrag = useRef<{ left: number; width: number; next: number } | null>(null);
  const heightDrag = useRef<{ top: number; height: number; next: number } | null>(null);
  const { settings, update, reset, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const { layout, dispatch } = useWorkspaceLayout(user.id);
  const current = questions.find(question => question.key === questionKey) ?? questions[0];
  const stage = current?.stages.find(item => item.id === stageId) ?? current?.stages[0];
  const hasAutomaticChecks = Boolean(current?.stages.some(item => item.judgeMode === "auto") || current?.stages.every(item => item.judgeMode === undefined));
  const rankPointsPerQuestion = attempt.firstAcPointsPerQuestion ?? attempt.paper.firstAcPointsPerQuestion ?? 10;
  const submitted = ["submitted", "reviewed", "released"].includes(attempt.status.toLowerCase());
  const frozen = attempt.canEdit === false || submitted;
  const currentCode = current ? codes[current.key] ?? current.starterCode : "";
  const latest = useRef<Record<string, string>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const saved = useRef<Record<string, string>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const revisions = useRef<Record<string, number>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.revision])));
  const inflight = useRef(new Map<string, Promise<void>>());
  const alive = useRef(true);
  const { dirty, status: saveStatus } = paper4SaveSummary(codes, saveState);
  useNavigationBlocker(dirty);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const saveFile = useCallback(async function saveFile(key: string): Promise<void> {
    const existing = inflight.current.get(key);
    if (existing) {
      await existing;
      if (latest.current[key] !== saved.current[key]) return saveFile(key);
      return;
    }
    // A failed request may have reached the server. Even after a local undo,
    // retry must obtain a confirmed revision before clearing that error.
    let retryFailedSave = Boolean(saveState.errors[key]);
    if (latest.current[key] === saved.current[key] && !retryFailedSave) return;
    dispatchSave({ type: "start", key });
    const operation = (async () => {
      while (retryFailedSave || latest.current[key] !== saved.current[key]) {
        const content = latest.current[key] ?? "";
        const response = await productionApi<Paper4File>(`paper4/attempts/${encodeURIComponent(attempt.id)}/files/${encodeURIComponent(key)}`, { method: "PATCH", body: { content, revision: revisions.current[key] ?? 0 } });
        if (!Number.isInteger(response.revision)) throw new Error(tx("服务器没有返回代码修订号，保存状态无法确认。", "The server did not confirm a code revision."));
        revisions.current[key] = response.revision;
        saved.current[key] = content;
        retryFailedSave = false;
        if (alive.current) dispatchSave({ type: "acknowledge", key, content });
      }
    })();
    inflight.current.set(key, operation);
    try { await operation; }
    catch (reason) { if (alive.current) { dispatchSave({ type: "fail", key, message: apiMessage(reason) }); setError(apiMessage(reason)); } throw reason; }
    finally { inflight.current.delete(key); if (alive.current) dispatchSave({ type: "settle", key }); }
  }, [attempt.id, saveState.errors, tx]);
  const saveAll = useCallback(async () => {
    await Promise.all(questions.map(question => saveFile(question.key)));
  }, [questions, saveFile]);
  useEffect(() => {
    if (frozen || !dirty || saveStatus === "error") return;
    const timer = window.setTimeout(() => { void saveAll().catch(() => undefined); }, 900);
    return () => window.clearTimeout(timer);
  }, [codes, dirty, frozen, saveAll, saveStatus]);
  useEffect(() => {
    if (!run || !["queued", "leased", "running"].includes(run.state.toLowerCase())) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try { const next = await productionApi<Paper4Run>(`paper4/runs/${encodeURIComponent(run.id)}`); if (!cancelled) setRun(next); }
      catch (reason) { if (!cancelled) setError(apiMessage(reason)); }
    }, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [run]);
  useEffect(() => {
    if (!frozen || !attempt.formalJudging?.pending) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`)
        .then(next => { if (!cancelled) setAttempt(next); })
        .catch(reason => { if (!cancelled) setError(apiMessage(reason)); });
    }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [attempt.id, attempt.formalJudging?.pending, frozen]);
  async function mutate(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  async function submitAttempt() {
    if (submitting || formatting || frozen) return;
    setSubmitting(true);
    try {
      await saveAll();
      const updated = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}/submit`, { method: "POST" });
      setAttempt(updated);
      setSubmitOpen(false);
      setMessage(freePractice ? tx("练习已提交，正在自动判题。每题首次 AC 将获得积分；本次记录保留后可再次练习。", "Practice submitted for automatic judging. Each question’s first AC earns points. This attempt is preserved and you can practice again.") : tx("已交卷。大题 AC 奖励将在自动判题后记入；请等待教师复核试卷成绩。", "Submitted. Question AC points are awarded after automatic judging; await teacher review for the paper mark."));
    } finally {
      setSubmitting(false);
    }
  }
  function changeQuestion(key: string) {
    const next = questions.find(question => question.key === key);
    if (!next) return;
    setQuestionKey(key); setStageId(next.stages[0]?.id ?? ""); setRun(null);
    if (statementBodyRef.current) statementBodyRef.current.scrollTop = 0;
  }
  function changeLeftTab(next: "problem" | "solutions") {
    setLeftTab(next);
    dispatch({ type: "show", panel: "statement" });
    if (statementBodyRef.current) statementBodyRef.current.scrollTop = 0;
  }
  const libraryItems = filterPaper4Catalog(library.data?.items ?? [], "", "");
  const libraryNavigation = problemNavigation(libraryItems.map(paper => ({ problemId: paper.id, title: paper.title })), attempt.paperId);
  function openLibraryProblem(target: NavigationProblem | null) {
    if (!target || busy || formatting || library.loading || library.error) return;
    setProblemListOpen(false);
    if (target.problemId === attempt.paperId) return;
    void mutate(async () => {
      if (!frozen) await saveAll();
      router.push(paper4PracticeHref(target.problemId, libraryScope));
    });
  }
  const runCurrent = (stageToRun?: string) => void mutate(async () => {
    if (!current) return;
    if (!hasAutomaticChecks) throw new Error(tx("本题尚未配置自动测试，请保存检查点并按要求核对代码与测试证据。", "No automatic tests are configured for this question. Save a checkpoint and review the code and test evidence against the requirements."));
    await saveFile(current.key);
    setRun(await productionApi<Paper4Run>(`paper4/attempts/${encodeURIComponent(attempt.id)}/runs`, { method: "POST", body: { fileKey: current.key, ...(stageToRun ? { stageId: stageToRun } : {}) } }));
    dispatch({ type: "show", panel: "testing" });
  });
  const formatCurrent = () => {
    if (formatting || frozen || submitting || !currentCode.trim()) return;
    setFormatting(true);
    void formatCode(currentCode, "python", settings.tabSize)
      .then(formatted => { editorRef.current?.replaceCode(formatted); setNotice(tx("代码已格式化，可使用撤销恢复。", "Code formatted. Use Undo to restore it.")); })
      .catch(reason => setError(apiMessage(reason)))
      .finally(() => setFormatting(false));
  };
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || settingsOpen || layoutOpen || helpOpen || resetOpen || submitOpen || problemListOpen) return;
      if (event.key === "Escape") { dispatch({ type: "exit-maximize" }); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") { event.preventDefault(); if (!frozen) void mutate(async () => { await saveAll(); setNotice(tx("代码已保存到服务器。", "Code saved to server.")); }); }
      else if (key === "'" && settings.runShortcut && !busy && !frozen) { event.preventDefault(); runCurrent(); }
      else if (key === "enter" && settings.submitShortcut && !busy && !formatting && !frozen && !dirty) { event.preventDefault(); setSubmitOpen(true); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  if (!current) return <div role="alert" className={`${surface} p-5 text-sm text-destructive`}>{tx("试卷没有可作答的大题。", "This paper has no questions.")}</div>;
  const latestSnapshot = stage && [...attempt.snapshots].reverse().find(item => item.stageId === stage.id);
  const mainClass = [styles.main, layout.panels.statement === "hidden" ? styles.leftHidden : layout.panels.statement === "collapsed" ? styles.leftCollapsed : "", layout.panels.editor === "hidden" && layout.panels.testing === "hidden" ? styles.onlyStatement : "", layout.maximized ? styles.maximized : "", layout.maximized === "statement" ? styles.statementMax : ""].join(" ");
  const rightClass = [styles.right, layout.panels.editor === "hidden" ? styles.editorHidden : layout.panels.editor === "collapsed" ? styles.editorCollapsed : "", layout.panels.testing === "hidden" ? styles.testingHidden : layout.panels.testing === "collapsed" ? styles.testingCollapsed : ""].join(" ");
  const panelClass = (panel: WorkspacePanel) => [styles.panel, styles[panel], layout.panels[panel] === "collapsed" ? styles.collapsed : "", layout.maximized === panel ? styles.maxPanel : ""].join(" ");
  const panelActions = (panel: WorkspacePanel) => <PanelControls panel={panel} collapsed={layout.panels[panel] === "collapsed"} maximized={layout.maximized === panel} onCollapse={() => dispatch({ type: "toggle-collapse", panel })} onMaximize={() => dispatch({ type: "toggle-maximize", panel })}/>;
  const questionRunDisabled = frozen || busy || saveStatus === "error" || !currentCode.trim() || !hasAutomaticChecks;
  const runQuestionButton = (location: "toolbar" | "stage") => <Button size="sm" variant="secondary" data-od-id={`paper4-${location}-run-question`} title={hasAutomaticChecks ? tx("运行当前大题的全部自动阶段", "Run all auto stages in this question") : tx("本题尚未配置自动测试", "No automatic tests are configured for this question")} disabled={questionRunDisabled} onClick={() => runCurrent()}><Play size={14} aria-hidden="true"/>{tx("运行本题", "Run question")}</Button>;
  const runButtons = <>{runQuestionButton("toolbar")}<Button size="sm" disabled={frozen || busy || formatting || dirty || saveStatus === "error"} onClick={() => setSubmitOpen(true)}><Send size={14}/>{freePractice ? tx("提交练习", "Submit practice") : tx("交卷", "Submit")}</Button>{freePractice && submitted && !attempt.paper.archivedAt && <Button size="sm" variant="secondary" disabled={busy || Boolean(attempt.formalJudging?.pending)} onClick={() => void mutate(onRestart)}><RotateCcw size={14}/>{tx("再次练习", "Practice again")}</Button>}</>;
  function widthStart(event: PointerEvent<HTMLDivElement>) { if (!mainRef.current) return; const rect = mainRef.current.getBoundingClientRect(); widthDrag.current = { left: rect.left, width: rect.width, next: settings.panelPercent }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  function widthMove(event: PointerEvent<HTMLDivElement>) { if (!widthDrag.current) return; const next = Math.max(25, Math.min(70, Math.round((event.clientX - widthDrag.current.left) / widthDrag.current.width * 100))); widthDrag.current.next = next; mainRef.current?.style.setProperty("--workspace-left", `${next}%`); }
  function widthEnd(event: PointerEvent<HTMLDivElement>) { if (!widthDrag.current) return; update({ panelPercent: widthDrag.current.next }); widthDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function heightStart(event: PointerEvent<HTMLDivElement>) { if (!rightRef.current) return; const rect = rightRef.current.getBoundingClientRect(); heightDrag.current = { top: rect.top, height: rect.height, next: layout.editorPercent }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  function heightMove(event: PointerEvent<HTMLDivElement>) { if (!heightDrag.current) return; const next = Math.max(20, Math.min(85, Math.round((event.clientY - heightDrag.current.top) / heightDrag.current.height * 100))); heightDrag.current.next = next; rightRef.current?.style.setProperty("--workspace-editor-height", `${next}%`); }
  function heightEnd(event: PointerEvent<HTMLDivElement>) { if (!heightDrag.current) return; dispatch({ type: "resize", percent: heightDrag.current.next }); heightDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  return <WorkspaceThemeProvider theme={resolvedPageTheme}><div ref={rootRef} style={{ colorScheme: resolvedPageTheme }} className={`${styles.root} ${resolvedPageTheme === "dark" ? "dark" : ""}`} data-od-id="paper4-workspace">
    <header className={`${styles.toolbar} ${paperStyles.toolbar}`}>
      <div className={`${styles.brand} ${paperStyles.brand}`}>
        <div className={styles.navigationStart}>
          <AppLink href="/" className={`${styles.back} ${styles.homeLink}`} title={tx("回首页", "Go home")} aria-label={tx("回首页", "Go home")}><House size={18}/></AppLink>
          <button type="button" onClick={() => setProblemListOpen(true)} className={`${styles.back} ${styles.problemList}`} title={tx("打开题目列表", "Open problem list")} aria-label={tx("打开题目列表", "Open problem list")} aria-haspopup="dialog" aria-expanded={problemListOpen} data-od-id="paper4-problem-list"><List size={18} aria-hidden="true"/><span>{tx("题目列表", "Problem list")}</span></button>
        </div>
        <span className={styles.navigationDivider}/>
        <div className={styles.problemNavigation} aria-label={tx("切换题目", "Switch problems")}>
          <button type="button" className={styles.tool} disabled={busy || formatting || library.loading || Boolean(library.error) || !libraryNavigation.previous} title={libraryNavigation.previous ? `${tx("上一题：", "Previous: ")}${libraryNavigation.previous.title ?? ""}` : tx("没有上一题", "No previous problem")} aria-label={tx("上一题", "Previous problem")} onClick={() => openLibraryProblem(libraryNavigation.previous)} data-od-id="previous-problem"><ChevronLeft size={20}/></button>
          <button type="button" className={styles.tool} disabled={busy || formatting || library.loading || Boolean(library.error) || !libraryNavigation.next} title={libraryNavigation.next ? `${tx("下一题：", "Next: ")}${libraryNavigation.next.title ?? ""}` : tx("没有下一题", "No next problem")} aria-label={tx("下一题", "Next problem")} onClick={() => openLibraryProblem(libraryNavigation.next)} data-od-id="next-problem"><ChevronRight size={20}/></button>
        </div>
        <AppLink href={learningContext ? paper4ChapterHref(learningContext) : freePractice ? "/student/paper4" : "/student/paper4?scope=activities"} className={styles.contextReturn} data-od-id="paper4-context-return">{learningContext ? tx("返回章节", "Back to chapter") : tx("返回 Paper 4 练习", "Back to Paper 4 Practice")}</AppLink>
        <span className={paperStyles.shortTitle} title={attempt.paper.title}>{paper4ShortTitle(attempt.paper)}</span>
      </div>
      {settings.actionPlacement === "toolbar" && <div className={styles.actions}>{runButtons}</div>}
      <div className={styles.tools}>
        <span role="status" className={`hidden text-xs sm:inline ${saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}>{saveStatus === "saving" ? tx("保存中…", "Saving…") : saveStatus === "error" ? tx("保存失败", "Save failed") : tx("已保存", "Saved")}</span>
        <button type="button" className={styles.tool} title={tx("布局与面板", "Layout and panels")} aria-label={tx("布局与面板", "Layout and panels")} onClick={() => setLayoutOpen(true)}><LayoutPanelLeft size={17}/></button>
        <button type="button" className={styles.tool} title={tx("工作区设置", "Workspace settings")} aria-label={tx("工作区设置", "Workspace settings")} onClick={() => { setSettingsScope("workspace"); setSettingsOpen(true); }}><Settings size={18}/></button>
        <button type="button" className={styles.tool} title={tx("帮助与快捷键", "Help and shortcuts")} aria-label={tx("帮助与快捷键", "Help and shortcuts")} onClick={() => setHelpOpen(true)}><HelpCircle size={17}/></button>
        <NotificationDropdown/>
        <AccountMenu user={user} role="student" busy={busy} onLogout={() => { if (dirty && !window.confirm(tx("代码仍有未保存修改，确定退出？", "There are unsaved edits. Sign out?"))) return; void mutate(async () => { try { await productionApi("auth/logout", { method: "POST" }); } catch (reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; } clearProductionSession(); router.replace("/login"); }); }}/>
      </div>
    </header>
    <nav className={styles.mobileTabs} aria-label={tx("答题分区", "Workspace panels")}>{panelIds.map(panel => <button key={panel} type="button" aria-pressed={layout.mobilePanel === panel} onClick={() => dispatch({ type: "mobile", panel })}>{panel === "statement" ? tx("题目", "Problem") : panel === "editor" ? tx("代码", "Code") : tx("测试", "Tests")}</button>)}</nav>
    <main ref={mainRef} className={mainClass} data-mobile={layout.mobilePanel} style={{ "--workspace-left": `${settings.panelPercent}%` } as CSSProperties}>
      <section className={panelClass("statement")}>
        <header className={styles.panelHeader}>
          <div className={styles.tabs} role="tablist" aria-label={tx("题目内容", "Problem content")}>
            {([{ value: "problem", label: tx("题目描述", "Problem"), icon: FileText }, { value: "solutions", label: tx("参考答案", "Solution"), icon: BookOpen }] as const).map(({ value, label, icon: Icon }) => <button key={value} id={`paper4-tab-${value}`} data-paper4-tab={value} type="button" role="tab" aria-selected={leftTab === value} aria-controls="paper4-content-panel" tabIndex={leftTab === value ? 0 : -1} className={styles.tab} onClick={() => changeLeftTab(value)} onKeyDown={event => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "problem" : event.key === "End" ? "solutions" : value === "problem" ? "solutions" : "problem";
              changeLeftTab(next);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-paper4-tab="${next}"]`)?.focus();
            }}><Icon size={15} aria-hidden="true"/>{label}</button>)}
          </div>
          {panelActions("statement")}
        </header>
        <div ref={statementBodyRef} className={`${styles.panelBody} ${paperStyles.statementBody}`} id="paper4-content-panel" role="tabpanel" aria-labelledby={`paper4-tab-${leftTab}`} tabIndex={0}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-od-id="paper4-question-selector">
            <label className="flex items-center gap-2 font-semibold">{tx("大题", "Question")}<select aria-label={tx("选择大题", "Select question")} className="min-h-9 max-w-[260px] rounded-md border border-border bg-surface px-2 text-foreground" value={current.key} onChange={event => changeQuestion(event.target.value)}>{questions.map((question, index) => <option key={question.key} value={question.key}>{index + 1}. {question.title}</option>)}</select></label>
            <span>{freePractice ? tx("自由练习", "Free practice") : attempt.paper.activityKind === "exam" ? tx("模拟考试", "Mock exam") : tx("练习任务", "Practice task")} · {freePractice && attempt.status === "submitted" ? tx("练习已提交", "Practice submitted") : paper4Status(attempt.status, locale)}{attempt.attemptNumber ? tx(` · 第 ${attempt.attemptNumber} 次`, ` · Attempt ${attempt.attemptNumber}`) : ""}{!freePractice && attempt.paper.endsAt ? ` · ${paper4Date(attempt.paper.endsAt, locale)}` : ""}</span>
          </div>
          {learningContext && <p className="mb-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted-foreground" data-od-id="paper4-course-context">{courseQuestion ? tx(`本章节练习只需 ${courseQuestion.key} 正式 AC。提交仍评测整卷，其他未完成的大题不影响本练习完成。`, `This course practice needs a formal AC for ${courseQuestion.key} only. Submission judges the whole paper; unfinished questions do not block this practice unit.`) : tx("本章节关联整套试卷，所有大题正式 AC 后完成本练习。", "This chapter links the whole paper. All questions need formal AC to complete this practice.")}</p>}
          <h1 className="sr-only">{current.title}</h1>
          <div hidden={leftTab !== "problem"}>
          <Paper4OriginalQuestion key={`${attempt.versionId ?? attempt.id}:${current.key}`} paper={attempt.paper} question={current} selectedStage={stage}/>
          <nav aria-label={tx("评分阶段", "Marking stages")} className="mt-4 mb-3 flex flex-wrap gap-1.5">{current.stages.map((item, index) => <button type="button" key={item.id} aria-current={item.id === stage?.id ? "step" : undefined} onClick={() => setStageId(item.id)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-primary ${item.id === stage?.id ? "border-primary bg-info-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{index + 1}. {item.title}{attempt.snapshots.some(snapshot => snapshot.stageId === item.id) && <span className="inline-flex items-center text-muted-foreground" title={tx("检查点已保存，并非判题通过", "Checkpoint saved; this does not mean the stage passed")}><Bookmark size={13} fill="currentColor" aria-hidden="true"/><span className="sr-only">{tx("检查点已保存，并非判题通过", "Checkpoint saved; this does not mean the stage passed")}</span></span>}</button>)}</nav>
          {stage && <section className="mt-6 border-t border-border pt-4" data-od-id="paper4-stage-actions">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{stage.title} · {stage.maxMarks} {tx("分", "marks")}</h2><span className="rounded bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground">{stage.judgeMode === "auto" ? tx("自动测试", "Automatic checks") : stage.judgeMode === "evidence" ? tx("测试证据", "Test evidence") : stage.judgeMode === "manual" ? tx("代码复核", "Code review") : tx("本题测试", "Question checks")}</span></div>
              <div className="flex flex-wrap items-center gap-2">{stage.judgeMode === "auto" && <Button size="sm" variant="outline" data-od-id="paper4-check-stage" disabled={questionRunDisabled} title={tx("仅检查所选阶段，不代表整道大题通过", "Check only the selected stage, not the whole question")} onClick={() => runCurrent(stage.id)}><CheckCircle2 size={14} aria-hidden="true"/>{tx("检查本阶段", "Check this stage")}</Button>}{runQuestionButton("stage")}</div>
            </div>
            {stage.description?.trim() && <Paper4Content content={stage.description}/>}
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{!hasAutomaticChecks ? tx("本题尚未配置自动测试，请保存检查点并按要求核对代码与测试证据。", "No automatic tests are configured for this question. Save a checkpoint and review the code and test evidence against the requirements.") : stage.judgeMode === "auto" ? tx("运行本题与顶部按钮相同，会检查本大题的全部自动阶段；检查本阶段仅运行当前阶段的测试。", "Run question matches the toolbar action and checks all auto stages in this question. Check this stage runs only the selected stage's tests.") : stage.judgeMode === "evidence" ? tx("运行本题可查看自动测试结果；本阶段的测试过程与证据需另行核对，不会自动判 AC。", "Run question shows automatic test results. The testing process and evidence for this stage are reviewed separately and do not receive an automatic AC.") : stage.judgeMode === "manual" ? tx("运行本题可查看自动测试结果；本阶段要求的代码结构与实现方法需另行核对，不会自动判 AC。", "Run question shows automatic test results. This stage's code structure and implementation requirements are reviewed separately and do not receive an automatic AC.") : tx("运行本题会检查本大题的全部测试。保存检查点不代表测试已通过。", "Run question checks all configured tests for this question. Saving a checkpoint does not mean the tests passed.")}</p>
          </section>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">{latestSnapshot ? tx(`检查点已保存 · ${paper4Date(latestSnapshot.createdAt, locale)}`, `Checkpoint saved · ${paper4Date(latestSnapshot.createdAt, locale)}`) : tx("本阶段尚无检查点", "No checkpoint for this stage")}</span><Button size="sm" variant="secondary" disabled={frozen || busy || saveStatus === "error" || !stage} onClick={() => void mutate(async () => { await saveFile(current.key); await productionApi(`paper4/attempts/${encodeURIComponent(attempt.id)}/checkpoints`, { method: "POST", body: { stageId: stage!.id } }); setAttempt(await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`)); setMessage(tx("阶段检查点已保存。", "Stage checkpoint saved.")); })}><Bookmark size={15}/>{tx("保存检查点", "Save checkpoint")}</Button></div></div>{leftTab === "solutions" && <Paper4Solutions key={`${attempt.id}:${current.key}`} attemptId={attempt.id} questionKey={current.key} locked={!freePractice && attempt.paper.activityKind === "exam" && !attempt.releasedAt} theme={solutionTheme} onThemeChange={setSolutionTheme}/>}
        </div>
      </section>
      <div role="separator" aria-label={tx("调整题目与代码区域宽度", "Resize problem and code panels")} aria-orientation="vertical" aria-valuemin={25} aria-valuemax={70} aria-valuenow={settings.panelPercent} tabIndex={0} onPointerDown={widthStart} onPointerMove={widthMove} onPointerUp={widthEnd} onPointerCancel={widthEnd} onLostPointerCapture={widthEnd} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); update({ panelPercent: settings.panelPercent + (event.key === "ArrowLeft" ? -2 : 2) }); } }} className={styles.separator}/>
      <div ref={rightRef} className={rightClass} style={{ "--workspace-editor-height": `${layout.editorPercent}%` } as CSSProperties}>
        <section className={panelClass("editor")}>
          <header className={styles.panelHeader}><span className={styles.panelTitle}><Code2 size={16}/>{tx("代码", "Code")}</span>{panelActions("editor")}</header>
          <div className={styles.editorToolbar}>
            <div className="flex min-w-0 items-center gap-2"><span className="font-mono font-semibold">{current.key}.py</span><span className="hidden text-muted-foreground sm:inline">Python 3</span></div>
            <div className={styles.tools}>
              <button type="button" className={styles.tool} title={tx("下载代码", "Download code")} aria-label={tx("下载代码", "Download code")} onClick={() => downloadCode(currentCode, `${current.key}.py`)}><Download size={14}/></button>
              <button type="button" className={styles.tool} title={`${tx("格式化代码", "Format code")} · ${displayBinding(settings.editorKeymap.format)}`} aria-label={tx("格式化代码", "Format code")} disabled={frozen || formatting || !currentCode.trim()} onClick={formatCurrent}><FormatCodeIcon/></button>
              <button type="button" className={styles.tool} title={tx("重置起始代码", "Reset starter code")} aria-label={tx("重置起始代码", "Reset starter code")} disabled={frozen || busy} onClick={() => setResetOpen(true)}><RotateCcw size={14}/></button>
              <EditorShortcutsHint bindings={settings.editorKeymap}/>
              <button type="button" className={styles.tool} title={tx("代码编辑器设置", "Code editor settings")} aria-label={tx("代码编辑器设置", "Code editor settings")} onClick={() => { setSettingsScope("editor"); setSettingsOpen(true); }}><Settings size={16}/></button>
              <button type="button" className={styles.tool} title={tx("最大化代码区", "Maximize code panel")} aria-label={tx("最大化代码区", "Maximize code panel")} onClick={() => dispatch({ type: "toggle-maximize", panel: "editor" })}><Maximize2 size={14}/></button>
            </div>
          </div>
          <div className={styles.editorBody}><CodeEditor editorRef={editorRef} code={currentCode} language="python" settings={settings} idPrefix="paper4" readOnly={frozen || formatting || submitting} inputLabel={tx(`${current.title} Python 代码`, `${current.title} Python code`)} status={saveStatus === "saved" ? tx("已保存到服务器", "Saved to server") : saveStatus === "saving" ? tx("正在保存…", "Saving…") : tx("保存失败", "Save failed")} actions={settings.actionPlacement === "editor" ? runButtons : undefined} onFormat={formatCurrent} onChange={value => { if (submitting || frozen) return; latest.current[current.key] = value; setCodes(existing => ({ ...existing, [current.key]: value })); }}/></div>
        </section>
        <div role="separator" aria-label={tx("调整代码与测试区域高度", "Resize code and test panels")} aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={85} aria-valuenow={layout.editorPercent} tabIndex={0} onPointerDown={heightStart} onPointerMove={heightMove} onPointerUp={heightEnd} onPointerCancel={heightEnd} onLostPointerCapture={heightEnd} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); dispatch({ type: "resize", percent: layout.editorPercent + (event.key === "ArrowUp" ? -2 : 2) }); } }} className={`${styles.separator} ${styles.horizontal}`}/>
        <section className={panelClass("testing")}>
          <header className={styles.panelHeader}><span className={styles.panelTitle}><Play size={15}/>{tx("测试结果与文件", "Results and files")}</span>{panelActions("testing")}</header>
          <div className={styles.resultBody}>
            {error && <div role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void mutate(saveAll)}>{tx("重试保存", "Retry save")}</button></div>}
            {message && <p role="status" className="mb-3 text-sm text-success">{message}</p>}
            <RunPanel key={run?.id ?? "idle"} run={run} stages={current.stages} initialFiles={current.initialFiles} locale={locale} freePractice={freePractice}/>
            {frozen && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm"><span>{attempt.formalJudging?.pending ? <span className="font-semibold text-primary">{tx(`大题判题中（剩余 ${attempt.formalJudging.pending} 题）`, `Judging questions (${attempt.formalJudging.pending} remaining)`)}</span> : attempt.formalJudging?.failed ? <span className="font-semibold text-warning">{tx("部分大题判题失败，请联系教师", "Some questions could not be judged; contact your teacher")}</span> : attempt.formalJudging?.total === 0 ? <span className="text-muted-foreground">{tx("历史答卷不追溯发放大题积分", "Historical attempts do not receive retroactive question points")}</span> : <>{tx("大题 AC 奖励", "Question AC rewards")}: <strong className="text-success">{(attempt.rankAwards ?? []).reduce((sum, award) => sum + award.points, 0)} / {questions.length * rankPointsPerQuestion} {tx("积分", "points")}</strong></>}</span><Button variant="secondary" size="sm" disabled={busy} onClick={() => void mutate(async () => { const refreshed = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`); setAttempt(refreshed); setMessage(freePractice ? tx("练习结果已刷新；重复 AC 不会重复获得积分。", "Practice results refreshed. Repeated AC does not award extra points.") : refreshed.releasedAt ? tx("结果与成绩已刷新。", "Results and marks refreshed.") : tx("结果已刷新；教师尚未公布试卷成绩。", "Results refreshed; the teacher has not released the paper mark yet.")); })}><RefreshCw size={14}/>{freePractice ? tx("刷新结果", "Refresh results") : tx("刷新结果与成绩", "Refresh results and marks")}</Button></div>}
            {attempt.releasedAt && <section className="mt-4 border-t border-border pt-3 text-sm"><div className="flex items-center justify-between gap-2"><strong className="text-success">{tx("教师评分已公布", "Teacher marks released")}</strong><strong>{attempt.score ?? "—"} / {attempt.totalMarks}</strong></div><div className="mt-2 space-y-2">{questions.flatMap(question => question.stages.map(item => { const mark = attempt.marks.find(value => value.stageId === item.id); return <div key={item.id} className="flex justify-between gap-3 border-t border-border pt-2"><span>{question.key} · {item.title}{mark?.note && <small className="block whitespace-pre-wrap text-muted-foreground">{mark.note}</small>}</span><strong>{mark?.marks ?? "—"} / {item.maxMarks}</strong></div>; }))}</div></section>}
          </div>
        </section>
      </div>
    </main>
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    <Dialog open={layoutOpen} onOpenChange={setLayoutOpen}><DialogContent className={styles.layoutMenu}><DialogTitle>{tx("布局与面板", "Layout and panels")}</DialogTitle><DialogDescription>{tx("展开、折叠或最大化作答区域。", "Show, collapse or maximize workspace panels.")}</DialogDescription>{panelIds.map(panel => <button key={panel} type="button" onClick={() => { dispatch({ type: "show", panel }); setLayoutOpen(false); }}>{panel === "statement" ? tx("题目描述", "Problem") : panel === "editor" ? tx("代码编辑器", "Code editor") : tx("测试结果", "Results")}<span className="text-xs text-muted-foreground">{layout.panels[panel] === "open" ? tx("已显示", "Shown") : tx("显示", "Show")}</span></button>)}<button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void rootRef.current?.requestFullscreen(); setLayoutOpen(false); }}>{tx("浏览器全屏", "Browser full screen")}<Maximize2 size={15}/></button></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogTitle>{tx("快捷键与保存", "Shortcuts and saving")}</DialogTitle><DialogDescription>{tx("代码自动保存到服务器。Ctrl / ⌘ + S 手动保存；Ctrl / ⌘ + 单引号运行；Ctrl / ⌘ + Enter 提交；Esc 退出最大化。", "Code autosaves to the server. Ctrl / ⌘ + S saves now, Ctrl / ⌘ + apostrophe runs, Ctrl / ⌘ + Enter submits, and Esc exits maximize.")}{" "}{freePractice ? tx("自由练习可在提交后再次练习，首次 AC 积分只发放一次。", "Free practice can be repeated after submission. First-AC points are awarded once.") : tx("教师评定试卷成绩。", "Your teacher awards the paper mark.")}</DialogDescription><DialogFooter><Button onClick={() => setHelpOpen(false)}>{tx("知道了", "Close")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent><DialogTitle>{tx("恢复起始代码？", "Restore starter code?")}</DialogTitle><DialogDescription>{tx("仅替换当前大题的编辑器内容；已有检查点仍保留。", "Only the current question's editor content changes. Existing checkpoints remain.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setResetOpen(false)}>{tx("取消", "Cancel")}</Button><Button onClick={() => { latest.current[current.key] = current.starterCode; setCodes(existing => ({ ...existing, [current.key]: current.starterCode })); setResetOpen(false); }}>{tx("恢复代码", "Restore code")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={submitOpen} onOpenChange={open => { if (!submitting) setSubmitOpen(open); }}><DialogContent><DialogTitle>{freePractice ? tx("提交本次练习", "Submit this practice") : tx("确认交卷", "Submit paper")}</DialogTitle><DialogDescription>{freePractice ? tx("提交后保留并冻结本次代码与检查点，自动判定各大题 AC。每题首次 AC 奖励 10 积分；之后可开始新一轮练习，重复 AC 不重复发放积分。", "Submission preserves and freezes this attempt, then judges each question for AC. Each question awards 10 points on its first AC only. You can start another practice attempt afterwards.") : tx("交卷后代码与检查点将冻结。系统将逐大题判定首次 AC 奖励积分；75 分试卷成绩由教师复核后公布。", "Submission freezes your code and checkpoints. Each question is judged for first-AC points; the paper mark out of 75 appears after teacher review.")}</DialogDescription><DialogFooter><Button variant="secondary" disabled={submitting} onClick={() => setSubmitOpen(false)}>{tx("继续作答", "Keep working")}</Button><Button disabled={busy || formatting} onClick={() => void mutate(submitAttempt)}>{freePractice ? tx("提交练习", "Submit practice") : tx("确认交卷", "Submit")}</Button></DialogFooter></DialogContent></Dialog>
    <ProblemListDrawer open={problemListOpen} onOpenChange={setProblemListOpen} title={tx("题目列表", "Problem list")} description={freePractice ? tx("Paper 4 练习 · 自由练习", "Paper 4 Practice · Free practice") : tx("Paper 4 练习 · 已布置活动", "Paper 4 Practice · Assigned activities")} items={libraryItems} currentId={attempt.paperId} loading={library.loading} error={library.error} onRetry={library.reload} onSelect={problem => {
      const target = libraryItems.find(item => item.id === problem.id);
      if (target) openLibraryProblem({ problemId: target.id, title: target.title });
    }}/>
    <WorkspaceSettingsDialog key={settingsScope} editorOnly={settingsScope === "editor"} initialSection={settingsScope === "editor" ? "editor" : "layout"} open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} update={update} reset={reset}/>
  </div></WorkspaceThemeProvider>;
}

function RunPanel({ run, stages, initialFiles, locale, freePractice }: { run: Paper4Run | null; stages: Paper4Stage[]; initialFiles: Record<string, string>; locale: "zh" | "en"; freePractice: boolean }) {
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const statusLabel = (status: string | null | undefined) => status === "NotPassed" ? tx("未通过", "Not passed") : status === "WA" ? tx("答案错误", "Wrong answer") : status === "NeedsReview" ? freePractice ? tx("需自行核对", "Self-check required") : tx("待教师复核", "Needs teacher review") : status ?? "";
  const results = run?.result?.publicResults ?? [];
  const stageResults = run?.result?.stageResults ?? [];
  const [selectedCase, setSelectedCase] = useState(0);
  const [selectedFile, setSelectedFile] = useState("");
  const caseResult = results[Math.min(selectedCase, results.length - 1)];
  const files = { ...initialFiles, ...(caseResult?.generatedFiles ?? {}) };
  const fileName = selectedFile in files ? selectedFile : Object.keys(files)[0] ?? "";
  const questionStatus = run?.result?.questionStatus;
  const stageTitle = (id: string | null | undefined) => stages.find(stage => stage.id === id)?.title ?? id ?? "";
  const routineMessages: Record<string, string> = {
    "自动测试全部通过；课程评分仍需教师审核人工阶段。": "All automatic tests passed. A teacher will still award marks for the manual stages.",
    "自动测试未通过；测试驱动与隐藏用例的诊断仅供教师查看。": "Automatic tests did not all pass. Driver and hidden-case diagnostics are available only to teachers.",
  };
  const publicMessage = run?.result?.publicMessage;
  const selectedStageStatus = stageResults.find(item => item.stageId === caseResult?.stageId)?.status;
  const casePassedButStageFailed = caseResult?.status === "AC" && selectedStageStatus && selectedStageStatus !== "AC";
  const allVisibleCasesPassed = results.filter(item => item.stageId === caseResult?.stageId).every(item => item.status === "AC");
  const verdict = run?.stageId ? stageResults.find(item => item.stageId === run.stageId)?.status ?? run.result?.status : questionStatus ?? run?.result?.status;
  const isRunning = run && ["queued", "leased", "running"].includes(run.state.toLowerCase());
  return <div className="min-w-0">
    {run ? <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2">
      <div><h2 className="text-sm font-bold">{run.stageId ? tx("本阶段运行", "Stage run") : tx("本题运行", "Question run")} · {run.stageId ? stageTitle(run.stageId) : tx("全部自动阶段", "All auto stages")}</h2><p className="mt-1 text-xs text-muted-foreground">{run.stageId ? tx("仅测试所选阶段，不代表整道题已通过。", "Only the selected stage was tested; this is not a whole-question result.") : tx("运行当前大题的所有自动阶段；各阶段全部通过才算自动 AC。", "Runs every auto stage in this question; all must pass for auto AC.")}</p></div>
      <span role="status" className={`text-xs font-semibold ${verdict === "AC" ? "text-success" : verdict === "NeedsReview" ? "text-warning" : verdict && !isRunning ? "text-destructive" : "text-muted-foreground"}`}>{paper4Status(run.state, locale)}{!isRunning && verdict ? ` · ${statusLabel(verdict)}` : ""}</span>
    </div> : <p className="text-xs text-muted-foreground">{tx("运行本题或所选阶段后，可查看判题结果、公开用例和工作文件。", "Run the question or selected stage to inspect the verdict, public cases and work files.")}</p>}
    <div className="pt-3">
      {publicMessage && <p className="text-xs text-muted-foreground">{freePractice && publicMessage === "自动测试全部通过；课程评分仍需教师审核人工阶段。" ? tx("所有自动测试已通过；人工阶段可对照要求自行核对。", "All automatic tests passed. Use the requirements to self-check the manual stages.") : locale === "en" ? routineMessages[publicMessage] ?? publicMessage : publicMessage}</p>}
      {!run?.stageId && stageResults.length > 0 && <section className="mt-2" aria-label={tx("各阶段结论", "Stage verdicts")}><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{tx("各阶段结论", "Stage verdicts")}</h3><div className="flex flex-wrap gap-1.5">{stageResults.map(item => <span key={item.stageId} className={`rounded-md border px-2 py-1 text-xs font-semibold ${item.status === "AC" ? "border-success text-success" : "border-destructive text-destructive"}`}>{stageTitle(item.stageId)} · {statusLabel(item.status)}</span>)}</div></section>}
      {Boolean(run?.result?.pendingManualStageIds?.length) && <p className="mt-2 text-xs text-warning">{freePractice ? tx("自行核对的代码阶段", "Code stages to self-check") : tx("待教师复核的代码阶段", "Code stages awaiting teacher review")}: {run!.result!.pendingManualStageIds!.map(stageTitle).join(locale === "en" ? ", " : "、")}</p>}
      {Boolean(run?.result?.evidenceStageIds?.length) && <p className="mt-1 text-xs text-muted-foreground">{freePractice ? tx("过程与证据练习", "Process and evidence practice") : tx("教师评定的过程/证据分", "Teacher-awarded process/evidence marks")}: {run!.result!.evidenceStageIds!.map(stageTitle).join(locale === "en" ? ", " : "、")}</p>}
      {caseResult && <section className="mt-3 border-t border-border pt-2" aria-label={tx("公开测试用例详情", "Public test case details")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-muted-foreground">{tx("公开测试用例", "Public test case")}</h3>{results.length > 1 && <select aria-label={tx("选择公开测试用例", "Select public test case")} className="max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs" value={selectedCase} onChange={event => { setSelectedCase(Number(event.target.value)); setSelectedFile(""); }}>{results.map((item, index) => <option key={`${item.stageId ?? "stage"}:${item.caseId}:${index}`} value={index}>{stageTitle(item.stageId)} · {item.caseId}</option>)}</select>}</div>
        <p className="mt-1 text-xs"><span className="font-medium">{stageTitle(caseResult.stageId)} · {caseResult.caseId}</span><span className={`ml-2 font-semibold ${caseResult.status === "AC" ? "text-success" : "text-destructive"}`}>{statusLabel(caseResult.status)}</span></p>
        {casePassedButStageFailed && <p className="mt-1 text-xs text-muted-foreground">{allVisibleCasesPassed ? tx("公开用例已通过，但本阶段仍有未公开检查未通过；详细诊断仅教师可见。", "Public cases passed, but an unpublished check in this stage failed. Detailed diagnostics are available only to teachers.") : tx("此公开用例已通过，但本阶段还有其他测试未通过。", "This public case passed, but another test in this stage did not.")}</p>}
      </section>}
      <div className="mt-2 grid gap-2 md:grid-cols-2"><div><h3 className="mb-1 flex items-center gap-1 text-xs font-semibold"><FileText size={13}/>{tx("标准输出", "Standard output")}</h3><pre className="max-h-32 min-h-16 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-2 text-xs">{caseResult?.stdout ?? run?.result?.publicOutput ?? "—"}</pre>{caseResult?.stderr && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">{caseResult.stderr}</p>}</div><div><h3 className="mb-1 text-xs font-semibold">{tx("工作文件", "Work files")}</h3>{fileName ? <><select aria-label={tx("选择工作文件", "Select work file")} className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs" value={fileName} onChange={event => setSelectedFile(event.target.value)}>{Object.keys(files).map(name => <option key={name}>{name}</option>)}</select><pre className="max-h-24 min-h-12 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-2 text-xs">{files[fileName]}</pre></> : <p className="text-xs text-muted-foreground">{tx("本题没有工作文件。", "No work files for this question.")}</p>}</div></div>
      {caseResult?.checks && <p className="mt-2 text-xs text-muted-foreground">{caseResult.checks.map(check => `${check.passed ? "✓" : "×"} ${check.name}`).join(" · ")}</p>}
    </div>
  </div>;
}

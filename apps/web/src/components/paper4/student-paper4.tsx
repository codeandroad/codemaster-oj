"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Clock3, Code2, Download, FileCode2, FileText, HelpCircle, House, LayoutPanelLeft, Maximize2, Play, RefreshCw, RotateCcw, Send, Settings } from "lucide-react";
import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { WorkspaceThemeProvider } from "@/components/ui/theme-context";
import { CodeEditor, type CodeEditorHandle } from "@/components/student/code-editor";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "@/components/student/workspace-settings";
import { useWorkspaceLayout, PanelControls } from "@/components/student/workspace-panels";
import { panelIds, type WorkspacePanel } from "@/components/student/workspace-layout-model";
import { formatCode, downloadCode } from "@/components/student/code-format";
import { FormatCodeIcon } from "@/components/student/format-code-icon";
import { EditorShortcutsHint } from "@/components/student/editor-shortcuts";
import { displayBinding } from "@/components/student/editor-keymap";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { AccountMenu } from "@/components/account-menu";
import styles from "@/components/student/workspace.module.css";
import { Empty, State, useData } from "@/components/student/shared";
import { ApiError, apiMessage, clearProductionSession, productionApi, type CampusUser } from "@/lib/production-api";
import { paper4Date, paper4Status, type Paper4Attempt, type Paper4File, type Paper4Paper, type Paper4PaperSummary, type Paper4Run, type Paper4Stage } from "./model";
import { Paper4Content } from "./paper4-content";

const surface = "min-w-0 rounded-lg border border-border bg-surface panel-shadow";

export function StudentPaper4List() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const papers = useData<{ items: Paper4PaperSummary[] }>("paper4/papers");
  return <>
    <PageHeader eyebrow={tx("实践评测", "Practical assessment")} title={tx("Paper 4 练习", "Paper 4 practice")} description={tx("课程与模拟考试中的编程实践卷。每道大题首次正式 AC 奖励 10 积分；试卷分数由教师评分。", "Practical papers for courses and mock exams. Each question earns 10 points on its first formal AC; teachers mark the paper separately.")} />
    <State data={papers}>{papers.data?.items.length ? <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface panel-shadow">
      {papers.data.items.map(paper => <AppLink key={paper.id} href={`/student/paper4/${paper.id}`} className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 last:border-b-0 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary">
        <span className="min-w-0"><strong className="block text-base text-primary">{paper.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{paper.questionCount} {tx("道大题", "questions")} · {paper.totalMarks} {tx("分", "marks")} · {tx("每题首次正式 AC +10 积分", "First formal AC +10 points per question")} · {paper4Date(paper.endsAt, locale)}</span></span>
        <span className="text-sm font-semibold text-primary">{tx("打开练习", "Open practice")} →</span>
      </AppLink>)}
    </div> : <Empty title={tx("暂无可参加的 Paper 4 练习", "No Paper 4 practice is available")} description={tx("教师发布到你的班级后会显示在这里。", "A paper appears here when your teacher publishes it to your class.")}/>}</State>
  </>;
}

export function StudentPaper4Detail({ paperId, user }: { paperId: string; user: CampusUser }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const paper = useData<Paper4Paper>(`paper4/papers/${encodeURIComponent(paperId)}`);
  const [attempt, setAttempt] = useState<Paper4Attempt | null>(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true); setError(""); setAttempt(null);
    productionApi<Paper4Attempt>(`paper4/papers/${encodeURIComponent(paperId)}/attempt`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setAttempt(value); })
      .catch(reason => { if (!controller.signal.aborted && !(reason instanceof ApiError && reason.status === 404)) setError(apiMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [paperId]);
  if (attempt) return <Paper4Workspace key={attempt.id} attempt={attempt} user={user}/>;
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
    <AppLink href="/student/paper4" className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("返回练习列表", "Back to practice list")}</AppLink>
    <State data={paper}>{paper.data && <div className={`${surface} p-5 sm:p-6`}>
      <PageHeader eyebrow={tx("编程实践卷 · Python", "Practical paper · Python")} title={paper.data.title} description={paper.data.description}/>
      <div className="mt-5 flex flex-wrap gap-5 border-t border-border pt-4 text-sm text-muted-foreground"><span>{paper.data.questions.length} {tx("道大题", "questions")}</span><span>{paper.data.totalMarks} {tx("分", "marks")}</span><span><Clock3 size={15} className="mr-1 inline"/>{paper4Date(paper.data.startsAt, locale)} – {paper4Date(paper.data.endsAt, locale)}</span></div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{tx("每道大题有独立代码；切换小题不会清空代码。请在规定阶段保存检查点，完成后交卷。正式交卷后，每道大题全部自动阶段通过可获得首次 AC 的 10 积分；75 分试卷成绩须经教师复核。", "Each question has its own code. Switching stages keeps your code. Save checkpoints, then submit. After formal submission, passing every auto stage in a question earns 10 first-AC points; teachers separately review the paper mark out of 75.")}</p>
      <Button className="mt-5" disabled={checking || starting || Boolean(error)} onClick={async () => {
        setStarting(true); setError("");
        try { setAttempt(await productionApi<Paper4Attempt>(`paper4/papers/${encodeURIComponent(paperId)}/attempt`, { method: "POST" })); }
        catch (reason) { setError(apiMessage(reason)); }
        finally { setStarting(false); }
      }}>{starting ? tx("正在打开…", "Opening…") : tx("开始或继续作答", "Start or continue")}</Button>
      {checking && <p role="status" className="mt-3 text-sm text-muted-foreground">{tx("正在检查作答记录…", "Checking your attempt…")}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </div>}</State>
  </main>;
}

function Paper4Workspace({ attempt: initialAttempt, user }: { attempt: Paper4Attempt; user: CampusUser }) {
  const { locale } = useLocale();
  const router = useRouter();
  const tx = useCallback((zh: string, en: string) => locale === "en" ? en : zh, [locale]);
  const [attempt, setAttempt] = useState(initialAttempt);
  const questions = attempt.paper.questions;
  const [questionKey, setQuestionKey] = useState(questions[0]?.key ?? "");
  const [stageId, setStageId] = useState(questions[0]?.stages[0]?.id ?? "");
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Paper4Run | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsScope, setSettingsScope] = useState<"workspace" | "editor">("workspace");
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<CodeEditorHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const widthDrag = useRef<{ left: number; width: number; next: number } | null>(null);
  const heightDrag = useRef<{ top: number; height: number; next: number } | null>(null);
  const { settings, update, reset, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const { layout, dispatch } = useWorkspaceLayout(user.id);
  const current = questions.find(question => question.key === questionKey) ?? questions[0];
  const stage = current?.stages.find(item => item.id === stageId) ?? current?.stages[0];
  const rankPointsPerQuestion = attempt.firstAcPointsPerQuestion ?? attempt.paper.firstAcPointsPerQuestion ?? 10;
  const currentAward = attempt.rankAwards?.find(award => award.questionKey === current.key);
  const frozen = attempt.canEdit === false || ["submitted", "reviewed", "released"].includes(attempt.status.toLowerCase());
  const currentCode = current ? codes[current.key] ?? current.starterCode : "";
  const latest = useRef<Record<string, string>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const saved = useRef<Record<string, string>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.content])));
  const revisions = useRef<Record<string, number>>(Object.fromEntries(initialAttempt.files.map(file => [file.fileKey, file.revision])));
  const inflight = useRef(new Map<string, Promise<void>>());
  const alive = useRef(true);
  const dirty = Object.keys(codes).some(key => codes[key] !== saved.current[key]);
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
    const operation = (async () => {
      while (latest.current[key] !== saved.current[key]) {
        const content = latest.current[key] ?? "";
        setSaveStatus("saving");
        const response = await productionApi<Paper4File>(`paper4/attempts/${encodeURIComponent(attempt.id)}/files/${encodeURIComponent(key)}`, { method: "PATCH", body: { content, revision: revisions.current[key] ?? 0 } });
        if (!Number.isInteger(response.revision)) throw new Error(tx("服务器没有返回代码修订号，保存状态无法确认。", "The server did not confirm a code revision."));
        revisions.current[key] = response.revision;
        saved.current[key] = content;
      }
      if (alive.current) setSaveStatus("saved");
    })();
    inflight.current.set(key, operation);
    try { await operation; }
    catch (reason) { if (alive.current) { setSaveStatus("error"); setError(apiMessage(reason)); } throw reason; }
    finally { inflight.current.delete(key); }
  }, [attempt.id, tx]);
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
  function changeQuestion(key: string) {
    const next = questions.find(question => question.key === key);
    if (!next) return;
    setQuestionKey(key); setStageId(next.stages[0]?.id ?? ""); setRun(null);
  }
  const questionIndex = questions.findIndex(question => question.key === current?.key);
  const runCurrent = (stageToRun?: string) => void mutate(async () => {
    if (!current) return;
    await saveFile(current.key);
    setRun(await productionApi<Paper4Run>(`paper4/attempts/${encodeURIComponent(attempt.id)}/runs`, { method: "POST", body: { fileKey: current.key, ...(stageToRun ? { stageId: stageToRun } : {}) } }));
    dispatch({ type: "show", panel: "testing" });
  });
  const formatCurrent = () => {
    if (formatting || frozen || !currentCode.trim()) return;
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
      if (event.defaultPrevented || event.isComposing || settingsOpen || layoutOpen || helpOpen || resetOpen || submitOpen) return;
      if (event.key === "Escape") { dispatch({ type: "exit-maximize" }); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") { event.preventDefault(); if (!frozen) void mutate(async () => { await saveAll(); setNotice(tx("代码已保存到服务器。", "Code saved to server.")); }); }
      else if (key === "'" && settings.runShortcut && !busy && !frozen) { event.preventDefault(); runCurrent(); }
      else if (key === "enter" && settings.submitShortcut && !busy && !frozen && !dirty) { event.preventDefault(); setSubmitOpen(true); }
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
  const runButtons = <><Button size="sm" variant="secondary" title={tx("运行当前大题的全部自动阶段", "Run all auto stages in this question")} disabled={frozen || busy || saveStatus === "error" || !currentCode.trim()} onClick={() => runCurrent()}><Play size={14}/>{tx("运行本题", "Run question")}</Button><Button size="sm" disabled={frozen || busy || dirty || saveStatus === "error"} onClick={() => setSubmitOpen(true)}><Send size={14}/>{tx("交卷", "Submit")}</Button></>;
  function widthStart(event: PointerEvent<HTMLDivElement>) { if (!mainRef.current) return; const rect = mainRef.current.getBoundingClientRect(); widthDrag.current = { left: rect.left, width: rect.width, next: settings.panelPercent }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  function widthMove(event: PointerEvent<HTMLDivElement>) { if (!widthDrag.current) return; const next = Math.max(25, Math.min(70, Math.round((event.clientX - widthDrag.current.left) / widthDrag.current.width * 100))); widthDrag.current.next = next; mainRef.current?.style.setProperty("--workspace-left", `${next}%`); }
  function widthEnd(event: PointerEvent<HTMLDivElement>) { if (!widthDrag.current) return; update({ panelPercent: widthDrag.current.next }); widthDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function heightStart(event: PointerEvent<HTMLDivElement>) { if (!rightRef.current) return; const rect = rightRef.current.getBoundingClientRect(); heightDrag.current = { top: rect.top, height: rect.height, next: layout.editorPercent }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }
  function heightMove(event: PointerEvent<HTMLDivElement>) { if (!heightDrag.current) return; const next = Math.max(20, Math.min(85, Math.round((event.clientY - heightDrag.current.top) / heightDrag.current.height * 100))); heightDrag.current.next = next; rightRef.current?.style.setProperty("--workspace-editor-height", `${next}%`); }
  function heightEnd(event: PointerEvent<HTMLDivElement>) { if (!heightDrag.current) return; dispatch({ type: "resize", percent: heightDrag.current.next }); heightDrag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  return <WorkspaceThemeProvider theme={resolvedPageTheme}><div ref={rootRef} style={{ colorScheme: resolvedPageTheme }} className={`${styles.root} ${resolvedPageTheme === "dark" ? "dark" : ""}`} data-od-id="paper4-workspace">
    <header className={styles.toolbar}>
      <div className={styles.brand}>
        <AppLink href="/" className={`${styles.back} ${styles.homeLink}`} title={tx("回首页", "Go home")} aria-label={tx("回首页", "Go home")}><House size={18}/></AppLink>
        <AppLink href="/student/paper4" className={styles.back}><FileCode2 size={16}/><span>{tx("试卷列表", "Paper list")}</span></AppLink>
        <span className={styles.navigationDivider}/>
        <div className={styles.problemNavigation} aria-label={tx("切换大题", "Switch questions")}>
          <button type="button" className={styles.tool} disabled={questionIndex <= 0} title={tx("上一题", "Previous question")} aria-label={tx("上一题", "Previous question")} onClick={() => changeQuestion(questions[questionIndex - 1]!.key)}><ChevronLeft size={20}/></button>
          <button type="button" className={styles.tool} disabled={questionIndex >= questions.length - 1} title={tx("下一题", "Next question")} aria-label={tx("下一题", "Next question")} onClick={() => changeQuestion(questions[questionIndex + 1]!.key)}><ChevronRight size={20}/></button>
        </div>
        <span className={styles.title} title={attempt.paper.title}>{attempt.paper.title}</span>
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
        <header className={styles.panelHeader}><span className={styles.panelTitle}><FileText size={16}/>{tx("题目描述", "Problem")}</span>{panelActions("statement")}</header>
        <div className={styles.panelBody}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2 font-semibold">{tx("大题", "Question")}<select aria-label={tx("选择大题", "Select question")} className="min-h-9 max-w-[260px] rounded-md border border-border bg-surface px-2 text-foreground" value={current.key} onChange={event => changeQuestion(event.target.value)}>{questions.map((question, index) => <option key={question.key} value={question.key}>{index + 1}. {question.title}</option>)}</select></label>
            <span>{paper4Status(attempt.status, locale)} · {paper4Date(attempt.paper.endsAt, locale)}</span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{current.title}</h1><span className={`rounded-md px-2 py-1 text-xs font-semibold ${currentAward ? "bg-success-soft text-success" : "bg-surface-subtle text-muted-foreground"}`}>{currentAward ? tx(`已获得 ${currentAward.points} 积分`, `${currentAward.points} points earned`) : tx(`首次正式 AC +${rankPointsPerQuestion} 积分`, `First formal AC +${rankPointsPerQuestion} points`)}</span></div>
          <nav aria-label={tx("评分阶段", "Marking stages")} className="mb-5 flex flex-wrap gap-1.5">{current.stages.map((item, index) => <button type="button" key={item.id} aria-current={item.id === stage?.id ? "step" : undefined} onClick={() => setStageId(item.id)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-primary ${item.id === stage?.id ? "border-primary bg-info-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{index + 1}. {item.title}{attempt.snapshots.some(snapshot => snapshot.stageId === item.id) && <span className="inline-flex items-center text-muted-foreground" title={tx("检查点已保存，并非判题通过", "Checkpoint saved; this does not mean the stage passed")}><Bookmark size={13} fill="currentColor" aria-hidden="true"/><span className="sr-only">{tx("检查点已保存，并非判题通过", "Checkpoint saved; this does not mean the stage passed")}</span></span>}</button>)}</nav>
          <Paper4Content content={current.statement}/>
          {stage?.description && <section className="mt-6 border-t border-border pt-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{stage.title} · {stage.maxMarks} {tx("分", "marks")}</h2>{stage.judgeMode === "auto" && <Button size="sm" variant="secondary" disabled={frozen || busy || saveStatus === "error" || !currentCode.trim()} onClick={() => runCurrent(stage.id)}><Play size={13}/>{tx("运行本阶段", "Run this stage")}</Button>}</div><Paper4Content content={stage.description}/></section>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><span className="text-xs text-muted-foreground">{latestSnapshot ? tx(`检查点已保存 · ${paper4Date(latestSnapshot.createdAt, locale)}`, `Checkpoint saved · ${paper4Date(latestSnapshot.createdAt, locale)}`) : tx("本阶段尚无检查点", "No checkpoint for this stage")}</span><Button size="sm" variant="secondary" disabled={frozen || busy || saveStatus === "error" || !stage} onClick={() => void mutate(async () => { await saveFile(current.key); await productionApi(`paper4/attempts/${encodeURIComponent(attempt.id)}/checkpoints`, { method: "POST", body: { stageId: stage!.id } }); setAttempt(await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`)); setMessage(tx("阶段检查点已保存。", "Stage checkpoint saved.")); })}><Bookmark size={15}/>{tx("保存检查点", "Save checkpoint")}</Button></div>
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
          <div className={styles.editorBody}><CodeEditor editorRef={editorRef} code={currentCode} language="python" settings={settings} idPrefix="paper4" readOnly={frozen || formatting} inputLabel={tx(`${current.title} Python 代码`, `${current.title} Python code`)} status={saveStatus === "saved" ? tx("已保存到服务器", "Saved to server") : saveStatus === "saving" ? tx("正在保存…", "Saving…") : tx("保存失败", "Save failed")} actions={settings.actionPlacement === "editor" ? runButtons : undefined} onFormat={formatCurrent} onChange={value => { latest.current[current.key] = value; setCodes(existing => ({ ...existing, [current.key]: value })); setSaveStatus("saving"); }}/></div>
        </section>
        <div role="separator" aria-label={tx("调整代码与测试区域高度", "Resize code and test panels")} aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={85} aria-valuenow={layout.editorPercent} tabIndex={0} onPointerDown={heightStart} onPointerMove={heightMove} onPointerUp={heightEnd} onPointerCancel={heightEnd} onLostPointerCapture={heightEnd} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); dispatch({ type: "resize", percent: layout.editorPercent + (event.key === "ArrowUp" ? -2 : 2) }); } }} className={`${styles.separator} ${styles.horizontal}`}/>
        <section className={panelClass("testing")}>
          <header className={styles.panelHeader}><span className={styles.panelTitle}><Play size={15}/>{tx("测试结果与文件", "Results and files")}</span>{panelActions("testing")}</header>
          <div className={styles.resultBody}>
            {error && <div role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void mutate(saveAll)}>{tx("重试保存", "Retry save")}</button></div>}
            {message && <p role="status" className="mb-3 text-sm text-success">{message}</p>}
            <RunPanel key={run?.id ?? "idle"} run={run} stages={current.stages} initialFiles={current.initialFiles} locale={locale}/>
            {frozen && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm"><span>{attempt.formalJudging?.pending ? <span className="font-semibold text-primary">{tx(`大题判题中（剩余 ${attempt.formalJudging.pending} 题）`, `Judging questions (${attempt.formalJudging.pending} remaining)`)}</span> : attempt.formalJudging?.failed ? <span className="font-semibold text-warning">{tx("部分大题判题失败，请联系教师", "Some questions could not be judged; contact your teacher")}</span> : attempt.formalJudging?.total === 0 ? <span className="text-muted-foreground">{tx("历史答卷不追溯发放大题积分", "Historical attempts do not receive retroactive question points")}</span> : <>{tx("大题 AC 奖励", "Question AC rewards")}: <strong className="text-success">{(attempt.rankAwards ?? []).reduce((sum, award) => sum + award.points, 0)} / {questions.length * rankPointsPerQuestion} {tx("积分", "points")}</strong></>}</span><Button variant="secondary" size="sm" disabled={busy} onClick={() => void mutate(async () => { const refreshed = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`); setAttempt(refreshed); setMessage(refreshed.releasedAt ? tx("结果与成绩已刷新。", "Results and marks refreshed.") : tx("结果已刷新；教师尚未公布试卷成绩。", "Results refreshed; the teacher has not released the paper mark yet.")); })}><RefreshCw size={14}/>{tx("刷新结果与成绩", "Refresh results and marks")}</Button></div>}
            {attempt.releasedAt && <section className="mt-4 border-t border-border pt-3 text-sm"><div className="flex items-center justify-between gap-2"><strong className="text-success">{tx("教师评分已公布", "Teacher marks released")}</strong><strong>{attempt.score ?? "—"} / {attempt.totalMarks}</strong></div><div className="mt-2 space-y-2">{questions.flatMap(question => question.stages.map(item => { const mark = attempt.marks.find(value => value.stageId === item.id); return <div key={item.id} className="flex justify-between gap-3 border-t border-border pt-2"><span>{question.key} · {item.title}{mark?.note && <small className="block whitespace-pre-wrap text-muted-foreground">{mark.note}</small>}</span><strong>{mark?.marks ?? "—"} / {item.maxMarks}</strong></div>; }))}</div></section>}
          </div>
        </section>
      </div>
    </main>
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    <Dialog open={layoutOpen} onOpenChange={setLayoutOpen}><DialogContent className={styles.layoutMenu}><DialogTitle>{tx("布局与面板", "Layout and panels")}</DialogTitle><DialogDescription>{tx("展开、折叠或最大化作答区域。", "Show, collapse or maximize workspace panels.")}</DialogDescription>{panelIds.map(panel => <button key={panel} type="button" onClick={() => { dispatch({ type: "show", panel }); setLayoutOpen(false); }}>{panel === "statement" ? tx("题目描述", "Problem") : panel === "editor" ? tx("代码编辑器", "Code editor") : tx("测试结果", "Results")}<span className="text-xs text-muted-foreground">{layout.panels[panel] === "open" ? tx("已显示", "Shown") : tx("显示", "Show")}</span></button>)}<button type="button" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void rootRef.current?.requestFullscreen(); setLayoutOpen(false); }}>{tx("浏览器全屏", "Browser full screen")}<Maximize2 size={15}/></button></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogTitle>{tx("快捷键与保存", "Shortcuts and saving")}</DialogTitle><DialogDescription>{tx("代码自动保存到服务器。Ctrl / ⌘ + S 手动保存；Ctrl / ⌘ + 单引号运行；Ctrl / ⌘ + Enter 交卷；Esc 退出最大化。自动判题会显示各阶段 AC 状态，75 分成绩由教师评定。", "Code autosaves to the server. Ctrl / ⌘ + S saves now, Ctrl / ⌘ + apostrophe runs, Ctrl / ⌘ + Enter submits, and Esc exits maximize. Auto judging reports stage AC status; teachers award marks out of 75.")}</DialogDescription><DialogFooter><Button onClick={() => setHelpOpen(false)}>{tx("知道了", "Close")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={resetOpen} onOpenChange={setResetOpen}><DialogContent><DialogTitle>{tx("恢复起始代码？", "Restore starter code?")}</DialogTitle><DialogDescription>{tx("仅替换当前大题的编辑器内容；已有检查点仍保留。", "Only the current question's editor content changes. Existing checkpoints remain.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setResetOpen(false)}>{tx("取消", "Cancel")}</Button><Button onClick={() => { latest.current[current.key] = current.starterCode; setCodes(existing => ({ ...existing, [current.key]: current.starterCode })); setSaveStatus("saving"); setResetOpen(false); }}>{tx("恢复代码", "Restore code")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={submitOpen} onOpenChange={setSubmitOpen}><DialogContent><DialogTitle>{tx("确认交卷", "Submit paper")}</DialogTitle><DialogDescription>{tx("交卷后代码与检查点将冻结。系统将逐大题判定首次 AC 奖励积分；75 分试卷成绩由教师复核后公布。", "Submission freezes your code and checkpoints. Each question is judged for first-AC points; the paper mark out of 75 appears after teacher review.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setSubmitOpen(false)}>{tx("继续作答", "Keep working")}</Button><Button disabled={busy} onClick={() => void mutate(async () => { await saveAll(); const updated = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}/submit`, { method: "POST" }); setAttempt(updated); setSubmitOpen(false); setMessage(tx("已交卷。大题 AC 奖励将在自动判题后记入；请等待教师复核试卷成绩。", "Submitted. Question AC points are awarded after automatic judging; await teacher review for the paper mark.")); })}>{tx("确认交卷", "Submit")}</Button></DialogFooter></DialogContent></Dialog>
    <WorkspaceSettingsDialog key={settingsScope} editorOnly={settingsScope === "editor"} initialSection={settingsScope === "editor" ? "editor" : "layout"} open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} update={update} reset={reset}/>
  </div></WorkspaceThemeProvider>;
}

function RunPanel({ run, stages, initialFiles, locale }: { run: Paper4Run | null; stages: Paper4Stage[]; initialFiles: Record<string, string>; locale: "zh" | "en" }) {
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const statusLabel = (status: string | null | undefined) => status === "NotPassed" ? tx("未通过", "Not passed") : status === "WA" ? tx("答案错误", "Wrong answer") : status === "NeedsReview" ? tx("待教师复核", "Needs teacher review") : status ?? "";
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
      {publicMessage && <p className="text-xs text-muted-foreground">{locale === "en" ? routineMessages[publicMessage] ?? publicMessage : publicMessage}</p>}
      {!run?.stageId && stageResults.length > 0 && <section className="mt-2" aria-label={tx("各阶段结论", "Stage verdicts")}><h3 className="mb-1 text-xs font-semibold text-muted-foreground">{tx("各阶段结论", "Stage verdicts")}</h3><div className="flex flex-wrap gap-1.5">{stageResults.map(item => <span key={item.stageId} className={`rounded-md border px-2 py-1 text-xs font-semibold ${item.status === "AC" ? "border-success text-success" : "border-destructive text-destructive"}`}>{stageTitle(item.stageId)} · {statusLabel(item.status)}</span>)}</div></section>}
      {Boolean(run?.result?.pendingManualStageIds?.length) && <p className="mt-2 text-xs text-warning">{tx("待教师复核的代码阶段", "Code stages awaiting teacher review")}: {run!.result!.pendingManualStageIds!.map(stageTitle).join(locale === "en" ? ", " : "、")}</p>}
      {Boolean(run?.result?.evidenceStageIds?.length) && <p className="mt-1 text-xs text-muted-foreground">{tx("教师评定的过程/证据分", "Teacher-awarded process/evidence marks")}: {run!.result!.evidenceStageIds!.map(stageTitle).join(locale === "en" ? ", " : "、")}</p>}
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

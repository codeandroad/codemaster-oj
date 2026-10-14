"use client";
import type {LearningPath} from "./learning";

import { AppLink, useNavigationBlocker } from "@/components/navigation";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Shuffle, List, Code2, FileText, HelpCircle, History, LayoutPanelLeft, Maximize2, Play, RotateCcw, Send, Settings, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/page-chrome";
import { isPending, productionApi, productionId, type Assignment, type CampusUser, type ProductionProblem, type Submission, type SubmissionLanguage } from "@/lib/production-api";
import { Feedback, LessonContent, ResultPanel, State, date, textarea, useData, useMutation, useSubmission } from "./shared";
import { draftKey, readDraft, readDraftLanguage, saveDraft, saveDraftLanguage, workspaceDraftContext } from "./drafts";
import {formatCode,downloadCode} from "./code-format";
import {WorkspaceThemeProvider} from "@/components/ui/theme-context";
import {displayBinding} from "./editor-keymap";
import {FormatCodeIcon} from "./format-code-icon";
import {EditorShortcutsHint} from "./editor-shortcuts";
import { CodeEditor,type CodeEditorHandle } from "./code-editor";
import { languageInfo, starterFor, submissionLanguage, supportedLanguages } from "./languages";
import { TimedClock, useStudentTimedSession } from "./timed";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "./workspace-settings";
import { WorkspaceTimer } from "./workspace-timer";
import { useWorkspaceLayout, PanelControls, panelNames } from "./workspace-panels";
import { panelIds, type WorkspacePanel } from "./workspace-layout-model";
import styles from "./workspace.module.css";
import {AccountMenu} from "@/components/account-menu";
import {NotificationDropdown} from "./notification-dropdown";
import {clearProductionSession,ApiError} from "@/lib/production-api";
import {ProblemListDrawer} from "./problem-list-drawer";
import {ProblemHeading} from "./problem-heading";
import {problemNavigation,navigationHref,type NavigationProblem} from "./problem-navigation";
import { validateFunctionInput } from "@/lib/function-input";

export function StudentWorkspace({ id, user }: { id: string; user: CampusUser }) {
  const search = useSearchParams(), originalId = search.get("originalSubmissionId"), version = search.get("versionId");
  const original = useData<Submission>(originalId ? `submissions/${encodeURIComponent(originalId)}` : ""), pinned = originalId ? original.data?.versionId : version;
  const problem = useData<ProductionProblem>(!originalId || original.data ? `problems/${id}${pinned ? `?versionId=${encodeURIComponent(pinned)}` : ""}` : "");
  const context = workspaceDraftContext({
    originalSubmissionId: originalId ? original.data?.originalSubmissionId ?? original.data?.id ?? originalId : null,
    timedPracticeId: search.get("timedPracticeId"),
    assignmentId: search.get("assignmentId"),
    learningPathId: search.get("learningPathId"),
    chapterId: search.get("chapterId"),
  });
  if (originalId && original.loading) return <div className="p-5"><State data={original}>Loading original submission…</State></div>;
  if (originalId && original.data?.problemId !== id) return <div role="alert" className="p-5 text-sm text-destructive">{original.error || "订正题目与原提交不匹配。"}</div>;
  return <State data={problem}>{problem.data && <WorkspaceBody key={`${user.id}:${problem.data.id}:${problem.data.versionId}:${context}`} problem={problem.data} user={user} original={original.data}/>}</State>;
}
function safeReturn(value: string | null) { return value?.startsWith("/student/") && !value.startsWith("//") ? value : null; }
function WorkspaceBody({ problem, user, original }: { problem: ProductionProblem; user: CampusUser; original: Submission | null }) {
  const router = useRouter();
  const params = useSearchParams(), assignmentId = original ? null : params.get("assignmentId"), timedPracticeId = original ? null : params.get("timedPracticeId"), originalId = original ? original.originalSubmissionId ?? original.id : null;
  const learningPathId=!assignmentId&&!timedPracticeId&&!originalId?params.get("learningPathId"):null,chapterId=params.get("chapterId");
  const course=useData<LearningPath>(learningPathId?`learning-paths/${encodeURIComponent(learningPathId)}`:"");
  const courseChapter=course.data?.chapters?.find(c=>c.id===chapterId);
  const courseValid=!!courseChapter?.problems.some(p=>p.problemId===problem.id&&p.versionId===problem.versionId);
  const returnTo = (learningPathId&&chapterId?`/student/learning-paths/${encodeURIComponent(learningPathId)}/chapters/${encodeURIComponent(chapterId)}`:safeReturn(params.get("returnTo"))) ?? (timedPracticeId ? `/student/timed-practice/${timedPracticeId}` : assignmentId ? `/student/assignments/${assignmentId}` : originalId ? `/student/submissions/${originalId}` : "/student/problems");
  const sourceLabel = params.get("sourceLabel") ?? (timedPracticeId ? "Timed Practice" : assignmentId ? "Assignment" : originalId ? "Review Notebook" : "Problems");
  const context = workspaceDraftContext({ originalSubmissionId: originalId, timedPracticeId, assignmentId, learningPathId, chapterId });
  const initialLanguage = submissionLanguage(original?.language);
  const [language, setLanguage] = useState<SubmissionLanguage>(initialLanguage);
  const storageKey = draftKey(user.id, problem.id, problem.versionId ?? "current", context, language);
  const initialDraft = readDraft(storageKey), initialCode = original?.code ?? starterFor(problem, language);
  const [code, setCode] = useState(initialDraft?.code ?? initialCode), [receivedCode, setReceivedCode] = useState(initialDraft?.receivedCode ?? initialCode), [leftTab, setLeftTab] = useState("Problem"), [resultTab, setResultTab] = useState("Samples"), [customInput, setCustomInput] = useState(""), [submissionId, setSubmissionId] = useState<string | null>(null), [confirm, setConfirm] = useState<"leave" | "reset" | "help" | null>(null), [settingsOpen, setSettingsOpen] = useState(false),[settingsScope,setSettingsScope]=useState<"workspace"|"editor">("workspace"),[formatting,setFormatting]=useState(false), [previewPercent, setPreviewPercent] = useState<number | null>(null), [layoutOpen, setLayoutOpen] = useState(false), [layoutMessage, setLayoutMessage] = useState(""), [selectedSample, setSelectedSample] = useState(0), [pendingDestination,setPendingDestination] = useState<string|null>(null);
  const editorRef=useRef<CodeEditorHandle>(null);
  const [activePanel,setActivePanel]=useState<WorkspacePanel>("editor");
  const { settings, update, reset, loaded: settingsReady, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const { layout, dispatch } = useWorkspaceLayout(user.id);
  const rightRef = useRef<HTMLDivElement>(null), verticalDrag = useRef<{top:number;height:number;next:number}|null>(null), executionLock = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null), mainRef = useRef<HTMLElement>(null), dragRef = useRef<{ width: number; left: number; next: number } | null>(null);
  const [draftSaved,setDraftSaved]=useState(false);
  const action = useMutation(), polling = useSubmission(submissionId), keys = useRef(new Map<string, string>()), timedSession = useStudentTimedSession(timedPracticeId);
  const [problemListOpen,setProblemListOpen]=useState(false);
  const library=useData<{items:ProductionProblem[]}>((!learningPathId&&!assignmentId&&!timedPracticeId)||(!learningPathId&&problemListOpen)?"problems":""),assignment=useData<Assignment>(assignmentId?`assignments/${encodeURIComponent(assignmentId)}`:"");
  const historyQuery = new URLSearchParams({ identityId: user.identityId, problemId: problem.id, kind: "submit,correction", ...(assignmentId ? { assignmentId } : {}), ...(timedPracticeId ? { timedPracticeId } : {}) });
  const submissions = useData<{ items: Submission[] }>(`submissions?${historyQuery}`), dirty = code !== receivedCode;
  const anyDirty = dirty || supportedLanguages.some(other => { if (other === language) return false; const draft = readDraft(draftKey(user.id, problem.id, problem.versionId ?? "current", context, other)); return draft?.code !== draft?.receivedCode && Boolean(draft?.code.trim()); });
  useNavigationBlocker(anyDirty);
  const pending = action.busy || Boolean(submissionId && !polling.result && !polling.error) || Boolean(polling.result && isPending(polling.result.status));
  const unavailable = Boolean(timedPracticeId && !timedSession.active);
  useEffect(() => { setDraftSaved(saveDraft(storageKey, { code, receivedCode, updatedAt: new Date().toISOString() })); }, [storageKey, code, receivedCode]);
  useEffect(() => {
    const selected = readDraftLanguage(user.id, problem.id, problem.versionId ?? "current", context);
    if (!selected || selected === language) return;
    const draft = readDraft(draftKey(user.id, problem.id, problem.versionId ?? "current", context, selected));
    const starter = original && selected === initialLanguage ? original.code : starterFor(problem, selected);
    setLanguage(selected); setCode(draft?.code ?? starter); setReceivedCode(draft?.receivedCode ?? starter);
  }, [user.id, problem, context, language, original, initialLanguage]);
  useEffect(() => { if (!anyDirty) return; const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [anyDirty]);
  function changeLanguage(next: SubmissionLanguage) {
    if (next === language || pending || formatting) return;
    saveDraft(storageKey, { code, receivedCode, updatedAt: new Date().toISOString() });
    saveDraftLanguage(user.id, problem.id, problem.versionId ?? "current", context, next);
    const nextDraft = readDraft(draftKey(user.id, problem.id, problem.versionId ?? "current", context, next));
    const starter = original && next === initialLanguage ? original.code : starterFor(problem, next);
    setLanguage(next); setCode(nextDraft?.code ?? starter); setReceivedCode(nextDraft?.receivedCode ?? starter);
    setSubmissionId(null); setResultTab("Samples");
  }
  async function run(kind: Submission["kind"]) {
    if (executionLock.current || pending || unavailable || !code.trim()) return;
    executionLock.current = true;
    dispatch({ type: "show", panel: "testing" });
    setResultTab(kind === "custom" ? "Custom Input" : "Result");
    try { await action.run(async () => {
      if (kind === "custom" && problem.mode === "function") {
        validateFunctionInput(customInput);
      }
      const body = { problemId: problem.id, versionId: problem.versionId, code, language, kind, ...(assignmentId ? { assignmentId } : {}), ...(timedPracticeId ? { timedPracticeId } : {}), ...(kind === "correction" && originalId ? { originalSubmissionId: originalId } : {}), ...(kind === "custom" ? { customInput } : {}) };
      const signature = JSON.stringify(body), key = keys.current.get(signature) ?? productionId(); keys.current.set(signature, key);
      const accepted = await productionApi<Submission>("submissions", { method: "POST", body: { ...body, idempotencyKey: key } });
      keys.current.delete(signature);
      setSubmissionId(accepted.id); if (["submit", "correction"].includes(kind)) setReceivedCode(code);
      setResultTab(kind === "custom" ? "Custom Input" : "Result"); submissions.reload();
      action.success(["submit", "correction"].includes(kind) ? `已接收 ${accepted.id}，等待真实评测。` : "自测已接收，不计入正式成绩。");
    }); } finally { executionLock.current = false; }
  }
  const formatEditor=useCallback(async()=>{
    if(formatting)return;setFormatting(true);
    try{const formatted=await formatCode(code,language,settings.tabSize);editorRef.current?.replaceCode(formatted);setLayoutMessage("代码已格式化，可使用撤销恢复原代码。");}
    catch(error){setLayoutMessage("格式化失败，代码已保留："+(error instanceof Error?error.message:String(error)));}
    finally{setFormatting(false);}
  },[code,language,settings.tabSize,formatting,setFormatting,setLayoutMessage]);
  const toggleFullscreen = useCallback(async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await rootRef.current?.requestFullscreen(); }
    catch { setLayoutMessage("当前浏览器不允许全屏，请使用面板最大化。"); }
  }, [setLayoutMessage]);
  const runRef = useRef(run);
  const leaveRef=useRef<()=>void>(()=>{});
  useEffect(()=>{leaveRef.current=()=>navigateWorkspace("/student/problems");});
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (settingsOpen || confirm || layoutOpen) return;
      if(event.defaultPrevented||event.isComposing)return;
      const key=event.code.startsWith("Key")?event.code.slice(3).toLowerCase():event.key.toLowerCase();
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&(["+","=","Add"].includes(event.key)||event.code==="Equal"||event.code==="NumpadAdd")){event.preventDefault();dispatch({type:"toggle-maximize",panel:activePanel});return;}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==="f"){event.preventDefault();void toggleFullscreen();return;}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==="w"){event.preventDefault();leaveRef.current();return;}
      if (event.key === "Escape") { dispatch({ type: "exit-maximize" }); return; }
      if ((event.metaKey || event.ctrlKey) && key === "s") { event.preventDefault(); saveDraft(storageKey, { code, receivedCode, updatedAt: new Date().toISOString() }); setLayoutMessage("草稿已保存到当前浏览器会话"); return; }
      if (event.altKey && event.shiftKey && key === "p") { event.preventDefault(); dispatch({ type: "toggle-maximize", panel: "editor" }); return; }
      if (event.altKey && event.shiftKey && key === "m") { event.preventDefault(); void toggleFullscreen(); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || pending || unavailable || !code.trim()) return;
      if (settings.runShortcut && event.key === "'" && problem.samples.length) { event.preventDefault(); void runRef.current("samples"); }
      if (settings.submitShortcut && event.key === "Enter") { event.preventDefault(); void runRef.current(originalId ? "correction" : "submit"); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [activePanel, settingsOpen, formatEditor, confirm, layoutOpen, dispatch, toggleFullscreen, settings.runShortcut, settings.submitShortcut, pending, unavailable, code, receivedCode, storageKey, originalId, problem.samples.length]);
  function resizeStart(event: PointerEvent<HTMLDivElement>) {
    if (!mainRef.current) return;
    const bounds = mainRef.current.getBoundingClientRect();
    dragRef.current = { width: bounds.width, left: bounds.left, next: settings.panelPercent };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function resizeMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const next = Math.max(25, Math.min(70, Math.round((event.clientX - dragRef.current.left) / dragRef.current.width * 100)));
    dragRef.current.next = next;
    if (settings.liveResize) {
      mainRef.current?.style.setProperty("--workspace-left", `${next}%`);

    } else setPreviewPercent(next);
  }
  function resizeEnd(event: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    update({ panelPercent: dragRef.current.next });
    dragRef.current = null; setPreviewPercent(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const ownSubmissions = submissions.data?.items.filter(s => s.problemId === problem.id && ["submit", "correction"].includes(s.kind)) ?? [];
  const problemWithHints = problem as ProductionProblem & { objective?: string; inputDescription?: string; outputDescription?: string; difficulty?: string; parameters?: (string | {name:string;type:string;description:string})[]; returnType?:string; hints?: string[]; editorial?:string; hintPolicy?:string };
  const signature = language === "python" ? starterFor(problem, "python").match(/^\s*def\s+\w+\(([^)]*)\)/m)?.[0]?.trim() ?? `def ${problem.functionName}(...):` : language === "javascript" ? `function ${problem.functionName ?? "solve"}(...args)` : `json ${problem.functionName ?? "solve"}(json& args, json& kwargs)`;
  function verticalStart(event: PointerEvent<HTMLDivElement>) {
    if (!rightRef.current) return;
    const bounds = rightRef.current.getBoundingClientRect();
    verticalDrag.current = { top: bounds.top, height: bounds.height, next: layout.editorPercent };
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function verticalMove(event: PointerEvent<HTMLDivElement>) {
    if (!verticalDrag.current) return;
    const next = Math.max(20, Math.min(85, Math.round((event.clientY - verticalDrag.current.top) / verticalDrag.current.height * 100)));
    verticalDrag.current.next = next;
    rightRef.current?.style.setProperty("--workspace-editor-height", `${next}%`);
  }
  function verticalEnd(event: PointerEvent<HTMLDivElement>) {
    if (!verticalDrag.current) return;
    dispatch({ type: "resize", percent: verticalDrag.current.next }); verticalDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function panelActions(panel: WorkspacePanel) {
    return <PanelControls panel={panel} collapsed={layout.panels[panel] === "collapsed"} maximized={layout.maximized === panel}
      onCollapse={() => dispatch({ type: "toggle-collapse", panel })} onMaximize={() => dispatch({ type: "toggle-maximize", panel })}/>;
  }
  function restorePanels() { dispatch({ type: "reset" }); reset(); setLayoutMessage("已恢复默认布局"); }
  const navigationItems: NavigationProblem[]=learningPathId?(courseValid?courseChapter?.problems??[]:[]):assignmentId?(assignment.data?.problems??[]):timedPracticeId?(timedSession.data?.problems??[]):(library.data?.items??[]).map(item=>({problemId:item.id,versionId:item.versionId,title:item.title}));
  const navigation=problemNavigation(navigationItems,problem.id);
  const navigationLoading=learningPathId?course.loading:assignmentId?assignment.loading:timedPracticeId?timedSession.loading:library.loading;
  const navigationError=learningPathId?(course.error||(!course.loading&&!courseValid?"当前题目不属于此课程章节":"")):assignmentId?assignment.error:timedPracticeId?timedSession.error:library.error;
  function navigateWorkspace(destination:string){
    saveDraft(storageKey,{code,receivedCode,updatedAt:new Date().toISOString()});
    if(anyDirty){setPendingDestination(destination);setConfirm("leave");}else router.push(destination);
  }
  function switchProblem(target:NavigationProblem|null){if(!target||navigationLoading||navigationError||pending)return;navigateWorkspace(navigationHref(target,{assignmentId,timedPracticeId,returnTo,sourceLabel,learningPathId,chapterId}));}
  function randomProblem(){if(!navigation.random.length)return;switchProblem(navigation.random[Math.floor(Math.random()*navigation.random.length)]);}
  const sample = problem.samples[selectedSample] ?? problem.samples[0];
  const mainClass = [styles.main, layout.panels.statement === "hidden" ? styles.leftHidden : layout.panels.statement === "collapsed" ? styles.leftCollapsed : "", layout.panels.editor === "hidden" && layout.panels.testing === "hidden" ? styles.onlyStatement : "", layout.maximized ? styles.maximized : "", layout.maximized === "statement" ? styles.statementMax : ""].join(" ");
  const rightClass = [styles.right, layout.panels.editor === "hidden" ? styles.editorHidden : layout.panels.editor === "collapsed" ? styles.editorCollapsed : "", layout.panels.testing === "hidden" ? styles.testingHidden : layout.panels.testing === "collapsed" ? styles.testingCollapsed : ""].join(" ");
  const panelClass = (panel: WorkspacePanel) => [styles.panel, styles[panel], layout.panels[panel] === "collapsed" ? styles.collapsed : "", layout.maximized === panel ? styles.maxPanel : ""].join(" ");
  const runButtons = <><Button size="sm" variant="secondary" disabled={pending || unavailable || !code.trim() || !problem.samples.length} onClick={() => run("samples")} data-od-id="run-code"><Play size={14}/>运行</Button><Button size="sm" className={styles.submit} disabled={pending || unavailable || !code.trim()} onClick={() => run(originalId ? "correction" : "submit")} data-od-id="submit-code"><Send size={14}/>{pending ? "评测中…" : originalId ? "提交订正" : "提交"}</Button></>;
  return <WorkspaceThemeProvider theme={resolvedPageTheme}><div ref={rootRef} style={{colorScheme:resolvedPageTheme}} className={`${styles.root} ${resolvedPageTheme==="dark"?"dark":""}`} data-od-id="production-workspace">
    <header className={`${styles.toolbar} ${timedPracticeId?styles.timedToolbar:""}`} data-od-id="workspace-navigation">
      <div className={styles.brand}>
        <button type="button" onClick={()=>setProblemListOpen(true)} className={`${styles.back} ${styles.problemList}`} title="打开题目列表" aria-label="打开题目列表" aria-haspopup="dialog" aria-expanded={problemListOpen} data-od-id="back-to-problem-list"><List size={18}/><span>{learningPathId?"本章练习":"题目列表"}</span></button>
        <span className={styles.navigationDivider}/>
        <div className={styles.problemNavigation} aria-label="切换题目">
          <button type="button" className={styles.tool} title={navigation.previous?`上一题：${navigation.previous.title??""}`:"没有上一题"} aria-label="上一题" disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.previous} onClick={()=>switchProblem(navigation.previous)} data-od-id="previous-problem"><ChevronLeft size={20}/></button>
          <button type="button" className={styles.tool} title={navigation.next?`下一题：${navigation.next.title??""}`:"没有下一题"} aria-label="下一题" disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.next} onClick={()=>switchProblem(navigation.next)} data-od-id="next-problem"><ChevronRight size={20}/></button>
          <button type="button" className={styles.tool} title="随机选择当前列表中的另一题" aria-label="随机选题" disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.random.length} onClick={randomProblem} data-od-id="random-problem"><Shuffle size={18}/></button>
        </div>
        {returnTo!=="/student/problems"&&<button type="button" className={styles.contextReturn} onClick={()=>navigateWorkspace(returnTo)} title={`返回 ${sourceLabel}`}>返回{learningPathId?"章节":assignmentId?"作业":timedPracticeId?"练习":originalId?"原提交":"来源"}</button>}
      </div>
      {timedPracticeId?<div className="min-w-0 shrink-0" data-od-id="timed-navigation-clock"><TimedClock session={timedSession} compact/></div>:settings.actionPlacement === "toolbar" && <div className={styles.actions}>{runButtons}</div>}
      <div className={styles.tools}>
        {timedPracticeId&&settings.actionPlacement==="toolbar"&&<div className={styles.actions}>{runButtons}</div>}<div className={styles.timer}><WorkspaceTimer settings={settings} settingsReady={settingsReady} userId={user.id} problemKey={`${problem.id}:${problem.versionId ?? "current"}`} acceptedKey={polling.result?.status === "AC" && ["submit", "correction"].includes(polling.result.kind) ? polling.result.id : null}/></div>
        <button type="button" aria-label="布局与面板" title="布局与面板" className={styles.tool} onClick={() => setLayoutOpen(true)} data-od-id="layout-settings"><LayoutPanelLeft size={17}/></button>
        <button type="button" aria-label="工作区设置" title="工作区设置" className={styles.tool} onClick={() => {setSettingsScope("workspace");setSettingsOpen(true);}} data-od-id="workspace-settings"><Settings size={18} strokeWidth={1.7}/></button>
        <button type="button" aria-label="帮助与快捷键" title="帮助与快捷键" className={styles.tool} onClick={() => setConfirm("help")}><HelpCircle size={17}/></button>
        <NotificationDropdown/>
        <AccountMenu user={user} role="student" busy={action.busy} onLogout={()=>{if(anyDirty&&!window.confirm("代码尚未提交，草稿保留在本机。确认退出登录？"))return;void action.run(async()=>{try{await productionApi("auth/logout",{method:"POST"});}catch(e){if(!(e instanceof ApiError&&e.status===401))throw e;}clearProductionSession();router.replace("/login");});}}/>
      </div>
    </header>
    {learningPathId&&courseValid&&<div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2" data-od-id="course-practice-context"><span className="text-xs">{course.data?.title} › 第 {(courseChapter?.position??0)+1} 章 · {courseChapter?.title}</span>{((polling.result?.status==="AC"&&polling.result.kind==="submit"&&polling.result.versionId===problem.versionId)||courseChapter?.problems.find(p=>p.problemId===problem.id)?.completed)&&<><span className="text-sm text-success">本题已完成</span>{navigation.next&&<Button size="sm" onClick={()=>switchProblem(navigation.next)}>下一题</Button>}</>}<Button size="sm" variant="secondary" onClick={()=>navigateWorkspace(returnTo)}>返回章节</Button></div>}
    <nav className={styles.mobileTabs} aria-label="答题分区">{panelIds.map(panel => <button key={panel} type="button" aria-pressed={layout.mobilePanel === panel} onClick={() => dispatch({ type: "mobile", panel })} data-od-id={`mobile-${panel}`}>{panel === "statement" ? "题目" : panel === "editor" ? "代码" : "测试"}</button>)}</nav>
    <main ref={mainRef} className={mainClass} data-mobile={layout.mobilePanel} style={{ "--workspace-left": `${settings.panelPercent}%` } as CSSProperties}>
      <section className={panelClass("statement")} data-od-id="statement-panel" onMouseEnter={()=>setActivePanel("statement")} onFocusCapture={()=>setActivePanel("statement")}>
        <header className={styles.panelHeader}><div className={styles.tabs} role="tablist" aria-label="题目内容">{[{value:"Problem",label:"题目描述",icon:FileText},{value:"Hints",label:"提示",icon:HelpCircle},{value:"My submissions",label:"提交记录",icon:History}].map(({value,label,icon:Icon}) => <button key={value} type="button" className={styles.tab} role="tab" aria-selected={leftTab === value} onClick={() => setLeftTab(value)}><Icon size={15}/>{label}</button>)}</div>{panelActions("statement")}</header>
        <div className={styles.panelBody} role="tabpanel">
{leftTab === "Problem" ? <article className="max-w-2xl text-base leading-7"><ProblemHeading title={problem.title} difficulty={problem.difficulty} tags={problem.tags}/><div className="mt-5"><LessonContent content={problem.statement}/></div>{problem.mode === "function" && <div className="mt-5 rounded-md border border-border bg-surface-subtle p-4"><strong>返回结果，不要打印。</strong><p className="mt-1 text-sm text-muted-foreground">评测器调用你的函数，无需从标准输入读取数据。</p><code className="mt-2 block font-mono text-sm">{signature}</code>{language === "cpp" && <p className="mt-2 text-xs leading-5 text-muted-foreground">C++ 使用 <code>nlohmann::json</code>；<code>args</code> 是 JSON 参数数组，<code>kwargs</code> 是命名参数对象，返回可序列化的 JSON 值。</p>}{language === "javascript" && <p className="mt-2 text-xs leading-5 text-muted-foreground">JavaScript 按位置展开 JSON <code>args</code>；非空 <code>kwargs</code> 作为最后一个对象参数传入。</p>}</div>}{problemWithHints.objective && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">学习目标</h2><p>{problemWithHints.objective}</p></section>}{problem.mode === "stdio" ? <>{problemWithHints.inputDescription && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">输入</h2><LessonContent content={problemWithHints.inputDescription}/></section>}{problemWithHints.outputDescription && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">输出</h2><LessonContent content={problemWithHints.outputDescription}/></section>}</> : <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">函数接口</h2><code className="rounded bg-muted px-1.5 py-1 font-mono text-sm">{signature}</code><dl className="mt-3 grid grid-cols-[92px_1fr] gap-y-2 text-sm">{problemWithHints.parameters?.map((parameter, index) => <div key={index} className="contents"><dt className="font-semibold">参数</dt><dd>{typeof parameter === "string" ? parameter : `${parameter.name} — ${parameter.type}${parameter.description ? ` · ${parameter.description}` : ""}`}</dd></div>)}{problemWithHints.returnType && <><dt className="font-semibold">返回值</dt><dd>{problemWithHints.returnType}</dd></>}</dl></section>}<p className="mt-5 text-xs text-muted-foreground">{problem.timeLimitMs} ms / test · {language === "javascript" ? `JavaScript 沙箱 ${problem.languageLimits?.javascript?.effectiveMemoryMb ?? Math.max(problem.memoryLimitMb, 128)} MB（Node.js 运行时最低 ${problem.languageLimits?.javascript?.runtimeMemoryFloorMb ?? 128} MB；题目设定 ${problem.memoryLimitMb} MB）` : `${problem.memoryLimitMb} MB`}</p><section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">示例</h2>{problem.samples.map((sample, index) => <div key={index} className="mb-3 border border-border"><div className="bg-surface-subtle px-3 py-2 text-xs font-semibold text-muted-foreground">示例 {index + 1}</div><div className="grid grid-cols-2 divide-x divide-border"><div className="min-w-0 p-3"><span className="text-xs text-muted-foreground">输入</span><pre className="mt-1 overflow-auto font-mono text-sm">{sample.input.replace(/(?:\r?\n)+$/, "")}</pre></div><div className="min-w-0 p-3"><span className="text-xs text-muted-foreground">返回值 / 输出</span><pre className="mt-1 overflow-auto font-mono text-sm">{sample.expected.replace(/(?:\r?\n)+$/, "")}</pre></div></div></div>)}</section></article> : leftTab === "Hints" ? <section><h2 className="text-lg font-bold">渐进式提示</h2>{problemWithHints.hints?.length ? problemWithHints.hints.map((hint, index) => <details key={index} className="mt-3 border border-border p-4"><summary className="cursor-pointer font-semibold">提示 {index + 1}</summary><p className="mt-3 text-sm text-muted-foreground">{hint}</p></details>) : <p className="mt-4 text-sm leading-6 text-muted-foreground">此题尚未提供单独提示。请先阅读题面、接口说明和公开样例；隐藏测试数据不对学生开放。</p>}{problemWithHints.editorial && <details className="mt-5 border border-border p-4"><summary className="cursor-pointer font-semibold">讲解 / 解法</summary><div className="mt-3"><LessonContent content={problemWithHints.editorial}/></div></details>}</section> : <section><h2 className="text-lg font-bold">我的提交</h2><State data={submissions}>{ownSubmissions.map(s => <AppLink key={s.id} href={`/student/submissions/${s.id}`} target={settings.openResultsNewTab ? "_blank" : undefined} rel={settings.openResultsNewTab ? "noopener noreferrer" : undefined} className="mt-4 grid grid-cols-[1fr_auto] border border-border p-4"><div><div className="font-mono text-xs text-primary">{s.id}</div><p className="mt-1 text-sm">{date(s.createdAt)} · {languageInfo[submissionLanguage(s.language)].name}</p></div><StatusPill status={s.status}/></AppLink>)}{!ownSubmissions.length && <p className="mt-4 text-sm text-muted-foreground">暂无正式提交。</p>}</State><p className="mt-3 text-xs text-muted-foreground">公开样例自测不属于正式提交。</p></section>}
        </div>
      </section>
      <div role="separator" aria-label="调整题目与代码区域宽度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={70} aria-valuenow={settings.panelPercent} tabIndex={0} onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); update({ panelPercent: settings.panelPercent + (event.key === "ArrowLeft" ? -2 : 2) }); } }} className={styles.separator} data-od-id="workspace-width-resizer"/>
      {previewPercent != null && <div aria-hidden style={{ position:"absolute",left:`${previewPercent}%`,top:54,bottom:34,width:2,background:"var(--primary)",pointerEvents:"none",zIndex:20 }}/>}
      <div ref={rightRef} className={rightClass} style={{ "--workspace-editor-height": `${layout.editorPercent}%` } as CSSProperties}>
        <section className={panelClass("editor")} data-od-id="editor-panel" onMouseEnter={()=>setActivePanel("editor")} onFocusCapture={()=>setActivePanel("editor")}>
          <header className={styles.panelHeader}><span className={styles.panelTitle}><Code2 size={16} className="text-muted-foreground"/>代码</span>{panelActions("editor")}</header>
          <div className={styles.editorToolbar}><div className="flex min-w-0 items-center gap-3"><select id="workspace-language" aria-label="编程语言" value={language} disabled={pending||formatting} onChange={event => changeLanguage(event.target.value as SubmissionLanguage)} data-od-id="programming-language">{supportedLanguages.map(value => <option key={value} value={value}>{languageInfo[value].name}</option>)}</select><span title={languageInfo[language].runtime} className="hidden font-mono text-muted-foreground sm:inline">{languageInfo[language].file}</span></div><div className={styles.tools}>
            <button type="button" className={styles.tool} title="下载编辑器中的代码" aria-label="下载编辑器中的代码" onClick={()=>downloadCode(code,languageInfo[language].file)} data-od-id="download-code"><Download size={14}/></button>
            <button type="button" className={styles.tool} title={`代码格式化 · ${displayBinding(settings.editorKeymap.format)}`} aria-label="代码格式化" disabled={formatting||!code.trim()} onClick={()=>void formatEditor()} data-od-id="format-code"><FormatCodeIcon/></button>
            <button type="button" className={styles.tool} title="重置代码" aria-label="重置代码" disabled={pending||formatting} onClick={() => setConfirm("reset")}><RotateCcw size={14}/></button>
            <EditorShortcutsHint bindings={settings.editorKeymap}/>
            <button type="button" className={styles.tool} title="代码编辑器设置" aria-label="代码编辑器设置" onClick={()=>{setSettingsScope("editor");setSettingsOpen(true);}} data-od-id="code-editor-settings"><Settings size={16} strokeWidth={1.7}/></button>
            <button type="button" className={styles.tool} title="最大化代码区" aria-label="最大化代码区" onClick={() => dispatch({ type: "toggle-maximize", panel: "editor" })}><Maximize2 size={14}/></button>
          </div></div>
          <div className={styles.editorBody}><CodeEditor editorRef={editorRef} readOnly={formatting} code={code} onChange={setCode} language={language} settings={settings} onFormat={()=>void formatEditor()} status={draftSaved?"草稿已保存（本机）":"草稿未保存"} actions={settings.actionPlacement==="editor"?runButtons:undefined}/></div>

        </section>
        <div role="separator" aria-label="调整代码与测试区域高度" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={85} aria-valuenow={layout.editorPercent} tabIndex={0} onPointerDown={verticalStart} onPointerMove={verticalMove} onPointerUp={verticalEnd} onPointerCancel={verticalEnd} onLostPointerCapture={verticalEnd} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); dispatch({ type: "resize", percent: layout.editorPercent + (event.key === "ArrowUp" ? -2 : 2) }); } }} className={`${styles.separator} ${styles.horizontal}`} data-od-id="workspace-height-resizer"/>
        <section className={panelClass("testing")} data-od-id="testing-panel" onMouseEnter={()=>setActivePanel("testing")} onFocusCapture={()=>setActivePanel("testing")}>
          <header className={styles.panelHeader}><div className={styles.tabs} role="tablist" aria-label="测试区域">{[{value:"Samples",label:"测试用例"},{value:"Custom Input",label:"自定义输入"},{value:"Result",label:"测试结果"}].map(({value,label}) => <button key={value} type="button" className={styles.tab} role="tab" aria-selected={resultTab === value} onClick={() => setResultTab(value)}>{label}</button>)}</div>{panelActions("testing")}</header>
          <div className={styles.resultBody} role="tabpanel">
            {resultTab === "Samples" ? <div><div className={styles.caseTabs}>{problem.samples.map((_,index) => <button type="button" key={index} className={styles.caseTab} aria-pressed={selectedSample === index} onClick={() => setSelectedSample(index)} data-od-id={`sample-${index+1}`}>用例 {index+1}</button>)}<button type="button" className={styles.caseTab} title="添加自定义输入" onClick={() => setResultTab("Custom Input")}>＋ 自定义</button></div>{sample ? <><span className={styles.sampleLabel}>输入</span><pre className={styles.sampleValue}>{sample.input.replace(/(?:\r?\n)+$/, "")}</pre><span className={styles.sampleLabel}>预期输出</span><pre className={styles.sampleValue}>{sample.expected.replace(/(?:\r?\n)+$/, "")}</pre></> : <p className="text-sm text-muted-foreground">此题暂无公开样例，可使用自定义输入。</p>}</div> : resultTab === "Custom Input" ? <div><label className={styles.sampleLabel} htmlFor="workspace-custom-input">{problem.mode === "function" ? "函数参数（JSON 数组或 args/kwargs 对象）" : "标准输入"}</label><textarea id="workspace-custom-input" value={customInput} onChange={event => setCustomInput(event.target.value)} maxLength={65536} rows={4} className={`${textarea} font-mono`} placeholder={problem.mode === "function" ? '{"args":[1,2],"kwargs":{"step":3}}' : "3 8"} data-od-id="custom-test-input"/>{problem.mode === "function" && <p className="mt-1 text-xs text-muted-foreground">例如 [1,2]；命名参数可用 args/kwargs 对象，kwargs 可省略。</p>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">自定义输入只运行程序，不判断正确性。</p><Button size="sm" variant="secondary" disabled={pending || unavailable || !code.trim() || !customInput.trim()} onClick={() => run("custom")} data-od-id="run-custom-code">运行自定义输入</Button></div>{polling.result?.kind === "custom" && <div className="mt-4"><ResultPanel {...polling}/></div>}</div> : <ResultPanel {...polling}/>}<Feedback action={action}/>{submissionId && <AppLink href={`/student/submissions/${submissionId}`} target={settings.openResultsNewTab ? "_blank" : undefined} rel={settings.openResultsNewTab ? "noopener noreferrer" : undefined} className="mt-3 inline-block break-all text-xs font-semibold text-primary">查看提交 {submissionId}</AppLink>}
          </div>

        </section>
      </div>
    </main>

    <footer className={styles.footer}><div className={styles.tray}>{panelIds.filter(panel => layout.panels[panel] !== "open").map(panel => <button type="button" key={panel} className={styles.restore} onClick={() => dispatch({ type:"show",panel })} data-od-id={`restore-${panel}`}>{panelNames[panel]} · {layout.panels[panel] === "hidden" ? "显示" : "展开"}</button>)}</div><span className={styles.footerCaption} role="status">{navigationError?`题目列表加载失败：${navigationError}`:layoutMessage || (originalId ? "订正保留原活动成绩" : "公开自测不计入正式成绩")}</span><button type="button" onClick={restorePanels}>恢复默认布局</button></footer>

    <Dialog open={layoutOpen} onOpenChange={setLayoutOpen}><DialogContent className={styles.layoutMenu}><DialogTitle>布局与面板</DialogTitle><DialogDescription>分别显示、折叠或最大化各操作区域。</DialogDescription>{panelIds.map(panel => <button key={panel} type="button" onClick={() => dispatch({ type:"show",panel })}>{panelNames[panel]}<span className="text-xs text-muted-foreground">{layout.panels[panel] === "open" ? "已显示" : "恢复显示"}</span></button>)}<button type="button" onClick={() => { restorePanels();setLayoutOpen(false); }}>恢复默认布局<RotateCcw size={15}/></button><button type="button" onClick={() => { void toggleFullscreen();setLayoutOpen(false); }}>浏览器全屏<Maximize2 size={15}/></button></DialogContent></Dialog>
    <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent><DialogTitle>{confirm === "leave" ? "离开答题页面？" : confirm === "reset" ? "重置初始代码？" : "答题帮助"}</DialogTitle><DialogDescription>{confirm === "leave" ? "草稿保留在当前浏览器会话中，但尚未正式提交，离开不会自动交卷。" : confirm === "reset" ? "当前草稿将替换为题目初始代码；服务器已接收的提交仍保留。" : "运行仅测试公开样例；自定义输入只运行程序，不判断正确性；提交才创建正式记录。Ctrl / ⌘ + 单引号运行样例，Ctrl / ⌘ + Enter 正式提交，Ctrl / ⌘ + S 保存草稿，Esc 退出面板最大化。"}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setConfirm(null)}>{confirm === "leave" ? "继续编辑" : "关闭"}</Button>{confirm === "leave" && <Button variant="danger" onClick={() => { const destination=pendingDestination??returnTo;setConfirm(null);router.push(destination); }}>离开，不提交</Button>}{confirm === "reset" && <Button onClick={() => { setCode(starterFor(problem,language));setConfirm(null); }}>重置代码</Button>}</DialogFooter></DialogContent></Dialog>

    <ProblemListDrawer open={problemListOpen} onOpenChange={setProblemListOpen} title={learningPathId?"本章练习":"题目列表"} description={learningPathId?`${course.data?.title??"课程"} › ${courseChapter?.title??"加载章节…"}`:undefined} items={learningPathId?navigationItems.map(p=>({id:p.problemId,title:p.title??"练习"})):library.data?.items??[]} currentId={problem.id} loading={learningPathId?navigationLoading:library.loading} error={learningPathId?navigationError:library.error} onRetry={learningPathId?course.reload:library.reload} onSelect={target=>{setProblemListOpen(false);if(target.id!==problem.id){if(learningPathId)switchProblem(navigationItems.find(p=>p.problemId===target.id)??null);else navigateWorkspace(`/student/problems/${encodeURIComponent(target.id)}`);}}}/>

    <WorkspaceSettingsDialog key={settingsScope} editorOnly={settingsScope==="editor"} initialSection={settingsScope==="editor"?"editor":"appearance"} open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} update={update} reset={reset}/>
  </div></WorkspaceThemeProvider>;
}

"use client";
import { OnlineStudents } from "@/components/student/student-presence";
import { ScholarshipAssistance } from "@/components/scholarship/assistance";
import { ScholarshipBalance } from "@/components/scholarship/account-pages";
import { StudentScholarshipRule } from "@/components/scholarship/teaching-page";
import type {LearningPath} from "./learning";

import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Shuffle, List, House, Code2, BookOpen, FileText, HelpCircle, History, Languages, LayoutPanelLeft, Lightbulb, Maximize2, Play, RotateCcw, Send, Settings, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ProblemSubmissionsTable, SolvedStatus, useProblemSubmissions } from "./problem-submissions";
import { CopyCodeButton } from "./copy-code-button";
import { isPending, productionApi, productionId, type Assignment, type CampusUser, type ProductionProblem, type Submission, type SubmissionLanguage } from "@/lib/production-api";
import { MAX_CUSTOM_INPUT_LENGTH } from "./result-feedback";
import { Feedback, LessonContent, ResultPanel, State, textarea, useData, useMutation, useSubmission, type DetailedSubmission } from "./shared";
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
import {ProblemTutorial, useProblemTutorial, type ProblemTutorialContent} from "./problem-tutorial";
import { AssignmentCompletionDialog, useAssignmentCelebrations } from "./assignment-completion";
import {problemNavigation,navigationHref,type NavigationProblem} from "./problem-navigation";
import { validateFunctionInput } from "@/lib/function-input";

export function StudentWorkspace({ id, user }: { id: string; user: CampusUser }) {
  const { locale } = useLocale();
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
  if (originalId && original.loading) return <div className="p-5"><State data={original}>{locale === "en" ? "Loading original submission…" : "正在加载原提交…"}</State></div>;
  if (originalId && original.data?.problemId !== id) return <div role="alert" className="p-5 text-sm text-destructive">{original.error || (locale === "en" ? "The correction problem does not match the original submission." : "订正题目与原提交不匹配。")}</div>;
  return <State data={problem}>{problem.data && <ProblemWorkspace key={`${user.id}:${problem.data.id}:${problem.data.versionId}:${context}`} problem={problem.data} user={user} original={original.data}/>}</State>;
}
function safeReturn(value: string | null) { return value?.startsWith("/student/") && !value.startsWith("//") ? value : null; }
/** Transport and navigation adapters share the full workspace UI, never its access rights. */
export type ProblemWorkspaceAdapter = {
  context: string;
  returnTo: string;
  returnLabel: string;
  homeHref: string;
  navigation: { items: NavigationProblem[]; loading: boolean; error: string; reload: () => void; href: (problem: NavigationProblem) => string; title: string; description?: string };
  chapter?: { courseTitle: string; title: string; position: number; completed: boolean };
  tutorial?: ProblemTutorialContent;
  submissionsPath: string;
  submit: (input: { kind: Submission["kind"]; code: string; language: SubmissionLanguage; customInput: string; requestId: string }) => Promise<{id: string}>;
  submissionPath: (id: string) => string;
  normalizeSubmission: (result: DetailedSubmission) => DetailedSubmission;
  readDraft: (language: SubmissionLanguage) => ReturnType<typeof readDraft>;
  saveDraft: (language: SubmissionLanguage, draft: NonNullable<ReturnType<typeof readDraft>>) => boolean;
  account: (hasUnsavedChanges: boolean) => ReactNode;
  presence?: ReactNode;
  assistance?: (kind: "FULL_TRANSLATION" | "FULL_SOLUTION") => ReactNode;
};
export function ProblemWorkspace({ problem, user, original = null, adapter }: { problem: ProductionProblem; user: CampusUser; original?: Submission | null; adapter?: ProblemWorkspaceAdapter }) {
  const { locale, t } = useLocale();
  const tx = useCallback((zh: string, en: string) => locale === "en" ? en : zh, [locale]);
  const panelName = (panel: WorkspacePanel) => locale === "en" ? ({ statement: "Problem", editor: "Code editor", testing: "Tests" } as const)[panel] : panelNames[panel];
  const router = useRouter();
  const params = useSearchParams(), assignmentId = original || adapter ? null : params.get("assignmentId"), timedPracticeId = original || adapter ? null : params.get("timedPracticeId"), originalId = original ? original.originalSubmissionId ?? original.id : null;
  const learningPathId=!adapter&&!assignmentId&&!timedPracticeId&&!originalId?params.get("learningPathId"):null,chapterId=params.get("chapterId");
  const tutorialEndpoint = !adapter && problem.versionId ? `problems/${encodeURIComponent(problem.id)}/tutorial?${new URLSearchParams({
    versionId: problem.versionId, ...(learningPathId && chapterId ? { courseId: learningPathId, chapterId } : {}),
  })}` : "";
  const tutorial = useProblemTutorial(tutorialEndpoint, adapter?.tutorial);
  const statementId = useId();
  const course=useData<LearningPath>(learningPathId?`learning-paths/${encodeURIComponent(learningPathId)}`:"");
  const courseChapter=course.data?.chapters?.find(c=>c.id===chapterId);
  const courseValid=!!courseChapter?.problems.some(p=>p.problemId===problem.id&&p.versionId===problem.versionId);
  const returnTo = adapter?.returnTo ?? (learningPathId&&chapterId?`/student/learning-paths/${encodeURIComponent(learningPathId)}/chapters/${encodeURIComponent(chapterId)}`:safeReturn(params.get("returnTo"))) ?? (timedPracticeId ? `/student/timed-practice/${timedPracticeId}` : assignmentId ? `/student/assignments/${assignmentId}` : originalId ? `/student/submissions/${originalId}` : "/student/problems");
  const sourceLabel = params.get("sourceLabel") ?? (timedPracticeId ? tx("限时训练", "Timed Practice") : assignmentId ? tx("作业", "Assignment") : originalId ? tx("订正本", "Review Notebook") : tx("题目", "Problems"));
  const sourceDisplay = sourceLabel === "Assignment" ? tx("作业", "Assignment") : t(sourceLabel);
  const context = adapter?.context ?? workspaceDraftContext({ originalSubmissionId: originalId, timedPracticeId, assignmentId, learningPathId, chapterId });
  const initialLanguage = submissionLanguage(original?.language);
  const [language, setLanguage] = useState<SubmissionLanguage>(initialLanguage);
  const storageKey = draftKey(user.id, problem.id, problem.versionId ?? "current", context, language);
  const readWorkspaceDraft = useCallback((selected: SubmissionLanguage) => adapter ? adapter.readDraft(selected) : readDraft(draftKey(user.id, problem.id, problem.versionId ?? "current", context, selected)), [adapter, user.id, problem.id, problem.versionId, context]);
  const saveWorkspaceDraft = useCallback((selected: SubmissionLanguage, draft: NonNullable<ReturnType<typeof readDraft>>) => adapter ? adapter.saveDraft(selected, draft) : saveDraft(draftKey(user.id, problem.id, problem.versionId ?? "current", context, selected), draft), [adapter, user.id, problem.id, problem.versionId, context]);
  const initialDraft = readWorkspaceDraft(language), initialCode = original?.code ?? starterFor(problem, language);
  const [code, setCode] = useState(initialDraft?.code ?? initialCode), [receivedCode, setReceivedCode] = useState(initialDraft?.receivedCode ?? initialCode), [leftTab, setLeftTab] = useState("Problem"), [resultTab, setResultTab] = useState("Samples"), [customInput, setCustomInput] = useState(""), [submissionId, setSubmissionId] = useState<string | null>(null), [confirm, setConfirm] = useState<"leave" | "reset" | "help" | null>(null), [settingsOpen, setSettingsOpen] = useState(false),[settingsScope,setSettingsScope]=useState<"workspace"|"editor">("workspace"),[formatting,setFormatting]=useState(false), [previewPercent, setPreviewPercent] = useState<number | null>(null), [layoutOpen, setLayoutOpen] = useState(false), [layoutMessage, setLayoutMessage] = useState(""), [selectedSample, setSelectedSample] = useState(0), [pendingDestination,setPendingDestination] = useState<string|null>(null);
  const editorRef=useRef<CodeEditorHandle>(null);
  const customInputRef = useRef<HTMLTextAreaElement>(null);
  const [activePanel,setActivePanel]=useState<WorkspacePanel>("editor");
  const { settings, update, reset, loaded: settingsReady, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const { layout, dispatch } = useWorkspaceLayout(user.id);
  const rightRef = useRef<HTMLDivElement>(null), verticalDrag = useRef<{top:number;height:number;next:number}|null>(null), executionLock = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null), mainRef = useRef<HTMLElement>(null), dragRef = useRef<{ width: number; left: number; next: number } | null>(null);
  const [draftSaved,setDraftSaved]=useState(false);
  const action = useMutation(), polling = useSubmission(submissionId, adapter && submissionId ? adapter.submissionPath(submissionId) : undefined, adapter?.normalizeSubmission), keys = useRef(new Map<string, string>()), timedSession = useStudentTimedSession(timedPracticeId);
  const [problemListOpen,setProblemListOpen]=useState(false);
  const formalResult = polling.result;
  const finishingSubmissionId = !adapter && !timedPracticeId && formalResult?.id === submissionId
    && formalResult.kind === "submit" && formalResult.status === "AC" ? formalResult.id : null;
  const celebrations = useAssignmentCelebrations(user.id, finishingSubmissionId);
  const celebration = !settingsOpen && !confirm && !layoutOpen && !problemListOpen ? celebrations.current : undefined;
  const library=useData<{items:ProductionProblem[]}>(!adapter&&!learningPathId&&!assignmentId&&!timedPracticeId?"problems":""),assignment=useData<Assignment>(assignmentId?`assignments/${encodeURIComponent(assignmentId)}`:"");
  const assignmentProblem = assignment.data?.problems.find(p => p.problemId === problem.id && p.versionId === problem.versionId);
  const assignmentValid = Boolean(assignmentProblem);
  const problemReward = assignmentProblem?.rewardPoints ?? 0;
  const assignmentGrade=assignment.data?.grades?.find(grade=>grade.identityId===user.identityId)?.problems.find(p=>p.problemId===problem.id);
  const refreshedSubmission=useRef<string|null>(null);
  const submissionContextQuery = new URLSearchParams({ ...(problem.versionId ? { versionId: problem.versionId } : {}), ...(assignmentId ? { assignmentId } : {}), ...(timedPracticeId ? { timedPracticeId } : {}) });
  const submissions = useProblemSubmissions(adapter?.submissionsPath ?? `problems/${encodeURIComponent(problem.id)}/submissions?${submissionContextQuery}`, `${submissionId ?? ""}:${polling.result?.status ?? ""}`), dirty = code !== receivedCode;
  const reloadAssignment=assignment.reload,reloadSubmissions=submissions.reload;
  useEffect(()=>{
    const result=polling.result;
    if(!assignmentId||!result||result.id!==submissionId||result.kind!=="submit"||isPending(result.status))return;
    const key=`${result.id}:${result.status}`;
    if(refreshedSubmission.current===key)return;
    refreshedSubmission.current=key;
    reloadAssignment();reloadSubmissions();
  },[assignmentId,submissionId,polling.result,reloadAssignment,reloadSubmissions]);
  const anyDirty = dirty || supportedLanguages.some(other => { if (other === language) return false; const draft = readWorkspaceDraft(other); return draft?.code !== draft?.receivedCode && Boolean(draft?.code.trim()); });
  useNavigationBlocker(anyDirty);
  const pending = action.busy || Boolean(submissionId && !polling.result && !polling.error) || Boolean(polling.result && isPending(polling.result.status));
  const unavailable = Boolean(timedPracticeId && !timedSession.active);
  useEffect(() => { setDraftSaved(saveWorkspaceDraft(language, { code, receivedCode, updatedAt: new Date().toISOString() })); }, [language, code, receivedCode, saveWorkspaceDraft]);
  useEffect(() => { if (!layoutMessage) return; const timeout = window.setTimeout(() => setLayoutMessage(""), 4000); return () => window.clearTimeout(timeout); }, [layoutMessage]);
  useEffect(() => {
    const selected = readDraftLanguage(user.id, problem.id, problem.versionId ?? "current", context);
    if (!selected || selected === language) return;
    const draft = readWorkspaceDraft(selected);
    const starter = original && selected === initialLanguage ? original.code : starterFor(problem, selected);
    setLanguage(selected); setCode(draft?.code ?? starter); setReceivedCode(draft?.receivedCode ?? starter);
  }, [user.id, problem, context, language, original, initialLanguage, readWorkspaceDraft]);
  useEffect(() => { if (!anyDirty) return; const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [anyDirty]);
  function changeLanguage(next: SubmissionLanguage) {
    if (next === language || pending || formatting) return;
    saveWorkspaceDraft(language, { code, receivedCode, updatedAt: new Date().toISOString() });
    saveDraftLanguage(user.id, problem.id, problem.versionId ?? "current", context, next);
    const nextDraft = readWorkspaceDraft(next);
    const starter = original && next === initialLanguage ? original.code : starterFor(problem, next);
    setLanguage(next); setCode(nextDraft?.code ?? starter); setReceivedCode(nextDraft?.receivedCode ?? starter);
    setSubmissionId(null); setResultTab("Samples");
  }
  function useCaseAsInput(input: string) {
    setCustomInput(input);
    setResultTab("Custom Input");
    dispatch({ type: "show", panel: "testing" });
    requestAnimationFrame(() => customInputRef.current?.focus());
  }
  async function run(kind: Submission["kind"]) {
    if (executionLock.current || pending || unavailable || !code.trim()) return;
    executionLock.current = true;
    dispatch({ type: "show", panel: "testing" });
    setResultTab("Result");
    try { await action.run(async () => {
      if (kind === "custom" && problem.mode === "function") {
        validateFunctionInput(customInput);
      }
      setSubmissionId(null);
      const body = { problemId: problem.id, versionId: problem.versionId, code, language, kind, ...(assignmentId ? { assignmentId } : {}), ...(timedPracticeId ? { timedPracticeId } : {}), ...(kind === "correction" && originalId ? { originalSubmissionId: originalId } : {}), ...(kind === "custom" ? { customInput } : {}) };
      const signature = JSON.stringify(body), key = keys.current.get(signature) ?? productionId(); keys.current.set(signature, key);
      let accepted: {id: string};
      try {
        accepted = adapter ? await adapter.submit({kind, code, language, customInput, requestId: key}) : await productionApi<Submission>("submissions", { method: "POST", body: { ...body, idempotencyKey: key } });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.code === "SUBMISSION_ALREADY_ACCEPTED") {
          keys.current.delete(signature);
          setReceivedCode(code);
          assignment.reload();
          action.success(tx("相同代码已通过，本次未计入提交次数。", "This code already passed. No new attempt was counted."));
          return;
        }
        if (error.code === "SUBMISSION_ALREADY_PENDING") {
          keys.current.delete(signature);
          action.success(tx("相同代码已在判题，请等待结果。", "This code is already being judged. Wait for the result."));
          return;
        }
        throw error;
      }
      keys.current.delete(signature);
      setSubmissionId(accepted.id); if (["submit", "correction"].includes(kind)) setReceivedCode(code);
      setResultTab("Result"); submissions.reload();
      action.success(["submit", "correction"].includes(kind) ? (locale === "en" ? `Submission ${accepted.id} received; waiting for judging.` : `已接收 ${accepted.id}，等待真实评测。`) : tx("自测已接收，不计入正式成绩。", "Test run received; it does not count toward your grade."));
    }); } finally { executionLock.current = false; }
  }
  const formatEditor=useCallback(async()=>{
    if(formatting)return;setFormatting(true);
    try{const formatted=await formatCode(code,language,settings.tabSize);editorRef.current?.replaceCode(formatted);setLayoutMessage(tx("代码已格式化，可使用撤销恢复原代码。", "Code formatted. Use Undo to restore the previous version."));}
    catch(error){setLayoutMessage(tx("格式化失败，代码已保留：", "Formatting failed; your code is unchanged: ")+(error instanceof Error?error.message:String(error)));}
    finally{setFormatting(false);}
  },[code,language,settings.tabSize,formatting,setFormatting,setLayoutMessage,tx]);
  const toggleFullscreen = useCallback(async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await rootRef.current?.requestFullscreen(); }
    catch { setLayoutMessage(tx("当前浏览器不允许全屏，请使用面板最大化。", "Full screen is unavailable in this browser. Maximize a panel instead.")); }
  }, [setLayoutMessage,tx]);
  const runRef = useRef(run);
  const leaveRef=useRef<()=>void>(()=>{});
  useEffect(()=>{leaveRef.current=()=>navigateWorkspace(adapter?.returnTo ?? "/student/problems");});
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (settingsOpen || confirm || layoutOpen || celebration) return;
      if(event.defaultPrevented||event.isComposing)return;
      const key=event.code.startsWith("Key")?event.code.slice(3).toLowerCase():event.key.toLowerCase();
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&(["+","=","Add"].includes(event.key)||event.code==="Equal"||event.code==="NumpadAdd")){event.preventDefault();dispatch({type:"toggle-maximize",panel:activePanel});return;}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==="f"){event.preventDefault();void toggleFullscreen();return;}
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==="w"){event.preventDefault();leaveRef.current();return;}
      if (event.key === "Escape") { dispatch({ type: "exit-maximize" }); return; }
      if ((event.metaKey || event.ctrlKey) && key === "s") { event.preventDefault(); saveWorkspaceDraft(language, { code, receivedCode, updatedAt: new Date().toISOString() }); setLayoutMessage(tx("草稿已保存到当前浏览器会话", "Draft saved in this browser session.")); return; }
      if (event.altKey && event.shiftKey && key === "p") { event.preventDefault(); dispatch({ type: "toggle-maximize", panel: "editor" }); return; }
      if (event.altKey && event.shiftKey && key === "m") { event.preventDefault(); void toggleFullscreen(); return; }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || pending || unavailable || !code.trim()) return;
      if (settings.runShortcut && event.key === "'" && problem.samples.length) { event.preventDefault(); void runRef.current("samples"); }
      if (settings.submitShortcut && event.key === "Enter") { event.preventDefault(); void runRef.current(originalId ? "correction" : "submit"); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [activePanel, settingsOpen, formatEditor, confirm, layoutOpen, celebration, dispatch, toggleFullscreen, settings.runShortcut, settings.submitShortcut, pending, unavailable, code, receivedCode, storageKey, originalId, problem.samples.length,tx,language,saveWorkspaceDraft]);
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
  const assistanceTarget = { problemId: problem.id, versionId: problem.versionId ?? "", ...(assignmentId ? { assignmentId } : {}), ...(timedSession.data?.attempt?.id ? { timedAttemptId: timedSession.data.attempt.id } : {}) };
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
  const navigationItems: NavigationProblem[]=adapter?.navigation.items ?? (learningPathId?(courseValid?courseChapter?.problems??[]:[]):assignmentId?(assignmentValid?assignment.data?.problems??[]:[]):timedPracticeId?(timedSession.data?.problems??[]):(library.data?.items??[]).map(item=>({problemId:item.id,versionId:item.versionId,title:item.title})));
  const navigation=problemNavigation(navigationItems,problem.id);
  const navigationLoading=adapter?.navigation.loading ?? (learningPathId?course.loading:assignmentId?assignment.loading:timedPracticeId?timedSession.loading:library.loading);
  const navigationError=adapter?.navigation.error ?? (learningPathId?(course.error||(!course.loading&&!courseValid?tx("当前题目不属于此课程章节","This problem is not part of this course chapter."):"")):assignmentId?(assignment.error||(!assignment.loading&&!assignmentValid?tx("当前题目版本不属于此作业","This problem version is not part of this assignment."):"")):timedPracticeId?timedSession.error:library.error);
  const scopedProblemList=Boolean(adapter||learningPathId||assignmentId||timedPracticeId);
  function navigateWorkspace(destination:string){
    saveWorkspaceDraft(language,{code,receivedCode,updatedAt:new Date().toISOString()});
    if(anyDirty){setPendingDestination(destination);setConfirm("leave");}else router.push(destination);
  }
  function switchProblem(target:NavigationProblem|null){if(!target||navigationLoading||navigationError||pending)return;navigateWorkspace(adapter ? adapter.navigation.href(target) : navigationHref(target,{assignmentId,timedPracticeId,returnTo,sourceLabel,learningPathId,chapterId}));}
  function randomProblem(){if(!navigation.random.length)return;switchProblem(navigation.random[Math.floor(Math.random()*navigation.random.length)]);}
  const chapterContext = adapter?.chapter ?? (courseValid ? {courseTitle: course.data!.title, title: courseChapter!.title, position: courseChapter!.position, completed: Boolean(courseChapter?.problems.find(p=>p.problemId===problem.id)?.completed)} : undefined);
  const sample = problem.samples[selectedSample] ?? problem.samples[0];
  const assistanceAvailable = !adapter || Boolean(adapter.assistance);
  const statementTabs = [
    { value: "Problem", label: tx("题目描述", "Problem"), icon: FileText },
    ...(tutorial ? [{ value: "Tutorial", label: tx("教程", "Tutorial"), icon: BookOpen }] : []),
    ...(assistanceAvailable ? [{ value: "Translation", label: tx("中文题面", "Translation"), icon: Languages }] : []),
    ...(assistanceAvailable ? [{ value: "Solution", label: tx("参考答案", "Solution"), icon: Lightbulb }] : []),
    { value: "Submissions", label: tx("提交记录", "Submissions"), icon: History },
  ];
  const statementTab = statementTabs.some(tab => tab.value === leftTab) ? leftTab : "Problem";
  const mainClass = [styles.main, layout.panels.statement === "hidden" ? styles.leftHidden : layout.panels.statement === "collapsed" ? styles.leftCollapsed : "", layout.panels.editor === "hidden" && layout.panels.testing === "hidden" ? styles.onlyStatement : "", layout.maximized ? styles.maximized : "", layout.maximized === "statement" ? styles.statementMax : ""].join(" ");
  const rightClass = [styles.right, layout.panels.editor === "hidden" ? styles.editorHidden : layout.panels.editor === "collapsed" ? styles.editorCollapsed : "", layout.panels.testing === "hidden" ? styles.testingHidden : layout.panels.testing === "collapsed" ? styles.testingCollapsed : ""].join(" ");
  const panelClass = (panel: WorkspacePanel) => [styles.panel, styles[panel], layout.panels[panel] === "collapsed" ? styles.collapsed : "", layout.maximized === panel ? styles.maxPanel : ""].join(" ");
  const runButtons = <><Button size="sm" variant="secondary" disabled={pending || unavailable || !code.trim() || !problem.samples.length} onClick={() => run("samples")} data-od-id="run-code"><Play size={14}/>{tx("运行","Run")}</Button><Button size="sm" className={styles.submit} disabled={pending || unavailable || !code.trim()} onClick={() => run(originalId ? "correction" : "submit")} data-od-id="submit-code"><Send size={14}/>{pending ? tx("评测中…","Judging…") : originalId ? tx("提交订正","Submit correction") : tx("提交","Submit")}</Button></>;
  return <WorkspaceThemeProvider theme={resolvedPageTheme}><div ref={rootRef} style={{colorScheme:resolvedPageTheme}} className={`${styles.root} ${resolvedPageTheme==="dark"?"dark":""}`} data-od-id="production-workspace">
    <header className={`${styles.toolbar} ${timedPracticeId?styles.timedToolbar:""}`} data-od-id="workspace-navigation">
      <div className={styles.brand}>
        <div className={styles.navigationStart}>
          <button type="button" onClick={()=>navigateWorkspace(adapter?.homeHref ?? "/")} className={`${styles.back} ${styles.homeLink}`} title={tx("回首页","Go home")} aria-label={tx("回首页","Go home")} data-od-id="workspace-home"><House size={18}/></button>
          <button type="button" onClick={()=>setProblemListOpen(true)} className={`${styles.back} ${styles.problemList}`} title={tx("打开题目列表","Open problem list")} aria-label={tx("打开题目列表","Open problem list")} aria-haspopup="dialog" aria-expanded={problemListOpen} data-od-id="back-to-problem-list"><List size={18}/><span>{adapter?.navigation.title ?? (learningPathId?tx("本章练习","Chapter practice"):tx("题目列表","Problem list"))}</span></button>
        </div>
        <span className={styles.navigationDivider}/>
        <div className={styles.problemNavigation} aria-label={tx("切换题目","Switch problems")}>
          <button type="button" className={styles.tool} title={navigation.previous?`${tx("上一题：","Previous: ")}${navigation.previous.title??""}`:tx("没有上一题","No previous problem")} aria-label={tx("上一题","Previous problem")} disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.previous} onClick={()=>switchProblem(navigation.previous)} data-od-id="previous-problem"><ChevronLeft size={20}/></button>
          <button type="button" className={styles.tool} title={navigation.next?`${tx("下一题：","Next: ")}${navigation.next.title??""}`:tx("没有下一题","No next problem")} aria-label={tx("下一题","Next problem")} disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.next} onClick={()=>switchProblem(navigation.next)} data-od-id="next-problem"><ChevronRight size={20}/></button>
          <button type="button" className={styles.tool} title={tx("随机选择当前列表中的另一题","Choose another problem at random")} aria-label={tx("随机选题","Random problem")} disabled={pending||navigationLoading||Boolean(navigationError)||!navigation.random.length} onClick={randomProblem} data-od-id="random-problem"><Shuffle size={18}/></button>
        </div>
        <button type="button" className={styles.contextReturn} onClick={()=>navigateWorkspace(returnTo)} title={adapter?.returnLabel ?? `${tx("返回 ","Back to ")}${sourceDisplay}`} data-od-id={returnTo === "/student/problems" ? "workspace-back-to-problems" : "workspace-context-return"}>{adapter ? adapter.returnLabel : learningPathId?tx("返回章节","Back to chapter"):assignmentId?tx("返回作业","Back to assignment"):timedPracticeId?tx("返回练习","Back to practice"):originalId?tx("返回原提交","Back to original submission"):returnTo === "/student/problems"?tx("返回题目","Back to Problems"):tx("返回来源","Back to source")}</button>
      </div>
      {timedPracticeId?<div className="min-w-0 shrink-0" data-od-id="timed-navigation-clock"><TimedClock session={timedSession} compact/></div>:settings.actionPlacement === "toolbar" && <div className={styles.actions}>{runButtons}</div>}
      <div className={styles.tools}>
        {timedPracticeId&&settings.actionPlacement==="toolbar"&&<div className={styles.actions}>{runButtons}</div>}<div className={styles.timer}><WorkspaceTimer settings={settings} settingsReady={settingsReady} userId={user.id} problemKey={`${problem.id}:${problem.versionId ?? "current"}`} acceptedKey={polling.result?.status === "AC" && ["submit", "correction"].includes(polling.result.kind) ? polling.result.id : null}/></div>
        <button type="button" aria-label={tx("布局与面板","Layout and panels")} title={tx("布局与面板","Layout and panels")} className={styles.tool} onClick={() => setLayoutOpen(true)} data-od-id="layout-settings"><LayoutPanelLeft size={17}/></button>
        <button type="button" aria-label={tx("工作区设置","Workspace settings")} title={tx("工作区设置","Workspace settings")} className={styles.tool} onClick={() => {setSettingsScope("workspace");setSettingsOpen(true);}} data-od-id="workspace-settings"><Settings size={18} strokeWidth={1.7}/></button>
        <button type="button" aria-label={tx("帮助与快捷键","Help and shortcuts")} title={tx("帮助与快捷键","Help and shortcuts")} className={styles.tool} onClick={() => setConfirm("help")}><HelpCircle size={17}/></button>
        {adapter ? adapter.account(anyDirty) : <><ScholarshipBalance identityId={user.identityId}/><NotificationDropdown/>
        <AccountMenu user={user} role="student" busy={action.busy} onLogout={()=>{if(anyDirty&&!window.confirm(tx("代码尚未提交，草稿保留在本机。确认退出登录？","Your code has not been submitted. The draft remains in this browser. Sign out?")))return;void action.run(async()=>{try{await productionApi("auth/logout",{method:"POST"});}catch(e){if(!(e instanceof ApiError&&e.status===401))throw e;}clearProductionSession();router.replace("/login");});}}/></>}
      </div>
    </header>
    {chapterContext&&<div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2" data-od-id="course-practice-context"><span className="text-xs">{chapterContext.courseTitle} › {locale==="en"?`Chapter ${chapterContext.position+1}`:`第 ${chapterContext.position+1} 章`} · {chapterContext.title}</span>{((polling.result?.status==="AC"&&polling.result.kind==="submit"&&polling.result.versionId===problem.versionId)||chapterContext.completed)&&<><span className="text-sm text-success">{tx("本题已完成","Problem completed")}</span>{navigation.next&&<Button size="sm" onClick={()=>switchProblem(navigation.next)}>{tx("下一题","Next problem")}</Button>}</>}<Button size="sm" variant="secondary" onClick={()=>navigateWorkspace(returnTo)}>{tx("返回章节","Back to chapter")}</Button></div>}
    {assignmentId&&assignment.data&&assignmentValid&&<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-1" data-od-id="assignment-practice-context">
      <div className="min-w-0 flex-1 basis-52 text-xs leading-5 [overflow-wrap:anywhere]">
        <StudentScholarshipRule activityType="assignment" activityId={assignmentId} assignmentContext={assignment.data}/>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{navigationItems.findIndex(p=>p.problemId===problem.id)+1} / {navigationItems.length}</span>
      {assignmentGrade?.status==="AC"&&<span role="status" className="shrink-0 text-xs text-success">{assignmentGrade.completionSource==="other_entry"?tx("已在其他入口通过","Passed elsewhere"):tx("本题已完成","Completed")}</span>}
      {navigation.next?<Button size="sm" variant="secondary" className="shrink-0 max-[760px]:min-h-11" disabled={pending||navigationLoading||Boolean(navigationError)} onClick={()=>switchProblem(navigation.next)} data-od-id="assignment-next-problem">{tx("下一题","Next problem")}<ChevronRight size={15}/></Button>:<span className="shrink-0 text-xs text-muted-foreground">{tx("最后一题","Last problem")}</span>}
    </div>}
    <nav className={styles.mobileTabs} aria-label={tx("答题分区","Workspace panels")}>{panelIds.map(panel => <button key={panel} type="button" aria-pressed={layout.mobilePanel === panel} onClick={() => dispatch({ type: "mobile", panel })} data-od-id={`mobile-${panel}`}>{panel === "statement" ? tx("题目","Problem") : panel === "editor" ? tx("代码","Code") : tx("测试","Tests")}</button>)}</nav>
    <main ref={mainRef} className={mainClass} data-mobile={layout.mobilePanel} style={{ "--workspace-left": `${settings.panelPercent}%` } as CSSProperties}>
      <section className={panelClass("statement")} data-od-id="statement-panel" onMouseEnter={()=>setActivePanel("statement")} onFocusCapture={()=>setActivePanel("statement")}>
        <header className={styles.panelHeader}>
          <div className={styles.tabs} role="tablist" aria-label={tx("题目内容", "Problem content")}
            aria-orientation={layout.panels.statement === "collapsed" ? "vertical" : "horizontal"}>
            {statementTabs.map(({ value, label, icon: Icon }, index) => (
              <button key={value} id={`${statementId}-${value}`} type="button" className={styles.tab} role="tab"
                aria-selected={statementTab === value} aria-controls={`${statementId}-panel`}
                tabIndex={statementTab === value ? 0 : -1} onClick={() => setLeftTab(value)}
                onKeyDown={event => {
                  const vertical = layout.panels.statement === "collapsed";
                  const next = event.key === "Home" ? 0 : event.key === "End" ? statementTabs.length - 1
                    : event.key === (vertical ? "ArrowDown" : "ArrowRight") ? (index + 1) % statementTabs.length
                    : event.key === (vertical ? "ArrowUp" : "ArrowLeft") ? (index - 1 + statementTabs.length) % statementTabs.length : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  const nextTab = statementTabs[next].value;
                  setLeftTab(nextTab);
                  document.getElementById(`${statementId}-${nextTab}`)?.focus();
                }}>
                <Icon size={15} aria-hidden="true"/>{label}
              </button>
            ))}
          </div>
          {panelActions("statement")}
        </header>
        <div key={statementTab === "Tutorial" ? "tutorial" : "statement"} id={`${statementId}-panel`}
          className={styles.panelBody} role="tabpanel" aria-labelledby={`${statementId}-${statementTab}`}
          tabIndex={statementTab === "Tutorial" ? 0 : undefined}>
{statementTab === "Problem" ? <><div className="flex items-start justify-between gap-4"><div className="min-w-0"><ProblemHeading title={problem.title} difficulty={problem.difficulty} tags={problem.tags}/></div><SolvedStatus solved={submissions.data?.solved ?? problem.solved ?? false}/></div><article className="max-w-2xl text-base leading-7">
          {problemReward > 0 && (
            <p className="my-1 py-1 text-xs font-semibold leading-5">
              {tx(`本题额外奖励 +${problemReward}`, `Extra reward for this problem +${problemReward}`)}
            </p>
          )}
          {assignmentId && assignment.data?.grades?.find(grade => grade.identityId === user.identityId)?.problems.some(item => item.problemId === problem.id && item.completionSource === "other_entry") && <p className="mt-3 text-sm text-success">{tx("本题已在其他入口通过，已计入作业满分，无需重复提交。", "You passed this version elsewhere. Full assignment credit is recorded; no repeat submission is needed.")}</p>}{timedPracticeId && <StudentScholarshipRule activityType="timed" activityId={timedPracticeId}/>}<div className="mt-5"><LessonContent content={problem.statement}/></div>{problemWithHints.objective && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">{tx("学习目标","Learning objectives")}</h2><p>{problemWithHints.objective}</p></section>}{problem.mode === "stdio" ? <>{problemWithHints.inputDescription && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">{tx("输入","Input")}</h2><LessonContent content={problemWithHints.inputDescription}/></section>}{problemWithHints.outputDescription && <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">{tx("输出","Output")}</h2><LessonContent content={problemWithHints.outputDescription}/></section>}</> : <section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">{tx("函数接口","Function interface")}</h2><code className="rounded bg-muted px-1.5 py-1 font-mono text-sm">{signature}</code>{language === "cpp" && <p className="mt-2 text-xs leading-5 text-muted-foreground">{tx("C++ 使用 ","C++ uses ")}<code>nlohmann::json</code>{tx("；","; ")}<code>args</code>{tx(" 是 JSON 参数数组，"," is a JSON argument array, ")}<code>kwargs</code>{tx(" 是命名参数对象，返回可序列化的 JSON 值。"," is an object of named arguments. Return a JSON-serializable value.")}</p>}{language === "javascript" && <p className="mt-2 text-xs leading-5 text-muted-foreground">{tx("JavaScript 按位置展开 JSON ","JavaScript expands JSON ")}<code>args</code>{tx("；非空 "," as positional arguments; nonempty ")}<code>kwargs</code>{tx(" 作为最后一个对象参数传入。"," is passed as the final object argument.")}</p>}<dl className="mt-3 grid grid-cols-[92px_1fr] gap-y-2 text-sm">{problemWithHints.parameters?.map((parameter, index) => <div key={index} className="contents"><dt className="font-semibold">{tx("参数","Parameter")}</dt><dd>{typeof parameter === "string" ? parameter : `${parameter.name} — ${parameter.type}${parameter.description ? ` · ${parameter.description}` : ""}`}</dd></div>)}{problemWithHints.returnType && <><dt className="font-semibold">{tx("返回值","Return value")}</dt><dd>{problemWithHints.returnType}</dd></>}</dl></section>}<p className="mt-5 text-xs text-muted-foreground">{problem.timeLimitMs} ms / test · {language === "javascript" ? locale === "en" ? `JavaScript sandbox ${problem.languageLimits?.javascript?.effectiveMemoryMb ?? Math.max(problem.memoryLimitMb, 128)} MB (Node.js runtime floor ${problem.languageLimits?.javascript?.runtimeMemoryFloorMb ?? 128} MB; problem limit ${problem.memoryLimitMb} MB)` : `JavaScript 沙箱 ${problem.languageLimits?.javascript?.effectiveMemoryMb ?? Math.max(problem.memoryLimitMb, 128)} MB（Node.js 运行时最低 ${problem.languageLimits?.javascript?.runtimeMemoryFloorMb ?? 128} MB；题目设定 ${problem.memoryLimitMb} MB）` : `${problem.memoryLimitMb} MB`}</p><section className="mt-7 border-t border-border pt-5"><h2 className="mb-3 text-lg font-bold">{tx("示例","Examples")}</h2>{problem.samples.map((sample, index) => <div key={index} className="mb-3 border border-border"><div className="bg-surface-subtle px-3 py-2 text-xs font-semibold text-muted-foreground">{tx("示例","Example")} {index + 1}</div><div className="grid grid-cols-2 divide-x divide-border"><div className="min-w-0 p-3"><span className="text-xs text-muted-foreground">{tx("输入","Input")}</span><pre className="mt-1 overflow-auto font-mono text-sm">{sample.input.replace(/(?:\r?\n)+$/, "")}</pre></div><div className="min-w-0 p-3"><span className="text-xs text-muted-foreground">{tx("返回值 / 输出","Return value / output")}</span><pre className="mt-1 overflow-auto font-mono text-sm">{sample.expected.replace(/(?:\r?\n)+$/, "")}</pre></div></div></div>)}</section></article></> : statementTab === "Tutorial" && tutorial ? <ProblemTutorial tutorial={tutorial}/> : statementTab === "Translation" || statementTab === "Solution" ? adapter ? adapter.assistance?.(statementTab === "Translation" ? "FULL_TRANSLATION" : "FULL_SOLUTION") : <ScholarshipAssistance key={statementTab} target={assistanceTarget} kind={statementTab === "Translation" ? "FULL_TRANSLATION" : "FULL_SOLUTION"}/> : <ProblemSubmissionsTable feed={submissions} allowLegacyDetails={!adapter} openInNewTab={settings.openResultsNewTab}/>}
        </div>
        {adapter ? adapter.presence : <OnlineStudents identityId={user.identityId}/>}
      </section>
      <div role="separator" aria-label={tx("调整题目与代码区域宽度","Resize problem and code panels")} aria-orientation="vertical" aria-valuemin={25} aria-valuemax={70} aria-valuenow={settings.panelPercent} tabIndex={0} onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); update({ panelPercent: settings.panelPercent + (event.key === "ArrowLeft" ? -2 : 2) }); } }} className={styles.separator} data-od-id="workspace-width-resizer"/>
      {previewPercent != null && <div aria-hidden style={{ position:"absolute",left:`${previewPercent}%`,top:54,bottom:0,width:2,background:"var(--primary)",pointerEvents:"none",zIndex:20 }}/>}
      <div ref={rightRef} className={rightClass} style={{ "--workspace-editor-height": `${layout.editorPercent}%` } as CSSProperties}>
        <section className={panelClass("editor")} data-od-id="editor-panel" onMouseEnter={()=>setActivePanel("editor")} onFocusCapture={()=>setActivePanel("editor")}>
          <header className={styles.panelHeader}><span className={styles.panelTitle}><Code2 size={16} className="text-muted-foreground"/>{tx("代码","Code")}</span>{panelActions("editor")}</header>
          <div className={styles.editorToolbar}><div className="flex min-w-0 items-center gap-3"><select id="workspace-language" aria-label={tx("编程语言","Programming language")} value={language} disabled={pending||formatting} onChange={event => changeLanguage(event.target.value as SubmissionLanguage)} data-od-id="programming-language">{supportedLanguages.map(value => <option key={value} value={value}>{languageInfo[value].name}</option>)}</select><span title={languageInfo[language].runtime} className="hidden font-mono text-muted-foreground sm:inline">{languageInfo[language].file}</span></div><div className={styles.tools}>
            <CopyCodeButton code={code} className={styles.tool}/>
            <button type="button" className={styles.tool} title={tx("下载编辑器中的代码","Download code from editor")} aria-label={tx("下载编辑器中的代码","Download code from editor")} onClick={()=>downloadCode(code,languageInfo[language].file)} data-od-id="download-code"><Download size={14}/></button>
            <button type="button" className={styles.tool} title={`${tx("代码格式化","Format code")} · ${displayBinding(settings.editorKeymap.format)}`} aria-label={tx("代码格式化","Format code")} disabled={formatting||!code.trim()} onClick={()=>void formatEditor()} data-od-id="format-code"><FormatCodeIcon/></button>
            <button type="button" className={styles.tool} title={tx("重置代码","Reset code")} aria-label={tx("重置代码","Reset code")} disabled={pending||formatting} onClick={() => setConfirm("reset")}><RotateCcw size={14}/></button>
            <EditorShortcutsHint bindings={settings.editorKeymap}/>
            <button type="button" className={styles.tool} title={tx("代码编辑器设置","Code editor settings")} aria-label={tx("代码编辑器设置","Code editor settings")} onClick={()=>{setSettingsScope("editor");setSettingsOpen(true);}} data-od-id="code-editor-settings"><Settings size={16} strokeWidth={1.7}/></button>
            <button type="button" className={styles.tool} title={tx("最大化代码区","Maximize code panel")} aria-label={tx("最大化代码区","Maximize code panel")} onClick={() => dispatch({ type: "toggle-maximize", panel: "editor" })}><Maximize2 size={14}/></button>
          </div></div>
          <div className={styles.editorBody}><CodeEditor onEnableVim={()=>update({keyBinding:"vim"})} editorRef={editorRef} readOnly={formatting} code={code} onChange={setCode} language={language} settings={settings} onFormat={()=>void formatEditor()} status={draftSaved?tx("草稿已保存（本机）","Draft saved locally"):tx("草稿未保存","Draft not saved")} actions={settings.actionPlacement==="editor"?runButtons:undefined}/></div>

        </section>
        <div role="separator" aria-label={tx("调整代码与测试区域高度","Resize code and test panels")} aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={85} aria-valuenow={layout.editorPercent} tabIndex={0} onPointerDown={verticalStart} onPointerMove={verticalMove} onPointerUp={verticalEnd} onPointerCancel={verticalEnd} onLostPointerCapture={verticalEnd} onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); dispatch({ type: "resize", percent: layout.editorPercent + (event.key === "ArrowUp" ? -2 : 2) }); } }} className={`${styles.separator} ${styles.horizontal}`} data-od-id="workspace-height-resizer"/>
        <section className={panelClass("testing")} data-od-id="testing-panel" onMouseEnter={()=>setActivePanel("testing")} onFocusCapture={()=>setActivePanel("testing")}>
          <header className={styles.panelHeader}><div className={styles.tabs} role="tablist" aria-label={tx("测试区域","Test panel")}>{[{value:"Samples",label:tx("测试用例","Test cases")},{value:"Custom Input",label:tx("自定义输入","Custom input")},{value:"Result",label:tx("测试结果","Result")}].map(({value,label}) => <button key={value} type="button" className={styles.tab} role="tab" aria-selected={resultTab === value} onClick={() => setResultTab(value)}>{label}</button>)}</div>{panelActions("testing")}</header>
          <div className={styles.resultBody} role="tabpanel">
            {resultTab === "Samples" ? <div><div className={styles.caseTabs}>{problem.samples.map((_,index) => <button type="button" key={index} className={styles.caseTab} aria-pressed={selectedSample === index} onClick={() => setSelectedSample(index)} data-od-id={`sample-${index+1}`}>{tx("用例","Case")} {index+1}</button>)}<button type="button" className={styles.caseTab} title={tx("添加自定义输入","Add custom input")} onClick={() => setResultTab("Custom Input")}>＋ {tx("自定义","Custom")}</button></div>{sample ? <><span className={styles.sampleLabel}>{tx("输入","Input")}</span><pre className={styles.sampleValue}>{sample.input.replace(/(?:\r?\n)+$/, "")}</pre><span className={styles.sampleLabel}>{tx("预期输出","Expected output")}</span><pre className={styles.sampleValue}>{sample.expected.replace(/(?:\r?\n)+$/, "")}</pre></> : <p className="text-sm text-muted-foreground">{tx("此题暂无公开样例，可使用自定义输入。","This problem has no public samples. You can use custom input.")}</p>}</div> : resultTab === "Custom Input" ? <div><label className={styles.sampleLabel} htmlFor="workspace-custom-input">{problem.mode === "function" ? tx("函数参数（JSON 数组或 args/kwargs 对象）","Function arguments (JSON array or args/kwargs object)") : tx("标准输入","Standard input")}</label><textarea id="workspace-custom-input" ref={customInputRef} value={customInput} onChange={event => setCustomInput(event.target.value)} maxLength={MAX_CUSTOM_INPUT_LENGTH} rows={4} className={`${textarea} font-mono`} placeholder={problem.mode === "function" ? '{"args":[1,2],"kwargs":{"step":3}}' : "3 8"} data-od-id="custom-test-input"/>{problem.mode === "function" && <p className="mt-1 text-xs text-muted-foreground">{tx("例如 [1,2]；命名参数可用 args/kwargs 对象，kwargs 可省略。","For example, [1,2]. Named arguments can use an args/kwargs object; kwargs is optional.")}</p>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{tx("自定义输入只运行程序，不判断正确性。","Custom input runs your program without checking correctness.")}</p><Button size="sm" variant="secondary" disabled={pending || unavailable || !code.trim() || (problem.mode === "function" && !customInput.trim())} onClick={() => run("custom")} data-od-id="run-custom-code">{tx("运行自定义输入","Run custom input")}</Button></div>{polling.result?.kind === "custom" && <div className="mt-4"><ResultPanel {...polling} loading={pending} currentCode={code} currentLanguage={language} onLocate={location=>{dispatch({type:"show",panel:"editor"});requestAnimationFrame(()=>editorRef.current?.revealLocation(location.line,location.column));}}/></div>}</div> : <ResultPanel {...polling} onUseCase={pending || unavailable ? undefined : useCaseAsInput} loading={pending} currentCode={code} currentLanguage={language} onLocate={location=>{dispatch({type:"show",panel:"editor"});requestAnimationFrame(()=>editorRef.current?.revealLocation(location.line,location.column));}}/>}<Feedback action={action}/>{submissionId && !adapter && <AppLink href={`/student/submissions/${submissionId}`} target={settings.openResultsNewTab ? "_blank" : undefined} rel={settings.openResultsNewTab ? "noopener noreferrer" : undefined} className="mt-3 inline-block break-all text-xs font-semibold text-primary">{tx("查看提交","View submission")} {submissionId}</AppLink>}
          </div>

        </section>
      </div>
    </main>

    {layoutMessage&&<div className={styles.notice} role="status">{layoutMessage}</div>}
    {navigationError&&<span className="sr-only" role="status">{tx("题目列表加载失败：","Failed to load problem list: ")}{navigationError}</span>}

    {celebration && <AssignmentCompletionDialog key={celebration.id} assignment={celebration} celebrate
      href={`/student/assignments/${encodeURIComponent(celebration.id)}`} onDismiss={celebrations.dismiss} />}

    <Dialog open={layoutOpen} onOpenChange={setLayoutOpen}>
      <DialogContent className={styles.layoutMenu}>
        <div className={styles.layoutMenuHeader}>
          <DialogTitle>{tx("布局与面板", "Layout and panels")}</DialogTitle>
          <DialogDescription>{tx("分别显示、折叠或最大化各操作区域。", "Show, collapse, or maximize each panel.")}</DialogDescription>
        </div>
        <div className={styles.layoutActions}>
          {panelIds.map(panel => <button key={panel} type="button" onClick={() => dispatch({ type: "show", panel })}>
            {panelName(panel)}
            <span className="shrink-0 text-xs text-muted-foreground">{layout.panels[panel] === "open" ? tx("已显示", "Shown") : tx("恢复显示", "Show")}</span>
          </button>)}
          <button type="button" onClick={() => { void toggleFullscreen(); setLayoutOpen(false); }}>
            {tx("浏览器全屏", "Browser full screen")}<Maximize2 size={15} aria-hidden="true" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent><DialogTitle>{confirm === "leave" ? tx("离开答题页面？","Leave workspace?") : confirm === "reset" ? tx("重置初始代码？","Reset starter code?") : tx("答题帮助","Workspace help")}</DialogTitle><DialogDescription>{confirm === "leave" ? tx("草稿保留在当前浏览器会话中，但尚未正式提交，离开不会自动交卷。","The draft remains in this browser session but has not been submitted. Leaving will not submit it.") : confirm === "reset" ? tx("当前草稿将替换为题目初始代码；服务器已接收的提交仍保留。","Your current draft will be replaced with the starter code. Existing submissions remain on the server.") : tx("运行仅测试公开样例；自定义输入只运行程序，不判断正确性；提交才创建正式记录。Ctrl / ⌘ + 单引号运行样例，Ctrl / ⌘ + Enter 正式提交，Ctrl / ⌘ + S 保存草稿，代码区按 Esc 启用或返回 Vim 普通模式；其他区域按 Esc 退出面板最大化。","Run checks only the public samples; custom input runs without checking correctness. Submit creates a formal record. Ctrl / ⌘ + apostrophe runs samples, Ctrl / ⌘ + Enter submits, Ctrl / ⌘ + S saves the draft, and Esc enables or returns to Vim normal mode in the code editor. Outside the editor, Esc exits panel maximization.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setConfirm(null)}>{confirm === "leave" ? tx("继续编辑","Keep editing") : tx("关闭","Close")}</Button>{confirm === "leave" && <Button variant="danger" onClick={() => { const destination=pendingDestination??returnTo;setConfirm(null);router.push(destination); }}>{tx("离开，不提交","Leave without submitting")}</Button>}{confirm === "reset" && <Button onClick={() => { setCode(starterFor(problem,language));setConfirm(null); }}>{tx("重置代码","Reset code")}</Button>}</DialogFooter></DialogContent></Dialog>

    <ProblemListDrawer open={problemListOpen} onOpenChange={setProblemListOpen} title={adapter?.navigation.title ?? (learningPathId?tx("本章练习","Chapter practice"):assignmentId?tx("作业题目","Assignment problems"):timedPracticeId?tx("训练题目","Practice problems"):tx("题目列表","Problem list"))} description={adapter?.navigation.description ?? (learningPathId?`${course.data?.title??tx("课程","Course")} › ${courseChapter?.title??tx("加载章节…","Loading chapter…")}`:undefined)} items={scopedProblemList?navigationItems.map(p=>({id:p.problemId,title:p.title??tx("练习","Practice")})):library.data?.items??[]} currentId={problem.id} loading={scopedProblemList?navigationLoading:library.loading} error={scopedProblemList?navigationError:library.error} onRetry={adapter?.navigation.reload ?? (learningPathId?course.reload:assignmentId?assignment.reload:timedPracticeId?timedSession.reload:library.reload)} onSelect={target=>{setProblemListOpen(false);if(target.id!==problem.id){if(scopedProblemList)switchProblem(navigationItems.find(p=>p.problemId===target.id)??null);else navigateWorkspace(`/student/problems/${encodeURIComponent(target.id)}`);}}}/>

    <WorkspaceSettingsDialog key={settingsScope} editorOnly={settingsScope==="editor"} initialSection={settingsScope==="editor"?"editor":"layout"} open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} update={update} reset={reset}/>
  </div></WorkspaceThemeProvider>;
}

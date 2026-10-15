"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, Clock3, FileCode2, FileText, Play, RefreshCw, Save, Send } from "lucide-react";
import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { CodeEditor } from "@/components/student/code-editor";
import { useWorkspaceSettings } from "@/components/student/workspace-settings";
import { Empty, LessonContent, State, useData } from "@/components/student/shared";
import { ApiError, apiMessage, productionApi, type CampusUser } from "@/lib/production-api";
import { paper4Date, paper4Status, type Paper4Attempt, type Paper4File, type Paper4Paper, type Paper4PaperSummary, type Paper4Run } from "./model";

const surface = "min-w-0 rounded-lg border border-border bg-surface panel-shadow";
const smallButton = "min-h-10 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function StudentPaper4List() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const papers = useData<{ items: Paper4PaperSummary[] }>("paper4/papers");
  return <>
    <PageHeader eyebrow={tx("实践评测", "Practical assessment")} title={tx("Paper 4 练习", "Paper 4 practice")} description={tx("课程与模拟考试中的编程实践卷。作答与成绩独立于普通 OJ 积分。", "Programming practical papers from courses and mock exams. Results are separate from ordinary OJ points.")} />
    <State data={papers}>{papers.data?.items.length ? <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface panel-shadow">
      {papers.data.items.map(paper => <AppLink key={paper.id} href={`/student/paper4/${paper.id}`} className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 last:border-b-0 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary">
        <span className="min-w-0"><strong className="block text-base text-primary">{paper.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{paper.questionCount} {tx("道大题", "questions")} · {paper.totalMarks} {tx("分", "marks")} · {paper4Date(paper.endsAt, locale)}</span></span>
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
  return <>
    <AppLink href="/student/paper4" className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("返回练习列表", "Back to practice list")}</AppLink>
    <State data={paper}>{paper.data && <div className={`${surface} p-5 sm:p-6`}>
      <PageHeader eyebrow={tx("编程实践卷 · Python", "Practical paper · Python")} title={paper.data.title} description={paper.data.description}/>
      <div className="mt-5 flex flex-wrap gap-5 border-t border-border pt-4 text-sm text-muted-foreground"><span>{paper.data.questions.length} {tx("道大题", "questions")}</span><span>{paper.data.totalMarks} {tx("分", "marks")}</span><span><Clock3 size={15} className="mr-1 inline"/>{paper4Date(paper.data.startsAt, locale)} – {paper4Date(paper.data.endsAt, locale)}</span></div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{tx("每道大题有独立代码；切换小题不会清空代码。请在规定阶段保存检查点，完成后交卷。正式分数须经教师复核。", "Each question has its own code. Switching stages keeps your code. Save checkpoints at the required stages, then submit. A teacher confirms the final mark.")}</p>
      <Button className="mt-5" disabled={checking || starting || Boolean(error)} onClick={async () => {
        setStarting(true); setError("");
        try { setAttempt(await productionApi<Paper4Attempt>(`paper4/papers/${encodeURIComponent(paperId)}/attempt`, { method: "POST" })); }
        catch (reason) { setError(apiMessage(reason)); }
        finally { setStarting(false); }
      }}>{starting ? tx("正在打开…", "Opening…") : tx("开始或继续作答", "Start or continue")}</Button>
      {checking && <p role="status" className="mt-3 text-sm text-muted-foreground">{tx("正在检查作答记录…", "Checking your attempt…")}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </div>}</State>
  </>;
}

function Paper4Workspace({ attempt: initialAttempt, user }: { attempt: Paper4Attempt; user: CampusUser }) {
  const { locale } = useLocale();
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
  const { settings } = useWorkspaceSettings(user.id);
  const current = questions.find(question => question.key === questionKey) ?? questions[0];
  const stage = current?.stages.find(item => item.id === stageId) ?? current?.stages[0];
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
  if (!current) return <div role="alert" className={`${surface} p-5 text-sm text-destructive`}>{tx("试卷没有可作答的大题。", "This paper has no questions.")}</div>;
  const latestSnapshot = stage && [...attempt.snapshots].reverse().find(item => item.stageId === stage.id);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <AppLink href="/student/paper4" className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("练习列表", "Practice list")}</AppLink>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-border px-3 py-1 text-xs font-semibold">{paper4Status(attempt.status, locale)}</span><span role="status" className={`text-xs ${saveStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}>{saveStatus === "saving" ? tx("正在保存到服务器…", "Saving to server…") : saveStatus === "error" ? tx("保存失败，请重试", "Save failed; retry") : tx("代码已保存", "Code saved")}</span></div>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">{attempt.paper.title}</h1><p className="mt-1 text-xs text-muted-foreground">{attempt.paper.totalMarks} {tx("分", "marks")} · {tx("截止", "Ends")} {paper4Date(attempt.paper.endsAt, locale)} · {tx("最终得分由教师确认", "Final marks are teacher-confirmed")}</p></div><div className="flex flex-wrap gap-2">{frozen && !attempt.releasedAt && <Button variant="secondary" disabled={busy} onClick={() => void mutate(async () => { const refreshed = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`); setAttempt(refreshed); setMessage(refreshed.releasedAt ? tx("成绩已公布。", "Marks released.") : tx("教师尚未公布成绩。", "Teacher marks are not released yet.")); })}><RefreshCw size={15}/>{tx("刷新成绩", "Refresh marks")}</Button>}<Button variant="secondary" disabled={frozen || busy || !dirty} onClick={() => void mutate(async () => { await saveAll(); setMessage(tx("所有代码已保存。", "All code saved.")); })}><Save size={15}/>{tx("保存", "Save")}</Button><Button disabled={frozen || busy || dirty || saveStatus === "error"} onClick={() => setSubmitOpen(true)}><Send size={15}/>{tx("交卷", "Submit paper")}</Button></div></div>
    {attempt.releasedAt && <section aria-label={tx("公布成绩", "Released marks")} className={`${surface} mt-4 p-4`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-success">{tx("教师评分已公布", "Teacher marks released")}</h2><strong className="text-lg">{attempt.score ?? "—"} / {attempt.totalMarks}</strong></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{questions.flatMap(question => question.stages.map(item => { const mark = attempt.marks.find(value => value.stageId === item.id); return <div key={item.id} className="rounded-md border border-border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-semibold">{question.key} · {item.title}</span><strong>{mark?.marks ?? "—"} / {item.maxMarks}</strong></div>{mark?.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{mark.note}</p>}</div>; }))}</div></section>}
    {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span>{error}</span><Button variant="secondary" size="sm" onClick={() => void mutate(async () => { await saveAll(); setMessage(tx("保存已恢复。", "Save recovered.")); })}><RefreshCw size={14}/>{tx("重试保存", "Retry save")}</Button></div>}
    {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    <div className="mt-4 grid gap-3 lg:min-h-[620px] lg:grid-cols-[180px_minmax(0,1fr)] lg:grid-rows-[minmax(190px,27vh)_minmax(390px,1fr)] xl:grid-cols-[190px_minmax(270px,0.85fr)_minmax(390px,1.15fr)] xl:grid-rows-1">
      <nav aria-label={tx("试卷大题与阶段", "Paper questions and stages")} className={`${surface} max-h-[220px] self-start overflow-y-auto p-3 lg:row-span-2 lg:max-h-[calc(100vh-190px)] xl:row-span-1`}>
        <p className="px-2 pb-2 text-xs font-semibold uppercase text-muted-foreground">{tx("试卷导航", "Paper navigation")}</p>
        {questions.map((question, index) => <div key={question.key} className="mb-2"><button type="button" aria-current={question.key === current.key ? "page" : undefined} className={`${smallButton} flex w-full items-center gap-2 font-semibold ${question.key === current.key ? "bg-info-soft text-primary" : "hover:bg-muted"}`} onClick={() => changeQuestion(question.key)}><FileCode2 size={15} className="shrink-0"/><span className="min-w-0 truncate">{index + 1}. {question.title}</span></button>{question.key === current.key && <div className="mt-1 space-y-0.5 border-l border-border pl-3">{question.stages.map(item => <button type="button" key={item.id} aria-current={item.id === stage?.id ? "step" : undefined} onClick={() => setStageId(item.id)} className={`${smallButton} flex w-full items-center justify-between gap-2 ${item.id === stage?.id ? "font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><span className="truncate">{item.title}</span>{attempt.snapshots.some(snapshot => snapshot.stageId === item.id) && <Check size={15} className="shrink-0 text-success"/>}</button>)}</div>}</div>)}
      </nav>
      <section aria-labelledby="paper4-question-heading" className={`${surface} flex min-h-[260px] flex-col overflow-hidden lg:col-start-2 lg:row-start-1 lg:min-h-0 xl:col-start-2 xl:row-start-1 xl:min-h-[540px]`}><div className="border-b border-border px-4 py-3"><p className="text-xs font-semibold text-primary">{current.key} · {stage?.maxMarks ?? 0} {tx("分", "marks")}</p><h2 id="paper4-question-heading" className="mt-1 text-lg font-bold">{stage?.title || current.title}</h2></div><div className="min-h-0 flex-1 overflow-y-auto p-4"><LessonContent content={current.statement}/>{stage?.description && <div className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-bold">{tx("本阶段要求", "Stage task")}</h3><LessonContent content={stage.description}/></div>}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"><span className="text-xs text-muted-foreground">{latestSnapshot ? tx(`已保存检查点 · ${paper4Date(latestSnapshot.createdAt, locale)}`, `Checkpoint saved · ${paper4Date(latestSnapshot.createdAt, locale)}`) : tx("尚未保存阶段检查点", "No checkpoint saved yet")}</span><Button size="sm" variant="secondary" disabled={frozen || busy || saveStatus === "error" || !stage} onClick={() => void mutate(async () => { await saveFile(current.key); await productionApi(`paper4/attempts/${encodeURIComponent(attempt.id)}/checkpoints`, { method: "POST", body: { stageId: stage!.id } }); setAttempt(await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}`)); setMessage(tx("阶段检查点已保存，原记录不会被覆盖。", "Checkpoint saved without overwriting earlier evidence.")); })}><CheckCircle2 size={15}/>{tx("保存检查点", "Save checkpoint")}</Button></div></section>
      <section aria-labelledby="paper4-editor-heading" className="flex min-h-[560px] min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:min-h-[390px] xl:col-start-3 xl:row-start-1 xl:min-h-[620px]"><div className={`${surface} flex min-h-[320px] flex-1 flex-col overflow-hidden lg:min-h-[230px] xl:min-h-[380px]`}><div className="flex items-center justify-between border-b border-border px-4 py-2"><h2 id="paper4-editor-heading" className="text-sm font-bold">{current.key}.py · Python 3</h2><Button size="sm" disabled={busy || frozen || saveStatus === "error"} onClick={() => void mutate(async () => { await saveFile(current.key); setRun(await productionApi<Paper4Run>(`paper4/attempts/${encodeURIComponent(attempt.id)}/runs`, { method: "POST", body: { fileKey: current.key } })); })}><Play size={14}/>{tx("运行代码", "Run code")}</Button></div><div className="min-h-[250px] flex-1 lg:min-h-[180px] xl:min-h-[330px]"><CodeEditor code={currentCode} language="python" settings={settings} idPrefix="paper4" readOnly={frozen} inputLabel={tx(`${current.title} Python 代码`, `${current.title} Python code`)} status={tx("服务端自动保存", "Server autosave")} onChange={value => { latest.current[current.key] = value; setCodes(existing => ({ ...existing, [current.key]: value })); setSaveStatus("saving"); }}/></div></div><RunPanel run={run} initialFiles={current.initialFiles} locale={locale}/></section>
    </div>
    <Dialog open={submitOpen} onOpenChange={setSubmitOpen}><DialogContent><DialogTitle>{tx("确认交卷", "Submit paper")}</DialogTitle><DialogDescription>{tx("交卷后代码与检查点将冻结，教师复核后才会公布分数。", "Submission freezes your code and checkpoints. Marks appear after teacher review.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setSubmitOpen(false)}>{tx("继续作答", "Keep working")}</Button><Button disabled={busy} onClick={() => void mutate(async () => { await saveAll(); const updated = await productionApi<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attempt.id)}/submit`, { method: "POST" }); setAttempt(updated); setSubmitOpen(false); setMessage(tx("已交卷。请等待教师复核。", "Submitted. Await teacher review.")); })}>{tx("确认交卷", "Submit")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function RunPanel({ run, initialFiles, locale }: { run: Paper4Run | null; initialFiles: Record<string, string>; locale: "zh" | "en" }) {
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const results = run?.result?.publicResults ?? [];
  const [selectedCase, setSelectedCase] = useState(0);
  const [selectedFile, setSelectedFile] = useState("");
  const caseResult = results[Math.min(selectedCase, results.length - 1)];
  const files = { ...initialFiles, ...(caseResult?.generatedFiles ?? {}) };
  const fileName = selectedFile in files ? selectedFile : Object.keys(files)[0] ?? "";
  return <div className={`${surface} min-h-[210px] overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2"><h2 className="text-sm font-bold">{tx("运行结果与工作文件", "Run results and files")}</h2>{run && <span role="status" className="text-xs font-semibold text-muted-foreground">{paper4Status(run.state, locale)}{run.result?.status ? ` · ${run.result.status}` : ""}</span>}</div>
    <div className="p-3"><p className="text-xs text-muted-foreground">{run?.result?.publicMessage ?? (run ? tx("运行结果不等于教师确认的分数。", "Run results are not teacher-confirmed marks.") : tx("运行代码可查看标准输出和生成文件。", "Run code to inspect stdout and generated files."))}</p>{results.length > 1 && <div className="mt-2 flex flex-wrap gap-1" aria-label={tx("公开用例", "Public cases")}>{results.map((item, index) => <button type="button" key={item.caseId} aria-pressed={selectedCase === index} className={`rounded-md border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-primary ${selectedCase === index ? "border-primary text-primary" : "border-border"}`} onClick={() => { setSelectedCase(index); setSelectedFile(""); }}>{item.caseId}</button>)}</div>}
      <div className="mt-2 grid gap-2 md:grid-cols-2"><div><h3 className="mb-1 flex items-center gap-1 text-xs font-semibold"><FileText size={13}/>{tx("标准输出", "Standard output")}</h3><pre className="max-h-32 min-h-16 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-2 text-xs">{caseResult?.stdout ?? run?.result?.publicOutput ?? "—"}</pre>{caseResult?.stderr && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">{caseResult.stderr}</p>}</div><div><h3 className="mb-1 text-xs font-semibold">{tx("工作文件", "Work files")}</h3>{fileName ? <><select aria-label={tx("选择工作文件", "Select work file")} className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs" value={fileName} onChange={event => setSelectedFile(event.target.value)}>{Object.keys(files).map(name => <option key={name}>{name}</option>)}</select><pre className="max-h-24 min-h-12 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle p-2 text-xs">{files[fileName]}</pre></> : <p className="text-xs text-muted-foreground">{tx("本题没有工作文件。", "No work files for this question.")}</p>}</div></div>
      {caseResult?.checks && <p className="mt-2 text-xs text-muted-foreground">{caseResult.checks.map(check => `${check.passed ? "✓" : "×"} ${check.name}`).join(" · ")}</p>}
    </div>
  </div>;
}

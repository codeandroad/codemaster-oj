"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FilePlus2, Play, Plus, Save, Send, Settings, Trash2, Upload } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Empty, State, useData } from "@/components/student/shared";
import { CodeBlock } from "@/components/student/shared";
import { CodeEditor } from "@/components/student/code-editor";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "@/components/student/workspace-settings";
import { apiMessage, productionApi, type CampusUser, type SchoolClass } from "@/lib/production-api";
import { paper4Date, paper4Status, type Paper4Attempt, type Paper4AttemptSummary, type Paper4Paper, type Paper4PaperSummary, type Paper4Question, type Paper4RunnerCase, type Paper4Run, type Paper4Stage } from "./model";

const panel = "rounded-lg border border-border bg-surface panel-shadow";
const input = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";
const area = "w-full min-w-0 rounded-md border border-input bg-background p-3 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-primary";
type PaperDraft = Omit<Paper4Paper, "id" | "status" | "totalMarks" | "classId" | "startsAt" | "endsAt"> & { classId: string; startsAt: string; endsAt: string; runnerCases: Record<string, Paper4RunnerCase[]>; referenceSolutions: Record<string, string> };

function blankQuestion(index: number): Paper4Question {
  return { key: `Q${index}`, title: "", statement: "", starterCode: "", initialFiles: {}, outputFiles: [], stages: [{ id: `Q${index}-a`, title: "", description: "", maxMarks: [20, 25, 30][index - 1] ?? 1, judgeMode: "manual" }] };
}
function blankCase(index: number): Paper4RunnerCase {
  return { id: `case-${index}`, stdin: "", inputFiles: {}, expectedStdout: "", expectedFiles: {}, public: true };
}
function newDraft(): PaperDraft {
  return { title: "", description: "", classId: "", startsAt: "", endsAt: "", questions: [blankQuestion(1), blankQuestion(2), blankQuestion(3)], runnerCases: {}, referenceSolutions: {} };
}
const dateInput = (value: string | null) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";
const toIso = (value: string) => value ? new Date(`${value}:00+08:00`).toISOString() : null;

export function TeacherPaper4List() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [importOpen, setImportOpen] = useState(false);
  const papers = useData<{ items: Paper4PaperSummary[] }>("paper4/papers");
  const classes = useData<{ items: SchoolClass[] }>("classes");
  const className = (id: string | null) => classes.data?.items.find(item => item.id === id)?.name ?? "—";
  return <>
    <PageHeader eyebrow={tx("教学工具", "Teaching tools")} title={tx("Paper 4 实践评测", "Paper 4 practical assessment")} description={tx("制作 Python 编程实践卷，发布给班级并逐点评分。独立于普通 OJ 判题与积分。", "Create Python practical papers for a class and mark each stage. These papers are separate from ordinary OJ judging and points.")} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={16}/>{tx("导入试卷包", "Import package")}</Button><AppLink href="/teacher/paper4/new" className={buttonVariants()}><FilePlus2 size={16}/>{tx("新建试卷", "Create paper")}</AppLink></div>}/>
    <State data={papers}>{papers.data?.items.length ? <div className={`mt-5 overflow-hidden ${panel}`}><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>{[tx("试卷", "Paper"), tx("班级", "Class"), tx("时间", "Window"), tx("分值", "Marks"), tx("状态", "Status")].map(label => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{papers.data.items.map(paper => <tr key={paper.id} className="border-t border-border hover:bg-surface-subtle"><td className="px-4 py-3"><AppLink href={`/teacher/paper4/${paper.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{paper.title}</AppLink><span className="mt-1 block text-xs text-muted-foreground">{paper.questionCount} {tx("道大题", "questions")}</span></td><td className="px-4 py-3">{className(paper.classId)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{paper4Date(paper.startsAt, locale)} – {paper4Date(paper.endsAt, locale)}</td><td className="px-4 py-3 font-semibold">{paper.totalMarks}</td><td className="px-4 py-3">{paper4Status(paper.status, locale)}</td></tr>)}</tbody></table></div></div> : <Empty title={tx("还没有实践试卷", "No practical papers yet")} description={tx("先建立草稿并检查题目、阶段与测试，再发布给班级。", "Create a draft, check its questions, stages and tests, then publish to a class.")}/>}</State>
    <Paper4ImportDialog open={importOpen} onOpenChange={setImportOpen} classes={classes.data?.items ?? []} tx={tx}/>
  </>;
}

interface ImportPreview {
  title: string;
  description: string;
  questionCount: number;
  totalMarks: number;
  autoStageCount: number;
  manualStageCount: number;
  evidenceStageCount?: number;
  caseCount: number;
  referenceSolutionCount: number;
  questions: Array<{ key: string; title: string; marks: number; stageCount: number; autoStageCount: number; manualStageCount?: number; evidenceStageCount?: number; caseCount: number; hasReferenceSolution: boolean }>;
}
function Paper4ImportDialog({ open, onOpenChange, classes, tx }: { open: boolean; onOpenChange: (open: boolean) => void; classes: SchoolClass[]; tx: (zh: string, en: string) => string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [createBody, setCreateBody] = useState<unknown>(null);
  const [filename, setFilename] = useState("");
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect(file: File) {
    setPreview(null); setCreateBody(null); setError(""); setFilename(file.name);
    if (!/\.(json|zip)$/i.test(file.name)) { setError(tx("请选择含 manifest.json 的结构化 .json 或 .zip 试卷包。原始 PDF/素材 ZIP 须先整理为结构化试卷包。", "Select a structured .json or .zip paper package with manifest.json. Convert raw PDFs or source ZIPs into a structured package first.")); return; }
    if (file.size > 1024 * 1024) { setError(tx("试卷包不可超过 1 MiB。", "Paper packages must be 1 MiB or smaller.")); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      const result = await productionApi<{ preview: ImportPreview; createBody: unknown }>("paper4/imports/preview", { method: "POST", body: { filename: file.name, contentBase64: btoa(binary) } });
      setPreview(result.preview); setCreateBody(result.createBody);
    } catch (reason) { setError(`${apiMessage(reason)} ${tx("请确认文件是结构化试卷包，原始 PDF 或素材 ZIP 需要先转换。", "Check that this is a structured paper package. Raw PDFs and source ZIPs need conversion first.")}`); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogTitle>{tx("导入 Paper 4 试卷包", "Import Paper 4 package")}</DialogTitle><DialogDescription>{tx("上传结构化 JSON 或带 manifest.json 的 ZIP。先预览和校验，再创建可编辑草稿；不会直接发布给学生。", "Upload structured JSON or a ZIP with manifest.json. Preview and validate it before creating an editable draft; students will not see it yet.")}</DialogDescription>
    <label className="block text-sm font-semibold">{tx("选择试卷包", "Choose package")}<input type="file" accept=".json,.zip,application/json,application/zip" className="mt-2 block w-full text-sm" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void inspect(file); }}/></label>
    <p className="text-xs text-muted-foreground">{tx("原始试题 PDF 或只含程序/数据文件的 ZIP 暂不能自动识别；请先按结构化试卷格式整理。", "Raw paper PDFs and ZIPs containing only code/data cannot be recognized automatically; first prepare a structured package.")}</p>
    {busy && <p role="status" className="text-sm text-muted-foreground">{tx("正在校验试卷包…", "Validating package…")}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <section className="rounded-md border border-border p-4 text-sm"><h3 className="font-bold">{preview.title}</h3><p className="mt-1 text-xs text-muted-foreground">{filename} · {preview.questionCount} {tx("道大题", "questions")} · {preview.totalMarks} {tx("分", "marks")}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-info-soft px-2 py-1">{tx("自动阶段", "Auto stages")}: {preview.autoStageCount}</span><span className="rounded bg-muted px-2 py-1">{tx("人工阶段", "Manual stages")}: {preview.manualStageCount}</span><span className="rounded bg-muted px-2 py-1">{tx("证据阶段", "Evidence stages")}: {preview.evidenceStageCount ?? 0}</span><span className="rounded bg-muted px-2 py-1">{tx("测试用例", "Test cases")}: {preview.caseCount}</span><span className="rounded bg-muted px-2 py-1">{tx("参考答案", "Reference solutions")}: {preview.referenceSolutionCount}</span></div><ul className="mt-3 divide-y divide-border">{preview.questions.map(question => <li key={question.key} className="flex flex-wrap justify-between gap-2 py-2"><span>{question.key} · {question.title}</span><span className="text-muted-foreground">{question.marks} {tx("分", "marks")} · {question.stageCount} {tx("阶段", "stages")} · {question.caseCount} {tx("用例", "cases")} · {question.hasReferenceSolution ? tx("有参考答案", "Reference ready") : tx("无参考答案", "No reference")}</span></li>)}</ul></section>}
    {preview && <label className="block text-sm font-semibold">{tx("草稿所属班级（可稍后选择）", "Draft class (optional now)")}<select className={`${input} mt-1`} value={classId} onChange={event => setClassId(event.target.value)}><option value="">{tx("稍后选择", "Choose later")}</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="mt-1 block text-xs font-normal text-muted-foreground">{tx("导入只建草稿；发布前须选择本人负责的班级，完成参考答案验证。", "Import creates a draft only; choose your class and validate references before publishing.")}</span></label>}
    <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>{tx("取消", "Cancel")}</Button><Button disabled={!createBody || busy} onClick={() => { setBusy(true); setError(""); void productionApi<Paper4Paper>("paper4/papers", { method: "POST", body: { ...(createBody as Record<string, unknown>), classId: classId || null } }).then(result => { onOpenChange(false); router.push(`/teacher/paper4/${result.id}`); }).catch(reason => setError(apiMessage(reason))).finally(() => setBusy(false)); }}>{tx("创建草稿", "Create draft")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function TeacherPaper4Editor({ id, user }: { id: string; user: CampusUser }) {
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const fresh = id === "new";
  const viewingDraft = search.get("view") === "draft";
  const paper = useData<Paper4Paper>(fresh ? "" : `paper4/papers/${encodeURIComponent(id)}${viewingDraft ? "?view=draft" : ""}`);
  const classes = useData<{ items: SchoolClass[] }>("classes");
  const attempts = useData<{ items: Paper4AttemptSummary[] }>(fresh ? "" : `paper4/attempts?paperId=${encodeURIComponent(id)}`);
  const [draft, setDraft] = useState<PaperDraft>(newDraft);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [selected, setSelected] = useState("Q1");
  const [selectedCaseStage, setSelectedCaseStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [referencePendingRefresh, setReferencePendingRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [referenceFeedback, setReferenceFeedback] = useState<Record<string, string>>({});
  const { settings, update: updateSettings, reset: resetSettings } = useWorkspaceSettings(user.id);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  useEffect(() => {
    if (!paper.data) return;
    const next = { title: paper.data.title, description: paper.data.description, classId: paper.data.classId ?? "", startsAt: dateInput(paper.data.startsAt), endsAt: dateInput(paper.data.endsAt), questions: paper.data.questions, runnerCases: paper.data.runnerCases ?? {}, referenceSolutions: paper.data.referenceSolutions ?? {} };
    setDraft(next);
    setSavedSnapshot(JSON.stringify(next));
    setReferencePendingRefresh(false);
    setSelected(current => paper.data?.questions.some(item => item.key === current) ? current : paper.data?.questions[0]?.key ?? "");
    setSelectedCaseStage(current => paper.data?.questions.some(item => item.stages.some(stage => stage.id === current)) ? current : paper.data?.questions[0]?.stages.find(stage => stage.judgeMode === "auto")?.id ?? "");
  }, [paper.data]);
  const published = Boolean(paper.data && paper.data.status.toLowerCase() !== "draft");
  const classLocked = viewingDraft && (paper.data?.versionNumber ?? 1) > 1;
  const question = draft.questions.find(item => item.key === selected) ?? draft.questions[0];
  const maxMarks = draft.questions.reduce((sum, item) => sum + item.stages.reduce((stageSum, stage) => stageSum + Number(stage.maxMarks || 0), 0), 0);
  const autoStages = question?.stages.filter(stage => stage.judgeMode === "auto") ?? [];
  const caseStage = autoStages.find(stage => stage.id === selectedCaseStage) ?? autoStages[0];
  const cases = caseStage ? draft.runnerCases[caseStage.id] ?? [] : [];
  const draftDirty = !fresh && savedSnapshot !== JSON.stringify(draft);
  const updateQuestion = (key: string, update: (question: Paper4Question) => Paper4Question) => setDraft(current => ({ ...current, questions: current.questions.map(item => item.key === key ? update(item) : item) }));
  const updateCases = (key: string, update: (cases: Paper4RunnerCase[]) => Paper4RunnerCase[]) => setDraft(current => ({ ...current, runnerCases: { ...current.runnerCases, [key]: update(current.runnerCases[key] ?? []) } }));
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  function validate(publishing = false): boolean {
    if (!draft.title.trim() || !draft.questions.length || draft.questions.length > 3 || maxMarks !== 75) {
      setError(tx("请填写标题，并使所有阶段分值合计恰好为 75。", "Enter a title and make all stage marks total exactly 75.")); return false;
    }
    if (publishing && (!draft.classId || !draft.startsAt || !draft.endsAt)) {
      setError(tx("发布前请选择班级，并设置开始和结束时间。", "Select a class and set start and end times before publishing.")); return false;
    }
    if (draft.startsAt && draft.endsAt && draft.startsAt >= draft.endsAt) {
      setError(tx("结束时间须晚于开始时间。", "End time must be after start time.")); return false;
    }
    if (draft.questions.some(item => !item.title.trim() || !item.statement.trim() || !item.stages.length || item.stages.some(stage => !stage.title.trim() || !Number.isInteger(stage.maxMarks) || stage.maxMarks < 1 || stage.maxMarks > 75))) {
      setError(tx("每道题须有标题、题面及有效的评分阶段。", "Every question needs a title, statement and valid marking stages.")); return false;
    }
    const validFilename = (name: string) => name.length <= 76 && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:txt|csv|dat)$/i.test(name);
    if (draft.questions.some(item => [...Object.keys(item.initialFiles), ...(item.outputFiles ?? []), ...item.stages.flatMap(stage => (draft.runnerCases[stage.id] ?? []).flatMap(test => [...Object.keys(test.inputFiles), ...Object.keys(test.expectedFiles)]))].some(name => !validFilename(name)))) {
      setError(tx("工作文件名须以 .txt、.csv 或 .dat 结尾，且不超过 76 个字符。", "Work filenames must end in .txt, .csv or .dat and be at most 76 characters.")); return false;
    }
    if (publishing && draft.questions.some(item => !item.stages.some(stage => stage.judgeMode === "auto"))) {
      setError(tx("发布时每道大题至少须有一个自动判题阶段。", "Each question needs at least one auto-judged stage before publishing.")); return false;
    }
    if (publishing && draft.questions.some(item => item.stages.some(stage => stage.judgeMode === "auto" && !(draft.runnerCases[stage.id]?.length)))) {
      setError(tx("每个自动判题阶段至少需要一个测试用例。", "Each auto-judged stage needs at least one test case.")); return false;
    }
    return true;
  }
  const payload = { ...draft, title: draft.title.trim(), description: draft.description.trim(), classId: draft.classId || null, startsAt: toIso(draft.startsAt), endsAt: toIso(draft.endsAt), runnerCases: Object.fromEntries(draft.questions.flatMap(item => item.stages.filter(stage => stage.judgeMode === "auto").map(stage => [stage.id, draft.runnerCases[stage.id] ?? []]))), referenceSolutions: Object.fromEntries(draft.questions.map(item => [item.key, draft.referenceSolutions[item.key] ?? ""])) };
  const validation = paper.data?.referenceValidation ?? {};
  const allAutoStages = draft.questions.flatMap(item => item.stages.filter(stage => stage.judgeMode === "auto"));
  const eachQuestionHasAuto = draft.questions.every(item => item.stages.some(stage => stage.judgeMode === "auto"));
  const referencesReady = allAutoStages.every(stage => validation[stage.id]?.status === "AC");
  const readyForPublish = !draftDirty && !referencePendingRefresh && eachQuestionHasAuto && referencesReady && Boolean(draft.classId && draft.startsAt && draft.endsAt);
  async function createRevision() {
    await perform(async () => {
      await productionApi(`paper4/papers/${encodeURIComponent(id)}/draft`, { method: "POST" });
      router.push(`/teacher/paper4/${encodeURIComponent(id)}?view=draft`);
      setMessage(tx("新版草稿已建立，可以编辑。", "A new editable draft revision is ready."));
    });
  }
  async function verifyReference(questionKey: string) {
    await perform(async () => {
      if (draftDirty || referencePendingRefresh) { setError(tx("请先保存草稿并等待状态刷新，再运行参考答案验证。", "Save the draft and wait for the status refresh before validating the reference solution.")); return; }
      const response = await productionApi<{ items: Array<{ id: string; stageId: string; state: string }> }>(`paper4/papers/${encodeURIComponent(id)}/reference-runs`, { method: "POST", body: { questionKey } });
      setReferenceFeedback(current => ({ ...current, ...Object.fromEntries(response.items.map(item => [item.stageId, tx("排队中", "Queued")])) }));
      await Promise.all(response.items.map(async task => {
        for (let poll = 0; poll < 40; poll++) {
          const result = await productionApi<Paper4Run>(`paper4/runs/${encodeURIComponent(task.id)}`);
          if (!["queued", "leased", "running"].includes(result.state.toLowerCase())) {
            const status = result.result?.stageResults?.find(item => item.stageId === task.stageId)?.status ?? result.result?.status ?? result.state;
            setReferenceFeedback(current => ({ ...current, [task.stageId]: status }));
            return;
          }
          await new Promise(resolve => window.setTimeout(resolve, 1200));
        }
        setReferenceFeedback(current => ({ ...current, [task.stageId]: tx("验证仍在运行，请刷新查看。", "Still running; refresh to check.") }));
      }));
      paper.reload();
      setMessage(tx("参考答案验证已完成。逐阶段查看结果。", "Reference validation finished. Review each stage result."));
    });
  }
  return <>
    <AppLink href="/teacher/paper4" className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("返回实践评测", "Back to practical papers")}</AppLink>
    <PageHeader eyebrow={fresh ? tx("新建试卷", "Create paper") : tx("实践试卷", "Practical paper")} title={fresh ? tx("建立 Paper 4 草稿", "Create a Paper 4 draft") : paper.data?.title ?? tx("正在加载…", "Loading…")} description={tx("准备题面、自动阶段用例、参考答案和评分点。自动判题给出 AC 状态；75 分成绩由教师复核。", "Prepare questions, auto-stage cases, reference solutions and marking points. Auto judging reports AC status; teachers award marks out of 75.")}/>
    {!fresh && <State data={paper}>{null}</State>}
    {!fresh && published && <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}><div><strong>{tx("当前已发布版本", "Current published version")} {paper.data?.versionNumber ? `v${paper.data.versionNumber}` : ""}</strong><p className="mt-1 text-muted-foreground">{tx("已发布版本保持不变。创建修订草稿后可修改题目和参考答案，再重新验证并发布新版。", "The published version remains unchanged. Create a draft revision to edit questions and reference code, validate it, then publish the new version.")}</p></div>{paper.data?.hasDraft ? <AppLink href={`/teacher/paper4/${encodeURIComponent(id)}?view=draft`} className={buttonVariants()}>{tx("继续编辑修订草稿", "Edit draft revision")}</AppLink> : <Button disabled={busy} onClick={() => void createRevision()}>{tx("创建修订草稿", "Create draft revision")}</Button>}</div>}
    {!fresh && viewingDraft && !published && <p className="mt-4 rounded-md border border-info bg-info-soft p-3 text-sm text-primary">{tx("正在编辑修订草稿。原已发布版本仍可供学生作答。", "Editing a draft revision. The current published version remains available to students.")}</p>}
    <div className={`${panel} mt-5 p-4 sm:p-5`}><div className="grid gap-4 md:grid-cols-2"><Field label={tx("试卷标题", "Paper title")}><input className={input} maxLength={180} value={draft.title} disabled={published} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))}/></Field><Field label={tx("发布班级", "Class")}><select className={input} value={draft.classId} disabled={published || classLocked} onChange={event => setDraft(value => ({ ...value, classId: event.target.value }))}><option value="">{tx("稍后选择班级", "Choose a class later")}</option>{classes.data?.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{classLocked && <span className="mt-1 block text-xs font-normal text-muted-foreground">{tx("修订版不能更换班级；如需更换，请新建试卷。", "A revision cannot change class. Create a new paper for another class.")}</span>}</Field><Field label={tx("开始时间", "Starts at")}><input type="datetime-local" className={input} value={draft.startsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, startsAt: event.target.value }))}/></Field><Field label={tx("结束时间", "Ends at")}><input type="datetime-local" className={input} value={draft.endsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, endsAt: event.target.value }))}/></Field></div><Field label={tx("说明", "Instructions")}><textarea rows={2} className={area} value={draft.description} disabled={published} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}/></Field><p className="mt-3 text-xs text-muted-foreground">{tx("本期支持 Python 3 校内练习与模拟考试；请勿上传正式试卷保密材料。", "This version supports Python 3 school practice and mock exams. Do not upload confidential live exam materials.")}</p></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"><nav aria-label={tx("大题编辑导航", "Question editor navigation")} className={`${panel} h-fit p-3`}><div className="flex items-center justify-between gap-2 px-2 pb-2"><h2 className="text-sm font-bold">{tx("大题", "Questions")}</h2><span className={`text-xs font-semibold ${maxMarks === 75 ? "text-success" : "text-warning"}`}>{maxMarks}/75</span></div>{draft.questions.map((item, index) => <button key={item.key} type="button" aria-current={item.key === question?.key ? "page" : undefined} className={`mb-1 block min-h-10 w-full rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${item.key === question?.key ? "bg-info-soft font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => { setSelected(item.key); setSelectedCaseStage(item.stages.find(stage => stage.judgeMode === "auto")?.id ?? ""); }}>{index + 1}. {item.title || tx("未命名大题", "Untitled question")}</button>)}<Button size="sm" variant="secondary" className="mt-2 w-full" disabled={published || draft.questions.length >= 3} onClick={() => { const number = Math.max(0, ...draft.questions.map(item => Number(item.key.slice(1)) || 0)) + 1; const next = blankQuestion(number); setDraft(current => ({ ...current, questions: [...current.questions, next] })); setSelected(next.key); setSelectedCaseStage(""); }}><Plus size={14}/>{tx("添加大题", "Add question")}</Button></nav>
    {question && <div className={`${panel} min-w-0 p-4 sm:p-5`}><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{question.key} · {tx("题目内容", "Question content")}</h2><Button size="sm" variant="ghost" disabled={published || draft.questions.length === 1} onClick={() => { setDraft(current => ({ ...current, questions: current.questions.filter(item => item.key !== question.key) })); setSelected(draft.questions.find(item => item.key !== question.key)?.key ?? ""); }}><Trash2 size={14}/>{tx("移除大题", "Remove")}</Button></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><Field label={tx("标题", "Title")}><input className={input} maxLength={180} value={question.title} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, title: event.target.value }))}/></Field><Field label={tx("入口文件名", "Entry file")}><input className={input} value={`${question.key}.py`} disabled aria-readonly="true"/></Field></div>
      <Field label={tx("题面（支持 Markdown）", "Statement (Markdown)")}><textarea rows={7} className={area} value={question.statement} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, statement: event.target.value }))}/></Field>
      <Field label={tx("起始代码", "Starter code")}><textarea rows={5} spellCheck={false} className={`${area} font-mono`} value={question.starterCode} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, starterCode: event.target.value }))}/></Field>
      <FileMapEditor label={tx("初始工作文件", "Initial work files")} value={question.initialFiles} disabled={published} tx={tx} onChange={initialFiles => updateQuestion(question.key, value => ({ ...value, initialFiles }))}/>
      <Field label={tx("允许收集的生成文件（每行一个文件名）", "Generated files to collect (one filename per line)")}><textarea rows={3} className={`${area} font-mono`} value={(question.outputFiles ?? []).join("\n")} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, outputFiles: event.target.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean) }))}/></Field>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("阶段与评分点", "Stages and marking points")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("学生在这些阶段保存不可覆盖的代码检查点。分数为教师复核上限。", "Students save immutable code checkpoints at these stages. Marks are teacher-reviewed caps.")}</p>
      <div className="mt-3 space-y-3">{question.stages.map((stage, stageIndex) => <StageEditor key={stage.id} stage={stage} disabled={published} tx={tx} onChange={patch => updateQuestion(question.key, value => ({ ...value, stages: value.stages.map(item => item.id === stage.id ? { ...item, ...patch } : item) }))} onRemove={() => updateQuestion(question.key, value => ({ ...value, stages: value.stages.filter(item => item.id !== stage.id) }))} canRemove={question.stages.length > 1} index={stageIndex} validation={referenceFeedback[stage.id] ?? validation[stage.id]?.status}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateQuestion(question.key, value => ({ ...value, stages: [...value.stages, { id: `${question.key}-${value.stages.length + 1}-${Date.now()}`, title: "", description: "", maxMarks: 1, judgeMode: "manual" }] }))}><Plus size={14}/>{tx("添加阶段", "Add stage")}</Button>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("阶段自动测试", "Stage runner cases")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("为每个自动判题阶段单独设置用例。隐藏用例不会向学生展示输入和预期输出。", "Configure cases for each auto-judged stage separately. Hidden cases do not reveal inputs or expected output to students.")}</p>{autoStages.length > 0 ? <><label className="mt-3 block text-sm font-semibold">{tx("测试阶段", "Test stage")}<select className={`${input} mt-1`} value={caseStage?.id ?? ""} onChange={event => setSelectedCaseStage(event.target.value)}>{autoStages.map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}</select></label><div className="mt-3 space-y-3">{cases.map((item, index) => <CaseEditor key={`${caseStage?.id}:${index}`} test={item} index={index} tx={tx} disabled={published} onChange={patch => updateCases(caseStage!.id, values => values.map((value, position) => position === index ? { ...value, ...patch } : value))} onRemove={() => updateCases(caseStage!.id, values => values.filter((_, position) => position !== index))}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateCases(caseStage!.id, values => [...values, blankCase(values.length + 1)])}><Plus size={14}/>{tx("添加测试", "Add case")}</Button></> : <p className="mt-3 text-xs text-muted-foreground">{tx("将某阶段的判题方式设为自动后，可在此添加测试用例。", "Set a stage to Auto to add test cases here.")}</p>}
      <div className="mt-6 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">{tx("参考答案 · Python 3", "Reference solution · Python 3")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("仅教师可见。保存草稿后运行验证，全部自动阶段 AC 才能发布。", "Teacher-only. Save the draft, run validation and pass every auto stage before publishing.")}</p></div><Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}><Settings size={14}/>{tx("编辑器设置", "Editor settings")}</Button></div><div className="mt-3 h-[340px] min-h-[260px] overflow-hidden rounded-md border border-border"><CodeEditor code={draft.referenceSolutions[question.key] ?? ""} onChange={code => setDraft(current => ({ ...current, referenceSolutions: { ...current.referenceSolutions, [question.key]: code } }))} language="python" settings={settings} readOnly={published} idPrefix={`paper4-reference-${question.key}`} inputLabel={tx(`${question.key} 参考答案`, `${question.key} reference solution`)} status={tx("教师私有参考代码", "Teacher-only reference code")}/></div><div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={published || busy || fresh || draftDirty || referencePendingRefresh || !autoStages.length || !draft.referenceSolutions[question.key]?.trim()} onClick={() => void verifyReference(question.key)}><Play size={14}/>{tx("运行验证", "Run validation")}</Button>{(draftDirty || referencePendingRefresh) && <span className="text-xs text-warning">{draftDirty ? tx("先保存草稿", "Save draft first") : tx("正在刷新验证状态…", "Refreshing validation status…")}</span>}{!autoStages.length && <span className="text-xs text-muted-foreground">{tx("本题没有自动阶段，无需参考运行验证。", "This question has no auto stages to validate.")}</span>}</div><div className="mt-3 flex flex-wrap gap-2 text-xs">{autoStages.map(item => { const status = referenceFeedback[item.id] ?? validation[item.id]?.status ?? "unverified"; return <span key={item.id} className={`rounded-md border px-2 py-1 ${status === "AC" ? "border-success text-success" : status === "WA" || status === "error" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>{item.title || item.id}: {status}</span>; })}</div></div>
    </div>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-sm">{paper.data && <span className="font-semibold">{paper4Status(paper.data.status, locale)} {paper.data.versionNumber ? `· v${paper.data.versionNumber}` : ""}</span>}<span className="ml-3 text-muted-foreground">{tx("总分", "Total")}: {maxMarks} / 75</span></div><div className="flex gap-2">{!published && <Button disabled={busy || Boolean(!draft.title.trim())} onClick={() => void perform(async () => { if (!validate()) return; const result = fresh ? await productionApi<Paper4Paper>("paper4/papers", { method: "POST", body: payload }) : await productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }); setReferencePendingRefresh(!fresh); setSavedSnapshot(JSON.stringify(draft)); setReferenceFeedback({}); setMessage(tx("试卷草稿已保存。", "Paper draft saved.")); if (fresh) router.push(`/teacher/paper4/${result.id}`); else paper.reload(); })}><Save size={15}/>{fresh ? tx("建立草稿", "Create draft") : tx("保存草稿", "Save draft")}</Button>}{!fresh && !published && <Button variant="secondary" disabled={busy || maxMarks !== 75 || !readyForPublish} title={draftDirty ? tx("先保存草稿", "Save the draft first") : !eachQuestionHasAuto ? tx("每道大题至少需要一个自动阶段", "Each question needs an auto stage") : !referencesReady ? tx("请先运行参考答案，确保全部自动阶段 AC", "Validate references so every auto stage is AC") : undefined} onClick={() => setConfirmPublish(true)}><Send size={15}/>{tx("发布到班级", "Publish to class")}</Button>}</div></div>
    {!fresh && !published && !readyForPublish && <p className="mt-2 text-xs text-warning">{draftDirty ? tx("有未保存的修改；保存后才能验证和发布。", "Save your changes before validation and publishing.") : !eachQuestionHasAuto ? tx("每道大题至少需要一个自动判题阶段。", "Each question needs at least one auto-judged stage.") : !referencesReady ? tx("发布前须验证所有自动判题阶段的参考答案为 AC。", "Validate reference solutions for all auto stages to AC before publishing.") : tx("发布前请选择班级，并设置开始和结束时间。", "Select a class and set the time window before publishing.")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    {!fresh && <section className={`${panel} mt-7 overflow-hidden`}><div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-bold">{tx("学生交卷与批阅", "Student attempts and marking")}</h2><Button variant="ghost" size="sm" onClick={attempts.reload}>{tx("刷新", "Refresh")}</Button></div><State data={attempts}>{attempts.data?.items.length ? <div className="divide-y divide-border">{attempts.data.items.map(item => <AppLink href={`/teacher/paper4/${id}/review/${item.id}`} key={item.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary"><span className="font-semibold text-primary">{item.studentName || item.studentIdentityId || item.id}</span><span className="text-muted-foreground">{item.versionNumber ? `v${item.versionNumber} · ` : ""}{paper4Status(item.status, locale)} · {item.score ?? "—"} / 75 · {paper4Date(item.submittedAt, locale)}</span></AppLink>)}</div> : <p className="p-5 text-sm text-muted-foreground">{tx("尚无学生作答。", "No student attempts yet.")}</p>}</State></section>}
    <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}><DialogContent><DialogTitle>{tx("发布实践试卷", "Publish practical paper")}</DialogTitle><DialogDescription>{tx("全部自动阶段参考答案已验证为 AC。确认后发布当前草稿版本到指定班级；该版本发布后不可修改，可再创建修订草稿。", "All auto-stage reference solutions are validated AC. Publish this draft to the selected class; this version then becomes immutable, but you can create another draft revision.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setConfirmPublish(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy || !readyForPublish} onClick={() => void perform(async () => { if (!validate(true) || !readyForPublish) { setConfirmPublish(false); return; } await productionApi(`paper4/papers/${encodeURIComponent(id)}/publish`, { method: "POST" }); setConfirmPublish(false); router.replace(`/teacher/paper4/${encodeURIComponent(id)}`); paper.reload(); setMessage(tx("试卷已发布。", "Paper published.")); })}>{tx("确认发布", "Publish")}</Button></DialogFooter></DialogContent></Dialog>
    <WorkspaceSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} editorOnly initialSection="editor" settings={settings} update={updateSettings} reset={resetSettings}/>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="mt-3 block text-sm font-semibold"><span className="mb-1.5 block">{label}</span>{children}</label>; }

function FileMapEditor({ label, value, disabled, onChange, tx }: { label: string; value: Record<string, string>; disabled: boolean; onChange: (value: Record<string, string>) => void; tx: (zh: string, en: string) => string }) {
  const entries = Object.entries(value);
  const [newName, setNewName] = useState("");
  return <div className="mt-4"><h4 className="text-sm font-semibold">{label}</h4><div className="mt-2 space-y-2">{entries.map(([name, content]) => <div key={name} className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-2"><code className="text-xs font-semibold">{name}</code><Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${tx("移除", "Remove")} ${name}`} onClick={() => { const next = { ...value }; delete next[name]; onChange(next); }}><Trash2 size={14}/></Button></div><textarea aria-label={`${name} ${tx("内容", "content")}`} rows={3} className={`${area} mt-2 font-mono`} spellCheck={false} value={content} disabled={disabled} onChange={event => onChange({ ...value, [name]: event.target.value })}/></div>)}</div>{!disabled && <div className="mt-2 flex gap-2"><input aria-label={tx("新增文件名", "New filename")} placeholder="TheData.txt" className={input} value={newName} onChange={event => setNewName(event.target.value)}/><Button type="button" variant="secondary" disabled={newName.length > 76 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:txt|csv|dat)$/i.test(newName) || newName in value} onClick={() => { onChange({ ...value, [newName]: "" }); setNewName(""); }}><Plus size={14}/>{tx("文件", "File")}</Button></div>}</div>;
}

function StageEditor({ stage, disabled, onChange, onRemove, canRemove, index, tx, validation }: { stage: Paper4Stage; disabled: boolean; onChange: (patch: Partial<Paper4Stage>) => void; onRemove: () => void; canRemove: boolean; index: number; tx: (zh: string, en: string) => string; validation?: string }) {
  return <div className="rounded-md border border-border bg-surface-subtle p-3"><div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">{tx("阶段", "Stage")} {index + 1}{stage.judgeMode === "auto" && validation && <span className={`ml-2 ${validation === "AC" ? "text-success" : validation === "WA" || validation === "error" ? "text-destructive" : ""}`}>· {tx("参考验证", "Reference validation")}: {validation}</span>}</span><Button type="button" size="sm" variant="ghost" disabled={disabled || !canRemove} aria-label={tx("移除阶段", "Remove stage")} onClick={onRemove}><Trash2 size={14}/></Button></div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_110px]"><Field label={tx("阶段标题", "Stage title")}><input className={input} maxLength={140} value={stage.title} disabled={disabled} onChange={event => onChange({ title: event.target.value })}/></Field><Field label={tx("判题方式", "Judging mode")}><select className={input} disabled={disabled} value={stage.judgeMode ?? "manual"} onChange={event => onChange({ judgeMode: event.target.value as Paper4Stage["judgeMode"] })}><option value="auto">{tx("自动判题", "Auto")}</option><option value="manual">{tx("人工复核代码", "Manual code review")}</option><option value="evidence">{tx("证据/过程分", "Evidence")}</option></select></Field><Field label={tx("满分", "Maximum marks")}><input type="number" min={1} max={75} className={input} value={stage.maxMarks} disabled={disabled} onChange={event => onChange({ maxMarks: Number(event.target.value) })}/></Field></div><Field label={tx("阶段要求", "Stage instructions")}><textarea rows={2} className={area} value={stage.description} disabled={disabled} onChange={event => onChange({ description: event.target.value })}/></Field></div>;
}

function CaseEditor({ test, index, disabled, onChange, onRemove, tx }: { test: Paper4RunnerCase; index: number; disabled: boolean; onChange: (patch: Partial<Paper4RunnerCase>) => void; onRemove: () => void; tx: (zh: string, en: string) => string }) {
  return <div className="rounded-md border border-border bg-surface-subtle p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{tx("用例", "Case")} {index + 1}</strong><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={tx("移除用例", "Remove case")} onClick={onRemove}><Trash2 size={14}/></Button></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("用例编号", "Case ID")}><input className={input} value={test.id} disabled={disabled} onChange={event => onChange({ id: event.target.value })}/></Field><label className="mt-8 flex items-center gap-2 text-sm"><input type="checkbox" checked={test.public} disabled={disabled} onChange={event => onChange({ public: event.target.checked })}/>{tx("向学生显示本用例输出", "Show this case output to students")}</label></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("标准输入", "Standard input")}><textarea rows={3} className={`${area} font-mono`} value={test.stdin} disabled={disabled} onChange={event => onChange({ stdin: event.target.value })}/></Field><Field label={tx("预期标准输出", "Expected stdout")}><textarea rows={3} className={`${area} font-mono`} value={test.expectedStdout} disabled={disabled} onChange={event => onChange({ expectedStdout: event.target.value })}/></Field></div><Field label={tx("测试驱动代码（可选，仅在此用例执行）", "Test driver code (optional, runs in this case only)")}><textarea rows={3} className={`${area} font-mono`} spellCheck={false} value={test.driverCode ?? ""} disabled={disabled} onChange={event => onChange({ driverCode: event.target.value })}/></Field><FileMapEditor label={tx("此用例额外输入文件", "Additional input files for this case")} value={test.inputFiles} disabled={disabled} onChange={inputFiles => onChange({ inputFiles })} tx={tx}/><FileMapEditor label={tx("预期生成文件", "Expected generated files")} value={test.expectedFiles} disabled={disabled} onChange={expectedFiles => onChange({ expectedFiles })} tx={tx}/></div>;
}

export function TeacherPaper4Review({ paperId, attemptId }: { paperId: string; attemptId: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const attempt = useData<Paper4Attempt>(`paper4/attempts/${encodeURIComponent(attemptId)}`);
  const stages = attempt.data?.paper.questions.flatMap(question => question.stages.map(stage => ({ question, stage }))) ?? [];
  const [stageId, setStageId] = useState("");
  const [marks, setMarks] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [releaseOpen, setReleaseOpen] = useState(false);
  const selected = stages.find(item => item.stage.id === stageId) ?? stages[0];
  const selectedStageId = selected?.stage.id ?? "";
  const selectedMark = attempt.data?.marks.find(item => item.stageId === selectedStageId);
  const selectedSnapshot = selected && [...(attempt.data?.snapshots ?? [])].reverse().find(item => item.stageId === selected.stage.id);
  const selectedFinalCode = selected && attempt.data?.files.find(file => file.fileKey === selected.question.key)?.content;
  const markedCount = stages.filter(item => attempt.data?.marks.some(mark => mark.stageId === item.stage.id)).length;
  const canMark = attempt.data && !attempt.data.releasedAt && !["in_progress", "active", "draft", "released"].includes(attempt.data.status.toLowerCase());
  useEffect(() => {
    if (!selectedStageId) return;
    setMarks(selectedMark?.marks ?? 0); setNote(selectedMark?.note ?? "");
  }, [selectedStageId, selectedMark?.marks, selectedMark?.note]);
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  function releaseResult() {
    void perform(async () => {
      await productionApi(`paper4/attempts/${encodeURIComponent(attemptId)}/release`, { method: "POST" });
      setReleaseOpen(false);
      attempt.reload();
      setMessage(tx("成绩已公布。", "Result released."));
    });
  }
  return <>
    <AppLink href={`/teacher/paper4/${paperId}`} className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("返回试卷", "Back to paper")}</AppLink>
    <State data={attempt}>{attempt.data && <>
      <PageHeader eyebrow={tx("逐阶段批阅", "Stage marking")} title={attempt.data.studentName || attempt.data.studentIdentityId || tx("学生答卷", "Student attempt")} description={`${attempt.data.paper.title} · ${paper4Status(attempt.data.status, locale)} · ${markedCount}/${stages.length} ${tx("阶段已评分", "stages marked")}`} action={<Button disabled={busy || !canMark || markedCount !== stages.length} onClick={() => setReleaseOpen(true)}><Send size={15}/>{tx("公布成绩", "Release result")}</Button>}/>
      <div className="mt-5 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"><nav aria-label={tx("评分阶段", "Marking stages")} className={`${panel} h-fit p-3`}>{attempt.data.paper.questions.map(question => <div key={question.key} className="mb-3"><h2 className="px-2 py-1 text-sm font-bold">{question.key} · {question.title}</h2>{question.stages.map(stage => { const marked = attempt.data?.marks.find(item => item.stageId === stage.id); return <button type="button" key={stage.id} aria-current={stage.id === selected?.stage.id ? "step" : undefined} className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${stage.id === selected?.stage.id ? "bg-info-soft font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => setStageId(stage.id)}><span className="truncate">{stage.title}</span><span className={`shrink-0 text-xs ${marked ? "text-success" : "text-muted-foreground"}`}>{marked ? `${marked.marks}/${stage.maxMarks}` : `—/${stage.maxMarks}`}</span></button>; })}</div>)}</nav>
      <div className="min-w-0 space-y-4">{selected && <><section className={`${panel} p-5`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">{selected.question.key} · {selected.stage.maxMarks} {tx("分", "marks")}</p><h2 className="mt-1 text-lg font-bold">{selected.stage.title}</h2></div><span className="text-xs text-muted-foreground">{selectedSnapshot ? paper4Date(selectedSnapshot.createdAt, locale) : tx("无检查点", "No checkpoint")}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{selected.stage.description || tx("按试卷题目要求检查此阶段。", "Review this stage against the paper requirements.")}</p></section>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-bold">{selectedSnapshot?.sourceCode != null ? tx("阶段代码检查点", "Stage code checkpoint") : tx("最终提交代码", "Final submitted code")}</h2>{!selectedSnapshot && <p className="mt-1 text-xs text-muted-foreground">{tx("本阶段未保存单独检查点；以下为交卷时冻结的代码。过程/证据阶段无需学生上传额外截图。", "No separate checkpoint was saved for this stage. This is the code frozen on submission. Process/evidence stages require no extra screenshot upload.")}</p>}</div>{selectedSnapshot?.sourceCode != null || selectedFinalCode != null ? <CodeBlock code={selectedSnapshot?.sourceCode ?? selectedFinalCode ?? ""} language="python"/> : <p className="p-4 text-sm text-muted-foreground">{tx("没有可查看的代码。", "No code is available.")}</p>}</section>
        <section className={`${panel} p-5`}><h2 className="font-bold">{tx("教师评分", "Teacher mark")}</h2><p className="mt-1 text-xs text-muted-foreground">{tx("自动判题提供 AC 状态，但不直接换算为 Paper 4 分数。请按评分标准复核，也可给 0 分并说明原因。", "Auto judging reports AC status but does not convert it into Paper 4 marks. Review against the rubric; zero marks are valid with a reason.")}</p><div className="mt-4 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]"><Field label={tx("本阶段得分", "Stage marks")}><input type="number" min={0} max={selected.stage.maxMarks} step={1} className={input} disabled={!canMark || busy} value={marks} onChange={event => setMarks(Number(event.target.value))}/></Field><Field label={tx("评语与依据", "Feedback and evidence")}><textarea rows={3} className={area} disabled={!canMark || busy} value={note} onChange={event => setNote(event.target.value)}/></Field></div><Button className="mt-4" disabled={!canMark || busy || !Number.isInteger(marks) || marks < 0 || marks > selected.stage.maxMarks} onClick={() => void perform(async () => { await productionApi(`paper4/attempts/${encodeURIComponent(attemptId)}/marks`, { method: "PATCH", body: { stageId: selected.stage.id, marks, note } }); attempt.reload(); setMessage(tx("阶段评分已保存。", "Stage mark saved.")); })}><ClipboardCheck size={15}/>{tx("保存本阶段评分", "Save stage mark")}</Button></section></>}
      </div></div>
      <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}><span>{tx("当前汇总", "Current total")} · <strong>{attempt.data.score ?? attempt.data.marks.reduce((sum, item) => sum + item.marks, 0)} / {attempt.data.paper.totalMarks}</strong></span><span className="text-muted-foreground">{tx("全部阶段评分后才可公布。公布后学生可查看成绩。", "Mark every stage before releasing. Students see marks after release.")}</span></div>
    </>}</State>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}><DialogContent><DialogTitle>{tx("公布 Paper 4 成绩", "Release Paper 4 result")}</DialogTitle><DialogDescription>{tx("公布后学生将看到教师确认的阶段分数和整卷成绩。", "The student will see teacher-confirmed stage and total marks.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setReleaseOpen(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy} onClick={releaseResult}>{tx("确认公布", "Release")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

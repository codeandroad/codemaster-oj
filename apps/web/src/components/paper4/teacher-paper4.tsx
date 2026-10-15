"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FilePlus2, Plus, Save, Send, Trash2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Empty, State, useData } from "@/components/student/shared";
import { CodeBlock } from "@/components/student/shared";
import { apiMessage, productionApi, type SchoolClass } from "@/lib/production-api";
import { paper4Date, paper4Status, type Paper4Attempt, type Paper4AttemptSummary, type Paper4Paper, type Paper4PaperSummary, type Paper4Question, type Paper4RunnerCase, type Paper4Stage } from "./model";

const panel = "rounded-lg border border-border bg-surface panel-shadow";
const input = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";
const area = "w-full min-w-0 rounded-md border border-input bg-background p-3 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-primary";
type PaperDraft = Omit<Paper4Paper, "id" | "status" | "totalMarks" | "classId" | "startsAt" | "endsAt"> & { classId: string; startsAt: string; endsAt: string; runnerCases: Record<string, Paper4RunnerCase[]> };

function blankQuestion(index: number): Paper4Question {
  return { key: `Q${index}`, title: "", statement: "", starterCode: "", initialFiles: {}, outputFiles: [], stages: [{ id: `Q${index}-a`, title: "", description: "", maxMarks: [20, 25, 30][index - 1] ?? 0 }] };
}
function blankCase(index: number): Paper4RunnerCase {
  return { id: `case-${index}`, stdin: "", inputFiles: {}, expectedStdout: "", expectedFiles: {}, public: true };
}
function newDraft(): PaperDraft {
  return { title: "", description: "", classId: "", startsAt: "", endsAt: "", questions: [blankQuestion(1), blankQuestion(2), blankQuestion(3)], runnerCases: {} };
}
const dateInput = (value: string | null) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T") : "";
const toIso = (value: string) => value ? new Date(`${value}:00+08:00`).toISOString() : null;

export function TeacherPaper4List() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const papers = useData<{ items: Paper4PaperSummary[] }>("paper4/papers");
  const classes = useData<{ items: SchoolClass[] }>("classes");
  const className = (id: string | null) => classes.data?.items.find(item => item.id === id)?.name ?? "—";
  return <>
    <PageHeader eyebrow={tx("教学工具", "Teaching tools")} title={tx("Paper 4 实践评测", "Paper 4 practical assessment")} description={tx("制作 Python 编程实践卷，发布给班级并逐点评分。独立于普通 OJ 判题与积分。", "Create Python practical papers for a class and mark each stage. These papers are separate from ordinary OJ judging and points.")} action={<AppLink href="/teacher/paper4/new" className={buttonVariants()}><FilePlus2 size={16}/>{tx("新建试卷", "Create paper")}</AppLink>}/>
    <State data={papers}>{papers.data?.items.length ? <div className={`mt-5 overflow-hidden ${panel}`}><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>{[tx("试卷", "Paper"), tx("班级", "Class"), tx("时间", "Window"), tx("分值", "Marks"), tx("状态", "Status")].map(label => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{papers.data.items.map(paper => <tr key={paper.id} className="border-t border-border hover:bg-surface-subtle"><td className="px-4 py-3"><AppLink href={`/teacher/paper4/${paper.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{paper.title}</AppLink><span className="mt-1 block text-xs text-muted-foreground">{paper.questionCount} {tx("道大题", "questions")}</span></td><td className="px-4 py-3">{className(paper.classId)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{paper4Date(paper.startsAt, locale)} – {paper4Date(paper.endsAt, locale)}</td><td className="px-4 py-3 font-semibold">{paper.totalMarks}</td><td className="px-4 py-3">{paper4Status(paper.status, locale)}</td></tr>)}</tbody></table></div></div> : <Empty title={tx("还没有实践试卷", "No practical papers yet")} description={tx("先建立草稿并检查题目、阶段与测试，再发布给班级。", "Create a draft, check its questions, stages and tests, then publish to a class.")}/>}</State>
  </>;
}

export function TeacherPaper4Editor({ id }: { id: string }) {
  const { locale } = useLocale();
  const router = useRouter();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const fresh = id === "new";
  const paper = useData<Paper4Paper>(fresh ? "" : `paper4/papers/${encodeURIComponent(id)}`);
  const classes = useData<{ items: SchoolClass[] }>("classes");
  const attempts = useData<{ items: Paper4AttemptSummary[] }>(fresh ? "" : `paper4/attempts?paperId=${encodeURIComponent(id)}`);
  const [draft, setDraft] = useState<PaperDraft>(newDraft);
  const [selected, setSelected] = useState("Q1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  useEffect(() => {
    if (!paper.data) return;
    setDraft({ title: paper.data.title, description: paper.data.description, classId: paper.data.classId ?? "", startsAt: dateInput(paper.data.startsAt), endsAt: dateInput(paper.data.endsAt), questions: paper.data.questions, runnerCases: paper.data.runnerCases ?? {} });
    setSelected(paper.data.questions[0]?.key ?? "");
  }, [paper.data]);
  const published = Boolean(paper.data && paper.data.status.toLowerCase() !== "draft");
  const question = draft.questions.find(item => item.key === selected) ?? draft.questions[0];
  const maxMarks = draft.questions.reduce((sum, item) => sum + item.stages.reduce((stageSum, stage) => stageSum + Number(stage.maxMarks || 0), 0), 0);
  const cases = question ? draft.runnerCases[question.key] ?? [] : [];
  const updateQuestion = (key: string, update: (question: Paper4Question) => Paper4Question) => setDraft(current => ({ ...current, questions: current.questions.map(item => item.key === key ? update(item) : item) }));
  const updateCases = (key: string, update: (cases: Paper4RunnerCase[]) => Paper4RunnerCase[]) => setDraft(current => ({ ...current, runnerCases: { ...current.runnerCases, [key]: update(current.runnerCases[key] ?? []) } }));
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  function validate(): boolean {
    if (!draft.title.trim() || !draft.classId || !draft.questions.length || draft.questions.length > 3 || maxMarks !== 75) {
      setError(tx("请填写标题和班级，并使所有阶段分值合计恰好为 75。", "Enter a title and class, and make all stage marks total exactly 75.")); return false;
    }
    if (!draft.startsAt || !draft.endsAt || draft.startsAt >= draft.endsAt) {
      setError(tx("请设置有效的开始和结束时间。", "Set a valid start and end time.")); return false;
    }
    if (draft.questions.some(item => !item.title.trim() || !item.statement.trim() || !item.stages.length || item.stages.some(stage => !stage.title.trim() || !Number.isInteger(stage.maxMarks) || stage.maxMarks < 1 || stage.maxMarks > 75))) {
      setError(tx("每道题须有标题、题面及有效的评分阶段。", "Every question needs a title, statement and valid marking stages.")); return false;
    }
    const validFilename = (name: string) => name.length <= 76 && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:txt|csv|dat)$/i.test(name);
    if (draft.questions.some(item => [...Object.keys(item.initialFiles), ...(item.outputFiles ?? []), ...(draft.runnerCases[item.key] ?? []).flatMap(test => [...Object.keys(test.inputFiles), ...Object.keys(test.expectedFiles)])].some(name => !validFilename(name)))) {
      setError(tx("工作文件名须以 .txt、.csv 或 .dat 结尾，且不超过 76 个字符。", "Work filenames must end in .txt, .csv or .dat and be at most 76 characters.")); return false;
    }
    return true;
  }
  const payload = { ...draft, title: draft.title.trim(), description: draft.description.trim(), startsAt: toIso(draft.startsAt), endsAt: toIso(draft.endsAt) };
  return <>
    <AppLink href="/teacher/paper4" className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16}/>{tx("返回实践评测", "Back to practical papers")}</AppLink>
    <PageHeader eyebrow={fresh ? tx("新建试卷", "Create paper") : tx("实践试卷", "Practical paper")} title={fresh ? tx("建立 Paper 4 草稿", "Create a Paper 4 draft") : paper.data?.title ?? tx("正在加载…", "Loading…")} description={tx("先准备题面、各阶段分值和运行测试。试卷满分为 75 分；自动运行仅提供证据，正式分数由教师复核。", "Prepare questions, stage marks and runner cases. The paper is worth 75 marks; runs provide evidence, and teachers confirm marks.")}/>
    {!fresh && <State data={paper}>{null}</State>}
    <div className={`${panel} mt-5 p-4 sm:p-5`}><div className="grid gap-4 md:grid-cols-2"><Field label={tx("试卷标题", "Paper title")}><input className={input} maxLength={180} value={draft.title} disabled={published} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))}/></Field><Field label={tx("发布班级", "Class")}><select className={input} value={draft.classId} disabled={published} onChange={event => setDraft(value => ({ ...value, classId: event.target.value }))}><option value="">{tx("选择班级", "Select a class")}</option>{classes.data?.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label={tx("开始时间", "Starts at")}><input type="datetime-local" className={input} value={draft.startsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, startsAt: event.target.value }))}/></Field><Field label={tx("结束时间", "Ends at")}><input type="datetime-local" className={input} value={draft.endsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, endsAt: event.target.value }))}/></Field></div><Field label={tx("说明", "Instructions")}><textarea rows={2} className={area} value={draft.description} disabled={published} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}/></Field><p className="mt-3 text-xs text-muted-foreground">{tx("本期支持 Python 3 校内练习与模拟考试；请勿上传正式试卷保密材料。", "This version supports Python 3 school practice and mock exams. Do not upload confidential live exam materials.")}</p></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"><nav aria-label={tx("大题编辑导航", "Question editor navigation")} className={`${panel} h-fit p-3`}><div className="flex items-center justify-between gap-2 px-2 pb-2"><h2 className="text-sm font-bold">{tx("大题", "Questions")}</h2><span className={`text-xs font-semibold ${maxMarks === 75 ? "text-success" : "text-warning"}`}>{maxMarks}/75</span></div>{draft.questions.map((item, index) => <button key={item.key} type="button" aria-current={item.key === question?.key ? "page" : undefined} className={`mb-1 block min-h-10 w-full rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${item.key === question?.key ? "bg-info-soft font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => setSelected(item.key)}>{index + 1}. {item.title || tx("未命名大题", "Untitled question")}</button>)}<Button size="sm" variant="secondary" className="mt-2 w-full" disabled={published || draft.questions.length >= 3} onClick={() => { const number = Math.max(0, ...draft.questions.map(item => Number(item.key.slice(1)) || 0)) + 1; const next = blankQuestion(number); setDraft(current => ({ ...current, questions: [...current.questions, next], runnerCases: { ...current.runnerCases, [next.key]: [blankCase(1)] } })); setSelected(next.key); }}><Plus size={14}/>{tx("添加大题", "Add question")}</Button></nav>
    {question && <div className={`${panel} min-w-0 p-4 sm:p-5`}><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{question.key} · {tx("题目内容", "Question content")}</h2><Button size="sm" variant="ghost" disabled={published || draft.questions.length === 1} onClick={() => { setDraft(current => ({ ...current, questions: current.questions.filter(item => item.key !== question.key) })); setSelected(draft.questions.find(item => item.key !== question.key)?.key ?? ""); }}><Trash2 size={14}/>{tx("移除大题", "Remove")}</Button></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><Field label={tx("标题", "Title")}><input className={input} maxLength={180} value={question.title} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, title: event.target.value }))}/></Field><Field label={tx("入口文件名", "Entry file")}><input className={input} value={`${question.key}.py`} disabled aria-readonly="true"/></Field></div>
      <Field label={tx("题面（支持 Markdown）", "Statement (Markdown)")}><textarea rows={7} className={area} value={question.statement} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, statement: event.target.value }))}/></Field>
      <Field label={tx("起始代码", "Starter code")}><textarea rows={5} spellCheck={false} className={`${area} font-mono`} value={question.starterCode} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, starterCode: event.target.value }))}/></Field>
      <FileMapEditor label={tx("初始工作文件", "Initial work files")} value={question.initialFiles} disabled={published} tx={tx} onChange={initialFiles => updateQuestion(question.key, value => ({ ...value, initialFiles }))}/>
      <Field label={tx("允许收集的生成文件（每行一个文件名）", "Generated files to collect (one filename per line)")}><textarea rows={3} className={`${area} font-mono`} value={(question.outputFiles ?? []).join("\n")} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, outputFiles: event.target.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean) }))}/></Field>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("阶段与评分点", "Stages and marking points")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("学生在这些阶段保存不可覆盖的代码检查点。分数为教师复核上限。", "Students save immutable code checkpoints at these stages. Marks are teacher-reviewed caps.")}</p>
      <div className="mt-3 space-y-3">{question.stages.map((stage, stageIndex) => <StageEditor key={stage.id} stage={stage} disabled={published} tx={tx} onChange={patch => updateQuestion(question.key, value => ({ ...value, stages: value.stages.map(item => item.id === stage.id ? { ...item, ...patch } : item) }))} onRemove={() => updateQuestion(question.key, value => ({ ...value, stages: value.stages.filter(item => item.id !== stage.id) }))} canRemove={question.stages.length > 1} index={stageIndex}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateQuestion(question.key, value => ({ ...value, stages: [...value.stages, { id: `${question.key}-${value.stages.length + 1}-${Date.now()}`, title: "", description: "", maxMarks: 1 }] }))}><Plus size={14}/>{tx("添加阶段", "Add stage")}</Button>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("隔离运行测试", "Isolated runner cases")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("运行时为每个用例建立全新文件工作区。隐藏用例不向学生显示输入或预期结果。", "Each case runs in a fresh file workspace. Hidden inputs and expected results are not shown to students.")}</p><div className="mt-3 space-y-3">{cases.map((item, index) => <CaseEditor key={`${question.key}:${index}`} test={item} index={index} tx={tx} disabled={published} onChange={patch => updateCases(question.key, values => values.map((value, position) => position === index ? { ...value, ...patch } : value))} onRemove={() => updateCases(question.key, values => values.filter((_, position) => position !== index))}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateCases(question.key, values => [...values, blankCase(values.length + 1)])}><Plus size={14}/>{tx("添加测试", "Add case")}</Button>
    </div>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-sm">{paper.data && <span className="font-semibold">{paper4Status(paper.data.status, locale)}</span>}<span className="ml-3 text-muted-foreground">{tx("总分", "Total")}: {maxMarks} / 75</span></div><div className="flex gap-2">{!published && <Button disabled={busy || Boolean(!draft.title.trim())} onClick={() => void perform(async () => { if (!validate()) return; const result = fresh ? await productionApi<Paper4Paper>("paper4/papers", { method: "POST", body: payload }) : await productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }); setMessage(tx("试卷草稿已保存。", "Paper draft saved.")); if (fresh) router.push(`/teacher/paper4/${result.id}`); else paper.reload(); })}><Save size={15}/>{fresh ? tx("建立草稿", "Create draft") : tx("保存草稿", "Save draft")}</Button>}{!fresh && !published && <Button variant="secondary" disabled={busy || maxMarks !== 75} onClick={() => setConfirmPublish(true)}><Send size={15}/>{tx("发布到班级", "Publish to class")}</Button>}</div></div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    {!fresh && <section className={`${panel} mt-7 overflow-hidden`}><div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-bold">{tx("学生交卷与批阅", "Student attempts and marking")}</h2><Button variant="ghost" size="sm" onClick={attempts.reload}>{tx("刷新", "Refresh")}</Button></div><State data={attempts}>{attempts.data?.items.length ? <div className="divide-y divide-border">{attempts.data.items.map(item => <AppLink href={`/teacher/paper4/${id}/review/${item.id}`} key={item.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary"><span className="font-semibold text-primary">{item.studentName || item.studentIdentityId || item.id}</span><span className="text-muted-foreground">{paper4Status(item.status, locale)} · {item.score ?? "—"} / 75 · {paper4Date(item.submittedAt, locale)}</span></AppLink>)}</div> : <p className="p-5 text-sm text-muted-foreground">{tx("尚无学生作答。", "No student attempts yet.")}</p>}</State></section>}
    <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}><DialogContent><DialogTitle>{tx("发布实践试卷", "Publish practical paper")}</DialogTitle><DialogDescription>{tx("发布时将先保存当前编辑，再把试卷开放给指定班级。发布后的试卷版本不可修改。", "Publishing saves the current edits and opens the paper to the class. A published paper cannot be edited.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setConfirmPublish(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy} onClick={() => void perform(async () => { if (!validate()) { setConfirmPublish(false); return; } await productionApi(`paper4/papers/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }); await productionApi(`paper4/papers/${encodeURIComponent(id)}/publish`, { method: "POST" }); setConfirmPublish(false); paper.reload(); setMessage(tx("试卷已发布。", "Paper published.")); })}>{tx("确认发布", "Publish")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="mt-3 block text-sm font-semibold"><span className="mb-1.5 block">{label}</span>{children}</label>; }

function FileMapEditor({ label, value, disabled, onChange, tx }: { label: string; value: Record<string, string>; disabled: boolean; onChange: (value: Record<string, string>) => void; tx: (zh: string, en: string) => string }) {
  const entries = Object.entries(value);
  const [newName, setNewName] = useState("");
  return <div className="mt-4"><h4 className="text-sm font-semibold">{label}</h4><div className="mt-2 space-y-2">{entries.map(([name, content]) => <div key={name} className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-2"><code className="text-xs font-semibold">{name}</code><Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${tx("移除", "Remove")} ${name}`} onClick={() => { const next = { ...value }; delete next[name]; onChange(next); }}><Trash2 size={14}/></Button></div><textarea aria-label={`${name} ${tx("内容", "content")}`} rows={3} className={`${area} mt-2 font-mono`} spellCheck={false} value={content} disabled={disabled} onChange={event => onChange({ ...value, [name]: event.target.value })}/></div>)}</div>{!disabled && <div className="mt-2 flex gap-2"><input aria-label={tx("新增文件名", "New filename")} placeholder="TheData.txt" className={input} value={newName} onChange={event => setNewName(event.target.value)}/><Button type="button" variant="secondary" disabled={newName.length > 76 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:txt|csv|dat)$/i.test(newName) || newName in value} onClick={() => { onChange({ ...value, [newName]: "" }); setNewName(""); }}><Plus size={14}/>{tx("文件", "File")}</Button></div>}</div>;
}

function StageEditor({ stage, disabled, onChange, onRemove, canRemove, index, tx }: { stage: Paper4Stage; disabled: boolean; onChange: (patch: Partial<Paper4Stage>) => void; onRemove: () => void; canRemove: boolean; index: number; tx: (zh: string, en: string) => string }) {
  return <div className="rounded-md border border-border bg-surface-subtle p-3"><div className="flex items-center justify-between"><span className="text-xs font-bold text-muted-foreground">{tx("阶段", "Stage")} {index + 1}</span><Button type="button" size="sm" variant="ghost" disabled={disabled || !canRemove} aria-label={tx("移除阶段", "Remove stage")} onClick={onRemove}><Trash2 size={14}/></Button></div><div className="grid gap-3 sm:grid-cols-[1fr_110px]"><Field label={tx("阶段标题", "Stage title")}><input className={input} maxLength={140} value={stage.title} disabled={disabled} onChange={event => onChange({ title: event.target.value })}/></Field><Field label={tx("满分", "Maximum marks")}><input type="number" min={1} max={75} className={input} value={stage.maxMarks} disabled={disabled} onChange={event => onChange({ maxMarks: Number(event.target.value) })}/></Field></div><Field label={tx("阶段要求", "Stage instructions")}><textarea rows={2} className={area} value={stage.description} disabled={disabled} onChange={event => onChange({ description: event.target.value })}/></Field></div>;
}

function CaseEditor({ test, index, disabled, onChange, onRemove, tx }: { test: Paper4RunnerCase; index: number; disabled: boolean; onChange: (patch: Partial<Paper4RunnerCase>) => void; onRemove: () => void; tx: (zh: string, en: string) => string }) {
  return <div className="rounded-md border border-border bg-surface-subtle p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{tx("用例", "Case")} {index + 1}</strong><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={tx("移除用例", "Remove case")} onClick={onRemove}><Trash2 size={14}/></Button></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("用例编号", "Case ID")}><input className={input} value={test.id} disabled={disabled} onChange={event => onChange({ id: event.target.value })}/></Field><label className="mt-8 flex items-center gap-2 text-sm"><input type="checkbox" checked={test.public} disabled={disabled} onChange={event => onChange({ public: event.target.checked })}/>{tx("向学生显示本用例输出", "Show this case output to students")}</label></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("标准输入", "Standard input")}><textarea rows={3} className={`${area} font-mono`} value={test.stdin} disabled={disabled} onChange={event => onChange({ stdin: event.target.value })}/></Field><Field label={tx("预期标准输出", "Expected stdout")}><textarea rows={3} className={`${area} font-mono`} value={test.expectedStdout} disabled={disabled} onChange={event => onChange({ expectedStdout: event.target.value })}/></Field></div><FileMapEditor label={tx("此用例额外输入文件", "Additional input files for this case")} value={test.inputFiles} disabled={disabled} onChange={inputFiles => onChange({ inputFiles })} tx={tx}/><FileMapEditor label={tx("预期生成文件", "Expected generated files")} value={test.expectedFiles} disabled={disabled} onChange={expectedFiles => onChange({ expectedFiles })} tx={tx}/></div>;
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
        <section className={`${panel} overflow-hidden`}><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-bold">{tx("阶段代码检查点", "Stage code checkpoint")}</h2></div>{selectedSnapshot?.sourceCode != null ? <CodeBlock code={selectedSnapshot.sourceCode} language="python"/> : <p className="p-4 text-sm text-muted-foreground">{tx("学生未在本阶段保存检查点。不能将最终代码冒充阶段证据。", "The student did not save a checkpoint for this stage. Final code cannot stand in for stage evidence.")}</p>}</section>
        <section className={`${panel} p-5`}><h2 className="font-bold">{tx("教师评分", "Teacher mark")}</h2><p className="mt-1 text-xs text-muted-foreground">{tx("自动运行只提供证据，不自动给出 Paper 4 分数。可给 0 分，并记录理由。", "Runs provide evidence; they do not assign Paper 4 marks. Zero is a valid mark; record a reason when appropriate.")}</p><div className="mt-4 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]"><Field label={tx("本阶段得分", "Stage marks")}><input type="number" min={0} max={selected.stage.maxMarks} step={1} className={input} disabled={!canMark || busy} value={marks} onChange={event => setMarks(Number(event.target.value))}/></Field><Field label={tx("评语与依据", "Feedback and evidence")}><textarea rows={3} className={area} disabled={!canMark || busy} value={note} onChange={event => setNote(event.target.value)}/></Field></div><Button className="mt-4" disabled={!canMark || busy || !Number.isInteger(marks) || marks < 0 || marks > selected.stage.maxMarks} onClick={() => void perform(async () => { await productionApi(`paper4/attempts/${encodeURIComponent(attemptId)}/marks`, { method: "PATCH", body: { stageId: selected.stage.id, marks, note } }); attempt.reload(); setMessage(tx("阶段评分已保存。", "Stage mark saved.")); })}><ClipboardCheck size={15}/>{tx("保存本阶段评分", "Save stage mark")}</Button></section></>}
      </div></div>
      <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}><span>{tx("当前汇总", "Current total")} · <strong>{attempt.data.score ?? attempt.data.marks.reduce((sum, item) => sum + item.marks, 0)} / {attempt.data.paper.totalMarks}</strong></span><span className="text-muted-foreground">{tx("全部阶段评分后才可公布。公布后学生可查看成绩。", "Mark every stage before releasing. Students see marks after release.")}</span></div>
    </>}</State>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}><DialogContent><DialogTitle>{tx("公布 Paper 4 成绩", "Release Paper 4 result")}</DialogTitle><DialogDescription>{tx("公布后学生将看到教师确认的阶段分数和整卷成绩。", "The student will see teacher-confirmed stage and total marks.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setReleaseOpen(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy} onClick={releaseResult}>{tx("确认公布", "Release")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

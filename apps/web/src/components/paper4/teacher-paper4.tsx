"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ClipboardCheck, Download, FilePlus2, Maximize2, Minimize2, Play, Plus, RotateCcw, Save, Send, Settings, Trash2, Upload } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Empty, State, useData } from "@/components/student/shared";
import { CodeBlock } from "@/components/student/shared";
import { CodeEditor } from "@/components/student/code-editor";
import { useWorkspaceSettings, WorkspaceSettingsDialog } from "@/components/student/workspace-settings";
import { apiMessage, productionApi, type CampusUser } from "@/lib/production-api";
import { paper4ClassNames, paper4Date, paper4Status, type Paper4Attempt, type Paper4AttemptSummary, type Paper4Paper, type Paper4PaperSummary, type Paper4Question, type Paper4RunnerCase, type Paper4Run, type Paper4Stage } from "./model";
import { Paper4CatalogPreview } from "./paper4-catalog-preview";
import { Paper4Content } from "./paper4-content";
import contentStyles from "./paper4-content.module.css";
import layoutStyles from "./teacher-paper4.module.css";
import listStyles from "./teacher-paper4-list.module.css";
import { downloadPaper4Export, type Paper4ExportEnvelope } from "./paper4-export";
import { Paper4CatalogFilter } from "./catalog-filter";
import { filterPaper4Catalog, paper4ExamLabel } from "./paper4-catalog";
import { Paper4BatchPublishDialog } from "./paper4-batch-publish-dialog";
import { Paper4BatchImportDialog } from "./paper4-batch-import-dialog";
import { Paper4AssignDialog } from "./paper4-assign-dialog";
import { Paper4ShortTitleEditor } from "./paper4-short-title";

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
  const router = useRouter();
  const search = useSearchParams();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const scope = search.get("scope") === "activities" ? "activities" : "catalog";
  const catalog = scope === "catalog";
  const [importOpen, setImportOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [year, setYear] = useState("");
  const [session, setSession] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAssignOpen, setBatchAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Paper4PaperSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Paper4PaperSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);
  const batchButtonRef = useRef<HTMLButtonElement>(null);
  const papers = useData<{ items: Paper4PaperSummary[] }>(`paper4/papers?scope=${scope}`);
  const categoryItems = papers.data?.items.filter(paper => {
    const kind = paper.deliveryKind ?? (paper.classId || paper.startsAt || paper.endsAt ? "activity" : "catalog");
    return kind === (catalog ? "catalog" : "activity") && Boolean(paper.archivedAt) === showArchived;
  }) ?? [];
  const visible = filterPaper4Catalog(categoryItems, year, session);
  const selectable = visible.filter(paper => paper.canManage && paper.canExport || catalog && paper.status === "published" && !paper.archivedAt && paper.canAssign);
  const selectedPapers = selectable.filter(paper => selectedIds.includes(paper.id));
  const exportPapers = selectedPapers.filter(paper => paper.canManage && paper.canExport);
  const assignPapers = catalog ? selectedPapers.filter(paper => paper.status === "published" && !paper.archivedAt && paper.canAssign) : [];
  const publishPapers = catalog ? selectedPapers.filter(paper => paper.status === "draft" && !paper.archivedAt) : [];
  const allSelected = selectable.length > 0 && selectable.slice(0, 100).every(paper => selectedIds.includes(paper.id));
  const partialSelection = selectedPapers.length > 0 && !allSelected;
  const checkbox = "size-4 cursor-pointer rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";
  const changeCategory = (archived: boolean) => { setShowArchived(archived); setYear(""); setSession(""); setSelectedIds([]); };
  useEffect(() => {
    setSelectedIds([]); setYear(""); setSession(""); setShowArchived(false);
    setBatchOpen(false); setBatchAssignOpen(false); setAssignTarget(null); setError(""); setMessage("");
  }, [scope]);

  async function archiveOrRestore() {
    if (!archiveTarget) return;
    const restoring = Boolean(archiveTarget.archivedAt);
    setBusy(true); setError(""); setMessage("");
    try {
      await productionApi(`paper4/papers/${encodeURIComponent(archiveTarget.id)}/${restoring ? "restore" : "archive"}`, { method: "POST" });
      setArchiveTarget(null);
      setSelectedIds(ids => ids.filter(id => id !== archiveTarget.id));
      papers.reload();
      setMessage(restoring ? tx("试卷已恢复。", "Paper restored.") : tx("试卷已归档。", "Paper archived."));
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  async function exportPaper(paper: Paper4PaperSummary) {
    setBusy(true); setError(""); setMessage("");
    try {
      const envelope = await productionApi<Paper4ExportEnvelope>(`paper4/papers/${encodeURIComponent(paper.id)}/export?view=current`);
      downloadPaper4Export(envelope);
      setMessage(tx("试卷包已下载；文件含参考答案和隐藏测试，请妥善保存。", "Paper package downloaded. It includes reference solutions and hidden tests; store it securely."));
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  async function exportSelected() {
    setBusy(true); setError(""); setMessage("");
    try {
      const envelope = await productionApi<Paper4ExportEnvelope>("paper4/papers/batch-export", { method: "POST", body: { paperIds: exportPapers.map(paper => paper.id) } });
      downloadPaper4Export(envelope);
      setMessage(tx(`已导出 ${exportPapers.length} 套试卷到 paper4-papers.zip，内含参考答案和隐藏测试。`, `${exportPapers.length} papers exported to paper4-papers.zip, including references and hidden tests.`));
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div className={listStyles.page}>
    <PageHeader title={tx("Paper 4 试卷", "Paper 4 papers")} action={<div className={listStyles.headerActions}><Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}><Upload size={14}/>{tx("导入 JSON / ZIP", "Import JSON / ZIP")}</Button><AppLink href="/teacher/paper4/new" className={buttonVariants({size:"sm"})}><FilePlus2 size={14}/>{tx("新建试卷", "Create paper")}</AppLink></div>}/>
    <section className={listStyles.controls}>
      <div className={listStyles.controlTop}>
    <nav aria-label={tx("试卷类型", "Paper type")} className={listStyles.tabs}>
      {(["catalog", "activities"] as const).map(value => <button key={value} type="button" aria-pressed={scope === value} onClick={() => router.replace(value === "activities" ? "/teacher/paper4?scope=activities" : "/teacher/paper4")} className={scope === value ? listStyles.activeTab : undefined}>{value === "catalog" ? tx("自由练习题库", "Practice library") : tx("已布置活动", "Assigned activities")}</button>)}
    </nav>
    <div className={listStyles.categories}>
      <Button size="sm" variant={showArchived ? "secondary" : "default"} aria-pressed={!showArchived} onClick={() => changeCategory(false)}>{tx("使用中", "Active")}</Button>
      <Button size="sm" variant={showArchived ? "default" : "secondary"} aria-pressed={showArchived} onClick={() => changeCategory(true)}>{tx("已归档", "Archived")}</Button>
    </div>
      </div>
    <div className={listStyles.filterBar}>
      <Paper4CatalogFilter compact items={categoryItems} year={year} session={session} onYear={value => { setYear(value); setSelectedIds([]); }} onSession={value => { setSession(value); setSelectedIds([]); }}/>
      <div className={listStyles.batchActions}>
        <span role="status" aria-live="polite" className={listStyles.selectionCount}>{tx(`已选 ${selectedPapers.length} 套`, `${selectedPapers.length} selected`)}</span>
        {selectedPapers.length > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelectedIds([])}>{tx("取消选择", "Clear selection")}</Button>}
        {catalog && !showArchived && <Button size="sm" variant="secondary" disabled={busy || !selectedPapers.length} onClick={() => router.push(`/teacher/luq?${new URLSearchParams({ targetType: "paper4", mode: "batch", ids: selectedPapers.map(paper => paper.id).join(",") })}`)}>{tx("Luq 价格", "Luq prices")}</Button>}
        <Button size="sm" variant="secondary" disabled={busy || !exportPapers.length} title={tx("ZIP 内含参考答案和隐藏测试，请妥善保存", "ZIP includes references and hidden tests; keep it private")} onClick={() => void exportSelected()}><Download size={16} aria-hidden="true"/>{tx(`导出 ZIP${exportPapers.length ? `（${exportPapers.length}）` : ""}`, `Export ZIP${exportPapers.length ? ` (${exportPapers.length})` : ""}`)}</Button>
        {catalog && !showArchived && <Button size="sm" variant="secondary" disabled={busy || !assignPapers.length} onClick={() => { setError(""); setMessage(""); setBatchAssignOpen(true); }}><ClipboardCheck size={16} aria-hidden="true"/>{tx(`批量布置${assignPapers.length ? `（${assignPapers.length}）` : ""}`, `Assign selected${assignPapers.length ? ` (${assignPapers.length})` : ""}`)}</Button>}
        {catalog && !showArchived && <Button size="sm" ref={batchButtonRef} disabled={busy || !publishPapers.length} onClick={() => { setError(""); setMessage(""); setBatchOpen(true); }}><Send size={16} aria-hidden="true"/>{tx(`公开所选${publishPapers.length ? `（${publishPapers.length}）` : ""}`, `Publish selected${publishPapers.length ? ` (${publishPapers.length})` : ""}`)}</Button>}
      </div>
    </div>
    </section>
    {selectable.length > 100 && <p className="mt-2 text-xs text-muted-foreground">{tx("每次最多选择 100 套试卷。", "Select up to 100 papers at a time.")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    <State data={papers}>{visible.length ? <div className={listStyles.tableWrap}>
      <table className={`${listStyles.table} ${catalog ? listStyles.catalogTable : listStyles.activityTable}`}>
        {catalog && <colgroup><col style={{width:36}}/><col style={{width:"44%"}}/><col style={{width:56}}/><col style={{width:80}}/><col/></colgroup>}
        <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
          {<th scope="col" className="w-14 px-1 py-1">
            <label className={listStyles.checkTarget}>
              <input ref={element => { selectAllRef.current = element; if (element) element.indeterminate = partialSelection; }} type="checkbox" className={checkbox} checked={allSelected} aria-checked={partialSelection ? "mixed" : allSelected} disabled={busy || !selectable.length} aria-label={tx("全选当前列表可操作的试卷（最多100套）", "Select available papers in this list (up to 100)")} onChange={() => setSelectedIds(allSelected ? [] : selectable.slice(0, 100).map(paper => paper.id))}/>
            </label>
          </th>}
          {[tx("试卷", "Paper"), ...(!catalog ? [tx("布置对象", "Recipients"), tx("类型", "Type"), tx("时间", "Window")] : []), tx("分值", "Marks"), tx("状态", "Status"), tx("操作", "Actions")].map(label => <th scope="col" key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}
        </tr></thead>
        <tbody>{visible.map(paper => {
          const selected = selectedPapers.some(item => item.id === paper.id);
          const eligible = selectable.some(item => item.id === paper.id);
          const status = paper.status === "published" ? catalog ? tx("已公开", "Public") : tx("已布置", "Assigned") : paper4Status(paper.status, locale);
          return <tr key={paper.id} className={`border-t border-border ${selected ? "bg-info-soft" : "hover:bg-surface-subtle"}`}>
            {<td className="px-1 py-1">
              <label className={listStyles.checkTarget} title={eligible ? undefined : tx("仅可选择本人可管理或可布置的试卷", "Select papers you can manage or assign")}>
                <input type="checkbox" className={checkbox} checked={selected} disabled={busy || !eligible || (!selected && selectedPapers.length >= 100)} aria-label={tx(`选择「${paper.title}」`, `Select ${paper.title}`)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, paper.id] : ids.filter(id => id !== paper.id))}/>
              </label>
            </td>}
            <td className={listStyles.paperCell}><AppLink href={`/teacher/paper4/${paper.id}`} title={paper.title} className={`${listStyles.title} font-semibold text-primary hover:underline focus-visible:underline`}>{paper.title}</AppLink><span className={listStyles.metadata}>{paper.questionCount} {tx("道大题", "questions")}{paper4ExamLabel(paper, locale) && ` · ${paper4ExamLabel(paper, locale)}`}</span></td>
            {!catalog && <><td className="px-4 py-3"><span className="whitespace-nowrap font-medium">{typeof paper.participantCount === "number" ? tx(`${paper.participantCount} 名学生`, `${paper.participantCount} students`) : tx("按学生名单", "Selected students")}</span>{paper4ClassNames(paper) && <span className="mt-1 block text-xs text-muted-foreground">{paper4ClassNames(paper)}</span>}</td><td className="whitespace-nowrap px-4 py-3">{paper.activityKind === "exam" ? tx("模拟考试", "Mock exam") : tx("练习任务", "Practice task")}</td><td className="px-4 py-3 text-xs text-muted-foreground">{paper.startsAt || paper.endsAt ? `${paper.startsAt ? paper4Date(paper.startsAt, locale) : tx("即日起", "Available now")} – ${paper.endsAt ? paper4Date(paper.endsAt, locale) : tx("无截止时间", "No deadline")}` : tx("不限时间", "No time limit")}</td></>}
            <td className="px-4 py-3 font-semibold">{paper.totalMarks}</td>
            <td className="px-4 py-3"><span className={paper.archivedAt ? "rounded bg-muted px-2 py-1 text-xs font-semibold" : "whitespace-nowrap text-sm"}>{paper.archivedAt ? tx("已归档", "Archived") : status}</span>{paper.archivedAt && <span className="mt-1 block text-xs text-muted-foreground">{status}</span>}</td>
            <td className="px-4 py-3"><div className={listStyles.rowActions}>
              {catalog && paper.status === "published" && !paper.archivedAt && paper.canAssign && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setError(""); setMessage(""); setAssignTarget(paper); }}><ClipboardCheck size={14}/>{tx("布置活动", "Assign activity")}</Button>}
              {paper.canManage && paper.canExport && <Button size="sm" variant="ghost" disabled={busy} title={tx("下载可再次导入的 JSON，包含参考答案和隐藏测试", "Download reimportable JSON with reference solutions and hidden tests")} onClick={() => void exportPaper(paper)}><Download size={14}/>{tx("导出 JSON", "Export JSON")}</Button>}
              {paper.canManage && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setArchiveTarget(paper)}>{paper.archivedAt ? <RotateCcw size={14}/> : <Archive size={14}/>} {paper.archivedAt ? tx("恢复", "Restore") : tx("归档", "Archive")}</Button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <Empty title={year || session ? tx("没有符合筛选条件的试卷", "No papers match these filters") : showArchived ? tx("暂无已归档试卷", "No archived papers") : catalog ? tx("暂无自由练习试卷", "No practice library papers") : tx("暂无已布置活动", "No assigned activities")} description={year || session ? tx("请调整年份或考季后重试。", "Try another year or exam session.") : showArchived ? tx("归档的试卷会显示在这里，历史作答和成绩仍会保留。", "Archived papers appear here, with historical attempts and marks retained.") : catalog ? tx("创建或导入草稿，验证参考答案后即可发布为全校自由练习。", "Create or import a draft, validate its references, then publish it for school-wide free practice.") : tx("从已公开试卷中选择学生布置练习或模拟考试，不要求先加入班级。", "Assign a public paper to selected students as practice or a mock exam. Class membership is not required.")}/>}</State>
    {batchOpen && publishPapers.length > 0 && <Paper4BatchPublishDialog papers={publishPapers} onClose={() => setBatchOpen(false)} onPublished={count => { setBatchOpen(false); setSelectedIds([]); setMessage(tx(`已公开 ${count} 套试卷，全校学生可自由练习。`, `${count} papers published for school-wide free practice.`)); papers.reload(); }} onReturnFocus={() => { if (batchButtonRef.current && !batchButtonRef.current.disabled) batchButtonRef.current.focus(); else selectAllRef.current?.focus(); }}/>}
    {batchAssignOpen && assignPapers.length > 0 && <Paper4AssignDialog papers={assignPapers} onClose={() => setBatchAssignOpen(false)} onCreated={activities => { setBatchAssignOpen(false); setSelectedIds([]); setMessage(tx(`已布置 ${activities.length} 套试卷，可在“已布置活动”中查看。`, `${activities.length} papers assigned. View them in Assigned activities.`)); papers.reload(); }}/>}
    {assignTarget && <Paper4AssignDialog paper={assignTarget} onClose={() => setAssignTarget(null)} onCreated={activities => { setAssignTarget(null); router.push(`/teacher/paper4/${activities[0]!.id}`); }}/>}
    {importOpen && <Paper4BatchImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={count => { setSelectedIds([]); setMessage(tx(`已创建 ${count} 套 Paper 4 草稿，验证参考答案后即可公开。`, `${count} Paper 4 drafts created. Validate references before publishing.`)); papers.reload(); }}/>}
    <Paper4ArchiveDialog paper={archiveTarget} busy={busy} tx={tx} onOpenChange={open => { if (!open && !busy) setArchiveTarget(null); }} onConfirm={() => void archiveOrRestore()}/>
  </div>;
}

function Paper4ArchiveDialog({ paper, busy, tx, onOpenChange, onConfirm }: { paper: Paper4PaperSummary | Paper4Paper | null; busy: boolean; tx: (zh: string, en: string) => string; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const restoring = Boolean(paper?.archivedAt);
  const catalog = paper?.deliveryKind !== "activity";
  const explanation = catalog
    ? restoring ? tx("恢复后重新向全校开放自由练习，历史答卷与成绩保留。", "Restore school-wide free practice with historical attempts and marks retained.") : tx("归档后关闭此自由练习的学生入口，历史答卷与成绩保留。已单独布置的活动继续使用其原版本。", "Close student access to this free practice while retaining attempts and marks. Separate assigned activities continue using their original version.")
    : restoring ? tx("恢复后，仍在活动时间内的答卷可继续作答。", "Restore the activity so attempts can continue within its time window.") : tx("归档后暂停此活动的学生作答，已有代码、答卷与成绩保留。", "Pause student work on this activity while retaining code, attempts and marks.");
  return <Dialog open={Boolean(paper)} onOpenChange={onOpenChange}><DialogContent><DialogTitle>{restoring ? tx("恢复 Paper 4 试卷", "Restore Paper 4 paper") : tx("归档 Paper 4 试卷", "Archive Paper 4 paper")}</DialogTitle><DialogDescription>{paper?.title}<span className="mt-2 block">{explanation}</span></DialogDescription><DialogFooter><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy} onClick={onConfirm}>{restoring ? tx("确认恢复", "Restore") : tx("确认归档", "Archive")}</Button></DialogFooter></DialogContent></Dialog>;
}

export function TeacherPaper4Editor({ id, user }: { id: string; user: CampusUser }) {
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const fresh = id === "new";
  const viewingDraft = search.get("view") === "draft";
  const pinnedVersion = search.get("versionId");
  const paper = useData<Paper4Paper>(fresh ? "" : `paper4/papers/${encodeURIComponent(id)}${pinnedVersion !== null ? `?versionId=${encodeURIComponent(pinnedVersion)}` : viewingDraft ? "?view=draft" : ""}`);
  const attempts = useData<{ items: Paper4AttemptSummary[] }>(fresh || pinnedVersion !== null || !paper.data?.canManage ? "" : `paper4/attempts?paperId=${encodeURIComponent(id)}`);
  const [draft, setDraft] = useState<PaperDraft>(newDraft);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [selected, setSelected] = useState("Q1");
  const [selectedCaseStage, setSelectedCaseStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [referencePendingRefresh, setReferencePendingRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [referenceExpanded, setReferenceExpanded] = useState(false);
  const [referenceFeedback, setReferenceFeedback] = useState<Record<string, string>>({});
  const { settings, update: updateSettings, reset: resetSettings } = useWorkspaceSettings(user.id);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  useEffect(() => {
    if (!paper.data) return;
    const next = { title: paper.data.title, shortTitle: paper.data.shortTitle ?? "", description: paper.data.description, examYear: paper.data.examYear ?? null, examSession: paper.data.examSession ?? null, examVariant: paper.data.examVariant ?? null, classId: paper.data.classId ?? "", startsAt: dateInput(paper.data.startsAt), endsAt: dateInput(paper.data.endsAt), questions: paper.data.questions, runnerCases: paper.data.runnerCases ?? {}, referenceSolutions: paper.data.referenceSolutions ?? {} };
    setDraft(next);
    setSavedSnapshot(JSON.stringify(next));
    setReferencePendingRefresh(false);
    setSelected(current => paper.data?.questions.some(item => item.key === current) ? current : paper.data?.questions[0]?.key ?? "");
    setSelectedCaseStage(current => paper.data?.questions.some(item => item.stages.some(stage => stage.id === current)) ? current : paper.data?.questions[0]?.stages.find(stage => stage.judgeMode === "auto")?.id ?? "");
  }, [paper.data]);
  const archived = Boolean(paper.data?.archivedAt);
  const isPublished = Boolean(paper.data && paper.data.status.toLowerCase() !== "draft");
  const published = isPublished || archived;
  const isActivity = paper.data?.deliveryKind === "activity";
  const examActivity = paper.data?.activityKind === "exam";
  const displayStatus = isPublished ? isActivity ? tx("已布置", "Assigned") : tx("已公开", "Public") : paper4Status(paper.data?.status ?? "draft", locale);
  const question = draft.questions.find(item => item.key === selected) ?? draft.questions[0];
  const referenceLineCount = (draft.referenceSolutions[question?.key] ?? "").split("\n").length;
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
    if (publishing && isActivity && examActivity && (!draft.startsAt || !draft.endsAt)) {
      setError(tx("模拟考试须设置开始和结束时间。", "Set both start and end times for a mock exam.")); return false;
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
  const contentDraft = Object.fromEntries(Object.entries(draft).filter(([key]) => !["classId", "startsAt", "endsAt"].includes(key)));
  const payload = { ...contentDraft, ...(isActivity ? { classId: draft.classId || null, startsAt: toIso(draft.startsAt), endsAt: toIso(draft.endsAt) } : {}), title: draft.title.trim(), description: draft.description.trim(), runnerCases: Object.fromEntries(draft.questions.flatMap(item => item.stages.filter(stage => stage.judgeMode === "auto").map(stage => [stage.id, draft.runnerCases[stage.id] ?? []]))), referenceSolutions: Object.fromEntries(draft.questions.map(item => [item.key, draft.referenceSolutions[item.key] ?? ""])) };
  const validation = paper.data?.referenceValidation ?? {};
  const allAutoStages = draft.questions.flatMap(item => item.stages.filter(stage => stage.judgeMode === "auto"));
  const eachQuestionHasAuto = draft.questions.every(item => item.stages.some(stage => stage.judgeMode === "auto"));
  const referencesReady = allAutoStages.every(stage => validation[stage.id]?.status === "AC");
  const readyForPublish = !draftDirty && !referencePendingRefresh && eachQuestionHasAuto && referencesReady && (!isActivity || !examActivity || Boolean(draft.startsAt && draft.endsAt));
  async function createRevision() {
    await perform(async () => {
      await productionApi(`paper4/papers/${encodeURIComponent(id)}/draft`, { method: "POST" });
      router.push(`/teacher/paper4/${encodeURIComponent(id)}?view=draft`);
      setMessage(tx("新版草稿已建立，可以编辑。", "A new editable draft revision is ready."));
    });
  }
  async function exportPaper() {
    await perform(async () => {
      const view = viewingDraft ? "draft" : "current";
      const envelope = await productionApi<Paper4ExportEnvelope>(`paper4/papers/${encodeURIComponent(id)}/export?view=${view}`);
      downloadPaper4Export(envelope);
      setMessage(tx("试卷包已下载；文件含参考答案和隐藏测试，请妥善保存。", "Paper package downloaded. It includes reference solutions and hidden tests; store it securely."));
    });
  }
  async function archiveOrRestore() {
    await perform(async () => {
      await productionApi(`paper4/papers/${encodeURIComponent(id)}/${archived ? "restore" : "archive"}`, { method: "POST" });
      setConfirmArchive(false);
      paper.reload();
      attempts.reload();
      setMessage(archived ? tx("试卷已恢复。", "Paper restored.") : tx("试卷已归档，已有代码和成绩保留。", "Paper archived; existing code and marks are retained."));
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
  if (!fresh && !paper.data) return <State data={paper}>{null}</State>;
  if (!fresh && pinnedVersion !== null) return <State data={paper}>{paper.data?.versionId?.toLowerCase() === pinnedVersion.toLowerCase() && <Paper4CatalogPreview key={paper.data.versionId} paper={{...paper.data, canAssign: false}} pinnedVersion/>}</State>;
  if (!fresh && paper.data && !paper.data.canManage) return <Paper4CatalogPreview paper={paper.data}/>;
  return <>
    <PageHeader eyebrow={fresh ? tx("新建试卷", "Create paper") : tx("实践试卷", "Practical paper")} title={fresh ? tx("建立 Paper 4 草稿", "Create a Paper 4 draft") : paper.data?.title ?? tx("正在加载…", "Loading…")} description={isActivity ? tx("此活动按布置时选定的学生名单开放，独立保存时间、答卷和成绩。", "This activity is open to its selected students and keeps its own schedule, attempts and marks.") : tx("准备并验证题目后，发布为全校自由练习；练习任务或模拟考试可另行选择学生布置。", "Prepare and validate the paper, then publish it for school-wide practice. Assign practice tasks or mock exams to selected students separately.")}/>
    {!fresh && <State data={paper}>{null}</State>}
    {!fresh && paper.data && <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm`}><div><strong className={archived ? "text-muted-foreground" : "text-foreground"}>{archived ? tx("已归档", "Archived") : !isActivity && isPublished ? tx("已公开 · 全校自由练习", "Public · School-wide practice") : displayStatus} {paper.data.versionNumber ? `· v${paper.data.versionNumber}` : ""}</strong>{archived && <p className="mt-1 text-xs text-muted-foreground">{tx("归档期间学生不能进入试卷或继续作答；已有代码和成绩保留。恢复后仍在期限内的答卷可继续。", "Students cannot enter or continue this paper while archived. Existing code and marks remain; attempts may continue after restoration if still within the deadline.")}</p>}</div><div className="flex flex-wrap gap-2">{!isActivity && isPublished && !archived && <Button size="sm" onClick={() => setAssignOpen(true)}><Send size={14}/>{tx("布置活动", "Assign activity")}</Button>}{paper.data.canExport && <Button size="sm" variant="secondary" disabled={busy || draftDirty} title={draftDirty ? tx("请先保存草稿；导出的是服务器已保存版本", "Save the draft first; export uses the saved server version") : tx("导出可再次导入的 JSON，含参考答案和隐藏测试", "Export reimportable JSON with reference solutions and hidden tests")} onClick={() => void exportPaper()}><Download size={14}/>{tx("导出 JSON", "Export JSON")}</Button>}<Button size="sm" variant="secondary" disabled={busy || draftDirty} title={draftDirty ? tx("请先保存或撤销未保存的修改", "Save or discard unsaved changes first") : undefined} onClick={() => setConfirmArchive(true)}>{archived ? <RotateCcw size={14}/> : <Archive size={14}/>} {archived ? tx("恢复试卷", "Restore paper") : tx("归档试卷", "Archive paper")}</Button></div></div>}
    {!fresh && paper.data?.canManage && <Paper4ShortTitleEditor paper={paper.data} disabled={busy || archived || draftDirty} onSaved={paper.reload}/>}
    {!fresh && isPublished && !paper.data?.sourcePaperId && <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}><div><strong>{tx("当前已发布版本", "Current published version")} {paper.data?.versionNumber ? `v${paper.data.versionNumber}` : ""}</strong><p className="mt-1 text-muted-foreground">{archived ? tx("恢复试卷后才能编辑修订草稿。", "Restore this paper before editing a draft revision.") : tx("已发布版本保持不变。创建修订草稿后可修改题目和参考答案，再重新验证并发布新版。", "The published version remains unchanged. Create a draft revision to edit questions and reference code, validate it, then publish the new version.")}</p></div>{paper.data?.hasDraft ? archived ? null : <AppLink href={`/teacher/paper4/${encodeURIComponent(id)}?view=draft`} className={buttonVariants()}>{tx("继续编辑修订草稿", "Edit draft revision")}</AppLink> : <Button disabled={busy || archived} onClick={() => void createRevision()}>{tx("创建修订草稿", "Create draft revision")}</Button>}</div>}
    {isActivity && paper.data?.sourcePaperId && <p className="mt-4 rounded-md border border-border bg-surface-subtle p-3 text-sm text-muted-foreground">{tx("此活动固定使用布置时的题库版本。", "This activity uses the library version selected when assigned.")} <AppLink href={`/teacher/paper4/${paper.data.sourcePaperId}`} className="font-semibold text-primary hover:underline">{tx("查看来源试卷", "View source paper")}</AppLink></p>}
    {!fresh && viewingDraft && !published && <p className="mt-4 rounded-md border border-info bg-info-soft p-3 text-sm text-primary">{tx("正在编辑修订草稿。原已发布版本仍可供学生作答。", "Editing a draft revision. The current published version remains available to students.")}</p>}
    <div className={`${panel} mt-5 p-4 sm:p-5`}><div className="grid gap-4 md:grid-cols-2"><Field label={tx("试卷标题", "Paper title")}><input className={input} maxLength={180} value={draft.title} disabled={published} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))}/></Field>{isActivity && <><Field label={tx("布置对象", "Recipients")}><div className="mt-1.5 rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm"><span className="font-semibold">{typeof paper.data?.participantCount === "number" ? tx(`${paper.data.participantCount} 名学生`, `${paper.data.participantCount} students`) : tx("按学生名单", "Selected students")}</span>{paper.data && paper4ClassNames(paper.data) && <span className="mt-1 block text-xs font-normal text-muted-foreground">{paper4ClassNames(paper.data)}</span>}</div></Field><Field label={tx("开始时间", "Starts at")}><input type="datetime-local" className={input} value={draft.startsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, startsAt: event.target.value }))}/></Field><Field label={tx("结束时间", "Ends at")}><input type="datetime-local" className={input} value={draft.endsAt} disabled={published} onChange={event => setDraft(value => ({ ...value, endsAt: event.target.value }))}/></Field></>}</div><div className="mt-4 grid gap-4 sm:grid-cols-3"><Field label={tx("试卷年份", "Exam year")}><input type="number" min={1900} max={2100} step={1} className={input} value={draft.examYear ?? ""} disabled={published} onChange={event => setDraft(value => ({ ...value, examYear: event.target.value ? Number(event.target.value) : null }))}/></Field><Field label={tx("考季", "Exam session")}><select className={input} value={draft.examSession ?? ""} disabled={published} onChange={event => setDraft(value => ({ ...value, examSession: event.target.value === "summer" ? "summer" : event.target.value === "autumn" ? "autumn" : null }))}><option value="">{tx("未分类", "Unclassified")}</option><option value="summer">{tx("夏季 May/June", "May/June")}</option><option value="autumn">{tx("秋季 October/November", "October/November")}</option></select></Field><Field label={tx("卷号", "Paper variant")}><select className={input} value={draft.examVariant ?? ""} disabled={published} onChange={event => setDraft(value => ({ ...value, examVariant: event.target.value ? Number(event.target.value) as 41 | 42 | 43 : null }))}><option value="">{tx("未分类", "Unclassified")}</option>{[41, 42, 43].map(number => <option key={number} value={number}>{number}</option>)}</select></Field></div><Field label={tx("说明", "Instructions")}>
<textarea rows={2} className={area} value={draft.description} disabled={published} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}/></Field><p className="mt-3 text-xs text-muted-foreground">{tx("本期支持 Python 3 校内练习与模拟考试；请勿上传正式试卷保密材料。", "This version supports Python 3 school practice and mock exams. Do not upload confidential live exam materials.")}</p></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"><nav aria-label={tx("大题编辑导航", "Question editor navigation")} className={`${panel} h-fit p-3`}><div className="flex items-center justify-between gap-2 px-2 pb-2"><h2 className="text-sm font-bold">{tx("大题", "Questions")}</h2><span className={`text-xs font-semibold ${maxMarks === 75 ? "text-success" : "text-warning"}`}>{maxMarks}/75</span></div>{draft.questions.map((item, index) => <button key={item.key} type="button" aria-current={item.key === question?.key ? "page" : undefined} className={`mb-1 block min-h-10 w-full rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${item.key === question?.key ? "bg-info-soft font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => { setSelected(item.key); setSelectedCaseStage(item.stages.find(stage => stage.judgeMode === "auto")?.id ?? ""); }}>{index + 1}. {item.title || tx("未命名大题", "Untitled question")}</button>)}<Button size="sm" variant="secondary" className="mt-2 w-full" disabled={published || draft.questions.length >= 3} onClick={() => { const number = Math.max(0, ...draft.questions.map(item => Number(item.key.slice(1)) || 0)) + 1; const next = blankQuestion(number); setDraft(current => ({ ...current, questions: [...current.questions, next] })); setSelected(next.key); setSelectedCaseStage(""); }}><Plus size={14}/>{tx("添加大题", "Add question")}</Button></nav>
    {question && <div className={`${panel} min-w-0 p-4 sm:p-5`}><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{question.key} · {tx("题目内容", "Question content")} <span className="ml-2 rounded-md bg-success-soft px-2 py-1 text-xs font-semibold text-success">{tx("首次正式 AC +10 积分", "First formal AC +10 points")}</span></h2><Button size="sm" variant="ghost" disabled={published || draft.questions.length === 1} onClick={() => { setDraft(current => ({ ...current, questions: current.questions.filter(item => item.key !== question.key) })); setSelected(draft.questions.find(item => item.key !== question.key)?.key ?? ""); }}><Trash2 size={14}/>{tx("移除大题", "Remove")}</Button></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><Field label={tx("标题", "Title")}><input className={input} maxLength={180} value={question.title} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, title: event.target.value }))}/></Field><Field label={tx("入口文件名", "Entry file")}><input className={input} value={`${question.key}.py`} disabled aria-readonly="true"/></Field></div>
      <Field label={tx("题面（支持 Markdown）", "Statement (Markdown)")}><textarea rows={7} className={area} value={question.statement} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, statement: event.target.value }))}/></Field>
      {question.statement.trim() && <section className={contentStyles.teacherPreview} aria-label={tx("题面预览", "Statement preview")}><p className={contentStyles.teacherPreviewLabel}>{tx("题面预览", "Statement preview")}</p><Paper4Content content={question.statement}/></section>}
      <Field label={tx("起始代码", "Starter code")}><textarea rows={5} spellCheck={false} className={`${area} font-mono`} value={question.starterCode} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, starterCode: event.target.value }))}/></Field>
      <FileMapEditor label={tx("初始工作文件", "Initial work files")} value={question.initialFiles} disabled={published} tx={tx} onChange={initialFiles => updateQuestion(question.key, value => ({ ...value, initialFiles }))}/>
      <Field label={tx("允许收集的生成文件（每行一个文件名）", "Generated files to collect (one filename per line)")}><textarea rows={3} className={`${area} font-mono`} value={(question.outputFiles ?? []).join("\n")} disabled={published} onChange={event => updateQuestion(question.key, value => ({ ...value, outputFiles: event.target.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean) }))}/></Field>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("阶段与评分点", "Stages and marking points")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("学生在这些阶段保存不可覆盖的代码检查点。分数为教师复核上限。", "Students save immutable code checkpoints at these stages. Marks are teacher-reviewed caps.")}</p>
      <div className="mt-3 space-y-3">{question.stages.map((stage, stageIndex) => <StageEditor key={stage.id} stage={stage} disabled={published} tx={tx} onChange={patch => updateQuestion(question.key, value => ({ ...value, stages: value.stages.map(item => item.id === stage.id ? { ...item, ...patch } : item) }))} onRemove={() => updateQuestion(question.key, value => ({ ...value, stages: value.stages.filter(item => item.id !== stage.id) }))} canRemove={question.stages.length > 1} index={stageIndex} validation={referenceFeedback[stage.id] ?? validation[stage.id]?.status}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateQuestion(question.key, value => ({ ...value, stages: [...value.stages, { id: `${question.key}-${value.stages.length + 1}-${Date.now()}`, title: "", description: "", maxMarks: 1, judgeMode: "manual" }] }))}><Plus size={14}/>{tx("添加阶段", "Add stage")}</Button>
      <h3 className="mt-6 border-t border-border pt-4 font-bold">{tx("阶段自动测试", "Stage runner cases")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("为每个自动判题阶段单独设置用例。隐藏用例不会向学生展示输入和预期输出。", "Configure cases for each auto-judged stage separately. Hidden cases do not reveal inputs or expected output to students.")}</p>{autoStages.length > 0 ? <><label className="mt-3 block text-sm font-semibold">{tx("测试阶段", "Test stage")}<select className={`${input} mt-1`} value={caseStage?.id ?? ""} onChange={event => setSelectedCaseStage(event.target.value)}>{autoStages.map(item => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}</select></label><div className="mt-3 space-y-3">{cases.map((item, index) => <CaseEditor key={`${caseStage?.id}:${index}`} test={item} index={index} tx={tx} disabled={published} onChange={patch => updateCases(caseStage!.id, values => values.map((value, position) => position === index ? { ...value, ...patch } : value))} onRemove={() => updateCases(caseStage!.id, values => values.filter((_, position) => position !== index))}/>)}</div><Button size="sm" variant="secondary" className="mt-3" disabled={published} onClick={() => updateCases(caseStage!.id, values => [...values, blankCase(values.length + 1)])}><Plus size={14}/>{tx("添加测试", "Add case")}</Button></> : <p className="mt-3 text-xs text-muted-foreground">{tx("将某阶段的判题方式设为自动后，可在此添加测试用例。", "Set a stage to Auto to add test cases here.")}</p>}
      <div className="mt-6 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">{tx("参考答案 · Python 3", "Reference solution · Python 3")}</h3><p className="mt-1 text-xs text-muted-foreground">{tx("仅教师可见。保存草稿后运行验证，全部自动阶段 AC 才能发布。", "Teacher-only. Save the draft, run validation and pass every auto stage before publishing.")}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" type="button" aria-expanded={referenceExpanded} onClick={() => setReferenceExpanded(value => !value)}>{referenceExpanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>} {referenceExpanded ? tx("收起代码", "Collapse code") : tx("展开完整代码", "Expand full code")}</Button><Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}><Settings size={14}/>{tx("编辑器设置", "Editor settings")}</Button></div></div><div className="mt-3 min-h-[260px] overflow-hidden rounded-md border border-border" style={{ height: referenceExpanded ? Math.min(Math.max(referenceLineCount * 24 + 72, 480), 1200) : 340 }}><CodeEditor onEnableVim={()=>updateSettings({keyBinding:"vim"})} code={draft.referenceSolutions[question.key] ?? ""} onChange={code => setDraft(current => ({ ...current, referenceSolutions: { ...current.referenceSolutions, [question.key]: code } }))} language="python" settings={settings} readOnly={published} idPrefix={`paper4-reference-${question.key}`} inputLabel={tx(`${question.key} 参考答案`, `${question.key} reference solution`)} status={tx("教师私有参考代码", "Teacher-only reference code")}/></div><div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={published || busy || fresh || draftDirty || referencePendingRefresh || !autoStages.length || !draft.referenceSolutions[question.key]?.trim()} onClick={() => void verifyReference(question.key)}><Play size={14}/>{tx("运行验证", "Run validation")}</Button>{(draftDirty || referencePendingRefresh) && <span className="text-xs text-warning">{draftDirty ? tx("先保存草稿", "Save draft first") : tx("正在刷新验证状态…", "Refreshing validation status…")}</span>}{!autoStages.length && <span className="text-xs text-muted-foreground">{tx("本题没有自动阶段，无需参考运行验证。", "This question has no auto stages to validate.")}</span>}</div><div className="mt-3 flex flex-wrap gap-2 text-xs">{autoStages.map(item => { const status = referenceFeedback[item.id] ?? validation[item.id]?.status ?? "unverified"; return <span key={item.id} className={`rounded-md border px-2 py-1 ${status === "AC" ? "border-success text-success" : status === "WA" || status === "error" ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>{item.title || item.id}: {status}</span>; })}</div></div>
    </div>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-sm">{paper.data && <span className="font-semibold">{displayStatus} {paper.data.versionNumber ? `· v${paper.data.versionNumber}` : ""}</span>}<span className="ml-3 text-muted-foreground">{tx("总分", "Total")}: {maxMarks} / 75</span></div><div className="flex gap-2">{!published && <Button disabled={busy || Boolean(!draft.title.trim())} onClick={() => void perform(async () => { if (!validate()) return; const result = fresh ? await productionApi<Paper4Paper>("paper4/papers", { method: "POST", body: payload }) : await productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }); setReferencePendingRefresh(!fresh); setSavedSnapshot(JSON.stringify(draft)); setReferenceFeedback({}); setMessage(tx("试卷草稿已保存。", "Paper draft saved.")); if (fresh) router.push(`/teacher/paper4/${result.id}`); else paper.reload(); })}><Save size={15}/>{fresh ? tx("建立草稿", "Create draft") : tx("保存草稿", "Save draft")}</Button>}{!fresh && !published && <Button variant="secondary" disabled={busy || maxMarks !== 75 || !readyForPublish} title={draftDirty ? tx("先保存草稿", "Save the draft first") : !eachQuestionHasAuto ? tx("每道大题至少需要一个自动阶段", "Each question needs an auto stage") : !referencesReady ? tx("请先运行参考答案，确保全部自动阶段 AC", "Validate references so every auto stage is AC") : undefined} onClick={() => setConfirmPublish(true)}><Send size={15}/>{isActivity ? tx("发布活动修订", "Publish activity revision") : tx("发布自由练习", "Publish for free practice")}</Button>}</div></div>
    {!fresh && !published && !readyForPublish && <p className="mt-2 text-xs text-warning">{draftDirty ? tx("有未保存的修改；保存后才能验证和发布。", "Save your changes before validation and publishing.") : !eachQuestionHasAuto ? tx("每道大题至少需要一个自动判题阶段。", "Each question needs at least one auto-judged stage.") : !referencesReady ? tx("发布前须验证所有自动判题阶段的参考答案为 AC。", "Validate reference solutions for all auto stages to AC before publishing.") : isActivity ? tx("请完善活动的设置。", "Complete the activity settings.") : tx("正在刷新验证状态…", "Refreshing validation status…")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    {!fresh && <section className={`${panel} mt-7 overflow-hidden`}><div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-bold">{tx("学生交卷与批阅", "Student attempts and marking")}</h2><Button variant="ghost" size="sm" onClick={attempts.reload}>{tx("刷新", "Refresh")}</Button></div><State data={attempts}>{attempts.data?.items.length ? <div className="divide-y divide-border">{attempts.data.items.map(item => <AppLink href={`/teacher/paper4/${id}/review/${item.id}`} key={item.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary"><span className="font-semibold text-primary">{item.studentName || item.studentIdentityId || item.id}</span><span className="text-muted-foreground">{item.versionNumber ? `v${item.versionNumber} · ` : ""}{paper4Status(item.status, locale)} · {item.score ?? "—"} / 75 · {paper4Date(item.submittedAt, locale)}</span></AppLink>)}</div> : <p className="p-5 text-sm text-muted-foreground">{tx("尚无学生作答。", "No student attempts yet.")}</p>}</State></section>}
    <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}><DialogContent><DialogTitle>{isActivity ? tx("发布活动修订", "Publish activity revision") : tx("发布自由练习", "Publish for free practice")}</DialogTitle><DialogDescription>{isActivity ? tx("将验证通过的修订版本发布到此活动。已有答卷继续使用其原试卷版本。", "Publish the validated revision to this assigned activity. Existing attempts retain their original version.") : tx("将验证通过的试卷公开为全校可见、无时间限制的自由练习。此版本公开后不可修改，可建立修订草稿。", "Publish the validated paper as school-wide practice without a time limit. This version becomes immutable; you can create a draft revision.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setConfirmPublish(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy || !readyForPublish} onClick={() => void perform(async () => { if (!validate(true) || !readyForPublish) { setConfirmPublish(false); return; } await productionApi(`paper4/papers/${encodeURIComponent(id)}/publish`, { method: "POST" }); setConfirmPublish(false); router.replace(`/teacher/paper4/${encodeURIComponent(id)}`); paper.reload(); setMessage(isActivity ? tx("活动修订已发布。", "Activity revision published.") : tx("试卷已公开，全校学生可自由练习。", "Paper published for school-wide practice.")); })}>{isActivity ? tx("确认发布", "Publish") : tx("确认公开", "Publish paper")}</Button></DialogFooter></DialogContent></Dialog>
    <Paper4ArchiveDialog paper={confirmArchive ? paper.data : null} busy={busy} tx={tx} onOpenChange={open => { if (!open && !busy) setConfirmArchive(false); }} onConfirm={() => void archiveOrRestore()}/>
    {assignOpen && paper.data && <Paper4AssignDialog paper={paper.data} onClose={() => setAssignOpen(false)} onCreated={activities => { setAssignOpen(false); router.push(`/teacher/paper4/${activities[0]!.id}`); }}/> }
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
  return <div className={`${layoutStyles.stageEditor} rounded-md border border-border bg-surface-subtle p-3`}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-muted-foreground">{tx("阶段", "Stage")} {index + 1}{stage.judgeMode === "auto" && validation && <span className={`ml-2 ${validation === "AC" ? "text-success" : validation === "WA" || validation === "error" ? "text-destructive" : ""}`}>· {tx("参考验证", "Reference validation")}: {validation}</span>}</span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled || !canRemove} aria-label={tx("移除阶段", "Remove stage")} onClick={onRemove}><Trash2 size={14}/></Button>
    </div>
    <div className={layoutStyles.stageFields}>
      <Field label={tx("阶段标题", "Stage title")}><input className={input} maxLength={140} value={stage.title} disabled={disabled} onChange={event => onChange({ title: event.target.value })}/></Field>
      <Field label={tx("判题方式", "Judging mode")}><select className={input} disabled={disabled} value={stage.judgeMode ?? "manual"} onChange={event => onChange({ judgeMode: event.target.value as Paper4Stage["judgeMode"] })}><option value="auto">{tx("自动判题", "Auto")}</option><option value="manual">{tx("人工复核代码", "Manual code review")}</option><option value="evidence">{tx("证据/过程分", "Evidence")}</option></select></Field>
      <Field label={tx("满分", "Maximum marks")}><input type="number" min={1} max={75} className={input} value={stage.maxMarks} disabled={disabled} onChange={event => onChange({ maxMarks: Number(event.target.value) })}/></Field>
    </div>
    <Field label={tx("阶段要求", "Stage instructions")}><textarea rows={2} className={area} value={stage.description} disabled={disabled} onChange={event => onChange({ description: event.target.value })}/></Field>
    {stage.description.trim() && <details className={contentStyles.stagePreview}><summary>{tx("预览阶段要求", "Preview stage instructions")}</summary><Paper4Content content={stage.description}/></details>}
  </div>;
}

function CaseEditor({ test, index, disabled, onChange, onRemove, tx }: { test: Paper4RunnerCase; index: number; disabled: boolean; onChange: (patch: Partial<Paper4RunnerCase>) => void; onRemove: () => void; tx: (zh: string, en: string) => string }) {
  return <div className="rounded-md border border-border bg-surface-subtle p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{tx("用例", "Case")} {index + 1}</strong><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={tx("移除用例", "Remove case")} onClick={onRemove}><Trash2 size={14}/></Button></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("用例编号", "Case ID")}><input className={input} value={test.id} disabled={disabled} onChange={event => onChange({ id: event.target.value })}/></Field><label className="mt-8 flex items-center gap-2 text-sm"><input type="checkbox" checked={test.public} disabled={disabled} onChange={event => onChange({ public: event.target.checked })}/>{tx("向学生显示本用例输出", "Show this case output to students")}</label></div><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={tx("标准输入", "Standard input")}><textarea rows={3} className={`${area} font-mono`} value={test.stdin} disabled={disabled} onChange={event => onChange({ stdin: event.target.value })}/></Field><Field label={tx("预期标准输出", "Expected stdout")}><textarea rows={3} className={`${area} font-mono`} value={test.expectedStdout} disabled={disabled} onChange={event => onChange({ expectedStdout: event.target.value })}/></Field></div><Field label={tx("测试驱动代码（可选，仅在此用例执行）", "Test driver code (optional, runs in this case only)")}><textarea rows={3} className={`${area} font-mono`} spellCheck={false} value={test.driverCode ?? ""} disabled={disabled} onChange={event => onChange({ driverCode: event.target.value })}/></Field><FileMapEditor label={tx("此用例额外输入文件", "Additional input files for this case")} value={test.inputFiles} disabled={disabled} onChange={inputFiles => onChange({ inputFiles })} tx={tx}/><FileMapEditor label={tx("预期生成文件", "Expected generated files")} value={test.expectedFiles} disabled={disabled} onChange={expectedFiles => onChange({ expectedFiles })} tx={tx}/></div>;
}

export function TeacherPaper4Review({ attemptId }: { attemptId: string }) {
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
    <State data={attempt}>{attempt.data && <>
      <PageHeader eyebrow={tx("逐阶段批阅", "Stage marking")} title={attempt.data.studentName || attempt.data.studentIdentityId || tx("学生答卷", "Student attempt")} description={`${attempt.data.paper.title} · ${paper4Status(attempt.data.status, locale)} · ${markedCount}/${stages.length} ${tx("阶段已评分", "stages marked")}`} action={<Button disabled={busy || !canMark || markedCount !== stages.length} onClick={() => setReleaseOpen(true)}><Send size={15}/>{tx("公布成绩", "Release result")}</Button>}/>
      <div className="mt-5 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"><nav aria-label={tx("评分阶段", "Marking stages")} className={`${panel} h-fit p-3`}>{attempt.data.paper.questions.map(question => <div key={question.key} className="mb-3"><h2 className="px-2 py-1 text-sm font-bold">{question.key} · {question.title}</h2>{question.stages.map(stage => { const marked = attempt.data?.marks.find(item => item.stageId === stage.id); return <button type="button" key={stage.id} aria-current={stage.id === selected?.stage.id ? "step" : undefined} className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${stage.id === selected?.stage.id ? "bg-info-soft font-semibold text-primary" : "hover:bg-muted"}`} onClick={() => setStageId(stage.id)}><span className="truncate">{stage.title}</span><span className={`shrink-0 text-xs ${marked ? "text-success" : "text-muted-foreground"}`}>{marked ? `${marked.marks}/${stage.maxMarks}` : `—/${stage.maxMarks}`}</span></button>; })}</div>)}</nav>
      <div className="min-w-0 space-y-4">{selected && <><section className={`${panel} p-5`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">{selected.question.key} · {selected.stage.maxMarks} {tx("分", "marks")}</p><h2 className="mt-1 text-lg font-bold">{selected.stage.title}</h2></div><span className="text-xs text-muted-foreground">{selectedSnapshot ? paper4Date(selectedSnapshot.createdAt, locale) : tx("无检查点", "No checkpoint")}</span></div><div className="mt-3 text-muted-foreground"><Paper4Content content={selected.stage.description || tx("按试卷题目要求检查此阶段。", "Review this stage against the paper requirements.")}/></div></section>
        <section className={`${panel} overflow-hidden`}><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-bold">{selectedSnapshot?.sourceCode != null ? tx("阶段代码检查点", "Stage code checkpoint") : tx("最终提交代码", "Final submitted code")}</h2>{!selectedSnapshot && <p className="mt-1 text-xs text-muted-foreground">{tx("本阶段未保存单独检查点；以下为交卷时冻结的代码。过程/证据阶段无需学生上传额外截图。", "No separate checkpoint was saved for this stage. This is the code frozen on submission. Process/evidence stages require no extra screenshot upload.")}</p>}</div>{selectedSnapshot?.sourceCode != null || selectedFinalCode != null ? <CodeBlock code={selectedSnapshot?.sourceCode ?? selectedFinalCode ?? ""} language="python"/> : <p className="p-4 text-sm text-muted-foreground">{tx("没有可查看的代码。", "No code is available.")}</p>}</section>
        <section className={`${panel} p-5`}><h2 className="font-bold">{tx("教师评分", "Teacher mark")}</h2><p className="mt-1 text-xs text-muted-foreground">{tx("自动判题提供 AC 状态，但不直接换算为 Paper 4 分数。请按评分标准复核，也可给 0 分并说明原因。", "Auto judging reports AC status but does not convert it into Paper 4 marks. Review against the rubric; zero marks are valid with a reason.")}</p><div className="mt-4 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]"><Field label={tx("本阶段得分", "Stage marks")}><input type="number" min={0} max={selected.stage.maxMarks} step={1} className={input} disabled={!canMark || busy} value={marks} onChange={event => setMarks(Number(event.target.value))}/></Field><Field label={tx("评语与依据", "Feedback and evidence")}><textarea rows={3} className={area} disabled={!canMark || busy} value={note} onChange={event => setNote(event.target.value)}/></Field></div><Button className="mt-4" disabled={!canMark || busy || !Number.isInteger(marks) || marks < 0 || marks > selected.stage.maxMarks} onClick={() => void perform(async () => { await productionApi(`paper4/attempts/${encodeURIComponent(attemptId)}/marks`, { method: "PATCH", body: { stageId: selected.stage.id, marks, note } }); attempt.reload(); setMessage(tx("阶段评分已保存。", "Stage mark saved.")); })}><ClipboardCheck size={15}/>{tx("保存本阶段评分", "Save stage mark")}</Button></section></>}
      </div></div>
      <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}><span>{tx("当前汇总", "Current total")} · <strong>{attempt.data.score ?? attempt.data.marks.reduce((sum, item) => sum + item.marks, 0)} / {attempt.data.paper.totalMarks}</strong></span><span className="text-muted-foreground">{tx("全部阶段评分后才可公布。公布后学生可查看成绩。", "Mark every stage before releasing. Students see marks after release.")}</span></div>
    </>}</State>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}><DialogContent><DialogTitle>{tx("公布 Paper 4 成绩", "Release Paper 4 result")}</DialogTitle><DialogDescription>{tx("公布后学生将看到教师确认的阶段分数和整卷成绩。", "The student will see teacher-confirmed stage and total marks.")}</DialogDescription><DialogFooter><Button variant="secondary" onClick={() => setReleaseOpen(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy} onClick={releaseResult}>{tx("确认公布", "Release")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

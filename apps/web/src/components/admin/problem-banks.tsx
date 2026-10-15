"use client";

import { useState } from "react";
import { Archive, Plus, RotateCcw, Search } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { PageHeader } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { Drawer, Feedback, Loading, Modal, inputClass, panelClass, useData, useMutation } from "./common";

interface ManagedBank {
  id: string;
  name: string;
  description: string;
  course: string;
  visibility: "school" | "private";
  isSystem: boolean;
  archivedAt: string | null;
  ownerName: string;
  problemCount: number;
  archivedProblemCount: number;
  publicVersionCount: number;
}

interface ManagedProblem {
  id: string;
  title: string;
  versionId: string | null;
  ownerName: string;
  archivedAt: string | null;
  publishedAt: string | null;
  validationStatus: string | null;
  rankReviewStatus: string | null;
  schoolVisibleAt: string | null;
  publicVersionCount: number;
  submissionCount: number;
  assignmentCount: number;
  timedCount: number;
  courseCount: number;
}

interface ManagedProblemHistory {
  id: string;
  bankName: string;
  ownerName: string;
  archivedAt: string | null;
  currentVersionId: string | null;
  versions: { id: string; title: string; statement: string; validationStatus: string; publishedAt: string | null; schoolVisibleAt: string | null; rankReviewStatus: string; createdAt: string }[];
}

type BankAction = { bank: ManagedBank; kind: "archive" | "restore" | "school" | "private" };
type ProblemAction = { problem: ManagedProblem; kind: "archive" | "restore" };

export function AdminProblemBanks() {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const banks = useData<{ items: ManagedBank[] }>("admin/problem-banks");
  const action = useMutation();
  const [selectedId, setSelectedId] = useState("");
  const [bankAction, setBankAction] = useState<BankAction | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCourse, setNewCourse] = useState("Python");
  const [newVisibility, setNewVisibility] = useState<"school" | "private">("private");
  const activeId = selectedId || banks.data?.items.find(bank => !bank.archivedAt)?.id || banks.data?.items[0]?.id || "";
  const selectedBank = banks.data?.items.find(bank => bank.id === activeId);

  const changeBank = async () => {
    if (!bankAction) return;
    await action.run(async () => {
      const { bank, kind } = bankAction;
      if (kind === "archive" || kind === "restore") {
        await productionApi(`admin/problem-banks/${encodeURIComponent(bank.id)}`, { method: "PATCH", body: { archived: kind === "archive" } });
      } else {
        await productionApi(`problem-banks/${encodeURIComponent(bank.id)}`, { method: "PATCH", body: { visibility: kind === "school" ? "school" : "private" } });
      }
      setBankAction(null);
      banks.reload();
      action.success(tr("题库设置已更新。", "Problem bank updated."));
    });
  };
  const createBank = async () => {
    await action.run(async () => {
      const bank = await productionApi<{ id: string }>("problem-banks", { method: "POST", body: { name: newName, description: newDescription, course: newCourse, visibility: newVisibility } });
      setCreating(false);
      setSelectedId(bank.id);
      setNewName("");
      setNewDescription("");
      setNewCourse("Python");
      setNewVisibility("private");
      banks.reload();
      action.success(tr("题库已创建。", "Problem bank created."));
    });
  };

  return <>
    <PageHeader eyebrow={tr("题库管理", "PROBLEM BANKS")} title={tr("题库管理", "Problem banks")}
      description={tr("查看全校和教师私有题库。题目以归档代替删除：停止新的自由练习，但保留题目版本、提交与成绩。", "Manage school and teacher-private banks. Archive instead of deleting problems: stop new free practice while retaining versions, submissions, and grades.")}
      action={<div className="flex gap-2"><Button variant="secondary" onClick={() => banks.reload()}>{tr("刷新", "Refresh")}</Button><Button onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />{tr("新建题库", "New bank")}</Button></div>} />
    <Feedback action={action} />
    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(250px,290px)_minmax(0,1fr)]">
      <section className={`${panelClass} min-w-0 self-start`}>
        <div className="border-b border-border p-4"><h2 className="font-semibold">{tr("全部题库", "All banks")}</h2><p className="mt-1 text-xs text-muted-foreground">{tr("含教师私有库与已归档库", "Including private and archived banks")}</p></div>
        <Loading resource={banks}><div className="max-h-[68vh] overflow-y-auto p-2">
          {banks.data?.items.map(bank => <button key={bank.id} type="button" aria-current={activeId === bank.id ? "true" : undefined}
            className={`w-full rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeId === bank.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-subtle"}`}
            onClick={() => setSelectedId(bank.id)}>
            <span className="block truncate text-sm font-semibold">{bank.name}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{bank.ownerName} · {bank.visibility === "school" ? tr("校内", "School") : tr("私有", "Private")}{bank.archivedAt ? ` · ${tr("已归档", "Archived")}` : ""}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{bank.problemCount} {tr("题", "problems")}{bank.archivedProblemCount ? ` · ${bank.archivedProblemCount} ${tr("题已归档", "archived")}` : ""}</span>
          </button>)}
          {!banks.data?.items.length && <p className="p-4 text-sm text-muted-foreground">{tr("暂无题库。", "No problem banks.")}</p>}
        </div></Loading>
      </section>
      {selectedBank && <div className="min-w-0 space-y-4">
        <section className={`${panelClass} p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold">{selectedBank.name}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedBank.ownerName} · {selectedBank.visibility === "school" ? tr("校内题库", "School bank") : tr("教师私有题库", "Teacher-private bank")}{selectedBank.archivedAt ? ` · ${tr("已归档", "Archived")}` : ""}</p>
              {selectedBank.description && <p className="mt-2 text-sm text-muted-foreground">{selectedBank.description}</p>}</div>
            <div className="flex flex-wrap gap-2">
              {!selectedBank.archivedAt && !selectedBank.isSystem && <Button size="sm" variant="secondary" onClick={() => setBankAction({ bank: selectedBank, kind: selectedBank.visibility === "private" ? "school" : "private" })}>{selectedBank.visibility === "private" ? tr("纳入校内审核", "Enable school review") : tr("改为私有", "Make private")}</Button>}
              {!selectedBank.isSystem && <Button size="sm" variant="secondary" onClick={() => setBankAction({ bank: selectedBank, kind: selectedBank.archivedAt ? "restore" : "archive" })}>{selectedBank.archivedAt ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{selectedBank.archivedAt ? tr("恢复题库", "Restore bank") : tr("归档题库", "Archive bank")}</Button>}
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{selectedBank.publicVersionCount ? tr(`该库仍有 ${selectedBank.publicVersionCount} 个公开题目版本；归档前须在题目审核中撤下。`, `${selectedBank.publicVersionCount} versions are still public. Withdraw them in problem review before archiving.`) : tr("归档不会硬删除数据；被已发布课程或未归档训练引用时会阻止归档。", "Archiving preserves data and is blocked while published courses or active practices reference the bank.")}</p>
          {selectedBank.publicVersionCount > 0 && <AppLink href="/admin/settings?tab=problem-reviews" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">{tr("前往题目审核", "Open problem review")}</AppLink>}
        </section>
        <ManagedProblemList key={activeId} bank={selectedBank} onChanged={banks.reload} />
      </div>}
    </div>
    {bankAction && <Modal title={bankAction.kind === "archive" ? tr("归档题库", "Archive bank") : bankAction.kind === "restore" ? tr("恢复题库", "Restore bank") : tr("调整题库范围", "Change bank visibility")}
      description={bankAction.kind === "archive" ? tr("归档后不再供新练习选用，题目版本、提交和成绩保留。若题库有公开版本或被课程、训练引用，系统会阻止归档。", "The bank will no longer be available for new practice. Versions, submissions, and grades remain. Public versions or course/practice references block archiving.") : bankAction.kind === "restore" ? tr("恢复题库不会自动重新公开已撤下题目，也不会补发积分。", "Restoring the bank does not republish withdrawn problems or grant past points.") : tr("调整范围不会自动通过题目审核。已公开版本或活动引用可能阻止缩小范围。", "Changing visibility does not approve problems. Existing public versions or activity references may block reducing visibility.")}
      onClose={() => setBankAction(null)}>
      <p className="font-semibold">{bankAction.bank.name}</p>
      {bankAction.kind === "archive" && <p className="mt-2 text-sm text-muted-foreground">{tr(`将影响 ${bankAction.bank.problemCount} 道未归档题目；${bankAction.bank.archivedProblemCount} 道题已归档。已发布作业与历史成绩保留。`, `This affects ${bankAction.bank.problemCount} active problems; ${bankAction.bank.archivedProblemCount} are already archived. Published assignments and historical grades remain.`)}</p>}
      <Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setBankAction(null)}>{tr("取消", "Cancel")}</Button><Button disabled={action.busy} onClick={() => void changeBank()}>{tr("确认", "Confirm")}</Button></div>
    </Modal>}
    {creating && <Modal title={tr("新建题库", "Create bank")} description={tr("教师私有题库仅供授权教师使用；校内题库中的题目仍须逐版通过审核后才面向全校学生。", "Private banks are limited to authorized teachers. Versions in school banks still require review before becoming school-wide.")} onClose={() => setCreating(false)}>
      <form onSubmit={event => { event.preventDefault(); void createBank(); }} className="space-y-3">
        <label className="block text-sm font-medium">{tr("名称", "Name")}<input required maxLength={200} className={`${inputClass} mt-1`} value={newName} onChange={event => setNewName(event.target.value)} /></label>
        <label className="block text-sm font-medium">{tr("课程标签", "Course label")}<input required maxLength={100} className={`${inputClass} mt-1`} value={newCourse} onChange={event => setNewCourse(event.target.value)} /></label>
        <label className="block text-sm font-medium">{tr("可见范围", "Visibility")}<select className={`${inputClass} mt-1`} value={newVisibility} onChange={event => setNewVisibility(event.target.value as "school" | "private")}><option value="private">{tr("教师私有", "Private")}</option><option value="school">{tr("纳入校内审核", "School review")}</option></select></label>
        <label className="block text-sm font-medium">{tr("简介", "Description")}<textarea maxLength={4000} rows={3} className={`${inputClass} mt-1 h-auto py-2`} value={newDescription} onChange={event => setNewDescription(event.target.value)} /></label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCreating(false)}>{tr("取消", "Cancel")}</Button><Button type="submit" disabled={action.busy}>{tr("创建", "Create")}</Button></div>
      </form>
    </Modal>}
  </>;
}

function ManagedProblemList({ bank, onChanged }: { bank: ManagedBank; onChanged: () => void }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [candidate, setCandidate] = useState<ProblemAction | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const list = useData<{ bank: { id: string; name: string }; items: ManagedProblem[]; total: number; page: number; pageSize: number }>(`admin/problem-banks/${encodeURIComponent(bank.id)}/problems?page=${page}&search=${encodeURIComponent(search)}`);
  const action = useMutation();
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 100));
  const updateProblem = async () => {
    if (!candidate) return;
    await action.run(async () => {
      await productionApi(`admin/problems/${encodeURIComponent(candidate.problem.id)}`, { method: "PATCH", body: { archived: candidate.kind === "archive" } });
      setCandidate(null);
      list.reload();
      onChanged();
      action.success(candidate.kind === "archive" ? tr("题目已归档，既有提交与成绩保留。", "Problem archived; past submissions and grades remain.") : tr("题目已恢复；如需再次校内公开，须发布新版本并审核。", "Problem restored. Publish and review a new version before making it school-wide again."));
    });
  };
  return <section className={`${panelClass} min-w-0`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="font-semibold">{tr("题目列表", "Problems")}</h2><p className="mt-1 text-xs text-muted-foreground">{list.data?.total ?? 0} {tr("题，包含已归档题目", "problems including archived")}</p></div>
      <form className="flex w-full min-w-0 gap-2 sm:w-auto" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}>
        <label className="sr-only" htmlFor="admin-bank-search">{tr("搜索题目标题", "Search titles")}</label>
        <input id="admin-bank-search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} className={`${inputClass} sm:w-56`} placeholder={tr("搜索题目标题", "Search problem titles")} />
        <Button type="submit" variant="secondary" aria-label={tr("搜索", "Search")}><Search size={16} aria-hidden="true" /></Button>
      </form>
    </div>
    <Feedback action={action} />
    <Loading resource={list}><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm">
      <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>{[tr("题目", "Problem"), tr("上传教师", "Teacher"), tr("版本状态", "Version"), tr("引用 / 提交", "Links / submissions"), tr("操作", "Actions")].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
      <tbody>{list.data?.items.map(problem => <tr key={problem.id} className="border-t border-border">
        <td className="px-4 py-3"><div><button type="button" className="font-semibold text-primary hover:underline focus-visible:underline" onClick={() => setDetailId(problem.id)}>{problem.title}</button></div><span className="text-xs text-muted-foreground">{problem.id.slice(0, 8)}{problem.archivedAt ? ` · ${tr("已归档", "Archived")}` : ""}</span></td>
        <td className="px-4 py-3">{problem.ownerName}</td>
        <td className="px-4 py-3"><span>{problem.publishedAt ? tr("已发布", "Published") : tr("草稿", "Draft")}</span><span className="block text-xs text-muted-foreground">{problem.publicVersionCount ? tr(`${problem.publicVersionCount} 个公开版本`, `${problem.publicVersionCount} public versions`) : problem.rankReviewStatus === "pending" && problem.publishedAt ? tr("待审核", "Pending review") : problem.validationStatus ?? "—"}</span></td>
        <td className="px-4 py-3 text-xs text-muted-foreground">{tr(`课程 ${problem.courseCount} · 作业 ${problem.assignmentCount} · 训练 ${problem.timedCount} · 提交 ${problem.submissionCount}`, `Courses ${problem.courseCount} · Assignments ${problem.assignmentCount} · Practices ${problem.timedCount} · Submissions ${problem.submissionCount}`)}</td>
        <td className="px-4 py-3"><Button size="sm" variant="ghost" disabled={Boolean(bank.archivedAt && problem.archivedAt)} onClick={() => setCandidate({ problem, kind: problem.archivedAt ? "restore" : "archive" })}>{problem.archivedAt ? tr("恢复题目", "Restore") : tr("归档题目", "Archive")}</Button></td>
      </tr>)}{!list.data?.items.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{tr("此题库暂无符合条件的题目。", "No matching problems in this bank.")}</td></tr>}</tbody>
    </table></div></Loading>
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm"><span className="text-muted-foreground">{tr(`第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`)}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{tr("上一页", "Previous")}</Button><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>{tr("下一页", "Next")}</Button></div></div>
    {candidate && <Modal title={candidate.kind === "archive" ? tr("归档题目", "Archive problem") : tr("恢复题目", "Restore problem")}
      description={candidate.kind === "archive" ? tr("归档将同步撤下该题所有已公开版本，停止新的自由练习与榜单积分；历史提交和成绩保留，已分配作业仍可按原版本访问。被已发布课程或未归档训练引用时会阻止归档。", "Archiving withdraws all public versions, stops new free practice and leaderboard points, and retains submissions and grades. Assigned work keeps its exact version. Published courses or active practices block archiving.") : tr("恢复只重新显示题目，不补发积分；已撤下版本不能再次通过审核，如需校内公开须发布新版本。", "Restoring only reopens the record and does not grant past points. Withdrawn versions cannot be reapproved; publish a new version for school-wide review.")}
      onClose={() => setCandidate(null)}>
      <p className="font-semibold">{candidate.problem.title}</p><Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCandidate(null)}>{tr("取消", "Cancel")}</Button><Button disabled={action.busy} onClick={() => void updateProblem()}>{tr("确认", "Confirm")}</Button></div>
    </Modal>}
    {detailId && <ManagedProblemDetail id={detailId} onClose={() => setDetailId(null)} />}
  </section>;
}

function ManagedProblemDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const detail = useData<ManagedProblemHistory>(`admin/problems/${encodeURIComponent(id)}`);
  return <Drawer title={detail.data?.versions[0]?.title ?? tr("题目详情", "Problem details")} eyebrow={tr("题目档案", "PROBLEM HISTORY")} onClose={onClose} wide>
    <Loading resource={detail}>{detail.data && <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">{detail.data.bankName} · {detail.data.ownerName} · {detail.data.versions.length} {tr("个历史版本", "versions")}</p>
      {detail.data.versions.map(version => <section key={version.id} className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{version.title}{version.id === detail.data?.currentVersionId ? ` · ${tr("当前版本", "Current version")}` : ""}</h3><span className="text-xs text-muted-foreground">{version.publishedAt ? tr("已发布", "Published") : tr("草稿", "Draft")} · {version.rankReviewStatus}</span></div>
        <p className="mt-2 whitespace-pre-wrap leading-6">{version.statement || tr("暂无题面", "No statement")}</p>
        <p className="mt-2 text-xs text-muted-foreground">{tr("验证", "Validation")}: {version.validationStatus} · {tr("校内公开", "School-wide")}: {version.schoolVisibleAt ? tr("是", "Yes") : tr("否", "No")}</p>
      </section>)}
    </div>}</Loading>
  </Drawer>;
}

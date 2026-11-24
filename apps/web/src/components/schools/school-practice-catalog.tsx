"use client";
import { RowActionButton } from "@/components/ui/row-action";

import { useState, type ReactNode } from "react";
import type { SchoolGroup } from "./school-group-manager";
import { ProblemGroupFilter } from "@/components/problem-group-filter";
import { Plus, RefreshCw } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { StatusPill } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { Table, Tabs } from "@/components/teacher/shared";
import { State, input } from "@/components/student/shared";
import { ProblemCatalogCourseFilter, type ProblemCatalogResult } from "@/components/student/problem-catalog-course-filter";
import { LearnerProblemTable as SharedLearnerProblemTable } from "@/components/student/learner-problem-table";
import { ProblemCatalogSearch } from "@/components/student/problem-catalog-search";
import problemStyles from "@/components/student/problems-page.module.css";
import bankStyles from "@/components/teacher/problem-banks.module.css";
import type { Bank, Problem } from "./school-practice-types";
import { practiceProblemMatches, practicePublicationState, type PracticeCatalogFilters } from "./school-practice-navigation";

export function SchoolPracticeCatalog({
  problems, allProblems, banks, role, filters, onFiltersChange, onOpen, onEditBank,
  groups, onManageGroups, onArchiveProblem, onNewProblem, onArchiveBank, onRefresh, busy, renderActions, courseFilter, learnerResource,
}: {
  onArchiveProblem: (problem: Problem) => void;
  groups: SchoolGroup[];
  onManageGroups: (bank: Bank) => void;
  problems: Problem[];
  allProblems: Problem[];
  banks: Bank[];
  role: string;
  filters: PracticeCatalogFilters;
  onFiltersChange: (patch: Partial<PracticeCatalogFilters>) => void;
  onOpen: (problemId: string) => void;
  onEditBank: (bank: Bank | "new") => void;
  onNewProblem: () => void;
  onArchiveBank: (bank: Bank) => void;
  onRefresh: () => void;
  busy: boolean;
  renderActions: (problem: Problem) => ReactNode;
  learnerResource?: { data: unknown; loading: boolean; error: string; reload: () => void };
  courseFilter?: { value: string; courses: ProblemCatalogResult<Problem>["courses"]; onChange: (id: string) => void };
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const staff = role === "teacher" || role === "school_admin";
  const { bankId, tab, query, bankQuery, status: filter, archived } = filters;
  const stateNames: Record<string, string> = {
    published: tx("已发布", "Published"),
    review: tx("待审核", "Awaiting review"),
    validating: tx("验证中", "Validating"),
    failed: tx("验证失败", "Validation failed"),
    draft: tx("草稿", "Draft"),
  };
  const adminBanks = role === "school_admin" && tab === "banks";
  const [paging,setPaging] = useState({key:"",page:1});
  const activeBanks = banks.filter(bank => !bank.archived);
  const archivedBanks = banks.filter(bank => bank.archived);
  const shownBanks = (archived ? archivedBanks : activeBanks).filter(bank => bank.name.toLocaleLowerCase().includes(bankQuery.trim().toLocaleLowerCase()));
  const rows = problems.filter(problem => practiceProblemMatches(problem, filters, staff));
  const currentBank = banks.find(bank => bank.id === bankId);
  const bankGroups = groups.filter(g => g.bankId === bankId);
  const groupManager = (bank: Bank) => !bank.archived && bank.id !== "platform" && (bank.canManage || groups.some(g => g.bankId === bank.id))
    && <RowActionButton onClick={() => onManageGroups(bank)}>{tx("分组管理","Manage groups")}</RowActionButton>;
  const groupFilter = currentBank && bankId !== "platform" && <ProblemGroupFilter groups={bankGroups} value={filters.groupId}
    onChange={groupId => onFiltersChange({groupId})}/>;
  const filterChoices = staff
    ? Object.entries(stateNames)
    : [["accepted", tx("已通过", "Accepted")], ["attempted", tx("已尝试", "Attempted")], ["not-started", tx("未开始", "Not started")]];
  const countLabel = tx(`显示 ${rows.length} / ${problems.length} 道题`, `Showing ${rows.length} of ${problems.length} problems`);
  const clearFilters = () => {
    onFiltersChange({ query: "", status: "", bankId: "" });
    courseFilter?.onChange("");
  };
  const toolbar = <div className={`${problemStyles.toolbar} flex-wrap`}>
    <ProblemCatalogSearch value={query} onChange={query => onFiltersChange({ query })} label={tx("搜索编号、标题、题库或主题", "Search ID, title, bank, or topic")} />
    <select aria-label={tx("题库", "Problem bank")} className={`${input} max-w-56 !h-[34px] max-md:!h-11`} value={bankId} onChange={event => onFiltersChange({ bankId: event.target.value })}>
      <option value="">{tx("全部题库", "All banks")}</option>
      {banks.filter(bank => !bank.archived || staff).map(bank => <option key={bank.id} value={bank.id}>{bank.name}{bank.archived ? ` (${tx("已归档", "Archived")})` : ""}</option>)}
    </select>
    {staff && groupFilter}
    {courseFilter && <ProblemCatalogCourseFilter {...courseFilter}/>}
    <select aria-label={tx("状态", "Status")} className={`${input} max-w-44 !h-[34px] max-md:!h-11`} value={filter} onChange={event => onFiltersChange({ status: event.target.value })}>
      <option value="">{tx("全部状态", "All statuses")}</option>
      {filterChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {(query || bankId || filter || courseFilter?.value) && <Button size="sm" variant="ghost" onClick={clearFilters}>{tx("清除筛选", "Clear filters")}</Button>}
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRefresh} aria-label={tx("刷新题目", "Refresh problems")}><RefreshCw size={15} aria-hidden="true" /></Button>
    {staff && <Button size="sm" disabled={busy || !activeBanks.some(bank => bank.canManage)} onClick={onNewProblem}><Plus size={14} aria-hidden="true" />{tx("新建题目", "New problem")}</Button>}
  </div>;

  if (!staff) return <div className={problemStyles.page}>
    {toolbar}
    <State data={learnerResource ?? { data: null, loading: false, error: "", reload: onRefresh }}><LearnerProblemTable rows={rows} onOpen={onOpen}
      empty={bankId && courseFilter?.value && !problems.length && allProblems.length
        ? tx("该题库中没有这门课的题目。选择「全部题库」可查看随课练习。", "This bank has no problems from this course. Select All banks to see its exercises.")
        : problems.length || courseFilter?.value
        ? tx("没有匹配的题目，请调整搜索或筛选。", "No matching problems. Try another search or filter.")
        : tx("学校尚未发布可练习题目。", "Your school has not published any problems yet.")} />
    <p className={problemStyles.count}>{countLabel}</p></State>
  </div>;

  const pageKey = JSON.stringify([filters,role]);
  const pages = Math.max(1,Math.ceil(rows.length / 50));
  const page = Math.min(pages,paging.key === pageKey ? paging.page : 1);
  const changePage = (page: number) => setPaging({key:pageKey,page});
  return <div className="min-w-0 space-y-2">
    <div className={bankStyles.sectionBar}>
      <Tabs items={[tx("题库", "Banks"), tx("全部题目", "All problems")]} value={tab === "banks" ? tx("题库", "Banks") : tx("全部题目", "All problems")} onChange={value => onFiltersChange({ tab: value === tx("题库", "Banks") ? "banks" : "problems" })} />
      <div className="flex items-center gap-2 py-1"><Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh} aria-label={tx("刷新题库", "Refresh banks")}><RefreshCw size={15} aria-hidden="true" /></Button><Button size="sm" disabled={busy} onClick={() => onEditBank("new")}><Plus size={14} aria-hidden="true" />{tx("新建题库", "New bank")}</Button></div>
    </div>
    {adminBanks ? <div className="grid items-start gap-4 lg:grid-cols-[minmax(180px,22%)_minmax(0,1fr)]">
      <aside className="rounded-lg border border-border bg-surface p-3">
        <h2 className="mb-2 font-semibold">{tx("全部题库","All banks")}</h2>
        {banks.filter(b => b.id !== "platform").map(b => <button type="button" key={b.id} aria-pressed={bankId === b.id}
          className={`mb-1 block w-full rounded-md border p-3 text-left text-sm ${bankId === b.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          onClick={() => onFiltersChange({bankId:b.id,query:"",status:""})}><strong>{b.name}</strong>
          <small className="mt-1 block text-muted-foreground">{allProblems.filter(p => p.bankId === b.id).length} {tx("道题","problems")}{b.archived && " · " + tx("已归档","Archived")}</small></button>)}
      </aside>
      {currentBank ? <div className="min-w-0 space-y-3">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">{currentBank.name}</h2>
          <div className="mt-3 flex flex-wrap gap-2">{groupManager(currentBank)}
            <RowActionButton onClick={() => onEditBank(currentBank)}>{tx("编辑题库","Edit bank")}</RowActionButton>
            <RowActionButton onClick={() => onArchiveBank(currentBank)}>{currentBank.archived ? tx("恢复题库","Restore bank") : tx("归档题库","Archive bank")}</RowActionButton>
            {!currentBank.archived && <RowActionButton onClick={onNewProblem}>{tx("新建题目","New problem")}</RowActionButton>}
            <RowActionButton onClick={() => onFiltersChange({tab:"problems",bankId:currentBank.id,status:"review",groupId:"",query:""})}>{tx("前往题目审核","Open problem review")}</RowActionButton>
          </div></section>
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 p-3"><ProblemCatalogSearch value={query} onChange={query => onFiltersChange({query})}
            label={tx("搜索题目标题或编号","Search problem titles or IDs")}/>{groupFilter}</div>
          <Table headers={[tx("题目","Problem"),tx("上传教师","Teacher"),tx("版本","Version"),tx("引用 / 提交","Links / submissions"),tx("操作","Actions")]} min={700}>
            {rows.slice((page-1)*50,page*50).map(p => <tr key={p.id}>
              <td><button className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(p.id)}>{p.title}</button>
                <small className="block text-muted-foreground">{p.id.slice(0,8)}</small></td>
              <td>{p.ownerName}</td><td><StatusPill status={p.archived ? tx("已归档","Archived") : stateNames[practicePublicationState(p)]}/>
                {p.publishedRevision != null && <small className="block">v{p.publishedRevision}</small>}</td>
              <td className="text-xs text-muted-foreground">{tx(`课程 ${p.courseCount} · 作业 ${p.assignmentCount} · 训练 ${p.timedCount} · 提交 ${p.submissionCount}`,
                `Courses ${p.courseCount} · Assignments ${p.assignmentCount} · Practices ${p.timedCount} · Submissions ${p.submissionCount}`)}</td>
              <td><RowActionButton disabled={busy || currentBank.archived} onClick={() => onArchiveProblem(p)}>{p.archived ? tx("恢复题目","Restore") : tx("归档题目","Archive")}</RowActionButton></td>
            </tr>)}
            {!rows.length && <tr><td colSpan={5}>{tx("没有匹配的题目。","No matching problems.")}</td></tr>}
          </Table>
          <div className="flex items-center justify-end gap-2 border-t border-border p-2 text-sm">
            <span>{rows.length} {tx("道题","problems")} · {page} / {pages}</span>
            <RowActionButton disabled={page<=1} onClick={() => changePage(page-1)}>{tx("上一页","Previous")}</RowActionButton>
            <RowActionButton disabled={page>=pages} onClick={() => changePage(page+1)}>{tx("下一页","Next")}</RowActionButton>
          </div></section></div> : <p>{tx("暂无校内题库。","No school banks yet.")}</p>}
    </div> : tab === "banks" ? <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button size="sm" variant={archived ? "ghost" : "secondary"} aria-pressed={!archived} onClick={() => onFiltersChange({ archived: false })}>{tx("使用中", "Active")} · {activeBanks.length}</Button>
        <Button size="sm" variant={archived ? "secondary" : "ghost"} aria-pressed={archived} onClick={() => onFiltersChange({ archived: true })}>{tx("已归档", "Archived")} · {archivedBanks.length}</Button>
        <ProblemCatalogSearch value={bankQuery} onChange={bankQuery => onFiltersChange({ bankQuery })} label={tx("搜索题库", "Search banks")} />
      </div>
      <Table headers={[tx("名称", "Name"), tx("可查看题目", "Available problems"), tx("已发布", "Published"), tx("操作", "Actions")]} min={620}>
        {shownBanks.map(bank => <tr key={bank.id}>
          <td><button type="button" className="break-words text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onFiltersChange({ bankId: bank.id, status: "", query: "", tab: "problems" })}>{bank.name}</button><p className="mt-1 font-mono text-xs text-muted-foreground">{bank.id.slice(0, 8)}</p></td>
          <td className="tabular-nums">{allProblems.filter(problem => problem.bankId === bank.id).length}</td>
          <td className="tabular-nums">{allProblems.filter(problem => problem.bankId === bank.id && problem.published).length}</td>
          <td><div className="flex flex-wrap gap-2"><RowActionButton onClick={() => onFiltersChange({ bankId: bank.id, status: "", query: "", tab: "problems" })}>{tx("打开", "Open")}</RowActionButton>{groupManager(bank)}{bank.canManage && <RowActionButton disabled={busy} onClick={() => onEditBank(bank)}>{tx("编辑题库", "Edit bank")}</RowActionButton>}
            {bank.canManage && <RowActionButton disabled={busy} onClick={() => onArchiveBank(bank)}>{bank.archived ? tx("恢复题库", "Restore bank") : tx("归档题库", "Archive bank")}</RowActionButton>}</div></td>
        </tr>)}
        {!shownBanks.length && <tr><td colSpan={4} className="text-center text-muted-foreground">{bankQuery ? tx("没有匹配的题库。", "No matching banks.") : archived ? tx("暂无已归档题库。", "No archived banks.") : tx("暂无使用中的题库。点击“新建题库”建立空题库。", "No active banks. Create one to get started.")}</td></tr>}
      </Table>
    </section> : <>
      {toolbar}
      {currentBank && <div className="flex flex-wrap items-center gap-2 px-1 text-sm"><strong>{currentBank.name}</strong>{groupManager(currentBank)}{currentBank.archived && <span className="text-muted-foreground">{tx("已归档", "Archived")}</span>}{currentBank.canManage && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEditBank(currentBank)}>{tx("编辑题库", "Edit bank")}</Button>}</div>}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table headers={[tx("题目", "Problem"), tx("题库", "Bank"), tx("状态", "Status"), tx("操作", "Actions")]} min={800}>
          {rows.map(problem => <tr key={problem.id}>
            <td className="w-[30%]"><button type="button" disabled={!problem.published && !problem.canManage} className="break-words text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:text-foreground disabled:no-underline" onClick={() => onOpen(problem.id)}>{problem.title}</button><p className="mt-1 font-mono text-xs text-muted-foreground" title={problem.id}>{problem.id.slice(0, 8)}</p></td>
            <td className="w-[18%] break-words text-muted-foreground">{problem.bankName}</td>
            <td className="w-[20%]"><StatusPill status={stateNames[practicePublicationState(problem)]} />{problem.published && problem.hasDraftChanges && <p className="mt-1 text-xs text-muted-foreground">{tx("旧版仍已发布", "Previous version is published")}</p>}</td>
            <td className="w-[32%]"><div className="flex flex-wrap items-center gap-1">{renderActions(problem)}</div></td>
          </tr>)}
          {!rows.length && <tr><td colSpan={4} className="text-center text-muted-foreground">{problems.length ? tx("当前筛选下没有题目。", "No problems match these filters.") : tx("新建题目后，验证参考程序，再由学校管理员审核发布。", "Create a problem, validate its reference, then request school administrator review.")}</td></tr>}
        </Table>
      </section>
      <p className={problemStyles.count}>{countLabel}</p>
    </>}
  </div>;
}

export function LearnerProblemTable({ rows, onOpen, empty }: {
  rows: Problem[];
  onOpen: (id: string) => void;
  empty: string;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <SharedLearnerProblemTable rows={rows.map(problem => ({
    id: problem.id, title: problem.title, bankName: [problem.bankName, ...(problem.courses ?? []).map(course =>
      course.localizations?.[locale]?.title ?? course.title)].filter(Boolean).join(" · "), tags: problem.tags, difficulty: problem.difficulty,
    status: problem.solved ? "AC" : problem.status ?? ((problem.attempts ?? 0) > 0 ? tx("已尝试", "Attempted") : tx("未开始", "Not started")),
  }))} onOpen={onOpen} empty={empty}/>;
}

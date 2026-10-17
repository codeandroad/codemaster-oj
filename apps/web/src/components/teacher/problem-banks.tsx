"use client";
import { ProblemPublicationStatus, PublicationGuide } from "@/components/problem-publication-status";
import {ProblemFilter} from "./problem-filter";
import styles from "./problem-banks.module.css";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArrowRight,
  BookOpenCheck,
  CheckSquare2,
  FolderPlus,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-chrome";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { productionApi, type CampusUser, type ProductionProblem } from "@/lib/production-api";
import {
  area,
  Drawer,
  Empty,
  Feedback,
  Field,
  input,
  link,
  Modal,
  panel,
  State,
  Table,
  Tabs,
  useAction,
  useData,
} from "./shared";

export interface Bank {
  id: string;
  name: string;
  description?: string;
  course?: string;
  visibility: "school" | "private";
  permission: string;
  canEdit?: boolean;
  canContribute?: boolean;
  isSystem?: boolean;
  archivedAt?: string | null;
  updatedAt?: string;
  count?: number;
  problemCount?: number;
  archivedProblemCount?: number;
}
export interface Group {
  id: string;
  name: string;
  bankId: string;
  problemIds: string[];
  canEdit: boolean;
}
const localText = (locale: AppLocale, zh: string, en: string) => locale === "zh" ? zh : en;
const hasBankProblems = (bank: Bank) => (bank.problemCount ?? 0) + (bank.archivedProblemCount ?? 0) > 0;
export function validationStatusLabel(status: string, locale: AppLocale) {
  if (locale === "en") return status;
  return ({ Draft: "草稿", Incomplete: "待完善", Waiting: "排队中", Judging: "评测中", "System Error": "系统错误", Published: "已发布" } as Record<string, string>)[status] ?? status;
}
export function reviewVisibilityLabel(problem: ProductionProblem, bankVisibility?: "school" | "private", locale: AppLocale = "zh") {
  if (!problem.published) return problem.publishedVersionId ? localText(locale,"当前草稿未开放 · 旧版保持原范围","Current draft unavailable · previous version retains its scope") : localText(locale,"草稿未向学生开放","Draft unavailable to students");
  const visibility = problem.bankVisibility ?? bankVisibility;
  if (visibility !== "school") return localText(locale,"仅指定活动学生可见","Only visible to assigned activity students");
  if (problem.schoolVisibleAt) return problem.rankReviewStatus === "approved" ? localText(locale,"全校自由练习 · 参与积分榜","School-wide practice · leaderboard points") : localText(locale,"全校自由练习 · 积分资格未通过审核","School-wide practice · points not approved");
  if (problem.rankReviewStatus === "revoked") return localText(locale,"仅指定活动学生可用 · 不再开放自由练习","Assigned students only · free practice withdrawn");
  return problem.rankReviewStatus === "rejected" ? localText(locale,"仅指定活动学生可用 · 修订后可重新申请公开","Assigned students only · revise to request review") : localText(locale,"仅指定活动学生可用 · 审核通过后全校公开","Assigned students only · public after approval");
}
export const MAX_BATCH_PUBLISH = 100;
export function publishEligibilityReason(problem: ProductionProblem, locale: AppLocale) {
  if (!problem.canEdit) return localText(locale, "无编辑权限", "No edit permission");
  if (problem.published) return localText(locale, "当前版本已发布", "Current version already published");
  if (problem.validationStatus !== "AC") return localText(locale, "参考解尚未通过全部测试", "Reference solution has not passed all tests");
  if (!problem.versionId) return localText(locale, "缺少题目版本", "Problem version is missing");
  if (!problem.canPublish) return localText(locale, "当前版本不可发布", "Current version cannot be published");
  return "";
}

export function TeacherBanks({ bankId, user }: { bankId?: string | undefined; user: CampusUser }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => localText(locale, zh, en);
  const router = useRouter(),
    search = useSearchParams(),
    banks = useData<{ items: Bank[] }>("problem-banks?includeArchived=owned"),
    problems = useData<{ items: ProductionProblem[] }>("problems"),
    groups = useData<{ items: Group[] }>("problem-groups");
  const [tab, setTab] = useState(
      search.get("tab") === "all" ? "全部题目" : "题库",
    ),
    [showArchived, setShowArchived] = useState(false),
    [query, setQuery] = useState(""),
    [filterBank, setFilterBank] = useState(""),
    [filterGroup, setFilterGroup] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [confirmPublish, setConfirmPublish] = useState(false),
    [create, setCreate] = useState(false),
    [deletingBank, setDeletingBank] = useState<Bank | null>(null),
    [archivingBank, setArchivingBank] = useState<Bank | null>(null),
    [manage, setManage] = useState<{ ids: string[]; bankId: string } | null>(
      null,
    ),
    [editGroup, setEditGroup] = useState<Group | null>(null),
    action = useAction();
  const bank = banks.data?.items.find((x) => x.id === bankId),
    activeBanks = banks.data?.items.filter((item) => !item.archivedAt) ?? [],
    archivedBanks = banks.data?.items.filter((item) => !!item.archivedAt) ?? [],
    listedBanks = showArchived ? archivedBanks : activeBanks,
    rows =
      problems.data?.items.filter(
        (x) =>
          (!bankId || x.bankId === bankId) &&
          (!filterBank || x.bankId === filterBank) &&
          (!filterGroup ||
            (filterGroup === "ungrouped"
              ? !groups.data?.items.some(
                  (g) => g.bankId === x.bankId && g.problemIds.includes(x.id),
                )
              : groups.data?.items
                  .find((g) => g.id === filterGroup)
                  ?.problemIds.includes(x.id))) &&
          (!filterStatus ||
            (filterStatus === "published" ? x.published : !x.published)) &&
          `${x.title} ${x.tags?.join(" ")} ${x.id}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ) ?? [];
  const checkedProblems = (problems.data?.items ?? []).filter((problem) => checked.includes(problem.id));
  const publishableSelection = checkedProblems.filter((problem) => !publishEligibilityReason(problem, locale));
  const excludedSelection = checkedProblems.filter((problem) => publishEligibilityReason(problem, locale));
  const publishableScope = rows.filter((problem) => !publishEligibilityReason(problem, locale));
  const selectableScope = publishableScope.slice(0, MAX_BATCH_PUBLISH);
  const allPublishableScopeSelected = selectableScope.length > 0 && selectableScope.every((problem) => checked.includes(problem.id));
  const togglePublishableScope = () => {
    const scopeIds = new Set(selectableScope.map((problem) => problem.id));
    setChecked((ids) => allPublishableScopeSelected
      ? ids.filter((id) => !scopeIds.has(id))
      : [...new Set([...ids, ...scopeIds])]);
  };
  const openManage = (ids: string[]) => {
    const selected = (problems.data?.items ?? []).filter((x) =>
        ids.includes(x.id),
      ),
      bankIds = [...new Set(selected.map((x) => x.bankId))];
    if (bankIds.length !== 1 || !bankIds[0]) {
      void action.run(async () => {
        throw new Error("请选择同一题库内的题目后整理分组。勾选已保留。");
      });
      return;
    }
    setManage({ ids, bankId: bankIds[0] });
  };
  const removeEmptyBank = () => {
    if (!deletingBank) return;
    void action.run(async () => {
      await productionApi(`problem-banks/${encodeURIComponent(deletingBank.id)}`, { method: "DELETE" });
      setDeletingBank(null);
      banks.reload();
      return tr("空题库已删除。", "Empty bank deleted.");
    });
  };
  const changeBankArchive = () => {
    if (!archivingBank) return;
    void action.run(async () => {
      const archived = !archivingBank.archivedAt;
      await productionApi(`problem-banks/${encodeURIComponent(archivingBank.id)}`, { method: "PATCH", body: { archived } });
      setArchivingBank(null);
      banks.reload();
      return archived ? tr("题库已归档，可随时在此恢复。", "Bank archived. You can restore it here at any time.") : tr("题库已恢复。", "Bank restored.");
    });
  };
  return (
    <>
      {bankId && (
        <Link
          href="/teacher/problems"
          className={`${link} mb-4 inline-block text-sm`}
        >
          ← {tr("题库与题目", "Problem banks and problems")}
        </Link>
      )}
      <PageHeader
        eyebrow={tr(bankId ? "题库" : "题库与题目", bankId ? "Problem bank" : "Problem banks")}
        title={bankId ? (bank?.name ?? tr("题库详情", "Bank details")) : tr("题库与题目", "Problem banks and problems")}
        description={
          bankId
            ? bank?.description ||
              tr("题库内可使用分组整理题目，分组不会改变访问权限与成绩。", "Use groups to organize problems. Groups do not change access or scores.")
            : tr("组织课程题目，创建练习，维护题面和测试数据。教师发布题目后，校内公开与积分资格仍须管理员逐版审核。", "Organize course problems and maintain statements and tests. School-wide visibility and leaderboard points require admin review of each version.")
        }
        action={
          <div className="flex gap-2">
            <Link
              href={`/teacher/imports?kind=problems${bankId ? `&bankId=${bankId}` : ""}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Upload size={15} />
              {tr("导入题目", "Import problems")}
            </Link>
            {bankId ? (
              <Link
                className={buttonVariants()}
                href={`/teacher/problems/new/edit?bankId=${bankId}`}
              >
                <Plus size={15} />
                {tr("新建题目", "New problem")}
              </Link>
            ) : (
              <Button onClick={() => setCreate(true)}>
                <BookOpenCheck size={15} />
                {tr("新建题库", "New bank")}
              </Button>
            )}
          </div>
        }
      />
      <State resource={banks} />
      <State resource={problems} />
      <State resource={groups} />
      <Feedback action={action} />
      <div className={styles.sectionBar}>
        {!bankId && (
          <Tabs value={tab === "题库" ? tr("题库", "Banks") : tr("全部题目", "All problems")} onChange={value => setTab(value === tr("题库", "Banks") ? "题库" : "全部题目")} items={[tr("题库", "Banks"), tr("全部题目", "All problems")]} />
        )}
        <div className={styles.accessGuide}>
          <PublicationGuide />
          <p className={styles.guideNote}>
            {tr("私有题库的题目仅供指定学生使用。需要全校自由练习时，由管理员审核公开。", "Private-bank problems are for assigned students. An administrator approves school-wide practice.")}
            {bankId && bank?.description && <span className="mt-1 block">{bank.description}</span>}
          </p>
        </div>
      </div>
      {!bankId && tab === "题库" ? (
        <section className={`${panel} mt-2`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <Button size="sm" variant={showArchived ? "ghost" : "secondary"} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
              {tr("使用中", "Active")} · {activeBanks.length}
            </Button>
            <Button size="sm" variant={showArchived ? "secondary" : "ghost"} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
              {tr("已归档", "Archived")} · {archivedBanks.length}
            </Button>
          </div>
          <Table
            headers={[tr("名称", "Name"), tr("课程", "Course"), tr("题目数", "Problems"), tr("可见范围", "Visibility"), tr("最近修改", "Updated"), tr("操作", "Actions")]}
          >
            {listedBanks.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.archivedAt ? <span className="font-semibold">{item.name}</span> : <Link href={`/teacher/problems/banks/${item.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{item.name}</Link>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.archivedAt ? `${tr("已归档", "Archived")}${item.description ? ` · ${item.description}` : ""}` : item.description}
                  </p>
                </td>
                <td>{item.course ?? "Python"}</td>
                <td>
                  {item.problemCount ??
                    item.count ??
                    problems.data?.items.filter((x) => x.bankId === item.id)
                      .length ??
                    0}
                </td>
                <td>
                  {item.visibility === "school"
                    ? tr("校内题库（题目逐版审核）", "School bank (reviewed per version)")
                    : tr("维护教师 / 获授教师", "Owner / permitted teachers")}
                </td>
                <td className="text-muted-foreground">
                  {item.updatedAt
                    ? new Date(item.updatedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")
                    : "—"}
                </td>
                <td>
                  <div className="flex gap-3">
                    {!item.archivedAt && <Link
                      href={`/teacher/problems/banks/${item.id}`}
                      className={link}
                    >
                      {tr("打开", "Open")}
                    </Link>}
                    {!item.archivedAt && (item.canContribute ||
                      item.canEdit ||
                      ["owner", "edit"].includes(item.permission)) && (
                      <Link
                        href={`/teacher/imports?bankId=${item.id}`}
                        className={link}
                      >
                        {tr("导入题目", "Import problems")}
                      </Link>
                    )}
                    {item.permission === "owner" && !item.isSystem && (
                      <>
                        {(item.visibility === "private" || user.roles.includes("admin")) && <button type="button" className={link} onClick={() => setArchivingBank(item)}>
                          {item.archivedAt ? tr("恢复", "Restore") : tr("归档", "Archive")}
                        </button>}
                        <button type="button" className="inline-flex items-center gap-1 font-semibold text-destructive hover:underline focus-visible:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline" disabled={hasBankProblems(item)} title={hasBankProblems(item) ? tr("有题目时请归档题库", "Archive banks that contain problems") : undefined} onClick={() => setDeletingBank(item)}>
                          <Trash2 size={14} aria-hidden="true" />{tr("删除空题库", "Delete empty bank")}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!banks.loading && !listedBanks.length && (
              <Empty columns={6}>{showArchived ? tr("暂无已归档题库。", "No archived banks.") : tr("暂无使用中的题库。点击“新建题库”建立空题库。", "No active banks. Create one to get started.")}</Empty>
            )}
          </Table>
        </section>
      ) : (
        <div
          className={`mt-2 ${bankId ? "grid grid-cols-[240px_minmax(0,1fr)] gap-3 max-md:grid-cols-1" : ""}`}
        >
          {bankId && (
            <aside className={`${panel} self-start`}>
              <div className="flex items-center justify-between border-b border-border p-3">
                <b className="text-sm">{tr("分组", "Groups")}</b>
                <Button
                  variant="ghost"
                  size="icon"
                  title={tr("新建分组", "New group")}
                  onClick={() => setManage({ ids: [], bankId })}
                >
                  <FolderPlus size={17} />
                </Button>
              </div>
              {[
                { id: "", name: "全部题目" },
                { id: "ungrouped", name: "未分组" },
                ...(groups.data?.items.filter((x) => x.bankId === bankId) ??
                  []),
              ].map((group) => (
                <div
                  key={group.id}
                  className={`flex items-center border-b border-border ${filterGroup === group.id ? "bg-info-soft text-primary" : ""}`}
                >
                  <button
                    className="min-h-11 flex-1 px-3 py-3 text-left text-sm"
                    onClick={() => setFilterGroup(group.id)}
                  >
                    {group.id === "" ? tr("全部题目", "All problems") : group.id === "ungrouped" ? tr("未分组", "Ungrouped") : group.name}
                  </button>
                  {"canEdit" in group && group.canEdit && (
                    <button
                    aria-label={`${tr("管理", "Manage")} ${group.name}`}
                      className="px-2 text-xs text-muted-foreground"
                      onClick={() => setEditGroup(group as Group)}
                    >
                      {tr("管理", "Manage")}
                    </button>
                  )}
                </div>
              ))}
            </aside>
          )}
          <section className={panel}>
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
              <label className="relative min-w-0 flex-1" style={{maxWidth:480,flexBasis:240}}>
                <Search
                  className="absolute left-3 top-3 text-muted-foreground"
                  size={16}
                />
                <input
                  aria-label={tr("搜索题目", "Search problems")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("搜索题号、标题或主题", "Search ID, title, or topic")}
                  className={`${input} pl-9`}
                />
              </label>
              <ProblemFilter banks={banks.data?.items??[]} groups={groups.data?.items??[]} bankId={bankId} bank={filterBank} status={filterStatus} group={filterGroup} onBank={setFilterBank} onStatus={setFilterStatus} onGroup={setFilterGroup}/>
              <Button variant="secondary" size="sm" onClick={togglePublishableScope} disabled={!publishableScope.length || action.busy}>
                <CheckSquare2 size={15} />
                {allPublishableScopeSelected
                  ? tr("取消本范围选择", "Deselect in scope")
                  : publishableScope.length > MAX_BATCH_PUBLISH
                    ? tr(`选择前 ${MAX_BATCH_PUBLISH} 道可发布题（共 ${publishableScope.length} 道）`, `Select first ${MAX_BATCH_PUBLISH} publishable (${publishableScope.length} total)`)
                    : `${tr("选择可发布题目", "Select publishable")} (${publishableScope.length})`}
              </Button>
              {!bankId && (
                <Link
                  className={buttonVariants()}
                  href="/teacher/problems/new/edit"
                >
                  <Plus size={15} />
                  {tr("新建题目", "New problem")}
                </Link>
              )}
            </div>
            {checked.length > 0 && (
              <div className="border-b border-border bg-surface-subtle px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{tr("已选", "Selected")} {checkedProblems.length} {tr("道", "problems")}</b>
                  <Button size="sm" onClick={() => { action.clear(); setConfirmPublish(true); }} disabled={!publishableSelection.length || publishableSelection.length > MAX_BATCH_PUBLISH || action.busy}>
                    {tr("批量发布", "Publish selected")} ({publishableSelection.length})
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openManage(checked)} disabled={action.busy}>
                    {tr("批量整理分组", "Organize groups")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setChecked([])} disabled={action.busy}>
                    {tr("取消选择", "Clear selection")}
                  </Button>
                </div>
                {publishableSelection.length > MAX_BATCH_PUBLISH && (
                  <p role="status" className="mt-2 text-xs text-muted-foreground">
                    {tr(`单次最多发布 ${MAX_BATCH_PUBLISH} 道题，请分批选择。`, `Publish at most ${MAX_BATCH_PUBLISH} problems per batch. Narrow your selection.`)}
                  </p>
                )}
                {excludedSelection.length > 0 && (
                  <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">
                    {tr("未纳入发布", "Excluded from publishing")} ({excludedSelection.length})：
                    {excludedSelection.slice(0, 3).map((problem) => `${problem.title}（${publishEligibilityReason(problem, locale)}）`).join("、")}
                    {excludedSelection.length > 3 ? tr("等", " and more") : ""}
                  </p>
                )}
              </div>
            )}
            <Table
              headers={[
                tr("选择", "Select"),
                tr("题目", "Problem"),
                tr("题库", "Bank"),
                tr("主题 / 分组", "Topics / groups"),
                tr("接口", "Interface"),
                tr("状态", "Status"),
                tr("操作", "Actions"),
              ]}
            >
              {rows.map((problem) => (
                <tr key={problem.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${tr("选择", "Select")} ${problem.title}`}
                      checked={checked.includes(problem.id)}
                      onChange={(e) =>
                        setChecked((x) =>
                          e.target.checked
                            ? [...x, problem.id]
                            : x.filter((id) => id !== problem.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Link
                      href={`/teacher/problems/${problem.id}/edit?returnTo=${encodeURIComponent(bankId ? `/teacher/problems/banks/${bankId}` : "/teacher/problems?tab=all")}`}
                      className="font-semibold text-primary hover:underline focus-visible:underline"
                    >
                      {problem.title}
                    </Link>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {problem.id.slice(0, 8)}
                    </p>
                  </td>
                  <td>
                    {
                      banks.data?.items.find((x) => x.id === problem.bankId)
                        ?.name
                    }
                  </td>
                  <td>
                    <p className="text-xs text-muted-foreground">
                      {problem.tags?.join(" · ") || "—"}
                    </p>
                    <GroupTags
                      onClick={() => openManage([problem.id])}
                      groups={
                        groups.data?.items.filter((g) =>
                          g.problemIds.includes(problem.id),
                        ) ?? []
                      }
                    />
                  </td>
                  <td>
                    {problem.mode === "function" ? tr("函数模式", "Function") : tr("标准输入输出", "Standard I/O")}
                  </td>
                  <td>
                    <ProblemPublicationStatus problem={problem} bankVisibility={banks.data?.items.find((x) => x.id === problem.bankId)?.visibility}/>
                    {!problem.published && <p className="mt-1 text-xs text-muted-foreground">{tr("参考验证", "Reference check")}: {validationStatusLabel(problem.validationStatus ?? "Draft", locale)}</p>}
                    <p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">{reviewVisibilityLabel(problem, banks.data?.items.find((x) => x.id === problem.bankId)?.visibility, locale)}</p>
                  </td>
                  <td>
                    <Link
                      href={`/teacher/problems/${problem.id}/edit?returnTo=${encodeURIComponent(bankId ? `/teacher/problems/banks/${bankId}` : "/teacher/problems?tab=all")}`}
                      className="inline-flex items-center gap-1 font-semibold text-primary"
                    >
                      {tr("编辑", "Edit")} <ArrowRight size={14} />
                    </Link>
                    <button
                      className={`${link} ml-3`}
                      onClick={() => openManage([problem.id])}
                    >
                      {tr("整理分组", "Organize groups")}
                    </button>
                  </td>
                </tr>
              ))}
              {!problems.loading && !rows.length && (
                <Empty columns={7}>
                  {tr("当前范围暂无题目。新建题目或导入后，它们会显示在这里。", "No problems in this scope yet. Create or import problems to show them here.")}
                </Empty>
              )}
            </Table>
          </section>
        </div>
      )}
      {create && (
        <CreateBank
          allowSchool={user.roles.includes("admin")}
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            router.push(`/teacher/problems/banks/${id}`);
          }}
        />
      )}
      {confirmPublish && (
        <Modal title={tr("确认批量发布题目", "Confirm batch publication")} onClose={() => { if (!action.busy) setConfirmPublish(false); }}>
          <div className="space-y-4 text-sm">
            <p>{tr(`即将发布 ${publishableSelection.length} 道已通过参考解验证的题目。`, `You are about to publish ${publishableSelection.length} validated problems.`)}</p>
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-subtle px-4 py-3" aria-label={tr("待发布题目", "Problems to publish")}>
              {publishableSelection.map((problem) => <li key={problem.id} className="leading-6">{problem.title}</li>)}
            </ul>
            {excludedSelection.length > 0 && <p className="text-muted-foreground">{tr(`另外 ${excludedSelection.length} 道不符合发布条件的已选题目将保持原状。`, `${excludedSelection.length} other selected problems are ineligible and will remain unchanged.`)}</p>}
            <p className="text-muted-foreground">{tr("发布后该版本固定。校内公开与积分资格仍须管理员逐版审核；关联课程不会因此自动发布。", "Published versions are fixed. School-wide visibility and leaderboard points still require admin review; linked courses will not publish automatically.")}</p>
            <Feedback action={action} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmPublish(false)} disabled={action.busy}>{tr("取消", "Cancel")}</Button>
              <Button
                disabled={action.busy || publishableSelection.length < 1 || publishableSelection.length > MAX_BATCH_PUBLISH}
                onClick={() => void action.run(async () => {
                  const items = publishableSelection.map((problem) => ({ problemId: problem.id, versionId: problem.versionId! }));
                  const result = await productionApi<{ publishedCount: number }>("problems/publish-batch", { method: "POST", body: { items } });
                  setChecked((ids) => ids.filter((id) => !items.some((item) => item.problemId === id)));
                  setConfirmPublish(false);
                  problems.reload();
                  return tr(`已发布 ${result.publishedCount} 道题目。校内公开与积分资格仍待管理员审核。`, `${result.publishedCount} problems published. School-wide visibility and points await admin review.`);
                })}
              >
                {tr("确认发布", "Publish now")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {deletingBank && (
        <Modal title={tr("删除题库", "Delete bank")} onClose={() => setDeletingBank(null)}>
          <p className="text-sm leading-6">
            {tr(`永久删除“${deletingBank.name}”？只有没有任何题目、分组或导入记录的空题库可以删除。`, `Permanently delete “${deletingBank.name}”? Only banks without any problems, groups, or import records can be deleted.`)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{tr("有内容的题库须归档，以保留已发布版本、提交和成绩。", "Archive banks with content to preserve published versions, submissions, and grades.")}</p>
          {hasBankProblems(deletingBank) && <p className="mt-2 text-sm font-medium text-destructive">{tr(`该库仍有 ${deletingBank.problemCount ?? 0} 道使用中的题目、${deletingBank.archivedProblemCount ?? 0} 道已归档题目，不能删除。`, `This bank contains ${deletingBank.problemCount ?? 0} active and ${deletingBank.archivedProblemCount ?? 0} archived problems, so it cannot be deleted.`)}</p>}
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={action.busy} onClick={() => setDeletingBank(null)}>{tr("取消", "Cancel")}</Button>
            <Button variant="danger" disabled={action.busy || hasBankProblems(deletingBank)} onClick={removeEmptyBank}>{tr("确认删除", "Delete bank")}</Button>
          </div>
        </Modal>
      )}
      {archivingBank && (
        <Modal title={archivingBank.archivedAt ? tr("恢复题库", "Restore bank") : tr("归档题库", "Archive bank")} onClose={() => setArchivingBank(null)}>
          <p className="text-sm leading-6">{archivingBank.archivedAt
            ? tr(`恢复“${archivingBank.name}”？恢复后可以继续维护题目，但不会重新公开曾撤下的版本。`, `Restore “${archivingBank.name}”? You can maintain its problems again, but withdrawn versions stay withdrawn.`)
            : tr(`归档“${archivingBank.name}”？题目版本、提交和成绩都会保留；若仍有公开版本或被已发布课程、未归档训练引用，系统会阻止归档。`, `Archive “${archivingBank.name}”? Versions, submissions, and grades remain. Public versions and active course or practice references block archiving.`)}</p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={action.busy} onClick={() => setArchivingBank(null)}>{tr("取消", "Cancel")}</Button>
            <Button disabled={action.busy} onClick={changeBankArchive}>{archivingBank.archivedAt ? <RotateCcw size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}{archivingBank.archivedAt ? tr("恢复题库", "Restore bank") : tr("归档题库", "Archive bank")}</Button>
          </div>
        </Modal>
      )}
      {manage && (
        <ManageGroups
          bankId={manage.bankId}
          problemIds={manage.ids}
          onClose={() => setManage(null)}
          onSaved={() => {
            groups.reload();
            setManage(null);
          }}
        />
      )}
      {editGroup && (
        <Modal
          title={`${tr("管理分组", "Manage group")} · ${editGroup.name}`}
          onClose={() => setEditGroup(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(async () => {
                await productionApi(`problem-groups/${editGroup.id}`, {
                  method: "PATCH",
                  body: { name: d.get("name") },
                });
                groups.reload();
                setEditGroup(null);
                return tr("分组名称已更新。", "Group name updated.");
              });
            }}
          >
            <Field label={tr("分组名称", "Group name")}>
              <input
                name="name"
                defaultValue={editGroup.name}
                required
                className={input}
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              {tr("解散分组会移除分组关系，题库题目与历史活动保留。", "Deleting a group removes only its relationships. Problems and past activities remain.")}
            </p>
            <Feedback action={action} />
            <div className="flex justify-between">
              <Button
                variant="danger"
                type="button"
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm(`${tr("解散", "Delete")} “${editGroup.name}”? ${tr("保留所有题目。", "All problems will remain.")}`))
                    void action.run(async () => {
                      await productionApi(`problem-groups/${editGroup.id}`, {
                        method: "DELETE",
                      });
                      groups.reload();
                      setEditGroup(null);
                      return tr("分组已解散，题目保留。", "Group deleted. Problems retained.");
                    });
                }}
              >
                {tr("解散分组", "Delete group")}
              </Button>
              <Button type="submit" disabled={action.busy}>
                {tr("保存名称", "Save name")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function GroupTags({
  groups,
  onClick,
}: {
  groups: Group[];
  onClick?: (() => void) | undefined;
}) {
  return (
    <span className="mt-1 inline-flex flex-wrap gap-1">
      {groups.slice(0, 2).map((g) => (
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          key={g.id}
          className="rounded bg-accent px-1.5 py-0.5 text-xs text-primary"
        >
          {g.name}
        </button>
      ))}
      {groups.length > 2 && (
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          title={groups
            .slice(2)
            .map((x) => x.name)
            .join("、")}
          className="rounded bg-muted px-1.5 py-0.5 text-xs"
        >
          +{groups.length - 2}
        </button>
      )}
    </span>
  );
}
export function CreateBank({
  allowSchool,
  onClose,
  onCreated,
}: {
  allowSchool: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => localText(locale, zh, en);
  const action = useAction();
  return (
    <Modal title={tr("新建题库", "New bank")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(async () => {
            const result = await productionApi<Bank>("problem-banks", {
              method: "POST",
              body: {
                name: d.get("name"),
                description: d.get("description"),
                course: d.get("course"),
                visibility: d.get("visibility"),
              },
            });
            onCreated(result.id);
          });
        }}
      >
        <Field label={tr("题库名称 *", "Bank name *")}>
          <input autoFocus name="name" required className={input} />
        </Field>
        <Field label={tr("简介", "Description")}>
          <textarea name="description" rows={3} className={area} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("课程 / 主题", "Course / topic")}>
            <select name="course" className={input}>
              {["Python", "ACSL", "CIE 9618", "其他"].map((x) => (
                <option key={x} value={x}>{x === "其他" ? tr("其他", "Other") : x}</option>
              ))}
            </select>
          </Field>
          <Field label={tr("可见范围", "Visibility")}>
            {allowSchool ? <select name="visibility" className={input}>
              <option value="private">{tr("教师私有", "Teacher private")}</option>
              <option value="school">{tr("校内题库（题目逐版审核）", "School bank (reviewed per version)")}</option>
            </select> : <><input type="hidden" name="visibility" value="private" /><p className={`${input} flex items-center bg-surface-subtle text-muted-foreground`}>{tr("教师私有", "Teacher private")}</p></>}
          </Field>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{allowSchool ? tr("校内题库仅代表题目可以提交审核；管理员逐版通过前，不会全校公开或计入积分榜。", "A school bank lets problems be submitted for review. Until an administrator approves each version, they are not school-wide and earn no leaderboard points.") : tr("如需全校可见，请联系管理员将题库纳入校内审核；审核通过前，题目仅向指定活动学生开放。", "For school-wide visibility, ask an administrator to include this bank in review. Before approval, problems are available only to assigned activity students.")}</p>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button type="submit" disabled={action.busy}>
            {tr("创建题库", "Create bank")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ManageGroups({
  bankId,
  problemIds,
  onClose,
  onSaved,
  initialMode,
  initialSource,
}: {
  bankId: string;
  problemIds: string[];
  initialMode?: string | undefined;
  initialSource?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => localText(locale, zh, en);
  const groups = useData<{ items: Group[] }>(`problem-groups?bankId=${bankId}`),
    [query, setQuery] = useState(""),
    [picked, setPicked] = useState<string[]>([]),
    [newName, setNewName] = useState(""),
    [mode, setMode] = useState(initialMode ?? "添加到分组"),
    [source, setSource] = useState(initialSource ?? ""),
    action = useAction();
  return (
    <Modal title={tr("整理分组", "Organize groups")} onClose={onClose}>
      <Tabs
        items={[tr("添加到分组", "Add to groups"), tr("移动分组", "Move groups"), tr("移出分组", "Remove from groups")]}
        value={mode === "添加到分组" ? tr("添加到分组", "Add to groups") : mode === "移动分组" ? tr("移动分组", "Move groups") : tr("移出分组", "Remove from groups")}
        onChange={value=>{setMode(value === tr("添加到分组", "Add to groups") ? "添加到分组" : value === tr("移动分组", "Move groups") ? "移动分组" : "移出分组");setPicked([]);setSource("");setNewName("");}}
      />
      <p className="mt-4 text-sm text-muted-foreground">
        {tr("已选", "Selected")} {problemIds.length}{" "}
        {tr("道题。添加保留原有分组；移动需要明确选择来源与目标。", "problems. Adding keeps existing groups; moving requires a source and a target.")}
      </p>
      <input
        aria-label={tr("搜索分组", "Search groups")}
        className={`${input} mt-3`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("搜索分组", "Search groups")}
      />
      <State resource={groups} />
      {mode === "移动分组" && (
        <Field label={tr("来源分组", "Source group")}>
          <select
            className={input}
            value={source}
            onChange={(e) => {setSource(e.target.value);setPicked(x=>x.filter(id=>id!==e.target.value));}}
          >
            <option value="">{tr("请选择来源", "Choose source")}</option>
            {groups.data?.items
              .filter((g) => g.canEdit && problemIds.every(id=>g.problemIds.includes(id)))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <div className="mt-3 max-h-64 overflow-auto border border-border">
        {groups.data?.items
          .filter((g) => g.name.toLowerCase().includes(query.toLowerCase()) && (mode!=="移出分组" || problemIds.some(id=>g.problemIds.includes(id))))
          .map((g) => (
            <label
              key={g.id}
              className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={picked.includes(g.id)}
                disabled={!g.canEdit || (mode === "移动分组" && g.id === source) || action.busy}
                onChange={(e) =>
                  setPicked((x) =>
                    e.target.checked
                      ? [...x, g.id]
                      : x.filter((id) => id !== g.id),
                  )
                }
              />
              <span>
                <b>{g.name}</b>
                <p className="mt-1 text-xs text-muted-foreground">
                  {g.problemIds.length} {tr("题", "problems")} ·{" "}
                  {problemIds.filter((id) => g.problemIds.includes(id)).length}{" "}
                  {tr("道已在此组", "selected in this group")}
                </p>
              </span>
            </label>
          ))}
        {!groups.loading&&!groups.error&&!groups.data?.items.some(g=>g.name.toLowerCase().includes(query.toLowerCase())&&(mode!=="移出分组"||problemIds.some(id=>g.problemIds.includes(id))))&&<p className="p-3 text-sm text-muted-foreground">{query?tr("没有匹配的分组。","No matching groups."):mode==="移出分组"?tr("所选题目尚未加入任何分组。","Selected problems are not in any group."):tr("此题库暂无分组，可在下方新建。","No groups yet. Create one below.")}</p>}
      </div>
      {mode === "添加到分组" && (
        <Field label={tr("新建分组（可选）", "New group (optional)")}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={`${input} mt-3`}
            placeholder={tr("输入新分组名称", "Enter a new group name")}
          />
        </Field>
      )}
      <Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {tr("取消", "Cancel")}
        </Button>
        <Button
          disabled={
            action.busy || groups.loading || !!groups.error ||
            (!picked.length && !(mode==="添加到分组"&&newName.trim())) ||
            (mode === "移动分组" && !source)
          }
          onClick={() =>
            void action.run(async () => {
              if(mode==="移动分组"){
                await productionApi("problem-groups/move",{method:"POST",body:{bankId,sourceGroupId:source,targetGroupIds:picked,problemIds}});
                onSaved();return "题目已通过服务端事务移动。";
              }
              const fresh=await productionApi<{items:Group[]}>(`problem-groups?bankId=${encodeURIComponent(bankId)}`);
              const selected=picked.map(id=>fresh.items.find(g=>g.id===id));
              if(selected.some(g=>!g?.canEdit))throw new Error("分组已删除或权限已变更，请重新加载后选择。");
              if (mode === "添加到分组" && newName.trim())
                await productionApi("problem-groups", {
                  method: "POST",
                  body: { bankId, name: newName.trim(), problemIds },
                });
              for (const id of picked) {
                const g = fresh.items.find((x) => x.id === id);
                if (!g) continue;
                await productionApi(`problem-groups/${id}`, {
                  method: "PATCH",
                  body: {
                    problemIds:
                      mode === "移出分组"
                        ? g.problemIds.filter((x) => !problemIds.includes(x))
                        : [...new Set([...g.problemIds, ...problemIds])],
                  },
                });
              }
              onSaved();
              return "分组关系已更新。";
            })
          }
        >
          {mode === "添加到分组"
            ? tr("确认添加", "Add")
            : mode === "移动分组"
              ? tr("确认移动", "Move")
              : tr("仅移出所选分组", "Remove from selected groups")}
        </Button>
      </div>
    </Modal>
  );
}
export function ProblemPicker({
  selected,
  onClose,
  onAdd,
  courseMode,
}: {
  selected: string[];
  onClose: () => void;
  onAdd: (items: ProductionProblem[]) => void;
  courseMode?: "draft" | "published";
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => localText(locale, zh, en);
  const banks = useData<{ items: Bank[] }>("problem-banks"),
    groups = useData<{ items: Group[] }>("problem-groups"),
    problems = useData<{ items: ProductionProblem[] }>("problems"),
    [bank, setBank] = useState(""),
    [group, setGroup] = useState(""),
    [query, setQuery] = useState(""),
    [picked, setPicked] = useState<string[]>([]);
  const rows =
    problems.data?.items.filter(
      (p) =>
        (!courseMode || (p.bankVisibility === "school" && (courseMode === "published" || p.canEdit))) &&
        (!bank || p.bankId === bank) &&
        (!group ||
          groups.data?.items
            .find((g) => g.id === group)
            ?.problemIds.includes(p.id)) &&
        `${p.title} ${p.tags?.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Drawer title={tr("从题库与分组选择", "Choose from banks and groups")} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        {courseMode === "draft"
          ? tr("课程草稿可引用校内题库中你能编辑的题目最新版本；发布课程前，关联题须发布并通过管理员公开审核。", "A course draft can link the latest versions you can edit in school banks. Publish and obtain admin approval for linked problems before publishing the course.")
          : courseMode === "published"
            ? tr("课程只能添加已通过管理员审核的校内公开题目。", "Only admin-approved school-wide problems can be added to a published course.")
            : tr("题库 → 分组 → 题目。多组同题只显示一次，已加入的题目保留选择状态。", "Bank → group → problem. Problems in multiple groups appear once; already added problems stay selected.")}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <select
          aria-label={tr("选择题库", "Choose bank")}
          className={input}
          value={bank}
          onChange={(e) => {
            setBank(e.target.value);
            setGroup("");
          }}
        >
          <option value="">{tr("全部题库", "All banks")}</option>
          {banks.data?.items.filter((x) => !courseMode || x.visibility === "school").map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select
          aria-label={tr("选择分组", "Choose group")}
          className={input}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">{tr("全部分组", "All groups")}</option>
          {groups.data?.items
            .filter((x) => (!bank || x.bankId === bank) &&
              (!courseMode || banks.data?.items.some((item) => item.id === x.bankId && item.visibility === "school")))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
        <input
          aria-label={tr("搜索选择题目", "Search problems to select")}
          className={`${input} col-span-2`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("搜索题目", "Search problems")}
        />
      </div>
      <State resource={banks} /><State resource={groups} /><State resource={problems} />
      <div className="mt-4 divide-y divide-border border border-border">
        {rows.map((p) => {
          const exists = selected.includes(p.id),
            courseReady = p.published && p.bankVisibility === "school" && Boolean(p.schoolVisibleAt) && p.rankReviewStatus === "approved",
            available = courseMode === "draft"
              ? true
              : courseMode === "published"
                ? courseReady
                : p.published || Boolean(p.publishedVersionId);
          return (
            <label key={p.id} className="flex gap-3 p-4 text-sm">
              <input
                type="checkbox"
                disabled={exists || !available}
                checked={exists || picked.includes(p.id)}
                onChange={(e) =>
                  setPicked((x) =>
                    e.target.checked
                      ? [...x, p.id]
                      : x.filter((id) => id !== p.id),
                  )
                }
              />
              <span>
                <b>{courseMode ? p.title : p.publishedTitle ?? p.title}</b>
                <GroupTags
                  groups={
                    groups.data?.items.filter((g) =>
                      g.problemIds.includes(p.id),
                    ) ?? []
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {exists
                    ? tr("已添加", "Added")
                    : courseMode
                      ? courseReady
                        ? tr("已审核公开 · 可随课程发布", "Approved and public · ready for the course")
                        : p.published
                          ? p.rankReviewStatus === "rejected"
                            ? tr("审核未通过 · 教学可用", "Review rejected · teaching ready")
                            : p.rankReviewStatus === "revoked"
                              ? tr("已撤下 · 教学可用", "Withdrawn · teaching ready")
                              : tr("待公开审核 · 教学可用", "Awaiting public review · teaching ready")
                          : tr("题目草稿 · 仅在课程草稿中预览", "Problem draft · preview only in the course draft")
                      : available
                        ? tr("教学可用 · 固定版本", "Teaching ready · fixed version")
                        : tr("教师草稿 · 不能进入正式活动", "Teacher draft · unavailable for formal activities")}
                </p>
              </span>
            </label>
          );
        })}
        {!problems.loading && !rows.length && (
          <p className="p-4 text-sm text-muted-foreground">
            {courseMode === "draft"
              ? tr("当前范围暂无可编辑的校内题库题目。", "No editable school-bank problems in this scope.")
              : courseMode === "published"
                ? tr("当前范围暂无校内题库题目。", "No school-bank problems in this scope.")
              : tr("当前范围暂无题目。", "No problems in this scope.")}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            setPicked(
              rows
                .filter(
                  (p) =>
                    (courseMode === "draft" || courseMode === "published"
                      ? courseMode === "draft" || (p.published && p.bankVisibility === "school" && Boolean(p.schoolVisibleAt) && p.rankReviewStatus === "approved")
                      : p.published || p.publishedVersionId) &&
                    !selected.includes(p.id),
                )
                .map((p) => p.id),
            )
          }
        >
          {courseMode === "draft"
            ? tr("选择当前范围全部题目", "Select all problems in scope")
            : courseMode === "published"
              ? tr("选择当前范围全部已审核题", "Select all approved problems in scope")
              : tr("选择当前范围全部已发布题", "Select all published problems in scope")}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button
            disabled={!picked.length || problems.loading || !!problems.error}
            onClick={() =>
              onAdd(
                (problems.data?.items ?? []).filter((x) =>
                  picked.includes(x.id),
                ),
              )
            }
          >
            {tr("确认加入", "Add")} {picked.length} {tr("题", "problems")}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

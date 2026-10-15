"use client";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import {
  CheckSquare2,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Search,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { Bank, Group, GroupTags, ManageGroups, MAX_BATCH_PUBLISH, publishEligibilityReason, reviewVisibilityLabel, validationStatusLabel } from "./problem-banks";
import { useLocale } from "@/components/locale-context";
import {
  Drawer,
  Feedback,
  Field,
  input,
  link,
  Modal,
  panel,
  State,
  useAction,
  useData,
} from "./shared";

export function TeacherBankDetail({ id }: { id: string }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const banks = useData<{ items: Bank[] }>("problem-banks"),
    problems = useData<{
      items: (ProductionProblem & { formalTestCount?: number })[];
    }>("problems"),
    groups = useData<{ items: Group[] }>(`problem-groups?bankId=${id}`),
    bank = banks.data?.items.find((x) => x.id === id),
    [view, setView] = useState("all"),
    [checked, setChecked] = useState<string[]>([]),
    [confirmPublish, setConfirmPublish] = useState(false),
    [manage, setManage] = useState<{
      ids: string[];
      mode?: string;
      source?: string;
    } | null>(null),
    [groupAdmin, setGroupAdmin] = useState(false),
    [adding, setAdding] = useState(false),
    [editGroup, setEditGroup] = useState<Group | null>(null),
    action = useAction();
  const all = problems.data?.items.filter((p) => p.bankId === id) ?? [],
    rows =
      view === "all"
        ? all
        : view === "none"
          ? all.filter(
              (p) =>
                !groups.data?.items.some((g) => g.problemIds.includes(p.id)),
            )
          : all.filter((p) =>
              groups.data?.items
                .find((g) => g.id === view)
                ?.problemIds.includes(p.id),
            ),
    selected = checked.filter((id) => rows.some((p) => p.id === id)),
    currentGroup = groups.data?.items.find((g) => g.id === view),
    label =
      view === "all"
        ? "全部题目"
        : view === "none"
          ? "未分组"
          : (currentGroup?.name ?? "分组"),
    canContribute =
      bank?.canContribute ||
      bank?.canEdit ||
      ["owner", "edit"].includes(bank?.permission ?? "");
  const selectedProblems = rows.filter((problem) => selected.includes(problem.id));
  const publishableSelection = selectedProblems.filter((problem) => !publishEligibilityReason(problem, locale));
  const excludedSelection = selectedProblems.filter((problem) => publishEligibilityReason(problem, locale));
  const publishableScope = rows.filter((problem) => !publishEligibilityReason(problem, locale));
  const selectableScope = publishableScope.slice(0, MAX_BATCH_PUBLISH);
  const allPublishableScopeSelected = selectableScope.length > 0 && selectableScope.every((problem) => selected.includes(problem.id));
  const togglePublishableScope = () => {
    const scopeIds = new Set(selectableScope.map((problem) => problem.id));
    setChecked((ids) => allPublishableScopeSelected
      ? ids.filter((problemId) => !scopeIds.has(problemId))
      : [...new Set([...ids, ...scopeIds])]);
  };
  const options = [
    { id: "all", name: "全部题目", count: all.length },
    {
      id: "none",
      name: "未分组",
      count: all.filter(
        (p) => !groups.data?.items.some((g) => g.problemIds.includes(p.id)),
      ).length,
    },
    ...(groups.data?.items.map((g) => ({
      id: g.id,
      name: g.name,
      count: g.problemIds.length,
    })) ?? []),
  ];
  return (
    <>
      <Link
        className={`${link} mb-4 inline-block text-sm`}
        href="/teacher/problems"
      >
        ← {tr("返回题库", "Back to banks")}
      </Link>
      <PageHeader
        eyebrow={tr("题库", "Problem bank")}
        title={bank?.name ?? tr("题库详情", "Bank details")}
        description={bank?.description || tr("教师创建的课程练习题库", "A teacher-created course practice bank")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!canContribute}
              onClick={() => setAdding(true)}
            >
              <Search size={15} />
              {tr("从已有题目添加", "Add existing problems")}
            </Button>
            <Link
              className={buttonVariants({ variant: "secondary" })}
              href={`/teacher/imports?bankId=${id}`}
            >
              <Upload size={15} />
              {tr("导入题目", "Import problems")}
            </Link>
            <Link
              className={buttonVariants()}
              href={`/teacher/problems/new/edit?bankId=${id}&returnTo=${encodeURIComponent(`/teacher/problems/banks/${id}`)}`}
            >
              <FilePlus2 size={15} />
              {tr("新建题目", "New problem")}
            </Link>
          </div>
        }
      />
      <p className="mt-3 rounded-md border border-border bg-surface-subtle px-4 py-3 text-sm leading-6 text-muted-foreground">
        {bank?.visibility === "school" ? tr("今后发布的新版本需管理员逐版审核；审核前仅指定活动学生可见，审核通过后才开放全校自由练习并参与后续积分排名。", "New versions require admin review. Before approval they are visible only to assigned activity students; after approval they are available school-wide and eligible for future leaderboard points.") : tr("教师私有题库不会直接对全校公开。如需开放，请联系管理员纳入校内审核；已发布题目仍需逐版审核。", "Private teacher banks are not public school-wide. Ask an administrator to enable review; published problems still require review per version.")}
      </p>
      <State resource={banks} />
      <State resource={problems} />
      <State resource={groups} />
      <Feedback action={action} />
      <div className="mt-5 grid grid-cols-[230px_minmax(0,1fr)] gap-5 max-md:grid-cols-1">
        <aside className={`${panel} self-start`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold">{tr("分组", "Groups")}</h2>
            <button
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
              onClick={() => setGroupAdmin(true)}
            >
              <FolderPlus size={15} />
              {tr("分组管理", "Manage groups")}
            </button>
          </div>
          <div className="p-3 md:hidden">
            <select
              aria-label={tr("题库分组", "Bank groups")}
              value={view}
              onChange={(e) => setView(e.target.value)}
              className={input}
            >
              {options.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id === "all" ? tr("全部题目", "All problems") : g.id === "none" ? tr("未分组", "Ungrouped") : g.name}（{g.count}）
                </option>
              ))}
            </select>
          </div>
          <nav className="hidden p-2 md:block" aria-label={tr("题库分组", "Bank groups")}>
            {options.map((g) => (
              <button
                key={g.id}
                onClick={() => setView(g.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${view === g.id ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <span className="truncate">{g.id === "all" ? tr("全部题目", "All problems") : g.id === "none" ? tr("未分组", "Ungrouped") : g.name}</span>
                <span>{g.count}</span>
              </button>
            ))}
          </nav>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {tr("一道题可属于多个分组；各分组题数之和可大于题库总题数", "A problem may belong to multiple groups; summed group counts may exceed the bank total of")} {all.length}{locale === "zh" ? "。" : "."}
          </p>
        </aside>
        <section className={`${panel} min-w-0`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-bold">{view === "all" ? tr("全部题目", "All problems") : view === "none" ? tr("未分组", "Ungrouped") : label}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {rows.length} {tr("道题 · 导入题与手工题统一归类", "problems · imported and manually created problems are grouped together")}
              </p>
            </div>
            <Button size="sm" variant="secondary" disabled={!publishableScope.length || action.busy} onClick={togglePublishableScope}>
              <CheckSquare2 size={15} />
              {allPublishableScopeSelected
                ? tr("取消可发布题目选择", "Deselect publishable")
                : publishableScope.length > MAX_BATCH_PUBLISH
                  ? tr(`选择前 ${MAX_BATCH_PUBLISH} 道可发布题`, `Select first ${MAX_BATCH_PUBLISH} publishable`)
                  : `${tr("选择可发布题目", "Select publishable")} (${publishableScope.length})`}
            </Button>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-4 py-3 text-sm">
              <b>{tr("已选", "Selected")} {selected.length} {tr("道", "problems")}</b>
              <Button
                size="sm"
                disabled={!publishableSelection.length || publishableSelection.length > MAX_BATCH_PUBLISH || action.busy}
                onClick={() => { action.clear(); setConfirmPublish(true); }}
              >
                {tr("批量发布", "Publish selected")} ({publishableSelection.length})
              </Button>
              <Button size="sm" onClick={() => setManage({ ids: selected })}>
                {view === "none" ? tr("分配分组", "Assign group") : tr("添加到分组", "Add to group")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setManage({
                    ids: selected,
                    mode: "移动分组",
                    source: currentGroup?.id,
                  })
                }
              >
                {tr("移动到分组", "Move to group")}
              </Button>
              {currentGroup && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `从“${currentGroup.name}”移除所选 ${selected.length} 道题？题目与其他分组保留。`,
                      )
                    )
                      void action.run(async () => {
                        await productionApi(
                          `problem-groups/${currentGroup.id}`,
                          {
                            method: "PATCH",
                            body: {
                              problemIds: currentGroup.problemIds.filter(
                                (p) => !selected.includes(p),
                              ),
                            },
                          },
                        );
                        groups.reload();
                        setChecked([]);
                        return "已仅从当前分组移除。";
                      });
                  }}
                >
                  {tr("从本分组移除", "Remove from this group")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setChecked([])}>
                {tr("取消选择", "Clear selection")}
              </Button>
              {publishableSelection.length > MAX_BATCH_PUBLISH && (
                <p role="status" className="w-full text-xs text-muted-foreground">
                  {tr(`单次最多发布 ${MAX_BATCH_PUBLISH} 道题，请分批选择。`, `Publish at most ${MAX_BATCH_PUBLISH} problems per batch. Narrow your selection.`)}
                </p>
              )}
              {excludedSelection.length > 0 && (
                <p role="status" className="w-full text-xs leading-5 text-muted-foreground">
                  {tr("未纳入发布", "Excluded from publishing")} ({excludedSelection.length})：
                  {excludedSelection.slice(0, 3).map((problem) => `${problem.title}（${publishEligibilityReason(problem, locale)}）`).join("、")}
                  {excludedSelection.length > 3 ? tr("等", " and more") : ""}
                </p>
              )}
            </div>
          )}
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-surface-subtle text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={tr("全选题库题目", "Select all bank problems")}
                        checked={selected.length === rows.length}
                        onChange={(e) =>
                          setChecked(
                            e.target.checked ? rows.map((p) => p.id) : [],
                          )
                        }
                      />
                    </th>
                    {[
                      "题号与标题",
                      "分组",
                      "接口",
                      "正式测试",
                      "状态",
                      "操作",
                    ].map((x) => (
                      <th className="px-4 py-3" key={x}>
                        {tr(x, ({"题号与标题":"ID and title","分组":"Group","接口":"Interface","正式测试":"Formal tests","状态":"Status","操作":"Actions"} as Record<string,string>)[x] ?? x)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <input
                          aria-label={`${tr("选择", "Select")} ${p.title}`}
                          type="checkbox"
                          checked={checked.includes(p.id)}
                          onChange={(e) =>
                            setChecked((x) =>
                              e.target.checked
                                ? [...x, p.id]
                                : x.filter((id) => id !== p.id),
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/teacher/problems/${p.id}/edit?returnTo=${encodeURIComponent(`/teacher/problems/banks/${id}`)}`}
                          className="font-semibold text-primary hover:underline focus-visible:underline"
                        >
                          {p.title}
                        </Link>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {p.id.slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <GroupTags
                          onClick={() => setManage({ ids: [p.id] })}
                          groups={
                            groups.data?.items.filter((g) =>
                              g.problemIds.includes(p.id),
                            ) ?? []
                          }
                        />
                        {!groups.data?.items.some((g) =>
                          g.problemIds.includes(p.id),
                        ) && (
                          <span className="text-xs text-muted-foreground">
                            {tr("未分组", "Ungrouped")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.mode === "function" ? tr("函数模式", "Function") : tr("标准输入输出", "Standard I/O")}
                      </td>
                      <td className="px-4 py-3">
                        {p.formalTestCount ??
                          p.tests?.filter(
                            (x) =>
                              (x as { enabled?: boolean }).enabled !== false,
                          ).length ??
                          tr("按版本查看", "View by version")}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          status={
                            p.published
                              ? tr("已发布", "Published")
                              : validationStatusLabel(p.validationStatus ?? "Draft", locale)
                          }
                        />
                        <p className="mt-1 max-w-52 text-xs leading-5 text-muted-foreground">{reviewVisibilityLabel(p, bank?.visibility, locale)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Link
                            className={link}
                            href={`/teacher/problems/${p.id}/edit?returnTo=${encodeURIComponent(`/teacher/problems/banks/${id}`)}`}
                          >
                            {tr("编辑", "Edit")}
                          </Link>
                          <button
                            className="text-muted-foreground"
                            title={tr("整理分组", "Organize groups")}
                            onClick={() => setManage({ ids: [p.id] })}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-[320px] place-items-center p-8 text-center">
              <div>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-muted text-muted-foreground">
                  <FilePlus2 />
                </div>
                <h3 className="mt-4 text-lg font-bold">
                  {view === "all" ? tr("题库还是空的", "This bank is empty") : `${tr("分组", "Group")} “${label}” ${tr("暂无题目", "has no problems")}`}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {view === "all"
                    ? tr("先手工创建一道题，或导入现有题目资料。", "Create a problem or import existing material to get started.")
                    : tr("从已有题目添加，或从其他分组添加到这里。", "Add an existing problem or one from another group.")}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => setAdding(true)}>
                    {tr("添加题目", "Add problems")}
                  </Button>
                  <Link
                    className={buttonVariants()}
                    href={`/teacher/problems/new/edit?bankId=${id}`}
                  >
                    {tr("新建题目", "New problem")}
                  </Link>
                  <Link
                    className={buttonVariants({ variant: "secondary" })}
                    href={`/teacher/imports?bankId=${id}`}
                  >
                    {tr("导入题目", "Import problems")}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
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
                  setChecked((ids) => ids.filter((problemId) => !items.some((item) => item.problemId === problemId)));
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
      {manage && (
        <ManageGroups
          bankId={id}
          problemIds={manage.ids}
          initialMode={manage.mode}
          initialSource={manage.source}
          onClose={() => setManage(null)}
          onSaved={() => {
            setManage(null);
            setChecked([]);
            groups.reload();
          }}
        />
      )}
      {groupAdmin && (
        <Modal title={tr("分组管理", "Manage groups")} onClose={() => setGroupAdmin(false)}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                d = new FormData(form);
              void action.run(async () => {
                await productionApi("problem-groups", {
                  method: "POST",
                  body: { bankId: id, name: d.get("name"), problemIds: [] },
                });
                form.reset();
                groups.reload();
                return "分组已创建。";
              });
            }}
          >
            <input
              aria-label={tr("新分组名称", "New group name")}
              name="name"
              required
              className={input}
              placeholder={tr("新分组名称", "New group name")}
            />
            <Button disabled={action.busy || !canContribute}>{tr("新建", "Create")}</Button>
          </form>
          <div className="mt-4 divide-y divide-border">
            {groups.data?.items.map((g) => (
              <div
                key={g.id}
                className="flex justify-between gap-2 py-3 text-sm"
              >
                <b>
                  {g.name} · {g.problemIds.length} {tr("题", "problems")}
                </b>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!g.canEdit}
                  onClick={() => setEditGroup(g)}
                >
                  {tr("改名 / 解散", "Rename / delete")}
                </Button>
              </div>
            ))}
          </div>
          <Feedback action={action} />
          <p className="mt-3 text-xs text-muted-foreground">
            {tr("解散分组只删除分组关系，题目、学习章节与历史活动保留。", "Deleting a group removes only its relationships. Problems, course chapters, and past activities remain.")}
          </p>
        </Modal>
      )}
      {editGroup && (
        <GroupEditor
          group={editGroup}
          onClose={() => setEditGroup(null)}
          onSaved={() => {
            setEditGroup(null);
            groups.reload();
          }}
        />
      )}
      {adding && (
        <AddExisting
          bankId={id}
          targetGroup={currentGroup}
          existing={all.map((p) => p.id)}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            problems.reload();
            groups.reload();
          }}
        />
      )}
    </>
  );
}
function GroupEditor({
  group,
  onClose,
  onSaved,
}: {
  group: Group;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const action = useAction();
  return (
    <Modal title={`${tr("分组", "Group")} · ${group.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void action.run(async () => {
            await productionApi(`problem-groups/${group.id}`, {
              method: "PATCH",
              body: { name: d.get("name") },
            });
            onSaved();
          });
        }}
      >
        <Field label={tr("名称", "Name")}>
          <input
            name="name"
            required
            defaultValue={group.name}
            className={input}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          {tr("解散后保留", "Deleting this group keeps")} {group.problemIds.length} {tr("道题及全部其他分组。", "problems and all other groups.")}
        </p>
        <Feedback action={action} />
        <div className="flex justify-between">
          <Button
            type="button"
            variant="danger"
            disabled={action.busy}
            onClick={() => {
              if (window.confirm(`${tr("解散", "Delete")} “${group.name}”? ${tr("保留全部题目。", "All problems will remain.")}`))
                void action.run(async () => {
                  await productionApi(`problem-groups/${group.id}`, {
                    method: "DELETE",
                  });
                  onSaved();
                });
            }}
          >
            {tr("解散分组", "Delete group")}
          </Button>
          <Button disabled={action.busy}>{tr("保存名称", "Save name")}</Button>
        </div>
      </form>
    </Modal>
  );
}
function AddExisting({
  bankId,
  targetGroup,
  existing,
  onClose,
  onSaved,
}: {
  bankId: string;
  targetGroup?: Group | undefined;
  existing: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const problems = useData<{ items: ProductionProblem[] }>("problems"),
    banks = useData<{ items: Bank[] }>("problem-banks"),
    [source, setSource] = useState(""),
    [query, setQuery] = useState(""),
    [picked, setPicked] = useState<string[]>([]),
    action = useAction(),
    rows =
      problems.data?.items.filter(
        (p) =>
          (!source || p.bankId === source) &&
          p.title.toLowerCase().includes(query.toLowerCase()),
      ) ?? [];
  return (
    <Drawer title={tr("从已有题目添加", "Add existing problems")} onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        {tr("同一题库的题目添加分组引用。跨题库复制为新草稿，保留来源，原题与已发布版本保持。", "Problems in this bank are linked to the group. Cross-bank copies become new drafts; the source and published versions remain unchanged.")}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <select
          aria-label={tr("来源题库", "Source bank")}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={input}
        >
          <option value="">{tr("全部有权限题库", "All accessible banks")}</option>
          {banks.data?.items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          className={input}
          aria-label={tr("搜索已有题目", "Search existing problems")}
          placeholder={tr("搜索标题", "Search titles")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <State resource={problems} />
      <div className="mt-4 divide-y divide-border border border-border">
        {rows.map((p) => {
          const already = targetGroup
              ? targetGroup.problemIds.includes(p.id)
              : existing.includes(p.id),
            copyable = p.bankId === bankId || p.canEdit !== false;
          return (
            <label className="flex gap-3 p-4 text-sm" key={p.id}>
              <input
                type="checkbox"
                disabled={already || !copyable}
                checked={already || picked.includes(p.id)}
                onChange={(e) =>
                  setPicked((x) =>
                    e.target.checked
                      ? [...x, p.id]
                      : x.filter((id) => id !== p.id),
                  )
                }
              />
              <span>
                <b>{p.title}</b>
                <p className="mt-1 text-xs text-muted-foreground">
                  {already
                    ? tr("已添加", "Added")
                    : p.bankId === bankId
                      ? tr("本题库题目 · 添加引用", "In this bank · add reference")
                      : copyable
                        ? tr("复制到目标题库为新草稿", "Copy to target bank as a new draft")
                        : tr("仅阅读权限 · 不能复制正式测试", "Read-only · cannot copy formal tests")}
                </p>
              </span>
            </label>
          );
        })}
      </div>
      <Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {tr("取消", "Cancel")}
        </Button>
        <Button
          disabled={!picked.length || action.busy}
          onClick={() =>
            void action.run(async () => {
              const added: string[] = [];
              for (const id of picked) {
                const source = rows.find((p) => p.id === id);
                if (!source) continue;
                if (source.bankId === bankId) added.push(id);
                else {
                  const full = await productionApi<ProductionProblem>(
                    `problems/${id}`,
                  );
                  if (!full.tests || full.referenceCode === undefined)
                    throw new Error(
                      `${full.title} 的正式测试不在您的编辑权限内。`,
                    );
                  const created = await productionApi<ProductionProblem>(
                    "problems",
                    {
                      method: "POST",
                      body: {
                        ...full,
                        saveDraft: true,
                        bankId,
                        source: `${full.source ? `${full.source} · ` : ""}Copied from ${id}`,
                        published: false,
                      },
                    },
                  );
                  added.push(created.id);
                }
              }
              if (targetGroup && added.length)
                await productionApi(`problem-groups/${targetGroup.id}`, {
                  method: "PATCH",
                  body: {
                    problemIds: [
                      ...new Set([...targetGroup.problemIds, ...added]),
                    ],
                  },
                });
              onSaved();
              return `已添加 ${added.length} 道题。`;
            })
          }
        >
          {tr("确认添加", "Add")} {picked.length} {tr("题", "problems")}
        </Button>
      </div>
    </Drawer>
  );
}

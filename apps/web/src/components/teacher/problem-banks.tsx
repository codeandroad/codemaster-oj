"use client";
import {ProblemFilter} from "./problem-filter";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  FolderPlus,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
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
  updatedAt?: string;
  count?: number;
  problemCount?: number;
}
export interface Group {
  id: string;
  name: string;
  bankId: string;
  problemIds: string[];
  canEdit: boolean;
}
export function TeacherBanks({ bankId }: { bankId?: string | undefined }) {
  const router = useRouter(),
    search = useSearchParams(),
    banks = useData<{ items: Bank[] }>("problem-banks"),
    problems = useData<{ items: ProductionProblem[] }>("problems"),
    groups = useData<{ items: Group[] }>("problem-groups");
  const [tab, setTab] = useState(
      search.get("tab") === "all" ? "全部题目" : "题库",
    ),
    [query, setQuery] = useState(""),
    [filterBank, setFilterBank] = useState(""),
    [filterGroup, setFilterGroup] = useState(""),
    [filterStatus, setFilterStatus] = useState(""),
    [checked, setChecked] = useState<string[]>([]),
    [create, setCreate] = useState(false),
    [manage, setManage] = useState<{ ids: string[]; bankId: string } | null>(
      null,
    ),
    [editGroup, setEditGroup] = useState<Group | null>(null),
    action = useAction();
  const bank = banks.data?.items.find((x) => x.id === bankId),
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
  return (
    <>
      {bankId && (
        <Link
          href="/teacher/problems"
          className={`${link} mb-4 inline-block text-sm`}
        >
          ← 题库与题目
        </Link>
      )}
      <PageHeader
        eyebrow={bankId ? "Problem Bank" : "Problem Banks"}
        title={bankId ? (bank?.name ?? "题库详情") : "题库与题目"}
        description={
          bankId
            ? bank?.description ||
              "题库内可使用分组整理题目，分组不会改变访问权限与成绩。"
            : "组织课程题目，创建练习，维护题面和测试数据。"
        }
        action={
          <div className="flex gap-2">
            <Link
              href={`/teacher/imports?kind=problems${bankId ? `&bankId=${bankId}` : ""}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Upload size={15} />
              导入题目
            </Link>
            {bankId ? (
              <Link
                className={buttonVariants()}
                href={`/teacher/problems/new/edit?bankId=${bankId}`}
              >
                <Plus size={15} />
                新建题目
              </Link>
            ) : (
              <Button onClick={() => setCreate(true)}>
                <BookOpenCheck size={15} />
                新建题库
              </Button>
            )}
          </div>
        }
      />
      <State resource={banks} />
      <State resource={problems} />
      <State resource={groups} />
      <Feedback action={action} />
      {!bankId && (
        <Tabs value={tab} onChange={setTab} items={["题库", "全部题目"]} />
      )}
      {!bankId && tab === "题库" ? (
        <section className={`${panel} mt-4`}>
          <Table
            headers={["名称", "课程", "题目数", "可见范围", "最近修改", "操作"]}
          >
            {banks.data?.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/teacher/problems/banks/${item.id}`} className="font-semibold text-primary hover:underline focus-visible:underline">{item.name}</Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.description}
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
                    ? "全校学生（已发布）"
                    : "维护教师 / 获授教师"}
                </td>
                <td className="text-muted-foreground">
                  {item.updatedAt
                    ? new Date(item.updatedAt).toLocaleDateString("zh-CN")
                    : "—"}
                </td>
                <td>
                  <div className="flex gap-3">
                    <Link
                      href={`/teacher/problems/banks/${item.id}`}
                      className={link}
                    >
                      打开
                    </Link>
                    {(item.canContribute ||
                      item.canEdit ||
                      ["owner", "edit"].includes(item.permission)) && (
                      <Link
                        href={`/teacher/imports?bankId=${item.id}`}
                        className={link}
                      >
                        导入题目
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!banks.loading && !banks.data?.items.length && (
              <Empty columns={6}>暂无题库。点击“新建题库”建立空题库。</Empty>
            )}
          </Table>
        </section>
      ) : (
        <div
          className={`mt-5 ${bankId ? "grid grid-cols-[240px_minmax(0,1fr)] gap-5 max-md:grid-cols-1" : ""}`}
        >
          {bankId && (
            <aside className={`${panel} self-start`}>
              <div className="flex items-center justify-between border-b border-border p-3">
                <b className="text-sm">分组</b>
                <Button
                  variant="ghost"
                  size="icon"
                  title="新建分组"
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
                    {group.name}
                  </button>
                  {"canEdit" in group && group.canEdit && (
                    <button
                      aria-label={`管理 ${group.name}`}
                      className="px-2 text-xs text-muted-foreground"
                      onClick={() => setEditGroup(group as Group)}
                    >
                      管理
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
                  aria-label="搜索题目"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索题号、标题或主题"
                  className={`${input} pl-9`}
                />
              </label>
              <ProblemFilter banks={banks.data?.items??[]} groups={groups.data?.items??[]} bankId={bankId} bank={filterBank} status={filterStatus} group={filterGroup} onBank={setFilterBank} onStatus={setFilterStatus} onGroup={setFilterGroup}/>
              {!bankId && (
                <Link
                  className={buttonVariants()}
                  href="/teacher/problems/new/edit"
                >
                  <Plus size={15} />
                  新建题目
                </Link>
              )}
            </div>
            {checked.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-4 py-3 text-sm">
                <b>已选 {checked.length} 道</b>
                <Button size="sm" onClick={() => openManage(checked)}>
                  批量整理分组
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChecked([])}
                >
                  取消选择
                </Button>
              </div>
            )}
            <Table
              headers={[
                "选择",
                "题目",
                "题库",
                "主题 / 分组",
                "接口",
                "状态",
                "操作",
              ]}
            >
              {rows.map((problem) => (
                <tr key={problem.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${problem.title}`}
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
                    {problem.mode === "function" ? "Function" : "Standard I/O"}
                  </td>
                  <td>
                    <StatusPill
                      status={
                        problem.published
                          ? "Published"
                          : (problem.validationStatus ?? "Draft")
                      }
                    />
                  </td>
                  <td>
                    <Link
                      href={`/teacher/problems/${problem.id}/edit?returnTo=${encodeURIComponent(bankId ? `/teacher/problems/banks/${bankId}` : "/teacher/problems?tab=all")}`}
                      className="inline-flex items-center gap-1 font-semibold text-primary"
                    >
                      编辑 <ArrowRight size={14} />
                    </Link>
                    <button
                      className={`${link} ml-3`}
                      onClick={() => openManage([problem.id])}
                    >
                      整理分组
                    </button>
                  </td>
                </tr>
              ))}
              {!problems.loading && !rows.length && (
                <Empty columns={7}>
                  当前范围暂无题目。新建题目或导入后，它们会显示在这里。
                </Empty>
              )}
            </Table>
          </section>
        </div>
      )}
      {create && (
        <CreateBank
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            router.push(`/teacher/problems/banks/${id}`);
          }}
        />
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
          title={`管理分组 · ${editGroup.name}`}
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
                return "分组名称已更新。";
              });
            }}
          >
            <Field label="分组名称">
              <input
                name="name"
                defaultValue={editGroup.name}
                required
                className={input}
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              解散分组会移除分组关系，题库题目与历史活动保留。
            </p>
            <Feedback action={action} />
            <div className="flex justify-between">
              <Button
                variant="danger"
                type="button"
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm(`解散“${editGroup.name}”？保留所有题目。`))
                    void action.run(async () => {
                      await productionApi(`problem-groups/${editGroup.id}`, {
                        method: "DELETE",
                      });
                      groups.reload();
                      setEditGroup(null);
                      return "分组已解散，题目保留。";
                    });
                }}
              >
                解散分组
              </Button>
              <Button type="submit" disabled={action.busy}>
                保存名称
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  return (
    <Modal title="新建题库" onClose={onClose}>
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
        <Field label="题库名称 *">
          <input autoFocus name="name" required className={input} />
        </Field>
        <Field label="简介">
          <textarea name="description" rows={3} className={area} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="课程 / 主题">
            <select name="course" className={input}>
              {["Python", "ACSL", "CIE 9618", "其他"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="可见范围">
            <select name="visibility" className={input}>
              <option value="private">仅维护教师 / 共享教师</option>
              <option value="school">全校学生（仅已发布题）</option>
            </select>
          </Field>
        </div>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={action.busy}>
            创建题库
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
  const groups = useData<{ items: Group[] }>(`problem-groups?bankId=${bankId}`),
    [query, setQuery] = useState(""),
    [picked, setPicked] = useState<string[]>([]),
    [newName, setNewName] = useState(""),
    [mode, setMode] = useState(initialMode ?? "添加到分组"),
    [source, setSource] = useState(initialSource ?? ""),
    action = useAction();
  return (
    <Modal title="整理分组" onClose={onClose}>
      <Tabs
        items={["添加到分组", "移动分组", "移出分组"]}
        value={mode}
        onChange={value=>{setMode(value);setPicked([]);setSource("");setNewName("");}}
      />
      <p className="mt-4 text-sm text-muted-foreground">
        已选 {problemIds.length}{" "}
        道题。添加保留原有分组；移动需要明确选择来源与目标。
      </p>
      <input
        aria-label="搜索分组"
        className={`${input} mt-3`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索分组"
      />
      <State resource={groups} />
      {mode === "移动分组" && (
        <Field label="来源分组">
          <select
            className={input}
            value={source}
            onChange={(e) => {setSource(e.target.value);setPicked(x=>x.filter(id=>id!==e.target.value));}}
          >
            <option value="">请选择来源</option>
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
                  {g.problemIds.length} 题 ·{" "}
                  {problemIds.filter((id) => g.problemIds.includes(id)).length}{" "}
                  道已在此组
                </p>
              </span>
            </label>
          ))}
        {!groups.loading&&!groups.error&&!groups.data?.items.some(g=>g.name.toLowerCase().includes(query.toLowerCase())&&(mode!=="移出分组"||problemIds.some(id=>g.problemIds.includes(id))))&&<p className="p-3 text-sm text-muted-foreground">{query?"没有匹配的分组。":mode==="移出分组"?"所选题目尚未加入任何分组。":"此题库暂无分组，可在下方新建。"}</p>}
      </div>
      {mode === "添加到分组" && (
        <Field label="新建分组（可选）">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={`${input} mt-3`}
            placeholder="输入新分组名称"
          />
        </Field>
      )}
      <Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
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
            ? "确认添加"
            : mode === "移动分组"
              ? "确认移动"
              : "仅移出所选分组"}
        </Button>
      </div>
    </Modal>
  );
}
export function ProblemPicker({
  selected,
  onClose,
  onAdd,
}: {
  selected: string[];
  onClose: () => void;
  onAdd: (items: ProductionProblem[]) => void;
}) {
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
    <Drawer title="从题库与分组选择" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        题库 → 分组 → 题目。多组同题只显示一次，已加入的题目保留选择状态。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <select
          aria-label="选择题库"
          className={input}
          value={bank}
          onChange={(e) => {
            setBank(e.target.value);
            setGroup("");
          }}
        >
          <option value="">全部题库</option>
          {banks.data?.items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select
          aria-label="选择分组"
          className={input}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">全部分组</option>
          {groups.data?.items
            .filter((x) => !bank || x.bankId === bank)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
        <input
          aria-label="搜索选择题目"
          className={`${input} col-span-2`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索题目"
        />
      </div>
      <State resource={banks} /><State resource={groups} /><State resource={problems} />
      <div className="mt-4 divide-y divide-border border border-border">
        {rows.map((p) => {
          const exists = selected.includes(p.id),
            available = p.published || Boolean(p.publishedVersionId);
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
                <b>{p.publishedTitle ?? p.title}</b>
                <GroupTags
                  groups={
                    groups.data?.items.filter((g) =>
                      g.problemIds.includes(p.id),
                    ) ?? []
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {exists
                    ? "已添加"
                    : available
                      ? "已发布 · 固定题目版本"
                      : "教师草稿 · 不能进入正式活动"}
                </p>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            setPicked(
              rows
                .filter(
                  (p) =>
                    (p.published || p.publishedVersionId) &&
                    !selected.includes(p.id),
                )
                .map((p) => p.id),
            )
          }
        >
          选择当前范围全部已发布题
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            取消
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
            确认加入 {picked.length} 题
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

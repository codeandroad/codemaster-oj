"use client";

import { AppLink as Link } from "@/components/navigation";
import { useState } from "react";
import {
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Search,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { Bank, Group, GroupTags, ManageGroups } from "./problem-banks";
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
  const banks = useData<{ items: Bank[] }>("problem-banks"),
    problems = useData<{
      items: (ProductionProblem & { formalTestCount?: number })[];
    }>("problems"),
    groups = useData<{ items: Group[] }>(`problem-groups?bankId=${id}`),
    bank = banks.data?.items.find((x) => x.id === id),
    [view, setView] = useState("all"),
    [checked, setChecked] = useState<string[]>([]),
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
        ← 返回题库
      </Link>
      <PageHeader
        eyebrow="题库"
        title={bank?.name ?? "题库详情"}
        description={bank?.description || "教师创建的课程练习题库"}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!canContribute}
              onClick={() => setAdding(true)}
            >
              <Search size={15} />
              从已有题目添加
            </Button>
            <Link
              className={buttonVariants({ variant: "secondary" })}
              href={`/teacher/imports?bankId=${id}`}
            >
              <Upload size={15} />
              导入题目
            </Link>
            <Link
              className={buttonVariants()}
              href={`/teacher/problems/new/edit?bankId=${id}&returnTo=${encodeURIComponent(`/teacher/problems/banks/${id}`)}`}
            >
              <FilePlus2 size={15} />
              新建题目
            </Link>
          </div>
        }
      />
      <State resource={banks} />
      <State resource={problems} />
      <State resource={groups} />
      <Feedback action={action} />
      <div className="mt-5 grid grid-cols-[230px_minmax(0,1fr)] gap-5 max-md:grid-cols-1">
        <aside className={`${panel} self-start`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold">分组</h2>
            <button
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
              onClick={() => setGroupAdmin(true)}
            >
              <FolderPlus size={15} />
              分组管理
            </button>
          </div>
          <div className="p-3 md:hidden">
            <select
              aria-label="题库分组"
              value={view}
              onChange={(e) => setView(e.target.value)}
              className={input}
            >
              {options.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（{g.count}）
                </option>
              ))}
            </select>
          </div>
          <nav className="hidden p-2 md:block" aria-label="题库分组">
            {options.map((g) => (
              <button
                key={g.id}
                onClick={() => setView(g.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${view === g.id ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                <span className="truncate">{g.name}</span>
                <span>{g.count}</span>
              </button>
            ))}
          </nav>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            一道题可属于多个分组；各分组题数之和可大于题库总题数 {all.length}。
          </p>
        </aside>
        <section className={`${panel} min-w-0`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-bold">{label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {rows.length} 道题 · 导入题与手工题统一归类
            </p>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subtle px-4 py-3 text-sm">
              <b>已选 {selected.length} 道</b>
              <Button size="sm" onClick={() => setManage({ ids: selected })}>
                {view === "none" ? "分配分组" : "添加到分组"}
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
                移动到分组
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
                  从本分组移除
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setChecked([])}>
                取消选择
              </Button>
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
                        aria-label="全选题库题目"
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
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <input
                          aria-label={`选择 ${p.title}`}
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
                            未分组
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.mode === "function" ? "Function" : "Standard I/O"}
                      </td>
                      <td className="px-4 py-3">
                        {p.formalTestCount ??
                          p.tests?.filter(
                            (x) =>
                              (x as { enabled?: boolean }).enabled !== false,
                          ).length ??
                          "按版本查看"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          status={
                            p.published
                              ? "Published"
                              : (p.validationStatus ?? "Draft")
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Link
                            className={link}
                            href={`/teacher/problems/${p.id}/edit?returnTo=${encodeURIComponent(`/teacher/problems/banks/${id}`)}`}
                          >
                            编辑
                          </Link>
                          <button
                            className="text-muted-foreground"
                            title="整理分组"
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
                  {view === "all" ? "题库还是空的" : `“${label}”暂无题目`}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {view === "all"
                    ? "先手工创建一道题，或导入现有题目资料。"
                    : "从已有题目添加，或从其他分组添加到这里。"}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => setAdding(true)}>
                    添加题目
                  </Button>
                  <Link
                    className={buttonVariants()}
                    href={`/teacher/problems/new/edit?bankId=${id}`}
                  >
                    新建题目
                  </Link>
                  <Link
                    className={buttonVariants({ variant: "secondary" })}
                    href={`/teacher/imports?bankId=${id}`}
                  >
                    导入题目
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
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
        <Modal title="分组管理" onClose={() => setGroupAdmin(false)}>
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
              aria-label="新分组名称"
              name="name"
              required
              className={input}
              placeholder="新分组名称"
            />
            <Button disabled={action.busy || !canContribute}>新建</Button>
          </form>
          <div className="mt-4 divide-y divide-border">
            {groups.data?.items.map((g) => (
              <div
                key={g.id}
                className="flex justify-between gap-2 py-3 text-sm"
              >
                <b>
                  {g.name} · {g.problemIds.length} 题
                </b>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!g.canEdit}
                  onClick={() => setEditGroup(g)}
                >
                  改名 / 解散
                </Button>
              </div>
            ))}
          </div>
          <Feedback action={action} />
          <p className="mt-3 text-xs text-muted-foreground">
            解散分组只删除分组关系，题目、学习章节与历史活动保留。
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
  const action = useAction();
  return (
    <Modal title={`分组 · ${group.name}`} onClose={onClose}>
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
        <Field label="名称">
          <input
            name="name"
            required
            defaultValue={group.name}
            className={input}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          解散后保留 {group.problemIds.length} 道题及全部其他分组。
        </p>
        <Feedback action={action} />
        <div className="flex justify-between">
          <Button
            type="button"
            variant="danger"
            disabled={action.busy}
            onClick={() => {
              if (window.confirm(`解散“${group.name}”？保留全部题目。`))
                void action.run(async () => {
                  await productionApi(`problem-groups/${group.id}`, {
                    method: "DELETE",
                  });
                  onSaved();
                });
            }}
          >
            解散分组
          </Button>
          <Button disabled={action.busy}>保存名称</Button>
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
    <Drawer title="从已有题目添加" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        同一题库的题目添加分组引用。跨题库复制为新草稿，保留来源，原题与已发布版本保持。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <select
          aria-label="来源题库"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={input}
        >
          <option value="">全部有权限题库</option>
          {banks.data?.items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          className={input}
          aria-label="搜索已有题目"
          placeholder="搜索标题"
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
                    ? "已添加"
                    : p.bankId === bankId
                      ? "本题库题目 · 添加引用"
                      : copyable
                        ? "复制到目标题库为新草稿"
                        : "仅阅读权限 · 不能复制正式测试"}
                </p>
              </span>
            </label>
          );
        })}
      </div>
      <Feedback action={action} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          取消
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
          确认添加 {picked.length} 题
        </Button>
      </div>
    </Drawer>
  );
}

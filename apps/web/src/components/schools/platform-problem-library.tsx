"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Feedback, State, useAction, useData } from "@/components/teacher/shared";
import type { PlatformSourceProblem } from "@/components/teacher/platform-problem-source";
import { productionApi, type CampusUser } from "@/lib/production-api";
import { PlatformContentEditors } from "./platform-content-editors";
import { PlatformProblemEditor } from "./platform-problems";
import { PlatformProblemFiltersBar } from "./platform-problem-filters";
import { PlatformProblemTable } from "./platform-problem-table";
import { PlatformProblemBanks } from "./platform-problem-banks";
import { PlatformProblemImport } from "./platform-problem-import";
import { PlatformProblemBatchDialog, type ProblemBatchOperation } from "./platform-problem-batch-dialog";
import { PlatformProblemReviewDialog } from "./platform-problem-review-dialog";
import { matchesPlatformProblem, mergePlatformLibrary, platformProblemFilterKeys, platformProblemFilters, type PlatformProblemBank, type PlatformProblemFilters, type PlatformProblemRow } from "./platform-problem-model";
import type { Problem } from "./school-practice-types";

export function PublicProblemReview({ user }: { user: CampusUser }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const search = useSearchParams(), filters = platformProblemFilters(search), scope = JSON.stringify(filters);
  const sources = useData<{ items: PlatformSourceProblem[] }>(`platform/source-problems${user.platformAdmin ? "?includeArchived=1" : ""}`);
  const publications = useData<{ items: Problem[] }>("platform/problem-publications"), banks = useData<{ items: PlatformProblemBank[] }>(user.platformAdmin ? "platform/problem-banks?includeArchived=1" : null);
  const action = useAction(), [editing, setEditing] = useState<string | null>(null), [preview, setPreview] = useState<Problem | null>(null), [grant, setGrant] = useState<PlatformProblemRow[] | null>(null);
  const [manageBanks, setManageBanks] = useState(false), [upload, setUpload] = useState(false), [operation, setOperation] = useState<ProblemBatchOperation | null>(null), [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const rows = useMemo(() => mergePlatformLibrary(sources.data?.items ?? [], publications.data?.items ?? []), [sources.data, publications.data]);
  const filtered = rows.filter(row => matchesPlatformProblem(row, filters)), pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const requestedPage = Number(search.get("problemPage")), page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1)), pageRows = filtered.slice((page - 1) * 50, page * 50);
  const selectedIds = selection.scope === scope ? selection.ids : [], selectedRows = filtered.filter(row => !!row.source && selectedIds.includes(row.id)), bankItems = banks.data?.items ?? [];
  const busy = action.busy || sources.loading || publications.loading || banks.loading;
  function reload() { sources.reload(); publications.reload(); banks.reload(); setSelection({ scope, ids: [] }); }
  function updateFilters(patch: Partial<PlatformProblemFilters>) {
    setSelection({ scope: "", ids: [] });
    const params = new URLSearchParams(window.location.search), next = { ...platformProblemFilters(params), ...patch };
    for (const [key, param] of Object.entries(platformProblemFilterKeys)) {
      const value = next[key as keyof PlatformProblemFilters];
      if (value) params.set(param, value === true ? "1" : String(value)); else params.delete(param);
    }
    params.delete("problemPage"); window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }
  function changePage(next: number) { const params = new URLSearchParams(window.location.search); params.set("problemPage", String(next)); window.history.replaceState(null, "", `${window.location.pathname}?${params}`); }
  function review(row: PlatformProblemRow) {
    const schoolId = row.publication?.schoolId ?? row.source?.schoolId;
    if (schoolId) void action.run(async () => { setPreview(await productionApi<Problem>(`platform/problem-publications/${row.id}?schoolId=${encodeURIComponent(schoolId)}`)); return " "; });
  }
  if (editing) return <PlatformProblemEditor id={editing} user={user} onClose={() => { setEditing(null); reload(); }} />;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" aria-label={tx("题目列表", "Problem lists")}>
      <Button type="button" variant={filters.deleted ? "ghost" : "secondary"} size="sm" aria-pressed={!filters.deleted} onClick={() => updateFilters({ deleted: false })}>{tx("全部题目", "Active problems")}</Button>
      {user.platformAdmin && <Button type="button" variant={filters.deleted ? "secondary" : "ghost"} size="sm" aria-pressed={filters.deleted} onClick={() => updateFilters({ deleted: true })}>{tx("已删除", "Deleted")}</Button>}
    </div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" aria-label={tx("刷新题库", "Refresh library")} disabled={busy} onClick={reload}><RefreshCw size={15} /></Button>{user.platformAdmin && <><Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setManageBanks(true)}>{tx("管理分类", "Manage categories")}</Button><Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setUpload(true)}>{tx("上传题目", "Upload problems")}</Button><Button type="button" size="sm" onClick={() => setEditing("new")}>{tx("新建题目", "New problem")}</Button></>}</div></div>
    <PlatformProblemFiltersBar value={filters} onChange={updateFilters} banks={bankItems} rows={rows} />
    <Feedback action={action} /><State resource={sources} /><State resource={publications} /><State resource={banks} />
    {user.platformAdmin && selectedRows.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-subtle p-3"><p className="mr-auto text-sm" role="status">{tx(`已选择 ${selectedRows.length} 道平台题目（最多 100 道）`, `${selectedRows.length} platform problems selected (up to 100)`)}</p>
      <Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setOperation({ action: "move", rows: selectedRows })}>{tx("更改分类", "Change category")}</Button>
      {!filters.deleted && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setGrant(selectedRows)}>{tx("批量授权", "Authorize selected")}</Button>}
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setOperation({ action: filters.deleted ? "restore" : "archive", rows: selectedRows })}>{filters.deleted ? tx("恢复所选", "Restore selected") : tx("删除所选", "Delete selected")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelection({ scope, ids: [] })}>{tx("取消选择", "Clear selection")}</Button>
    </div>}
    {sources.data && publications.data && <><PlatformProblemTable rows={pageRows} selected={selectedIds} busy={busy} canManage={user.platformAdmin === true} onSelect={ids => setSelection({ scope, ids })} onEdit={setEditing} onReview={review} onGrant={setGrant} onBatch={setOperation} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-muted-foreground">{tx(`共 ${filtered.length} 道题目`, `${filtered.length} problems`)}</p><div className="flex items-center gap-2"><Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>{tx("上一页", "Previous")}</Button><span className="tabular-nums">{page} / {pageCount}</span><Button type="button" size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>{tx("下一页", "Next")}</Button></div></div></>}
    {manageBanks && <PlatformProblemBanks banks={bankItems} onClose={() => setManageBanks(false)} onSaved={reload} />}
    {upload && <PlatformProblemImport banks={bankItems} initialBankId={bankItems.some(bank => bank.id === filters.bank && !bank.archivedAt) ? filters.bank : undefined} onClose={() => setUpload(false)} onImported={reload} />}
    {operation && <PlatformProblemBatchDialog operation={operation} banks={bankItems} onClose={() => setOperation(null)} onSaved={reload} />}
    {grant && <PlatformContentEditors kind="problem" resourceIds={grant.map(row => row.id)} title={grant.length === 1 ? grant[0].title : tx(`${grant.length} 道题目`, `${grant.length} problems`)} onClose={() => setGrant(null)} />}
    {preview && <PlatformProblemReviewDialog problem={preview} onClose={() => setPreview(null)} onSaved={reload} />}
  </div>;
}

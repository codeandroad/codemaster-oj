"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Feedback, State, useAction, useData } from "@/components/teacher/shared";
import { adjacentProblemRows } from "@/components/teacher/problem-editor-navigation";
import type { PlatformSourceProblem } from "@/components/teacher/platform-problem-source";
import { productionApi, type CampusUser } from "@/lib/production-api";
import { PlatformContentEditors } from "./platform-content-editors";
import { PlatformProblemEditor } from "./platform-problems";
import { PlatformProblemFiltersBar } from "./platform-problem-filters";
import { PlatformProblemTable } from "./platform-problem-table";
import { PlatformProblemBanks } from "./platform-problem-banks";
import { PlatformProblemImport } from "./platform-problem-import";
import { PlatformProblemBatchDialog, type ProblemBatchOperation } from "./platform-problem-batch-dialog";
import { PlatformProblemBatchReview } from "./platform-problem-batch-review";
import { PlatformDraftBatchPublish } from "./platform-draft-batch-publish";
import { PlatformProblemReviewDialog } from "./platform-problem-review-dialog";
import { matchesPlatformProblem, mergePlatformLibrary, platformDraftPublicationTarget, platformProblemFilterKeys, platformProblemFilters, problemReviewTarget, type PlatformProblemBank, type PlatformProblemFilters, type PlatformProblemRow } from "./platform-problem-model";
import type { Problem } from "./school-practice-types";

export function PublicProblemReview({ user }: { user: CampusUser }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const search = useSearchParams(), filters = platformProblemFilters(search), scope = JSON.stringify(filters);
  const sources = useData<{ items: PlatformSourceProblem[] }>(`platform/source-problems?view=summary${user.platformAdmin ? "&includeArchived=1" : ""}`);
  const publications = useData<{ items: Problem[] }>("platform/problem-publications"), banks = useData<{ items: PlatformProblemBank[] }>(user.platformAdmin ? "platform/problem-banks?includeArchived=1" : null);
  const action = useAction(), [editing, setEditing] = useState<string | null>(null), [preview, setPreview] = useState<Problem | null>(null), [grant, setGrant] = useState<PlatformProblemRow[] | null>(null);
  const [reviewTab, setReviewTab] = useState<"publication" | "solutions">();
  const [batchReview, setBatchReview] = useState<PlatformProblemRow[] | null>(null), [reviewMessage, setReviewMessage] = useState("");
  const [draftPublish, setDraftPublish] = useState<{ pageScope: string; targets: NonNullable<ReturnType<typeof platformDraftPublicationTarget>>[]; skipped: number } | null>(null);
  const [manageBanks, setManageBanks] = useState(false), [upload, setUpload] = useState(false), [operation, setOperation] = useState<ProblemBatchOperation | null>(null), [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const rows = useMemo(() => mergePlatformLibrary(sources.data?.items ?? [], publications.data?.items ?? []), [sources.data, publications.data]);
  const filtered = rows.filter(row => matchesPlatformProblem(row, filters)), pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const requestedPage = Number(search.get("problemPage")), page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1)), pageRows = filtered.slice((page - 1) * 50, page * 50);
  const selectedIds = selection.scope === scope ? selection.ids : [], selectedRows = filtered.filter(row => selectedIds.includes(row.id)), bankItems = banks.data?.items ?? [];
  const selectedOnPage = pageRows.filter(row => selectedIds.includes(row.id));
  const pendingOnPage = selectedOnPage.filter(row => row.source?.draftReviewStatus === "pending");
  const draftTargets = pendingOnPage.map(platformDraftPublicationTarget).filter(target => target !== null);
  const pageScope = JSON.stringify([scope, page]);
  const platformOnly = selectedRows.every(row => !!row.source);
  const busy = action.busy || sources.loading || publications.loading || banks.loading;
  function reload() { sources.reload(); publications.reload(); banks.reload(); setSelection({ scope, ids: [] }); setReviewMessage(""); }
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
  function openEditor(id: string, tab?: "publication" | "solutions") { setReviewTab(tab); setEditing(id); }
  function review(row: PlatformProblemRow) {
    const schoolId = row.publication?.schoolId ?? row.source?.schoolId;
    if (schoolId) void action.run(async () => { setPreview(await productionApi<Problem>(`platform/problem-publications/${row.id}?schoolId=${encodeURIComponent(schoolId)}`)); return " "; });
  }
  if (editing) {
    const editableRows = rows.filter(row => row.source?.canEdit === true && !row.source.archivedAt
      && (row.id === editing || matchesPlatformProblem(row, filters)));
    const { previous, next } = adjacentProblemRows(editableRows, editing);
    const target = (row?: PlatformProblemRow) => row && ({
      title: row.title,
      select: () => openEditor(row.id),
    });
    return <PlatformProblemEditor id={editing} user={user} initialTab={reviewTab} navigation={{ previous: target(previous), next: target(next) }}
      onClose={() => { setEditing(null); reload(); }} />;
  }
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" aria-label={tx("题目列表", "Problem lists")}>
      <Button type="button" variant={!filters.deleted && !filters.pendingDrafts ? "secondary" : "ghost"} size="sm" aria-pressed={!filters.deleted && !filters.pendingDrafts} onClick={() => updateFilters({ deleted: false, pendingDrafts: false })}>{tx("全部题目", "Active problems")}</Button>
      {user.platformAdmin && <>
        <Button type="button" variant={filters.pendingDrafts ? "secondary" : "ghost"} size="sm" aria-pressed={filters.pendingDrafts} onClick={() => updateFilters({ deleted: false, pendingDrafts: true })}>{tx("待审核草稿", "Drafts awaiting review")}</Button>
        <Button type="button" variant={filters.deleted ? "secondary" : "ghost"} size="sm" aria-pressed={filters.deleted} onClick={() => updateFilters({ deleted: true, pendingDrafts: false })}>{tx("已删除", "Deleted")}</Button>
      </>}
    </div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" aria-label={tx("刷新题库", "Refresh library")} disabled={busy} onClick={reload}><RefreshCw size={15} /></Button>{user.platformAdmin && <><Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setManageBanks(true)}>{tx("管理分类", "Manage categories")}</Button><Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setUpload(true)}>{tx("上传题目", "Upload problems")}</Button><Button type="button" size="sm" onClick={() => openEditor("new")}>{tx("新建题目", "New problem")}</Button></>}</div></div>
    <PlatformProblemFiltersBar value={filters} onChange={updateFilters} banks={bankItems} rows={rows} />
    <Feedback action={action} /><State resource={sources} /><State resource={publications} /><State resource={banks} />
    {reviewMessage && <p role="status" className="text-sm text-success">{reviewMessage}</p>}
    {user.platformAdmin && selectedRows.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-subtle p-3"><p className="mr-auto text-sm" role="status">{tx(`已选择 ${selectedRows.length} 道题目（最多 100 道）`, `${selectedRows.length} problems selected (up to 100)`)}</p>
      {pendingOnPage.length > 0 && !filters.deleted && <Button type="button" size="sm" disabled={busy || !draftTargets.length || !!sources.error} onClick={() => {
        setReviewMessage("");
        setDraftPublish({ pageScope, targets: draftTargets, skipped: selectedOnPage.length - draftTargets.length });
      }}>{tx("批量审核发布", "Approve and publish drafts")} ({draftTargets.length})</Button>}
      {!filters.deleted && <Button type="button" size="sm" variant="secondary" disabled={busy || !selectedRows.some(problemReviewTarget)} onClick={() => { setReviewMessage(""); setBatchReview(selectedRows); }}>{tx("批量审核", "Batch review")}</Button>}
      {platformOnly && <>
        <Button type="button" size="sm" variant="secondary" disabled={busy || !!banks.error} onClick={() => setOperation({ action: "move", rows: selectedRows })}>{tx("更改分类", "Change category")}</Button>
        {!filters.deleted && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setGrant(selectedRows)}>{tx("批量授权", "Authorize selected")}</Button>}
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setOperation({ action: filters.deleted ? "restore" : "archive", rows: selectedRows })}>{filters.deleted ? tx("恢复所选", "Restore selected") : tx("删除所选", "Delete selected")}</Button>
      </>}
      <Button type="button" size="sm" variant="ghost" onClick={() => setSelection({ scope, ids: [] })}>{tx("取消选择", "Clear selection")}</Button>
    </div>}
    {sources.data && publications.data && <><PlatformProblemTable rows={pageRows} selected={selectedIds} busy={busy} canManage={user.platformAdmin === true} onSelect={ids => setSelection({ scope, ids })} onEdit={openEditor} onReview={review} onGrant={setGrant} onBatch={setOperation} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-muted-foreground">{tx(`共 ${filtered.length} 道题目`, `${filtered.length} problems`)}</p><div className="flex items-center gap-2"><Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>{tx("上一页", "Previous")}</Button><span className="tabular-nums">{page} / {pageCount}</span><Button type="button" size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>{tx("下一页", "Next")}</Button></div></div></>}
    {manageBanks && <PlatformProblemBanks banks={bankItems} onClose={() => setManageBanks(false)} onSaved={reload} />}
    {upload && <PlatformProblemImport banks={bankItems} initialBankId={bankItems.some(bank => bank.id === filters.bank && !bank.archivedAt) ? filters.bank : undefined} onClose={() => setUpload(false)} onImported={reload} />}
    {operation && <PlatformProblemBatchDialog operation={operation} banks={bankItems} onClose={() => setOperation(null)} onSaved={reload} />}
    {draftPublish?.pageScope === pageScope && <PlatformDraftBatchPublish targets={draftPublish.targets} skipped={draftPublish.skipped}
      onClose={() => setDraftPublish(null)} onPublished={(ids, message) => {
        setDraftPublish(null);
        sources.reload();
        publications.reload();
        setSelection(current => ({ ...current, ids: current.ids.filter(id => !ids.has(id)) }));
        setReviewMessage(message);
      }} />}
    {batchReview && <PlatformProblemBatchReview rows={batchReview} onClose={() => setBatchReview(null)} onSaved={count => {
      setBatchReview(null); reload(); setReviewMessage(tx(`已审核 ${count} 道题目。`, `Reviewed ${count} problems.`));
    }} />}
    {grant && <PlatformContentEditors kind="problem" resourceIds={grant.map(row => row.id)} title={grant.length === 1 ? grant[0].title : tx(`${grant.length} 道题目`, `${grant.length} problems`)} onClose={() => setGrant(null)} />}
    {preview && <PlatformProblemReviewDialog problem={preview} onClose={() => setPreview(null)} onSaved={reload} />}
  </div>;
}

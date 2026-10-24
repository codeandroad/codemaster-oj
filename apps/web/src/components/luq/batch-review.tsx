"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { SolutionContent } from "@/components/luq/solution-content";
import { Button } from "@/components/ui/button";
import { type EditorTheme } from "@/components/student/editor-themes";
import { Modal, State, input, panel, useData } from "@/components/teacher/shared";
import { ApiError, apiMessage, productionApi } from "@/lib/production-api";

type Status = "published" | "draft" | "missing" | "withdrawn";
interface ReviewItem {
  targetType: "problem" | "paper4";
  targetId: string;
  title: string;
  questionKey?: string;
  questionTitle?: string;
  versionId: string;
  contentId: string | null;
  contentHash: string | null;
  status: Status;
  publishedAt: string | null;
}
interface ReviewList {
  items: ReviewItem[];
  counts: Record<Status, number>;
  total: number;
}
interface ReviewContent {
  id: string;
  versionId: string;
  kind: string;
  language: string;
  body: string;
  status: string;
  contentHash: string;
}
interface PublishResult {
  requestId: string;
  publishedCount: number;
  alreadyPublishedCount: number;
}
type Text = (zh: string, en: string) => string;
const statuses: Status[] = ["draft", "published", "missing", "withdrawn"];
const statusStyle: Record<Status, string> = {
  published: "border-success/25 bg-success/10 text-success",
  draft: "border-warning/30 bg-warning/10 text-foreground",
  missing: "border-border bg-surface-subtle text-muted-foreground",
  withdrawn: "border-destructive/25 bg-destructive/5 text-destructive",
};
function statusLabel(status: Status, tx: Text) {
  return {
    published: tx("已发布", "Published"),
    draft: tx("待审核", "Awaiting review"),
    missing: tx("缺少内容", "Missing content"),
    withdrawn: tx("已撤回", "Withdrawn"),
  }[status];
}
function itemLabel(item: ReviewItem) {
  return item.questionKey
    ? `${item.title} · ${item.questionKey}${item.questionTitle ? ` ${item.questionTitle}` : ""}`
    : item.title;
}
function editorHref(item: ReviewItem) {
  return `/teacher/luq?${new URLSearchParams({
    targetType: item.targetType,
    targetId: item.targetId,
    versionId: item.versionId,
    kind: "FULL_SOLUTION",
    ...(item.questionKey ? { questionKey: item.questionKey } : {}),
  })}`;
}
function selectable(item: ReviewItem) {
  return item.status === "draft" && Boolean(item.contentId && item.contentHash);
}

/** The list contains metadata only. Content is fetched on explicit staff preview. */
export function LuqBatchReview({ targetType }: { targetType: "problem" | "paper4" }) {
  const { locale } = useLocale();
  const tx: Text = (zh, en) => locale === "en" ? en : zh;
  const list = useData<ReviewList>(`luq/contents/review?${new URLSearchParams({ targetType })}`);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<Status | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ReviewItem | null>(null);
  const [batch, setBatch] = useState<ReviewItem[] | null>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [mustRefresh, setMustRefresh] = useState(false);
  const lock = useRef(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const items = list.data?.items ?? [];
  const filtered = items.filter(item => (filter === "all" || item.status === filter)
    && `${itemLabel(item)} ${item.versionId}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleDrafts = filtered.filter(selectable);
  const selectedItems = items.filter(item => selectable(item) && selected.includes(item.contentId!));
  const allVisible = visibleDrafts.length > 0 && visibleDrafts.every(item => selected.includes(item.contentId!));
  const someVisible = visibleDrafts.some(item => selected.includes(item.contentId!));
  const unavailable = list.loading || Boolean(list.error) || busy;

  function refresh() {
    if (lock.current) return;
    setSelected([]);
    setBatch(null);
    setPreview(null);
    setReviewed(false);
    setError("");
    setMustRefresh(false);
    pending.current = null;
    list.reload();
  }
  function toggleVisible() {
    setSelected(current => allVisible
      ? current.filter(id => !visibleDrafts.some(item => item.contentId === id))
      : [...new Set([...current, ...visibleDrafts.map(item => item.contentId!)])]);
  }
  function confirm() {
    setBatch(selectedItems);
    setReviewed(false);
    setError("");
    setMessage("");
    setMustRefresh(false);
  }
  async function publish() {
    if (lock.current || !batch?.length || !reviewed || mustRefresh) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const entries = batch.map(item => ({ contentId: item.contentId!, expectedHash: item.contentHash! }))
      .sort((a, b) => a.contentId.localeCompare(b.contentId));
    const signature = JSON.stringify(entries);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    try {
      const result = await productionApi<PublishResult>("luq/contents/batch-publish", {
        method: "POST", body: { requestId: pending.current.requestId, reviewed: true, items: entries },
      });
      pending.current = null;
      setMessage(tx(
        `已审核发布 ${result.publishedCount} 项题解${result.alreadyPublishedCount ? `，另有 ${result.alreadyPublishedCount} 项已发布，本次未重复发布` : ""}。解锁价格及活动开放规则保持不变。`,
        `Published ${result.publishedCount} reviewed solutions${result.alreadyPublishedCount ? `; ${result.alreadyPublishedCount} were already published and were not published again` : ""}. Unlock prices and activity access rules are unchanged.`,
      ));
      setSelected([]);
      setBatch(null);
      setReviewed(false);
      list.reload();
    } catch (cause) {
      const stale = cause instanceof ApiError && [400, 403, 404, 409].includes(cause.status);
      setError(apiMessage(cause));
      setMustRefresh(stale);
      if (stale) setReviewed(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <section className={`${panel} min-w-0 space-y-3 p-3`} aria-label={tx("批量审核参考答案", "Batch reference solution review")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{tx("参考答案审核与发布", "Review and publish solutions")}</h2>
      <Button size="sm" variant="secondary" disabled={busy || list.loading} onClick={refresh}>{tx("刷新状态", "Refresh status")}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{tx(
      "显示当前公开版本的完整题解；未发布题目使用最新草稿，Paper 4 按大题列出。可批量发布待审核内容，缺少内容须先录入。课程或活动固定的旧版本仍需单独审核。",
      "Full solutions for the current public version, or the latest draft for unpublished problems; Paper 4 lists each question separately. Publish drafts together after review. Missing content must be authored first. Older versions pinned in courses or activities still need separate review.",
    )}</p>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tx("题解发布状态", "Solution publication status")}>
      <Button size="sm" variant={filter === "all" ? "primary" : "secondary"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{tx("全部", "All")} {list.data?.total ?? "—"}</Button>
      {statuses.map(status => <Button key={status} size="sm" variant={filter === status ? "primary" : "secondary"} aria-pressed={filter === status} onClick={() => setFilter(status)}>{statusLabel(status, tx)} {list.data?.counts[status] ?? "—"}</Button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${input} max-w-sm`} aria-label={tx("搜索待审核题解", "Search solution reviews")} placeholder={tx("搜索题目、试卷、大题或版本", "Search problem, paper, question or version")} value={query} onChange={event => setQuery(event.target.value)}/>
      <Button size="sm" variant="secondary" disabled={unavailable || !visibleDrafts.length} onClick={toggleVisible}>{allVisible ? tx("取消筛选内待审核", "Deselect filtered drafts") : tx("全选筛选内待审核", "Select filtered drafts")}</Button>
      <Button size="sm" variant="ghost" disabled={busy || !selected.length} onClick={() => setSelected([])}>{tx("清空", "Clear")}</Button>
      <span className="text-xs text-muted-foreground" role="status">{tx(`已选 ${selectedItems.length} 项`, `${selectedItems.length} selected`)}</span>
      <Button size="sm" className="sm:ml-auto" disabled={unavailable || !selectedItems.length || selectedItems.length > 500} onClick={confirm}>{tx("审核并发布所选", "Review and publish selected")}</Button>
    </div>
    {selectedItems.length > 500 && <p role="alert" className="text-xs text-destructive">{tx("每批最多发布 500 项，请减少选择。", "Publish up to 500 items per batch. Reduce the selection.")}</p>}
    <State resource={list}/>
    {!list.loading && !list.error && <div className="max-h-[60dvh] overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[560px] table-fixed text-left text-sm">
        <colgroup><col className="w-10"/><col/><col className="w-24"/><col className="w-28"/><col className="w-28"/></colgroup>
        <thead className="sticky top-0 z-10 bg-surface-subtle text-xs text-muted-foreground"><tr>
          <th scope="col" className="p-2 text-center"><input type="checkbox" aria-label={tx("选择筛选内全部待审核题解", "Select all filtered draft solutions")} ref={element => { if (element) element.indeterminate = someVisible && !allVisible; }} checked={allVisible} disabled={unavailable || !visibleDrafts.length} onChange={toggleVisible}/></th>
          <th scope="col" className="px-2 py-2">{tx("题目 / 大题", "Problem / question")}</th>
          <th scope="col" className="px-2 py-2">{tx("版本", "Version")}</th>
          <th scope="col" className="px-2 py-2">{tx("状态", "Status")}</th>
          <th scope="col" className="px-2 py-2">{tx("操作", "Actions")}</th>
        </tr></thead>
        <tbody>{filtered.map(item => <tr key={`${item.targetId}:${item.questionKey ?? ""}:${item.versionId}`} className="border-t border-border align-top hover:bg-surface-subtle/50">
          <td className="p-2 text-center"><input type="checkbox" aria-label={tx(`选择 ${itemLabel(item)}`, `Select ${itemLabel(item)}`)} checked={Boolean(item.contentId && selected.includes(item.contentId))} disabled={busy || !selectable(item)} onChange={event => setSelected(current => event.target.checked ? [...new Set([...current, item.contentId!])] : current.filter(id => id !== item.contentId))}/></td>
          <td className="break-words px-2 py-2"><span className="font-medium">{item.title}</span>{item.questionKey && <span className="mt-0.5 block text-xs text-muted-foreground">{item.questionKey}{item.questionTitle ? ` · ${item.questionTitle}` : ""}</span>}</td>
          <td className="px-2 py-2"><code className="text-xs" title={item.versionId}>{item.versionId.slice(0, 8)}</code></td>
          <td className="px-2 py-2"><span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${statusStyle[item.status]}`}>{statusLabel(item.status, tx)}</span></td>
          <td className="px-2 py-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {item.contentId && <Button size="sm" variant="ghost" className="h-8 px-1" disabled={busy} onClick={() => setPreview(item)}>{tx("预览", "Preview")}</Button>}
            {item.status !== "published" && <a href={editorHref(item)} className="inline-flex min-h-8 items-center font-medium text-primary hover:underline">{item.status === "missing" ? tx("录入", "Author") : tx("编辑", "Edit")}</a>}
          </div></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="p-4 text-center text-sm text-muted-foreground">{tx("没有符合筛选条件的题目。", "No problems match these filters.")}</p>}
    </div>}
    {message && <p role="status" className="text-sm text-success">{message}</p>}
    {preview && <SolutionPreview item={preview} onClose={() => setPreview(null)} onRefresh={refresh}/>}
    {batch && <Modal title={tx(`审核发布 ${batch.length} 项参考答案`, `Review and publish ${batch.length} solutions`)} onClose={() => { if (!lock.current) { setBatch(null); setReviewed(false); } }}>
      <div className="space-y-3 text-sm">
        <p>{tx("本次将发布以下版本的已保存题解。价格与开放规则另行管理，不会从教师参考代码自动生成内容。", "This publishes the saved solutions for the versions below. Prices and access rules are managed separately; no content is copied automatically from private reference code.")}</p>
        <ul className="max-h-52 overflow-y-auto rounded border border-border">{batch.map(item => <li key={item.contentId} className="border-b border-border px-3 py-2 last:border-0"><span className="break-words">{itemLabel(item)}</span><code className="ml-2 text-xs text-muted-foreground">{item.versionId.slice(0, 8)}</code></li>)}</ul>
        <label className="flex items-start gap-2"><input className="mt-1 accent-primary" type="checkbox" checked={reviewed} disabled={busy || mustRefresh} onChange={event => setReviewed(event.target.checked)}/><span>{tx("已核对所有所选题解的版本和内容准确性，确认不含隐藏测试、判题驱动或教师私有批注。", "I reviewed the versions and accuracy of every selected solution and confirmed they contain no hidden tests, judge drivers or private teacher notes.")}</span></label>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {mustRefresh && <p className="text-muted-foreground">{tx("本批未完成发布。内容版本或权限可能已变化，请刷新状态后重新核对。", "This batch was not completed. Content versions or permissions may have changed. Refresh and review again.")}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setBatch(null); setReviewed(false); }}>{tx("取消", "Cancel")}</Button>
          {mustRefresh
            ? <Button size="sm" disabled={busy} onClick={refresh}>{tx("刷新并重新核对", "Refresh and review again")}</Button>
            : <Button size="sm" disabled={busy || !reviewed} onClick={() => void publish()}>{busy ? tx("正在发布…", "Publishing…") : tx("确认审核并发布", "Confirm review and publish")}</Button>}
        </div>
      </div>
    </Modal>}
  </section>;
}

function SolutionPreview({ item, onClose, onRefresh }: { item: ReviewItem; onClose: () => void; onRefresh: () => void }) {
  const { locale } = useLocale();
  const tx: Text = (zh, en) => locale === "en" ? en : zh;
  const [theme, setTheme] = useState<EditorTheme>("github-dark");
  const target: Record<string, string> = item.targetType === "problem"
    ? { problemId: item.targetId, versionId: item.versionId }
    : { paperId: item.targetId, versionId: item.versionId, questionKey: item.questionKey! };
  const contents = useData<{ items: ReviewContent[] }>(`luq/contents?${new URLSearchParams(target)}`);
  const content = contents.data?.items.find(value => value.id === item.contentId && value.kind === "FULL_SOLUTION"
    && value.versionId === item.versionId && value.contentHash === item.contentHash);
  return <Modal title={tx("参考答案预览", "Solution preview")} onClose={onClose} wide>
    <div className="space-y-3">
      <p className="text-sm font-medium">{itemLabel(item)}</p>
      <p className="text-xs text-muted-foreground">{tx("版本", "Version")} <code>{item.versionId.slice(0, 8)}</code> · {statusLabel(item.status, tx)}</p>
      <State resource={contents}/>
      {!contents.loading && !contents.error && (content ? <SolutionContent body={content.body} theme={theme} onThemeChange={setTheme}/> : <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{tx("此题解已变更，请刷新状态后重新核对。", "This solution has changed. Refresh status and review again.")}</p><Button size="sm" variant="secondary" onClick={onRefresh}>{tx("刷新并重新核对", "Refresh and review again")}</Button></div>)}
    </div>
  </Modal>;
}

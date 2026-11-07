"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { StatusPill } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { State, date } from "./shared";
import { problemSubmissionsUrl, submissionMeasurement, submissionOwnDetailHref, type ProblemSubmissionPage, type SubmissionPageQuery, type SubmissionSort } from "./problem-submissions-model";

export function SolvedStatus({ solved }: { solved: boolean }) {
  const { locale } = useLocale();
  if (!solved) return null;
  return <span role="status" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-success" data-od-id="problem-solved"><span>{locale === "en" ? "Solved" : "已通过"}</span><CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" /></span>;
}

export function useProblemSubmissions(endpoint: string, refreshKey = "") {
  const [query, setQuery] = useState<SubmissionPageQuery>({ page: 1, pageSize: 25, sort: "createdAt", order: "desc" });
  const [state, setState] = useState<{ endpoint: string; url: string; loading: boolean; error: string; data: ProblemSubmissionPage | null }>({ endpoint: "", url: "", loading: false, error: "", data: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const url = problemSubmissionsUrl(endpoint, query);
  useEffect(() => { setQuery(current => ({ ...current, page: 1 })); }, [endpoint]);
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    setState(previous => ({ endpoint, url, loading: true, error: "", data: previous.endpoint === endpoint ? previous.data : null }));
    productionApi<ProblemSubmissionPage>(url, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ endpoint, url, loading: false, error: "", data });
    }).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: apiMessage(error) }));
    });
    return () => controller.abort();
  }, [endpoint, url, refreshKey, revision]);
  return { data: state.endpoint === endpoint ? state.data : null, loading: Boolean(endpoint) && (state.url !== url || state.loading), error: state.endpoint === endpoint ? state.error : "", reload, query, setQuery };
}

export function ProblemSubmissionsTable({ feed, allowLegacyDetails = false, openInNewTab = false }: {
  feed: ReturnType<typeof useProblemSubmissions>;
  allowLegacyDetails?: boolean;
  openInNewTab?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const columns: { key?: SubmissionSort; label: string; title?: string }[] = [
    { label: tx("学生", "Student") },
    { key: "createdAt", label: tx("提交时间", "Submitted") },
    { key: "status", label: tx("状态", "Status") },
    { key: "language", label: tx("语言", "Language") },
    { key: "runtimeMs", label: tx("总用时", "Total runtime"), title: tx("全部测试的 CPU 运行时间合计；未测量时显示 —", "Total measured CPU time across tests; — when unavailable") },
    { key: "memoryKb", label: tx("峰值内存", "Peak memory"), title: tx("峰值内存（MiB）；未测量时显示 —", "Peak memory in MiB; — when unavailable") },
  ];
  const total = feed.data?.total ?? 0;
  const page = feed.data?.page ?? feed.query.page;
  const pageSize = feed.data?.pageSize ?? feed.query.pageSize;
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  const sort = (key: SubmissionSort) => feed.setQuery(current => ({ ...current, page: 1, sort: key, order: current.sort === key && current.order === "desc" ? "asc" : "desc" }));
  return <section className="min-w-0 text-sm" aria-label={tx("本题提交记录", "Problem submissions")} data-od-id="problem-submissions">
    <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold">{tx("每人最新提交", "Latest submission per student")}</h2><Button type="button" size="sm" variant="ghost" disabled={feed.loading} onClick={feed.reload} aria-label={tx("刷新提交记录", "Refresh submissions")}><RefreshCw size={14} aria-hidden="true" /></Button></div>
    <State data={feed}>
      <div className="overflow-x-auto rounded-md border border-border" aria-busy={feed.loading}>
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-surface-subtle text-muted-foreground"><tr>{columns.map(column => <th key={column.label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium" title={column.title} aria-sort={column.key && feed.query.sort === column.key ? feed.query.order === "asc" ? "ascending" : "descending" : column.key ? "none" : undefined}>{column.key ? <button type="button" className="inline-flex min-h-7 items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60" disabled={feed.loading} onClick={() => sort(column.key!)}>{column.label}{feed.query.sort === column.key ? feed.query.order === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : <ArrowUpDown size={12} aria-hidden="true" />}</button> : column.label}</th>)}</tr></thead>
          <tbody>{feed.data?.items.map(row => {
            const href = submissionOwnDetailHref(row, allowLegacyDetails);
            const language = ({ python: "Python 3", cpp: "C++", javascript: "JavaScript" } as Record<string, string>)[row.language] ?? row.language;
            return <tr key={row.id} data-own-submission={row.isOwn || undefined} className={`border-t border-border ${row.isOwn ? "bg-primary/[0.07]" : ""}`}>
              <td className={`px-3 py-2 ${row.isOwn ? "border-l-[3px] border-l-primary" : ""}`}><span className="inline-flex items-center gap-1.5"><span className="max-w-40 truncate font-medium" title={row.displayName}>{row.displayName}</span>{row.isOwn && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{tx("我", "You")}</span>}</span></td>
              <td className="whitespace-nowrap px-3 py-2">{href ? <AppLink href={href} target={openInNewTab ? "_blank" : undefined} rel={openInNewTab ? "noopener noreferrer" : undefined} className="font-medium text-primary hover:underline">{date(row.createdAt, locale)}</AppLink> : <span>{date(row.createdAt, locale)}</span>}</td>
              <td className="px-3 py-2"><StatusPill status={row.status} /></td>
              <td className="whitespace-nowrap px-3 py-2">{language}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{submissionMeasurement(row.runtimeMs, "ms", locale)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{submissionMeasurement(row.memoryKb, "KiB", locale)}</td>
            </tr>;
          })}</tbody>
        </table>
        {!feed.data?.items.length && <p className="p-5 text-center text-muted-foreground">{tx("暂无可查看的正式提交。", "No visible formal submissions yet.")}</p>}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status">{tx(`${start}–${end} / ${total} 人`, `${start}–${end} of ${total} students`)}</span>
        <div className="flex items-center gap-1"><label className="mr-1 flex items-center gap-1.5">{tx("每页", "Rows")}<select aria-label={tx("每页提交数", "Submissions per page")} value={feed.query.pageSize} disabled={feed.loading} onChange={event => feed.setQuery(current => ({ ...current, page: 1, pageSize: Number(event.target.value) }))} className="h-8 rounded border border-input bg-background px-1.5 text-foreground">{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label><Button type="button" size="sm" variant="ghost" disabled={feed.loading || page <= 1} aria-label={tx("上一页", "Previous page")} onClick={() => feed.setQuery(current => ({ ...current, page: Math.max(1, page - 1) }))}><ChevronLeft size={15} aria-hidden="true" /></Button><span className="min-w-6 text-center tabular-nums">{page}</span><Button type="button" size="sm" variant="ghost" disabled={feed.loading || !feed.data?.hasMore} aria-label={tx("下一页", "Next page")} onClick={() => feed.setQuery(current => ({ ...current, page: page + 1 }))}><ChevronRight size={15} aria-hidden="true" /></Button></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{tx("正式提交的运行时间合计与峰值内存；未测量项显示 —。", "Formal submissions · total runtime and peak memory; — means unavailable.")}</p>
    </State>
  </section>;
}

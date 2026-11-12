"use client";

import type { ReactNode } from "react";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { isPending } from "@/lib/production-api";
import { languageInfo, submissionLanguage } from "./languages";
import { Empty, State, date } from "./shared";

type Resource = Parameters<typeof State>[0]["data"];
type RecordRow = { key: string; href: string; title: string; context: string };
type SubmissionRow = RecordRow & {
  id: string;
  displayId?: string;
  language?: string;
  status: string;
  score: number | null;
  createdAt: string;
};
type Pagination = { page: number; hasMore: boolean; previous: () => void; next: () => void };
type NotebookRow = RecordRow & {
  originalResult: string;
  lastPracticedAt?: string;
  language?: string;
  correction?: string;
  state?: string;
  feedback?: string;
};

const linkClass = "font-semibold text-primary hover:underline focus-visible:underline";

export function studyRecordScore(result: { status: string; score: number | null }) {
  return result.score == null || isPending(result.status) || /system.?error/i.test(result.status)
    ? "—" : `${Number(result.score).toFixed(2)}/100`;
}

export function studyRecordVerdict(locale: AppLocale, status: string) {
  const labels: Record<string, string> = {
    Waiting: "等待中", Judging: "评测中", Executed: "已运行", "System Error": "系统错误",
    "Not started": "未开始", NotStarted: "未开始", Unavailable: "不可用", NotSubmitted: "未提交", Open: "进行中", Ended: "已结束",
  };
  return locale === "zh" ? labels[status] ?? status : status;
}

function RecordPager({ pagination, count, loading, notebook = false }: {
  pagination: Pagination; count: number; loading: boolean; notebook?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const { page, hasMore, previous, next } = pagination;
  return <nav aria-label={notebook ? tx("订正本分页", "Review notebook pages") : tx("提交记录分页", "Submission history pages")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-muted-foreground">{tx(`第 ${page} 页 · 本页 ${count} 条`, `Page ${page} · ${count} ${count === 1 ? "record" : "records"} on this page`)}</p>
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" aria-label={notebook ? undefined : tx("上一页提交记录", "Previous submissions page")}
        disabled={loading || page <= 1} onClick={previous}>{tx("上一页", "Previous")}</Button>
      <Button variant="secondary" size="sm" aria-label={notebook ? undefined : tx("下一页提交记录", "Next submissions page")}
        disabled={loading || !hasMore} onClick={next}>{tx("下一页", "Next")}</Button>
    </div>
  </nav>;
}

function RecordTable({ headings, children, label, width }: {
  headings: string[]; children: ReactNode; label: string; width: string;
}) {
  return <div className="mt-4 overflow-x-auto border border-border bg-surface panel-shadow" role="region" aria-label={label} tabIndex={0}>
    <table className={`w-full text-left text-sm ${width}`}>
      <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
        {headings.map(heading => <th key={heading} scope="col" className="px-4 py-3">{heading}</th>)}
      </tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function SubmissionHistory({ resource, rows, filters, pagination }: {
  resource: Resource; rows: SubmissionRow[]; filters: ReactNode; pagination: Pagination;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  return <>
    <PageHeader eyebrow={tx("学习记录", "Your activity")} title={tx("提交记录", "Submissions")}
      description={tx("这里只列出正式提交，不包含样例或自定义运行。", "Formal submissions only. Sample and custom runs are not listed here.")}/>
    <div className="mt-5 flex flex-wrap items-center gap-2 border border-border bg-surface p-3 panel-shadow">{filters}</div>
    <State data={resource}>
      {rows.length ? <RecordTable label={tx("提交记录", "Submissions")} width="min-w-[900px]"
        headings={[tx("提交编号", "Submission"), tx("题目", "Problem"), tx("来源", "Context"), tx("语言", "Language"), tx("判题结果", "Verdict"), tx("成绩", "Score"), tx("提交时间", "Submitted"), tx("操作", "Action")]}>
        {rows.map(row => <tr key={row.key} className="border-t border-border hover:bg-surface-subtle">
          <td className="px-4 py-3 font-mono text-xs"><AppLink href={row.href} className={linkClass} title={row.displayId ? row.id : undefined}>{row.displayId ?? row.id}</AppLink></td>
          <td className="px-4 py-3"><AppLink href={row.href} className={linkClass}>{row.title}</AppLink></td>
          <td className="max-w-[220px] px-4 py-3 text-muted-foreground">{row.context}</td>
          <td className="px-4 py-3 text-muted-foreground">{languageInfo[submissionLanguage(row.language)].name}</td>
          <td className="px-4 py-3"><StatusPill status={studyRecordVerdict(locale, row.status)}/></td>
          <td className="px-4 py-3 font-semibold">{studyRecordScore(row)}</td>
          <td className="px-4 py-3 text-xs text-muted-foreground">{date(row.createdAt, locale)}</td>
          <td className="px-4 py-3"><AppLink href={row.href} className={linkClass}>{tx("打开", "Open")}</AppLink></td>
        </tr>)}
      </RecordTable> : <Empty title={tx("没有匹配的提交", "No matching submissions")}
        description={tx("调整筛选条件，或从题目工作区正式提交代码。", "Change the filters, or make a formal submission from a problem workspace.")}/>}
    </State>
    {Boolean(resource.data) && <RecordPager pagination={pagination} count={rows.length} loading={resource.loading}/>}
  </>;
}

export function ReviewNotebookView({ resource, rows, filters, pagination, school = false }: {
  resource: Resource; rows: NotebookRow[]; filters?: ReactNode; pagination?: Pagination; school?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  return <>
    <PageHeader eyebrow={tx("订正", "Correction")} title={tx("订正本", "Review Notebook")}
      description={school ? tx("原活动成绩与后续订正分开记录。", "Original activity results and later corrections remain separate.")
        : tx("查看从正式提交保存的订正笔记。", "Review the notes saved from your formal submissions.")}/>
    {filters}
    <State data={resource}>
      {rows.length ? <RecordTable label={tx("订正记录", "Review entries")} width={school ? "min-w-[1080px]" : "min-w-[680px]"}
        headings={[tx("题目", "Problem"), tx("来源活动", "Source activity"), tx("原始结果", "Original result"),
          ...(school ? [tx("最新订正", "Latest correction"), tx("状态", "Status"), tx("教师反馈", "Teacher feedback")] : []),
          school ? tx("最近练习", "Latest practice") : tx("笔记更新时间", "Note updated"), tx("操作", "Action")]}>
        {rows.map(row => <tr key={row.key} className="border-t border-border">
          <td className="px-4 py-3"><AppLink href={row.href} className={linkClass}>{row.title}</AppLink>
            {row.language && <span className="mt-1 block text-xs text-muted-foreground">{languageInfo[submissionLanguage(row.language)].name}</span>}
          </td>
          <td className="max-w-[200px] px-4 py-3">{row.context}</td>
          <td className="px-4 py-3"><StatusPill status={row.originalResult}/></td>
          {school && <>
            <td className="px-4 py-3"><StatusPill status={row.correction ?? tx("未重试", "Not retried")}/></td>
            <td className="px-4 py-3">{row.state}</td>
            <td className="max-w-[220px] px-4 py-3 text-muted-foreground">{row.feedback || "—"}</td>
          </>}
          <td className="px-4 py-3 text-xs">{date(row.lastPracticedAt, locale)}</td>
          <td className="px-4 py-3"><AppLink href={row.href} className={linkClass}>{tx("打开", "Open")}</AppLink></td>
        </tr>)}
      </RecordTable> : <Empty title={tx("暂无订正记录", "No correction records")}
        description={school ? tx("从提交详情选择“加入订正本”，记录错误原因和下一次测试。", "Choose Add to Review Notebook from a submission to record the cause and next test.")
          : tx("从提交详情保存订正笔记。", "Open a completed submission and save a review note.")}/>}
    </State>
    {pagination && (pagination.page > 1 || pagination.hasMore) && Boolean(resource.data) &&
      <RecordPager pagination={pagination} count={rows.length} loading={resource.loading} notebook/>}
  </>;
}

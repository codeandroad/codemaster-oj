"use client";

import { useState } from "react";
import { Flag, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/navigation";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { Feedback, Loading, Modal, useData, useMutation } from "./common";

interface MessageReport {
  id: string;
  messageId: string;
  profileIdentityId: string;
  profileNickname: string;
  profileAvailable: boolean;
  authorIdentityId: string;
  authorNickname: string;
  reason: "spam" | "abuse" | "privacy" | "other";
  createdAt: string;
  body: string;
  deleted: boolean;
  status: "pending" | "deleted" | "dismissed";
  resolvedAt: string | null;
}
interface ReportPage {
  items: MessageReport[];
  total: number;
  page: number;
  pageSize: number;
  counts: { pending: number; deleted: number; dismissed: number };
}

const reasonLabels: Record<MessageReport["reason"], string> = {
  spam: "广告或刷屏",
  abuse: "辱骂或骚扰",
  privacy: "泄露个人信息",
  other: "其他不合适内容",
};
const pageSize = 10;
type ReportStatus = "pending" | "deleted" | "dismissed" | "all";
const statusLabels: Record<ReportStatus, string> = { pending: "待处理", deleted: "已删除", dismissed: "已驳回", all: "全部" };
const reportEnglish: Record<string, string> = {
  "留言举报": "Message reports", "查看学生对主页留言的举报。删除会立即从主页隐藏留言，并保留举报与操作记录。": "Review reports about student profile messages. Deleting a message hides it immediately while retaining the report and action history.",
  "刷新列表": "Refresh list", "举报处理状态": "Report status", "待处理": "Pending", "已删除": "Deleted", "已驳回": "Dismissed", "全部": "All",
  "举报时间": "Reported", "被留言学生": "Profile student", "留言者": "Author", "举报原因": "Reason", "留言内容": "Message", "状态": "Status", "操作": "Actions",
  "广告或刷屏": "Spam", "辱骂或骚扰": "Abuse or harassment", "泄露个人信息": "Personal information exposure", "其他不合适内容": "Other inappropriate content",
  "主页不可用": "Profile unavailable", "查看并处理": "Review and resolve", "查看详情": "View details", "此状态下暂无留言举报。": "No message reports with this status.",
  "留言举报分页": "Message report pages", "第": "Page", "页 · 共": "of", "条举报": "reports", "上一页": "Previous", "下一页": "Next",
  "处理留言举报": "Resolve message report", "核对留言内容与举报原因。删除后，学生主页不再显示该留言，举报记录仍保留。": "Review the message and report reason. Deleting hides the message from the student's profile while retaining the report.",
  "· 查看主页": " · View profile", "处理状态": "Resolution", "留言原文": "Original message", "返回列表": "Back to list", "驳回举报": "Dismiss report", "处理中…": "Processing…", "删除违规留言": "Delete message",
  "举报已驳回，留言保持展示。": "Report dismissed; the message remains visible.", "留言已删除，举报记录已保留。": "Message deleted; report history retained.",
};
const time = (value: string, locale: AppLocale) => new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
}).format(new Date(value));

export function MessageReports() {
  const { locale } = useLocale();
  const t = (value: string) => locale === "en" ? reportEnglish[value] ?? value : value;
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [selected, setSelected] = useState<MessageReport | null>(null);
  const reports = useData<ReportPage>(`profile-message-reports?status=${status}&page=${page}&pageSize=${pageSize}`);
  const action = useMutation();
  const totalPages = Math.max(1, Math.ceil((reports.data?.total ?? 0) / pageSize));
  const counts = reports.data?.counts;
  const refreshAfterResolution = () => {
    if (reports.data?.items.length === 1 && page > 1) setPage(page - 1);
    else reports.reload();
  };

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-bold"><Flag size={17} className="text-primary"/>{t("留言举报")}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("查看学生对主页留言的举报。删除会立即从主页隐藏留言，并保留举报与操作记录。")}</p>
      </div>
      <Button size="sm" variant="secondary" disabled={reports.loading} onClick={reports.reload}><RefreshCw size={14}/>{t("刷新列表")}</Button>
    </div>
    <Feedback action={action}/>
    <div role="group" aria-label={t("举报处理状态")} className="mt-4 flex flex-wrap gap-2">
      {(["pending", "deleted", "dismissed", "all"] as ReportStatus[]).map(value => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }} className={`min-h-9 rounded-md border px-3 text-sm font-semibold ${status === value ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
        {t(statusLabels[value])}{counts && ` · ${value === "all" ? counts.pending + counts.deleted + counts.dismissed : counts[value]}`}
      </button>)}
    </div>
    <Loading resource={reports}>
      {reports.data && <>
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
              <th scope="col" className="px-4 py-3">{t("举报时间")}</th>
              <th scope="col" className="px-4 py-3">{t("被留言学生")}</th>
              <th scope="col" className="px-4 py-3">{t("留言者")}</th>
              <th scope="col" className="px-4 py-3">{t("举报原因")}</th>
              <th scope="col" className="px-4 py-3">{t("留言内容")}</th>
              <th scope="col" className="px-4 py-3">{t("状态")}</th>
              <th scope="col" className="px-4 py-3">{t("操作")}</th>
            </tr></thead>
            <tbody>
              {reports.data.items.map(report => <tr key={report.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground"><time dateTime={report.createdAt}>{time(report.createdAt, locale)}</time></td>
                <td className="px-4 py-3 font-semibold">{report.profileAvailable ? <AppLink href={`/admin/people/${encodeURIComponent(report.profileIdentityId)}?from=reports`} className="text-primary hover:underline focus-visible:underline">{report.profileNickname}</AppLink> : <><span>{report.profileNickname}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{t("主页不可用")}</span></>}</td>
                <td className="px-4 py-3">{report.authorNickname}</td>
                <td className="px-4 py-3">{t(reasonLabels[report.reason])}</td>
                <td className="max-w-sm px-4 py-3"><p className="line-clamp-3 whitespace-pre-wrap break-words">{report.body}</p></td>
                <td className="whitespace-nowrap px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${report.status === "pending" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground"}`}>{t(statusLabels[report.status])}</span></td>
                <td className="whitespace-nowrap px-4 py-3"><Button size="sm" variant="ghost" onClick={() => { action.clear(); setSelected(report); }}>{t(report.status === "pending" ? "查看并处理" : "查看详情")}</Button></td>
              </tr>)}
              {!reports.data.items.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">{t("此状态下暂无留言举报。")}</td></tr>}
            </tbody>
          </table>
        </div>
        {reports.data.total > pageSize && <nav aria-label={t("留言举报分页")} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{t("第")} {page} / {totalPages} {t("页 · 共")} {reports.data.total} {t("条举报")}</span>
          <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("上一页")}</Button><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("下一页")}</Button></div>
        </nav>}
      </>}
    </Loading>
    {selected && <Modal title={t("处理留言举报")} description={t("核对留言内容与举报原因。删除后，学生主页不再显示该留言，举报记录仍保留。")} onClose={() => { if (!action.busy) setSelected(null); }}>
      <dl className="grid gap-3 text-sm sm:grid-cols-[100px_1fr]">
        <dt className="text-muted-foreground">{t("被留言学生")}</dt><dd className="font-semibold">{selected.profileAvailable ? <AppLink href={`/admin/people/${encodeURIComponent(selected.profileIdentityId)}?from=reports`} className="text-primary hover:underline focus-visible:underline">{selected.profileNickname} {t("· 查看主页")}</AppLink> : <>{selected.profileNickname}<span className="ml-2 text-xs font-normal text-muted-foreground">{t("主页不可用")}</span></>}</dd>
        <dt className="text-muted-foreground">{t("留言者")}</dt><dd>{selected.authorNickname}</dd>
        <dt className="text-muted-foreground">{t("举报原因")}</dt><dd>{t(reasonLabels[selected.reason])}</dd>
        <dt className="text-muted-foreground">{t("举报时间")}</dt><dd>{time(selected.createdAt, locale)}</dd>
        <dt className="text-muted-foreground">{t("处理状态")}</dt><dd>{t(statusLabels[selected.status])}{selected.resolvedAt && ` · ${time(selected.resolvedAt, locale)}`}</dd>
      </dl>
      <div className="rounded-md border border-border bg-surface-subtle p-4"><p className="text-xs font-semibold text-muted-foreground">{t("留言原文")}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{selected.body}</p></div>
      <Feedback action={action}/>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={action.busy} onClick={() => setSelected(null)}>{t("返回列表")}</Button>{selected.status === "pending" && <Button variant="outline" disabled={action.busy} onClick={() => { void action.run(async () => {
        await productionApi(`profile-message-reports/${encodeURIComponent(selected.id)}/dismiss`, { method: "POST" });
        setSelected(null); refreshAfterResolution(); action.success(t("举报已驳回，留言保持展示。"));
      }); }}>{t("驳回举报")}</Button>}{selected.status === "pending" && <Button variant="destructive" disabled={action.busy} onClick={() => { void action.run(async () => {
        await productionApi(`profiles/${encodeURIComponent(selected.profileIdentityId)}/messages/${encodeURIComponent(selected.messageId)}`, { method: "DELETE" });
        setSelected(null); refreshAfterResolution(); action.success(t("留言已删除，举报记录已保留。"));
      }); }}><Trash2 size={14}/>{t(action.busy ? "处理中…" : "删除违规留言")}</Button>}</div>
    </Modal>}
  </div>;
}

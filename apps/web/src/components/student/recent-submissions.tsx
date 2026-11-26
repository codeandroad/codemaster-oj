"use client";

import { ChevronRight } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import { schoolWorkspaceHref } from "../schools/school-workspace-location";
import { date, Empty, State, useData } from "./data-state";

export type RecentSubmission = {
  title: string;
  href: string;
  id: string;
  problemId: string;
  status: string;
  score: number | null | undefined;
  sourceLabel?: string;
};

type SubmissionRecord = {
  id: string;
  schoolId?: string;
  problemId: string;
  problemTitle: string;
  status: string;
  score: number | null;
  createdAt: string;
};

export function useLearnerSubmissions(schoolId?: string, version = 0) {
  const { locale } = useLocale();
  const submissionsState = useData<{ items: SubmissionRecord[] }>(
    schoolId ? `schools/${schoolId}/submissions` : "practice/submissions", version,
  );
  const submissionsHref = schoolId ? schoolWorkspaceHref(schoolId, "submissions") : "/practice/submissions";
  const submissions = (submissionsState.data?.items ?? []).map(row => ({
    id: row.id, problemId: row.problemId, title: row.problemTitle, status: row.status, score: row.score,
    sourceLabel: date(row.createdAt, locale),
    href: schoolId ? submissionsHref + "&" + new URLSearchParams({submissionId: row.id})
      : submissionsHref + "?" + new URLSearchParams({submissionId: row.id, ...(row.schoolId && {submissionSchoolId: row.schoolId})}),
  }));
  return { submissions, submissionsHref, submissionsState };
}

export function RecentSubmissions({ submissions, submissionsHref, submissionsState }: {
  submissions: RecentSubmission[];
  submissionsHref: string;
  submissionsState: Parameters<typeof State>[0]["data"];
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const statusLabel = (status: string) => locale === "zh"
    ? ({ Waiting: "等待中", Judging: "评测中", "System Error": "系统错误", Submitted: "已提交" }[status] ?? status)
    : status;
  return <section aria-label={text("最近提交", "Recent submissions")}>
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-bold">{text("最近提交", "Recent submissions")}</h2>
      <AppLink href={submissionsHref} className="text-sm font-semibold text-primary">{text("查看全部", "View all")}</AppLink>
    </div>
    <State data={submissionsState}>
      {submissions.length ? <div className="overflow-hidden border border-border bg-surface panel-shadow">
        {submissions.slice(0, 3).map(row => <AppLink key={row.id} href={row.href} className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0 hover:bg-surface-subtle md:grid-cols-[110px_minmax(0,1fr)_150px_92px_24px]">
          <span className="truncate font-mono text-xs font-semibold text-primary" title={row.id}>{row.id}</span>
          <span className="truncate font-semibold">{row.title}</span>
          <span className="hidden truncate text-muted-foreground md:block">{row.sourceLabel || "—"}</span>
          <StatusPill status={statusLabel(row.status)} />
          <ChevronRight size={15} className="hidden text-muted-foreground md:block" />
        </AppLink>)}
      </div> : <Empty title={text("暂无正式提交", "No formal submissions yet")} />}
    </State>
  </section>;
}

"use client";

import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Code2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import { CopyCodeButton } from "@/components/student/copy-code-button";
import { CodeBlock, date, kindLabel, State, useData, type DetailedSubmission } from "@/components/student/shared";
import { RunResultPanel } from "@/components/student/run-result-panel";
import { isPending } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { useSchoolText } from "./school-ui";

export type JobDetail = DetailedSubmission & {
  state: string;
  caseFeedback: DetailedSubmission["testResults"];
};

// This endpoint returns only the current account's record in the current school.
// Never use the problem-wide metadata feed to fetch another student's code.
export function SchoolSubmissionDetail({ schoolId, submissionId, backHref }: {
  schoolId: string; submissionId: string; backHref: string;
}) {
  return <StudySubmissionDetail path={`schools/${schoolId}/judge-jobs/${encodeURIComponent(submissionId)}`} backHref={backHref}
    problemHref={job => `/schools?schoolId=${encodeURIComponent(schoolId)}&section=problems&problemId=${encodeURIComponent(job.problemId)}`} />;
}

export function StudySubmissionDetail<T extends JobDetail>({ path, backHref, backLabel, problemHref, renderExtra }: {
  path: string;
  backHref: string;
  backLabel?: string;
  problemHref: (job: T) => string;
  renderExtra?: (job: T, reload: () => void) => ReactNode;
}) {
  const resource = useData<T>(path);
  const { locale } = useLocale();
  const text = useSchoolText();
  const job = resource.data;
  useEffect(() => {
    if (!job || !isPending(job.status) || resource.error) return;
    const timer = window.setInterval(resource.reload, 2000);
    return () => window.clearInterval(timer);
  }, [job, resource.error, resource.reload]);
  return <div className="space-y-4">
    <AppLink href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
      <ArrowLeft size={15} aria-hidden="true" />{backLabel ?? text("Back to submissions", "返回提交记录")}
    </AppLink>
    <State data={resource}>
      {job && <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <section className={`border-l-4 bg-surface p-4 panel-shadow ${job.status === "AC" ? "border-success" : "border-border"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 font-mono text-xs text-muted-foreground" title={job.id}>{job.id.slice(0, 8)}</p>
                <h1 className="break-words text-xl font-bold">{job.problemTitle}</h1>
                <p className="mt-2 text-xs text-muted-foreground">{kindLabel(job.kind, locale)} · {text("Read-only record", "只读记录")}</p>
              </div>
              <StatusPill status={job.status} />
            </div>
          </section>
          <section className="overflow-hidden rounded-lg border border-border bg-surface">
            <RunResultPanel result={{ ...job, testResults: job.caseFeedback }} error="" reload={resource.reload} loading={resource.loading} />
          </section>
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <h2 className="flex items-center gap-2 text-sm font-bold"><Code2 size={16} aria-hidden="true" />{text("Submitted code", "已提交代码")}</h2>
              <CopyCodeButton code={job.code} />
            </header>
            <CodeBlock code={job.code} language={job.language} />
          </section>
        </div>
        <aside className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-bold">{text("Submission details", "提交详情")}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              [text("Submitted", "提交时间"), date(job.createdAt, locale)],
              [text("Language", "语言"), job.language === "cpp" ? "C++17" : job.language === "javascript" ? "JavaScript" : "Python 3"],
              [text("Score", "得分"), job.score === null ? "—" : `${job.score}/100`],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}
          </dl>
          <AppLink href={problemHref(job)} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            {text("Open problem", "打开题目")}<ArrowRight size={14} aria-hidden="true" />
          </AppLink>
        </aside>
      </div>}
      {job && renderExtra?.(job, resource.reload)}
    </State>
  </div>;
}

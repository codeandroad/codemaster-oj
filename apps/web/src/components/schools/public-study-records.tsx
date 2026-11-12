"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { useNavigationBlocker } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Feedback, textarea, useData, useMutation } from "@/components/student/shared";
import { publicSubmissionContext, submissionVerdicts } from "@/components/student/submission-filter";
import { ReviewNotebookView, SubmissionHistory, studyRecordScore, studyRecordVerdict } from "@/components/student/study-record-views";
import { reviewNotebookState, type ReviewNotebookFilter } from "@/components/student/review-notebook-state";
import { productionApi } from "@/lib/production-api";
import { StudySubmissionDetail, type JobDetail } from "./school-submission-detail";
import { useSchoolText } from "./school-ui";

type PublicRecord = {
  id: string;
  schoolId: string;
  problemTitle: string;
  language: string;
  createdAt: string;
  status: string;
  score: number | null;
  noteUpdatedAt?: string | null;
};
type RecordPage = { items: PublicRecord[]; page: number; hasMore: boolean };
type PublicJob = JobDetail & { state: string; note: string | null; noteUpdatedAt: string | null };

export function PublicSubmissions() {
  return <PublicStudyRecords notebook={false} />;
}

export function PublicReviewNotebook() {
  return <PublicStudyRecords notebook />;
}

function PublicStudyRecords({ notebook }: { notebook: boolean }) {
  const text = useSchoolText();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = search.get("submissionId");
  const schoolId = search.get("submissionSchoolId");
  const selectedVerdict = search.get("publicVerdict") ?? "";
  const verdict = !notebook && submissionVerdicts.includes(selectedVerdict) ? selectedVerdict : "";
  const context = search.get("publicContext") === publicSubmissionContext ? publicSubmissionContext : "";
  const review = search.get("publicReview");
  const reviewState = notebook && (review === "resolved" || review === "needs-review") ? review : "";
  const candidate = Number(search.get("publicPage") ?? 1);
  const page = Number.isInteger(candidate) && candidate > 0 && candidate <= 100000 ? candidate : 1;
  function href(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) params.delete(name);
      else params.set(name, value);
    }
    return params.size ? `${pathname}?${params}` : pathname;
  }
  if (id && schoolId) {
    const path = `practice/submissions/${encodeURIComponent(schoolId)}/${encodeURIComponent(id)}`;
    return <StudySubmissionDetail<PublicJob> key={path} path={path}
      backHref={href({ submissionId: null, submissionSchoolId: null })}
      backLabel={notebook ? text("Back to review notebook", "返回订正本") : undefined}
      problemHref={job => `/practice/problems?problemId=${encodeURIComponent(job.problemId)}`}
      renderExtra={(job, reload) => job.state === "completed" &&
        <PublicCorrectionNote key={job.noteUpdatedAt ?? "new"} path={path} job={job} onSaved={reload} />}
    />;
  }
  return <PublicRecordsList key={`${notebook}:${page}:${verdict}:${reviewState}`} notebook={notebook} page={page}
    verdict={verdict} context={context} reviewState={reviewState} href={href} />;
}

function PublicRecordsList({ notebook, page, verdict, context, reviewState, href }: {
  notebook: boolean;
  page: number;
  verdict: string;
  context: string;
  reviewState: "" | "resolved" | "needs-review";
  href: (changes: Record<string, string | null>) => string;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const router = useRouter();
  // This endpoint already restricts submissions to public practice.
  const query = new URLSearchParams({ page: String(page), ...(verdict ? { status: verdict } : {}), ...(reviewState ? { reviewState } : {}) });
  const resource = useData<RecordPage>(`practice/${notebook ? "review-notebook" : "submissions"}?${query}`);
  const rows = (resource.data?.items ?? []).map(row => ({
    ...row,
    key: `${row.schoolId}:${row.id}`,
    displayId: row.id.slice(0, 8),
    href: href({ submissionId: row.id, submissionSchoolId: row.schoolId }),
    title: row.problemTitle,
    context: text("Public practice", "公开练习"),
  }));
  const pagination = {
    page,
    hasMore: Boolean(resource.data?.hasMore),
    previous: () => router.push(href({ publicPage: page > 2 ? String(page - 1) : null })),
    next: () => router.push(href({ publicPage: String(page + 1) })),
  };
  const reviewFilter: ReviewNotebookFilter = reviewState === "resolved" ? "Resolved" : reviewState === "needs-review" ? "Needs review" : "All";
  if (notebook) return <ReviewNotebookView resource={resource} pagination={pagination} filter={reviewFilter}
    onFilter={value => router.push(href({ publicReview: value === "Resolved" ? "resolved" : value === "Needs review" ? "needs-review" : null, publicPage: null }))}
    rows={rows.map(row => {
      const score = studyRecordScore(row);
      const status = studyRecordVerdict(locale, row.status);
      return { ...row, originalResult: score === "—" ? status : `${status} · ${score}`,
        state: reviewNotebookState(row.status, undefined, false), lastPracticedAt: row.noteUpdatedAt ?? row.createdAt };
    })}/>;
  return <SubmissionHistory resource={resource} rows={rows} pagination={pagination}
    filters={{
      verdict, context, scope: "public",
      onVerdict: value => router.push(href({ publicVerdict: value || null, publicPage: null })),
      onContext: value => router.push(href({ publicContext: value || null, publicPage: null })),
    }}/>;
}

function PublicCorrectionNote({ path, job, onSaved }: { path: string; job: PublicJob; onSaved: () => void }) {
  const text = useSchoolText();
  const [note, setNote] = useState(job.note ?? "");
  const action = useMutation();
  const dirty = note !== (job.note ?? "");
  useNavigationBlocker(dirty);
  return <form className="space-y-3 rounded-lg border border-border bg-surface p-4" onSubmit={event => {
    event.preventDefault();
    void action.run(async () => {
      await productionApi(`${path}/note`, { method: "PATCH", body: { note } });
      onSaved();
    });
  }}>
    <label className="block font-semibold" htmlFor="public-correction-note">{text("Review note", "订正笔记")}</label>
    <textarea id="public-correction-note" className={textarea} rows={4} required maxLength={8000} value={note} onChange={event => setNote(event.target.value)} />
    <Feedback action={action} />
    <Button type="submit" disabled={action.busy || !dirty || !note.trim()}>{text("Save note", "保存笔记")}</Button>
  </form>;
}

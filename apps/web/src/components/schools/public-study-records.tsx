"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { State, useData } from "@/components/student/shared";
import { publicSubmissionContext, submissionVerdicts } from "@/components/student/submission-filter";
import { ReviewNotebookView, SubmissionHistory, studyRecordScore, studyRecordVerdict } from "@/components/student/study-record-views";
import { reviewNotebookState, type ReviewNotebookFilter } from "@/components/student/review-notebook-state";
import { CorrectionNote } from "./correction-note";
import { SchoolSubmissionDetail, StudySubmissionDetail, type JobDetail } from "./school-submission-detail";
import { useSchoolText } from "./school-ui";

type PublicRecord = {
  id: string;
  schoolId: string;
  problemTitle: string;
  language: string;
  createdAt: string;
  status: string;
  score: number | null;
  context?: string; correctionStatus?:string|null; feedback?:string|null; reviewState?:ReviewNotebookFilter;
  noteUpdatedAt?: string | null;
};
type RecordPage = { items: PublicRecord[]; page: number; hasMore: boolean };
type PublicJob = JobDetail & { state: string; note: string | null; noteUpdatedAt: string | null };

export function PublicSubmissions() {
  return <LearnerRecords notebook={false} />;
}

export function PublicReviewNotebook() {
  return <LearnerRecords notebook />;
}

export function LearnerRecords({ notebook, schoolId: workspace }: { notebook: boolean; schoolId?:string }) {
  const text = useSchoolText();
  const pathname = usePathname();
  const search = useSearchParams();
  const entry = search.get("reviewEntryId");
  const review = useData<{submissionId:string}>(workspace && notebook && entry ? `schools/${workspace}/review-notebook/${encodeURIComponent(entry)}` : "");
  const id = search.get("submissionId") ?? review.data?.submissionId;
  const schoolId = search.get("submissionSchoolId");
  const pageKey=workspace ? "submissionPage" : "publicPage";
  const selectedVerdict = search.get(workspace ? "verdict" : "publicVerdict") ?? "";
  const verdict = !notebook && submissionVerdicts.includes(selectedVerdict) ? selectedVerdict : "";
  const requestedContext=search.get(workspace ? "context":"publicContext") ?? "";
  const context=(workspace ? ["assignment","timed","correction","practice"] : [publicSubmissionContext]).includes(requestedContext) ? requestedContext : "";
  const requestedReview=search.get(workspace ? "reviewState":"publicReview") ?? "";
  const reviewState=notebook && ["resolved","needs-review",...(workspace ? ["retried","feedback"] : [])].includes(requestedReview) ? requestedReview : "";
  const candidate = Number(search.get(pageKey) ?? 1);
  const page = Number.isInteger(candidate) && candidate > 0 && candidate <= 100000 ? candidate : 1;
  function href(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) params.delete(name);
      else params.set(name, value);
    }
    return params.size ? `${pathname}?${params}` : pathname;
  }
  if (entry && workspace && notebook && !id) return <State data={review}>{null}</State>;
  if (id && workspace) return <SchoolSubmissionDetail key={workspace+id} schoolId={workspace} submissionId={id} backHref={href({submissionId:null,reviewEntryId:null})} backLabel={notebook ? text("Back to review notebook","返回订正本") : undefined}/>;
  if (id && schoolId) {
    const path = `practice/submissions/${encodeURIComponent(schoolId)}/${encodeURIComponent(id)}`;
    return <StudySubmissionDetail<PublicJob> key={path} path={path}
      backHref={href({ submissionId: null, submissionSchoolId: null })}
      backLabel={notebook ? text("Back to review notebook", "返回订正本") : undefined}
      problemHref={job => pathname === "/schools" ? `/schools?${new URLSearchParams({schoolId:search.get("schoolId")!,section:"problems",scope:"public",problemId:job.problemId})}`
        : `/practice/problems?problemId=${encodeURIComponent(job.problemId)}`}
      renderExtra={(job, reload) => job.state === "completed" &&
        <CorrectionNote key={job.noteUpdatedAt ?? "new"} path={path} job={job} onSaved={reload} />}
    />;
  }
  return <PublicRecordsList schoolId={workspace} key={`${workspace}:${notebook}:${page}:${verdict}:${context}:${reviewState}`} notebook={notebook} page={page}
    verdict={verdict} context={context} reviewState={reviewState} href={href} />;
}

function PublicRecordsList({ schoolId, notebook, page, verdict, context, reviewState, href }: {
  schoolId?: string;
  notebook: boolean;
  page: number;
  verdict: string;
  context: string;
  reviewState: string;
  href: (changes: Record<string, string | null>) => string;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const router = useRouter();
  const pageKey=schoolId ? "submissionPage" : "publicPage";
  const path=schoolId ? `schools/${schoolId}/submissions` : `practice/${notebook ? "review-notebook" : "submissions"}`;
  const query = new URLSearchParams({ page:String(page), ...(verdict && {status:verdict}), ...(reviewState && {reviewState}),
    ...(schoolId && notebook && {view:"review"}), ...(schoolId && context && {context}) });
  const resource = useData<RecordPage>(`${path}?${query}`);
  const contexts: Record<string,string>={assignment:text("Assignment","作业"),timed:text("Timed practice","限时训练"),correction:text("Correction","订正"),practice:text("Practice library","题库练习")};
  const rows = (resource.data?.items ?? []).map(row => ({
    ...row,
    key: `${row.schoolId}:${row.id}`,
    displayId: row.id.slice(0, 8),
    href: href({ submissionId: row.id, submissionSchoolId: schoolId ? null : row.schoolId }),
    title: row.problemTitle,
    context: schoolId ? contexts[row.context ?? "practice"] : text("Public practice", "公开练习"),
  }));
  const pagination = {
    page,
    hasMore: Boolean(resource.data?.hasMore),
    previous: () => router.push(href({ [pageKey]: page > 2 ? String(page - 1) : null })),
    next: () => router.push(href({ [pageKey]: String(page + 1) })),
  };
  const states:Record<string,ReviewNotebookFilter>={"resolved":"Resolved","needs-review":"Needs review","retried":"Retried","feedback":"Feedback received"};
  if (notebook) return <ReviewNotebookView resource={resource} school={!!schoolId} pagination={pagination} filter={states[reviewState] ?? "All"}
    onFilter={value=>router.push(href({[schoolId ? "reviewState":"publicReview"]:Object.keys(states).find(k=>states[k]===value) ?? null,[pageKey]:null}))}
    rows={rows.map(row => {
      const score = studyRecordScore(row);
      const status = studyRecordVerdict(locale, row.status);
      return { ...row, originalResult: score === "—" ? status : `${status} · ${score}`,
        feedback:row.feedback ?? undefined, correction:row.correctionStatus ?? undefined,
        state: reviewNotebookState(row.status,row.correctionStatus ?? undefined,Boolean(row.feedback)), lastPracticedAt: row.noteUpdatedAt ?? row.createdAt };
    })}/>;
  return <SubmissionHistory resource={resource} rows={rows} pagination={pagination}
    filters={{
      verdict, context, scope: schoolId ? "school" : "public",
      onVerdict: value => router.push(href({ [schoolId ? "verdict":"publicVerdict"]: value || null, [pageKey]: null })),
      onContext: value => router.push(href({ [schoolId ? "context":"publicContext"]: value || null, [pageKey]: null })),
    }}/>;
}

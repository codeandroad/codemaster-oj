"use client";

import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { draftKey, readCurrentDraft, saveDraft } from "@/components/student/drafts";
import { requiredLanguageText } from "@/components/student/languages";
import { date, State, useData } from "@/components/student/shared";
import { ProblemWorkspace, type ProblemWorkspaceAdapter } from "@/components/student/workspace";
import { productionApi, type CampusUser, type ProductionProblem, type SubmissionLanguage } from "@/lib/production-api";

type Preview = {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  requiredLanguage?: SubmissionLanguage | null;
  problems: { problemId: string; versionId: string; title: string; points: number; score: number | null }[];
};
type PreviewProblem = { problem: ProductionProblem & { versionId: string }; revision: number; requiredLanguage?: SubmissionLanguage | null };

function previewHref(id: string, from: "edit" | "progress", problemId?: string) {
  const query = new URLSearchParams({ from });
  if (problemId) query.set("problemId", problemId);
  return `/teacher/assignments/${encodeURIComponent(id)}/preview?${query}`;
}

export function AssignmentPreviewLink({ id, from }: { id: string; from: "edit" | "progress" }) {
  const { locale } = useLocale();
  return <AppLink href={previewHref(id, from)} className={buttonVariants({ variant: "secondary" })}>
    {locale === "en" ? "Try as a student" : "以学生视角试做"}
  </AppLink>;
}

export function TeacherAssignmentPreview({ id, user }: { id: string; user: CampusUser }) {
  const search = useSearchParams();
  const { locale } = useLocale();
  const en = locale === "en";
  const from = search.get("from") === "edit" ? "edit" : "progress";
  const problemId = search.get("problemId");
  const base = `assignments/${encodeURIComponent(id)}/preview`;
  const problemPath = problemId ? `${base}/problems/${encodeURIComponent(problemId)}` : "";
  const overview = useData<Preview>(base);
  const selected = useData<PreviewProblem>(problemPath);
  const exit = `/teacher/assignments/${encodeURIComponent(id)}/${from}`;
  const returnTo = previewHref(id, from);
  if (problemId) {
    const data = selected.data;
    if (!data || data.problem.id !== problemId || !overview.data || selected.error || overview.error) {
      return <main className="mx-auto max-w-4xl p-5">
        <AppLink href={returnTo} className={buttonVariants({ variant: "secondary" })}>{en ? "Back to preview" : "返回试做"}</AppLink>
        <State data={overview}><State data={selected}>{null}</State></State>
      </main>;
    }
    const { problem, revision } = data;
    const context = `legacy-assignment-preview:${id}:${revision}`;
    const key = (language: SubmissionLanguage) => draftKey(user.id, problem.id, "current", context, language);
    const adapter: ProblemWorkspaceAdapter = {
      context, returnTo, returnLabel: en ? "Back to preview" : "返回试做", homeHref: returnTo,
      requiredLanguage: data.requiredLanguage, languageScope: "assignment", reloadLanguagePolicy: selected.reload,
      presence: null,
      navigation: {
        items: overview.data.problems, loading: overview.loading, error: overview.error, reload: overview.reload,
        href: target => previewHref(id, from, target.problemId), title: en ? "Assignment problems" : "作业题目",
      },
      submissionsPath: `${problemPath}/submissions`,
      submissionPath: jobId => `${base}/jobs/${encodeURIComponent(jobId)}`,
      submit: input => productionApi(`${problemPath}/submissions`, {
        method: "POST", body: { ...input, revision, versionId: problem.versionId, publishedRevision: problem.publishedRevision },
      }),
      normalizeSubmission: result => result,
      draftVersion: "current",
      readDraft: language => readCurrentDraft(user.id, problem.id, context, language),
      saveDraft: (language, draft) => saveDraft(key(language), draft),
      account: () => <span className="hidden rounded bg-muted px-2 py-1 text-xs font-semibold text-foreground sm:inline">
        {en ? "Assignment preview" : "作业试做"}
      </span>,
    };
    return <ProblemWorkspace key={`${user.id}:${context}:${problem.id}:${problem.versionId}`} user={user} problem={problem} adapter={adapter} onReloadProblem={()=>{selected.reload();overview.reload();}}/>;
  }
  const preview = overview.data;
  const score = preview?.problems.reduce((sum, problem) => sum + (problem.score ?? 0), 0) ?? 0;
  const total = preview?.problems.reduce((sum, problem) => sum + problem.points, 0) ?? 0;
  const points = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return <>
    <PageHeader title={preview?.title ?? (en ? "Assignment preview" : "作业试做")}/>
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-0 flex-1 basis-52">
        <p className="text-xs font-semibold text-primary">{en ? "Student view · Assignment preview" : "学生视角 · 作业试做"}</p>
        {preview && <p className="mt-1 break-words text-lg font-semibold">{preview.title}</p>}
        <p className="mt-1 text-sm text-muted-foreground">
          {en ? "Your submissions and scores are private. You can try the saved assignment after the student deadline." : "试做提交和得分仅本人可见。学生截止后仍可试做已保存的作业。"}
        </p>
      </div>
      <AppLink href={exit} className={buttonVariants({ variant: "secondary" })}>{en ? "Exit preview" : "退出试做"}</AppLink>
    </div>
    <State data={overview} empty={preview && !preview.problems.length ? (en ? "This assignment has no problems yet." : "这份作业还没有题目。") : undefined}>
      {preview && <section className="mt-5 rounded-lg border border-border bg-surface p-4">
        <p className="mb-3 text-sm text-muted-foreground">{en ? "Student deadline" : "学生截止时间"} <time dateTime={preview.dueAt}>{date(preview.dueAt, locale)}</time></p>
        {preview.requiredLanguage && <p className="mb-3 text-sm">{requiredLanguageText(locale, preview.requiredLanguage, "assignment")}</p>}
        {preview.description && <p className="mb-4 whitespace-pre-wrap break-words text-sm">{preview.description}</p>}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{en ? "Assignment problems" : "作业题目"}</h2>
          <p className="text-sm text-muted-foreground">{en ? "Preview score" : "试做得分"} <strong className="ml-1 tabular-nums text-foreground">{points.format(score)}/{points.format(total)}</strong></p>
        </div>
        <ol className="mt-3 divide-y divide-border border-y border-border">
          {preview.problems.map((problem, index) => <li key={problem.problemId}>
            <AppLink href={previewHref(id, from, problem.problemId)} className="flex min-h-11 items-center justify-between gap-3 px-2 py-2 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2">
              <span className="min-w-0 break-words font-medium text-primary">{index + 1}. {problem.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{problem.score == null ? "—" : points.format(problem.score)} / {points.format(problem.points)}</span>
            </AppLink>
          </li>)}
        </ol>
      </section>}
    </State>
  </>;
}

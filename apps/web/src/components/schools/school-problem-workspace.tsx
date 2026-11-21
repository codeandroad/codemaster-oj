"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { State, useData, type DetailedSubmission } from "@/components/student/shared";
import type { ResultCase } from "@/components/student/result-feedback";
import type { StudentDraft } from "@/components/student/drafts";
import { starterFor, submissionLanguage } from "@/components/student/languages";
import { ProblemWorkspace, type ProblemWorkspaceAdapter } from "@/components/student/workspace";
import { productionApi, type CampusUser, type SubmissionLanguage } from "@/lib/production-api";
import { publicWorkspaceProblem } from "./public-workspace-model";
import { ProblemWorkspaceAccount } from "./problem-workspace-account";
import { SchoolActivityScholarshipRule, SchoolAssistance } from "./school-scholarship";
import { practiceLocation } from "./school-practice-navigation";
import type { Problem } from "./school-practice-types";
import { PracticeToolbar, type PracticeNavigation } from "./school-practice-toolbar";
import { schoolWorkspaceHref } from "./school-workspace-location";

type CoursePracticeContext = { courseId: string; chapterId: string; requiredLanguage?: SubmissionLanguage | null; solved: boolean; preview: boolean; reload: () => void };
type Props = { path: string; jobPath: (id: string) => string; onBack: () => void; backLabel?: string; navigation?: PracticeNavigation; expectedVersionId?: string; course?: CoursePracticeContext };

export function PracticeProblem(props: Props) {
  const { path, course, expectedVersionId } = props;
  const query = new URLSearchParams({ view: "practice", ...(!course && expectedVersionId && { versionId: expectedVersionId }) });
  const data = useData<Problem>(`${path}?${query}`), auth = useData<{user: CampusUser}>("auth/me");
  return <>
    {(!data.data?.definition || !auth.data || data.error || auth.error) && <PracticeToolbar title="" onBack={props.onBack} backLabel={props.backLabel} navigation={props.navigation}/>}
    <State data={data}><State data={auth}>{data.data?.definition && auth.data && <SchoolProblemWorkspace
      key={[path,data.data.versionId,data.data.activity?.revision,course?.courseId,course?.chapterId].join(":")}
      {...props} problem={data.data} reload={data.reload} user={auth.data.user}/>}</State></State>
  </>;
}

function schoolDraftStorage(problem: Problem, userId: string) {
  const a = problem.activity;
  const prefix = a?.preview ? `codemaster:assignment-preview:${userId}:${problem.schoolId}:${a.id}:${a.revision}:${problem.id}:${problem.versionId}`
    : `codemaster:school-practice:${userId}:${problem.schoolId}:${problem.id}:${a ? problem.versionId : "current"}`;
  const previous = `codemaster:school-practice:${userId}:${problem.schoolId}:${problem.id}:${problem.versionId}`;
  const key = (lang: SubmissionLanguage) => lang === "python" ? "" : ":" + lang;
  return {
    readSelectedLanguage() { try { return submissionLanguage(localStorage.getItem(prefix + ":language")); } catch { return null; } },
    saveSelectedLanguage(lang: SubmissionLanguage) { try { localStorage.setItem(prefix + ":language",lang); } catch { /* Optional local preference. */ } },
    readDraft(lang: SubmissionLanguage): StudentDraft | null {
      try {
        const stored = localStorage.getItem(prefix + key(lang) + ":draft");
        if (stored) {
          const data = JSON.parse(stored);
          if (typeof data?.code === "string" && typeof data.receivedCode === "string") return data;
        }
        const code = localStorage.getItem(prefix + key(lang)) ?? (!a ? localStorage.getItem(previous + key(lang)) : null);
        return code === null ? null : { code, receivedCode: starterFor(problem.definition!,lang), updatedAt: "" };
      } catch { return null; }
    },
    saveDraft(lang: SubmissionLanguage, draft: StudentDraft) {
      try { localStorage.setItem(prefix + key(lang) + ":draft",JSON.stringify(draft)); return true; } catch { return false; }
    },
  };
}

const normalizeJob = (result: DetailedSubmission) => ({
  ...result, testResults: (result as DetailedSubmission & {caseFeedback?: ResultCase[]}).caseFeedback ?? [],
});

function SchoolProblemWorkspace({ path, jobPath, backLabel, navigation, course, problem, user, reload }: Props & { problem: Problem; user: CampusUser; reload: () => void }) {
  const { locale } = useLocale(), pathname = usePathname(), query = useSearchParams();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const a = problem.activity, staff = Boolean(a?.preview || problem.staffPractice || course?.preview);
  const deadline = a?.kind === "timed" ? a.attempt?.deadlineAt : null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()),1000);
    return () => window.clearInterval(timer);
  },[deadline]);
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline)-now)/1000)) : null;
  const courseContext = course ? {courseId: course.courseId, chapterId: course.chapterId} : {};
  const tutorialQuery = new URLSearchParams({versionId: problem.versionId!, ...(course ? {courseId:course.courseId,chapterId:course.chapterId} : {})});
  const href = (problemId: string | null) => practiceLocation(pathname, query.toString(), {problemId});
  const closed = a?.canSubmit === false || a?.kind === "timed" && Boolean(a.attempt?.finishedAt || seconds === 0 || a.resultsPublishedAt);
  const adapter: ProblemWorkspaceAdapter = {
    context: `school:${problem.schoolId}:${a?.id ?? course?.courseId ?? "practice"}`, draftVersion: a ? problem.versionId! : "current",
    ...schoolDraftStorage(problem,user.id), requiredLanguage: course?.requiredLanguage ?? (a ? "python" : null),
    languageScope: a ? "assignment" : "course", reloadLanguagePolicy:course?.reload, submissionClosed: closed,
    returnTo:href(null), returnLabel:backLabel ?? tx("返回题目","Back to problems"), homeHref:schoolWorkspaceHref(problem.schoolId),
    navigation:{items:(navigation?.items ?? []).map(i => ({problemId:i.id,title:i.title})),loading:false,error:"",reload,href:i=>href(i.problemId),title:a?.title ?? tx("题目列表","Problem list")},
    tutorialEndpoint: !a?.preview && (a?.kind !== "timed" || a.resultsPublishedAt) ? `schools/${problem.schoolId}/problems/${problem.id}/tutorial?${tutorialQuery}` : undefined,
    submissionsPath:`${path}/submissions?includePlatform=1`, submissionPath:jobPath, normalizeSubmission:normalizeJob,
    submit:({kind,code,language,customInput,requestId})=>productionApi(`${path}/submissions`,{method:"POST",body:{kind,code,language,input:customInput,requestId,
      versionId:problem.versionId,publishedRevision:problem.publishedRevision,...courseContext,...(course?.preview && {coursePreview:true}),...(a?.preview && {expectedRevision:a.revision})}}),
    onSubmissionCompleted: result => {
      if(result.kind !== "submit") return;
      course?.reload();
      if (!staff) window.dispatchEvent(new Event("codemaster:school-scholarship-changed"));
    },
    presence:null, account:dirty=><ProblemWorkspaceAccount user={user} schoolId={problem.schoolId} staff={staff} dirty={dirty}/>,
    assistance:staff ? undefined : (kind,language)=><SchoolAssistance schoolId={problem.schoolId} preferredLanguage={language} kind={kind}
      target={{type:"problem",problemId:problem.id,versionId:problem.versionId!,activityId:a?.id}}/>,
    statusBanner:(a || staff) && <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm">
      {a?.title}{staff && tx("教师试做 · 仅本人可见","Teacher preview · Personal results")}
      {a?.kind === "assignment" && a.canSubmit && a.endsAt && !staff && tx("截止后补交会更新进度，成绩与奖励以截止前提交为准。","Late work updates progress. Grades and rewards use submissions received by the deadline.")}
      {a && !a.preview && <SchoolActivityScholarshipRule schoolId={problem.schoolId} activityId={a.id}/>}
      {seconds !== null && <span role="timer" className="font-mono">{closed ? tx("已结束","Ended") : [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,"0")).join(":")}</span>}
    </div>,
  };
  return <ProblemWorkspace problem={{...publicWorkspaceProblem(problem),solved:course?.solved ?? problem.solved}} user={user} adapter={adapter} onReloadProblem={()=>{reload();course?.reload();}}/>;
}

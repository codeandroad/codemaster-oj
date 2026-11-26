"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ProblemWorkspaceAccount } from "./problem-workspace-account";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { OnlineStudents, StudentPresenceHeartbeat } from "@/components/student/student-presence";
import { ScholarshipAssistance } from "@/components/scholarship/assistance";
import { ProblemWorkspace, type ProblemWorkspaceAdapter } from "@/components/student/workspace";
import { State, useData, type DetailedSubmission } from "@/components/student/shared";
import type { ResultCase } from "@/components/student/result-feedback";
import { productionApi, type CampusUser, type SubmissionLanguage } from "@/lib/production-api";
import { schoolDisplayName, type School } from "./school-ui";
import type { Problem } from "./school-practice-types";
import { publicDraftStorage, publicPracticeHref, publicPracticeReturnHref, publicWorkspaceProblem } from "./public-workspace-model";

type PublicChapter = {id:string;title:string;body:string;position?:number;problems:{problemId:string;versionId:string;title:string;solved:boolean}[]};
type PublicCourse = {title:string;requiredLanguage?:SubmissionLanguage|null;chapters:PublicChapter[]};
const normalizeJob = (result: DetailedSubmission) => ({...result, testResults: (result as DetailedSubmission & {caseFeedback?:ResultCase[]}).caseFeedback ?? []});
const unavailableStorage = {getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); }};

export function PublicProblemWorkspace({ id, catalog, workspaceSchoolId }: { id:string; workspaceSchoolId?:string|null; catalog:{data:{items:Problem[]}|null;loading:boolean;error:string;reload:()=>void} }) {
  const params = useSearchParams();
  const user = useData<{user:CampusUser}>("auth/me");
  const problem = useData<Problem>(`practice/problems/${encodeURIComponent(id)}?${new URLSearchParams({view:"practice", ...(params.get("publicCourseId") ? {courseId:params.get("publicCourseId")!,chapterId:params.get("publicChapterId")!} : {})})}`);
  return <State data={user}><State data={problem}>{user.data?.user && problem.data?.definition && <PublicWorkspace key={`${workspaceSchoolId??""}:${user.data.user.id}:${problem.data.id}:${problem.data.versionId}:${params.get("publicCourseId")??""}:${params.get("publicChapterId")??""}`} workspaceSchoolId={workspaceSchoolId} user={user.data.user} problem={problem.data} catalog={catalog} reloadProblem={problem.reload}/>}</State></State>;
}
function PublicWorkspace({user, problem, catalog, reloadProblem, workspaceSchoolId}:{workspaceSchoolId?:string|null; user:CampusUser;problem:Problem;catalog:{data:{items:Problem[]}|null;loading:boolean;error:string;reload:()=>void};reloadProblem:()=>void}) {
  const params = useSearchParams(), search = params.toString(), {locale} = useLocale();
  const pathname = usePathname();
  const fromCatalog = params.get("fromProblemCatalog") === "1";
  const workspacePath = pathname === "/schools" || fromCatalog ? pathname : "/practice/problems";
  const courseId = params.get("publicCourseId"), chapterId = params.get("publicChapterId");
  const course = useData<PublicCourse>(courseId && chapterId ? `practice/courses/${encodeURIComponent(courseId)}` : "");
  const reloadCourse = course.reload;
  const chapter = course.data?.chapters.find(item=>item.id===chapterId);
  const validChapter = chapter?.problems.some(item=>item.problemId===problem.id && item.versionId===problem.versionId);
  const memberships = useData<{items:School[]}>("schools");
  const [selectedSchool, setSelectedSchool] = useState("");
  const classroom = memberships.data?.items.find(s => s.id === selectedSchool && s.roles.includes("student"));
  const adapter = useMemo<ProblemWorkspaceAdapter>(()=> {
    const path = `practice/problems/${encodeURIComponent(problem.id)}`;
    let storage: Pick<Storage,"getItem"|"setItem"> = unavailableStorage;
    try { storage = window.localStorage; } catch { /* The editor remains usable without storage. */ }
    const inCourse = Boolean(courseId && chapterId);
    return {
      context: inCourse ? `public-course:${courseId}:${chapterId}` : "public-practice",
      requestScope: classroom?.id,
      statusBanner: <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-2 text-sm">
        <label>{locale === "en" ? "Run this problem as " : "本题运行归属 "}
          <select className="rounded border border-input bg-background px-2 py-1" value={classroom?.id ?? ""} onChange={e=>setSelectedSchool(e.target.value)}>
            <option value="">{locale === "en" ? "Personal practice" : "个人练习"}</option>
            {memberships.data?.items.filter(s=>s.roles.includes("student")).map(s=><option key={s.id} value={s.id}>{schoolDisplayName(s,locale)} · {locale === "en" ? "Classroom" : "课堂练习"}</option>)}
          </select>
        </label>
        <span aria-live="polite">{classroom
          ? (locale==="en" ? `Administrators at ${schoolDisplayName(classroom,locale)} can see each new run, submission and its code.` : `${schoolDisplayName(classroom,locale)}的管理员可以查看本题接下来的每次运行、正式提交和当次代码。`)
          : (locale==="en" ? "You can share personal runs with a school from Submissions." : "个人练习可在「提交记录」中自行选择分享给学校。")}</span>
      </div>,
      requiredLanguage: validChapter ? course.data?.requiredLanguage : null,
      languageScope: "course",
      reloadLanguagePolicy: inCourse ? reloadCourse : undefined,
      onSubmissionCompleted: inCourse ? result => { if (result.kind === "submit") reloadCourse(); } : undefined,
      returnTo: publicPracticeReturnHref(search, workspacePath), returnLabel: inCourse && !fromCatalog ? (locale==="en"?"Back to chapter":"返回章节") : (locale==="en"?"Back to Problems":"返回题目"), homeHref:workspaceSchoolId ? `/schools?schoolId=${workspaceSchoolId}` : "/practice",
      navigation: {
        items: inCourse ? validChapter ? chapter!.problems : [] : (catalog.data?.items??[]).map(item=>({problemId:item.id,versionId:item.versionId??undefined,title:item.title})),
        loading: inCourse ? course.loading : catalog.loading,
        error: inCourse ? course.error || (!course.loading&&!validChapter ? (locale==="en"?"This version is not available in this course chapter.":"此版本不在本章可访问的练习中。") : "") : catalog.error,
        reload: inCourse ? reloadCourse : catalog.reload,
        href: target => {
          const query = new URLSearchParams(search);
          if (fromCatalog && !inCourse) {
            const context = catalog.data?.items.find(item => item.id === target.problemId)?.courseContext;
            if (context) {
              query.set("publicCourseId", context.courseId);
              query.set("publicChapterId", context.chapterId);
            }
          }
          return publicPracticeHref(target, query.toString(), workspacePath);
        }, title: inCourse ? (locale==="en"?"Chapter practice":"本章练习") : (locale==="en"?"Problem list":"题目列表"),
        description: validChapter ? `${course.data?.title} › ${chapter?.title}` : undefined,
      },
      chapter: validChapter ? {courseTitle:course.data!.title,title:chapter!.title,position:chapter!.position??course.data!.chapters.indexOf(chapter!),completed:chapter!.problems.find(item=>item.problemId===problem.id)!.solved} : undefined,
      tutorial: validChapter && chapter?.body.trim() ? {source:"course",courseTitle:course.data!.title,title:chapter.title,body:chapter.body} : undefined,
      submissionsPath: `${path}/submissions?${new URLSearchParams({
        versionId:problem.versionId!,
        ...(workspaceSchoolId ? {workspaceSchoolId} : {}),
        ...(inCourse ? {courseId:courseId!,chapterId:chapterId!} : {}),
      })}`,
      submissionsTitle: workspaceSchoolId
        ? (locale === "en" ? "Latest school and platform practice submissions" : "校内与平台练习 · 每人最新提交")
        : (locale === "en" ? "Latest platform practice submissions" : "平台练习 · 每人最新提交"),
      resumeSubmission: true,
      submit: ({kind,code,language,customInput,requestId})=>productionApi(`${path}/submissions`, {method:"POST",body:{kind,code,language,input:customInput,...(classroom && {classroomSchoolId:classroom.id}),requestId,versionId:problem.versionId,publishedRevision:problem.publishedRevision,...(inCourse ? {courseId,chapterId} : {})}}),
      submissionPath: id=>`${path}/submissions/${encodeURIComponent(id)}`, normalizeSubmission:normalizeJob,
      ...publicDraftStorage(user.id,problem,storage), draftVersion:"current",
      assistance: (kind, language)=><ScholarshipAssistance preferredLanguage={language} key={`${problem.id}:${problem.versionId}:${kind}`} target={{problemId:problem.id,versionId:problem.versionId!}} kind={kind} endpoint="practice/scholarship/assistance"/>,
      presence:<><StudentPresenceHeartbeat identityId={user.id} endpoint="practice/presence"/><OnlineStudents identityId={user.id} endpoint="practice/presence"/></>,
      account:dirty=><ProblemWorkspaceAccount user={user} dirty={dirty} schoolId={workspaceSchoolId} publicWallet/>,
    };
  },[user,problem,classroom,memberships.data,search,courseId,chapterId,chapter,validChapter,catalog,course.data,course.loading,course.error,reloadCourse,locale,fromCatalog,workspacePath,workspaceSchoolId]);
  if ((courseId || chapterId) && (!validChapter || course.error)) {
    const error = course.error || (!course.loading ? (locale === "en" ? "This version is not available in this course chapter." : "此版本不在本章可访问的练习中。") : "");
    return <div className="p-5">
      <AppLink href={adapter.returnTo} className="text-sm text-primary underline underline-offset-2">{adapter.returnLabel}</AppLink>
      <State data={{ ...course, data: undefined, error }}>{null}</State>
    </div>;
  }
  return <ProblemWorkspace problem={publicWorkspaceProblem(problem)} user={user} adapter={adapter} onReloadProblem={()=>{reloadProblem();reloadCourse();catalog.reload();}}/>;
}

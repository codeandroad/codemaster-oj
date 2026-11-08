"use client";

import { useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { useLocale } from "@/components/locale-context";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { OnlineStudents, StudentPresenceHeartbeat } from "@/components/student/student-presence";
import { LuqAssistance } from "@/components/luq/assistance";
import { LuqBalance } from "@/components/luq/account-pages";
import { ProblemWorkspace, type ProblemWorkspaceAdapter } from "@/components/student/workspace";
import { State, useData, useMutation, type DetailedSubmission } from "@/components/student/shared";
import type { ResultCase } from "@/components/student/result-feedback";
import { ApiError, clearProductionSession, productionApi, type CampusUser } from "@/lib/production-api";
import type { Problem } from "./school-practice-types";
import { publicDraftStorage, publicPracticeHref, publicPracticeReturnHref, publicWorkspaceProblem } from "./public-workspace-model";

type PublicChapter = {id:string;title:string;body:string;position?:number;problems:{problemId:string;versionId:string;title:string;solved:boolean}[]};
type PublicCourse = {title:string;chapters:PublicChapter[]};
const normalizeJob = (result: DetailedSubmission) => ({...result, testResults: (result as DetailedSubmission & {caseFeedback?:ResultCase[]}).caseFeedback ?? []});
const unavailableStorage = {getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); }};

export function PublicProblemWorkspace({ id, catalog }: { id:string; catalog:{data:{items:Problem[]}|null;loading:boolean;error:string;reload:()=>void} }) {
  const params = useSearchParams(), version = params.get("versionId");
  const user = useData<{user:CampusUser}>("auth/me");
  const problem = useData<Problem>(`practice/problems/${encodeURIComponent(id)}?${new URLSearchParams({view:"practice", ...(version ? {versionId:version} : {})})}`);
  return <State data={user}><State data={problem}>{user.data?.user && problem.data?.definition && <PublicWorkspace key={`${user.data.user.id}:${problem.data.id}:${problem.data.versionId}:${params.get("publicCourseId")??""}:${params.get("publicChapterId")??""}`} user={user.data.user} problem={problem.data} catalog={catalog}/>}</State></State>;
}
function PublicWorkspace({user, problem, catalog}:{user:CampusUser;problem:Problem;catalog:{data:{items:Problem[]}|null;loading:boolean;error:string;reload:()=>void}}) {
  const params = useSearchParams(), search = params.toString(), router = useRouter(), {locale} = useLocale();
  const courseId = params.get("publicCourseId"), chapterId = params.get("publicChapterId");
  const course = useData<PublicCourse>(courseId && chapterId ? `practice/courses/${encodeURIComponent(courseId)}` : "");
  const chapter = course.data?.chapters.find(item=>item.id===chapterId);
  const validChapter = chapter?.problems.some(item=>item.problemId===problem.id && item.versionId===problem.versionId);
  const logout = useMutation();
  const adapter = useMemo<ProblemWorkspaceAdapter>(()=> {
    const path = `practice/problems/${encodeURIComponent(problem.id)}`;
    let storage: Pick<Storage,"getItem"|"setItem"> = unavailableStorage;
    try { storage = window.localStorage; } catch { /* The editor remains usable without storage. */ }
    const inCourse = Boolean(courseId && chapterId);
    return {
      context: inCourse ? `public-course:${courseId}:${chapterId}` : "public-practice",
      returnTo: publicPracticeReturnHref(search), returnLabel: inCourse ? (locale==="en"?"Back to chapter":"返回章节") : (locale==="en"?"Back to Problems":"返回题目"), homeHref:"/practice",
      navigation: {
        items: inCourse ? validChapter ? chapter!.problems : [] : (catalog.data?.items??[]).map(item=>({problemId:item.id,versionId:item.versionId??undefined,title:item.title})),
        loading: inCourse ? course.loading : catalog.loading,
        error: inCourse ? course.error || (!course.loading&&!validChapter ? (locale==="en"?"This version is not available in this course chapter.":"此版本不在本章可访问的练习中。") : "") : catalog.error,
        reload: inCourse ? course.reload : catalog.reload,
        href: target=>publicPracticeHref(target,search), title: inCourse ? (locale==="en"?"Chapter practice":"本章练习") : (locale==="en"?"Problem list":"题目列表"),
        description: validChapter ? `${course.data?.title} › ${chapter?.title}` : undefined,
      },
      chapter: validChapter ? {courseTitle:course.data!.title,title:chapter!.title,position:chapter!.position??course.data!.chapters.indexOf(chapter!),completed:chapter!.problems.find(item=>item.problemId===problem.id)!.solved} : undefined,
      tutorial: validChapter && chapter?.body.trim() ? {source:"course",courseTitle:course.data!.title,title:chapter.title,body:chapter.body} : undefined,
      submissionsPath: `${path}/submissions?${new URLSearchParams({versionId:problem.versionId!})}`,
      submit: ({kind,code,language,customInput,requestId})=>productionApi(`${path}/submissions`, {method:"POST",body:{kind,code,language,input:customInput,requestId,versionId:problem.versionId}}),
      submissionPath: id=>`${path}/submissions/${encodeURIComponent(id)}`, normalizeSubmission:normalizeJob,
      ...publicDraftStorage(user.id,problem,storage),
      assistance: kind=><LuqAssistance key={`${problem.id}:${problem.versionId}:${kind}`} target={{problemId:problem.id,versionId:problem.versionId!}} kind={kind} endpoint="practice/luq/assistance"/>,
      presence:<><StudentPresenceHeartbeat identityId={user.id} endpoint="practice/presence"/><OnlineStudents identityId={user.id} endpoint="practice/presence"/></>,
      account:hasUnsavedChanges=><><LuqBalance identityId={user.id} endpoint="practice/luq/me" href="/practice/scholarship"/><NotificationDropdown key={user.id} workspace="public"/><AccountMenu user={user} busy={logout.busy} leaderboardHref="/practice/leaderboard" onLogout={()=>{
        if(hasUnsavedChanges&&!window.confirm(locale==="en"?"Your code has not been submitted. The draft remains in this browser. Sign out?":"代码尚未提交，草稿保留在本机。确认退出登录？"))return;
        void logout.run(async()=>{
        try { await productionApi("auth/logout",{method:"POST"}); } catch(error) { if(!(error instanceof ApiError&&error.status===401))throw error; }
        clearProductionSession();router.replace("/login");
      });}}/></>,
    };
  },[user,problem,search,courseId,chapterId,chapter,validChapter,catalog,course.data,course.loading,course.error,course.reload,locale,logout,router]);
  return <ProblemWorkspace problem={publicWorkspaceProblem(problem)} user={user} adapter={adapter}/>;
}

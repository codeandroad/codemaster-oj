"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { Feedback, panelClass, useData, useMutation } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { PersonalAppearanceProvider } from "@/components/personal-appearance-settings";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { StudentPublicProfile } from "@/components/student/public-profile";
import { StudentPresenceHeartbeat } from "@/components/student/student-presence";
import { ScholarshipBalance, StudentScholarshipPage } from "@/components/scholarship/account-pages";
import { useWorkspaceSettings } from "@/components/student/workspace-settings";
import { WorkspaceThemeProvider } from "@/components/ui/theme-context";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { learnerNavigation, useWorkspaceNavigationLabel, WorkspaceNavigation } from "@/components/workspace-navigation";
import { ApiError, productionApi, type CampusUser } from "@/lib/production-api";
import { PersonalWorkspaceProfile } from "./personal-workspace-profile";
import { PersonalWorkspaceSettings } from "./personal-workspace-settings";
import { PublicCourseCatalog, PublicCoursePage } from "./public-course-catalog";
import { PublicPracticeLeaderboard } from "./public-practice-leaderboard";
import { PublicPracticePreferences } from "./public-practice-preferences";
import { PublicPractice } from "./school-practice";
import { schoolDisplayName, useSchoolText, type School } from "./school-ui";

import { useLocale } from "../locale-context";
import { PageHeadingProvider, useCurrentPageHeading } from "../page-heading-context";
import { useWorkspaceData } from "../workspace-data";
import { StudentDashboardView } from "../student/dashboard-view";
import { StudentClass, StudentClasses } from "../student/classes";
import { AcslPage } from "../acsl/acsl-page";
import { useAcslEnabled } from "../acsl/use-acsl-enabled";
import { PreparationRouter } from "../written-papers/preparation-router";
import { SchoolStudentDashboard } from "./school-dashboard";
import { SchoolActivities } from "./school-activities";
import { SchoolCourses } from "./school-courses";
import { SchoolPractice } from "./school-practice";
import { SchoolPaper4 } from "./school-paper4";
import { SchoolLeaderboard } from "./school-scholarship";
import { LearnerResourceScope } from "./learner-resource-scope";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { LearnerRecords } from "./public-study-records";
import { OpenPlatformPoker } from "@/components/poker/open-platform-poker";

type LearnerProps = {
  user: CampusUser; pathname: string; school?: School; onLogout: () => void;
  onUserSaved: (user: CampusUser) => void; onSchoolsChanged?: () => void;
};

export function LearnerWorkspace({ user, pathname, school, onLogout, onUserSaved, onSchoolsChanged }: LearnerProps) {
  const text = useSchoolText(), {locale} = useLocale();
  const search = useSearchParams(), router = useRouter();
  const navLabel = useWorkspaceNavigationLabel();
  const { settings, update, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const logout = useMutation();
  const memberships = useWorkspaceData<{items:School[]}>("schools");
  const pokerStatus = useData<{enabled:boolean;unlocked:boolean}>(school ? "" : "practice/poker/status");
  const acslEnabled = useAcslEnabled(school?.id,false);
  const [, , publicSection, resourceId] = pathname.split("/");
  const requested = school ? (search.get("join") === "1" ? "settings" : search.get("section")) : publicSection;
  const section = requested === "personal-settings" ? "settings" : requested || "home";
  const navigation = learnerNavigation(school?.id);
  const href = (key:string) => school ? schoolWorkspaceHref(school.id,key === "settings" ? "personal-settings" : key)
    : key === "home" ? "/practice" : `/practice/${key}`;
  const scopeName = school ? schoolDisplayName(school,locale) : text("Open Platform","开放平台");
  const prep = ["paper4","acsl"].includes(section);
  const item = navigation.find(item=>item.section === section);
  const otherLabels:Record<string,string> = {profile:text("Profile","个人资料"),people:text("Profile","个人主页"),
    settings:text("Settings","设置"),leaderboard:text("Leaderboard","排行榜"),timed:text("Timed practice","限时训练"),
    paper4:text("Paper 4 past papers","Paper 4 真题练习"),acsl:text("ACSL practice","ACSL 真题练习")};
  const label = item ? navLabel(item) : otherLabels[section] ?? scopeName;
  const wallet = school ? `schools/${school.id}/scholarship/me` as const : "practice/scholarship/me";
  const classId = school && search.get("classId");
  const profileId = school ? search.get("profileId") : resourceId;
  const schools = memberships.data?.items.filter(s=>s.roles.includes("student")) ?? [];
  function switchWorkspace(id:string) {
    const next = learnerNavigation(id || undefined).find(item=>item.section===section);
    router.push(next?.href ?? (id ? schoolWorkspaceHref(id) : "/practice"));
  }
  useEffect(() => { document.title = `${label} · CodeMaster`; },[label]);
  let content;
  switch(section) {
    case "settings":
      content = <div className="space-y-4">{!school && <PublicPracticePreferences/>}<PersonalWorkspaceSettings user={user} onUserSaved={onUserSaved} onSchoolsChanged={onSchoolsChanged}/></div>;
      break;
    case "profile":
      content = <><PersonalWorkspaceProfile user={user} onUserSaved={onUserSaved} schoolRoles={school?.roles} publicPractice={!school}/>
        {!school && <StudentPublicProfile profileId={user.id} viewer={user} workspace="practice" embedded/>}</>;
      break;
    case "people":
    case "leaderboard":
      content = profileId ? <StudentPublicProfile key={profileId} profileId={profileId} schoolId={school?.id} viewer={user} workspace={school ? "student" : "practice"}/>
        : school ? <SchoolLeaderboard schoolId={school.id}/> : <PublicPracticeLeaderboard/>;
      break;
    case "problems":
      content = school ? <LearnerResourceScope workspaceSchoolId={school.id} section="problems" schoolHref={href(section)} accountId={user.id}>
        <SchoolPractice accountId={user.id} schoolId={school.id} role="student" initialProblemId={search.get("problemId") ?? undefined}/></LearnerResourceScope>
        : <PublicPractice accountId={user.id} workspaceSchoolId={search.get("workspaceSchoolId")}/>;
      break;
    case "courses":
      content = school ? <LearnerResourceScope workspaceSchoolId={school.id} section="courses" schoolHref={href(section)}>
        <SchoolCourses school={school} initialCourseId={search.get("courseId")}/></LearnerResourceScope>
        : resourceId ? <PublicCoursePage id={resourceId} workspaceSchoolId={search.get("workspaceSchoolId")} homeHref={href(section)}/>
          : <PublicCourseCatalog courseHref={publicCourseHref}/>;
      break;
    case "review-notebook":
    case "submissions":
      content = school ? <LearnerResourceScope section={section} schoolHref={href(section)}>
        <LearnerRecords schoolId={school.id} notebook={section === "review-notebook"}/></LearnerResourceScope>
        : <LearnerRecords notebook={section === "review-notebook"}/>;
      break;
    case "scholarship":
      content = <StudentScholarshipPage key={wallet} endpoint={wallet} scopeName={scopeName}
        exchangeSchools={(school ? [school] : schools).map(s => ({id:s.id, name:schoolDisplayName(s,locale)}))}/>;
      break;
    case "poker":
      content = !school && <OpenPlatformPoker/>;
      break;
    case "classes":
      content = school && (classId ? <StudentClass id={classId} schoolId={school.id}/> : <StudentClasses schoolId={school.id}/>);
      break;
    case "assignments":
    case "timed":
      content = school && <SchoolActivities school={school} kind={section === "timed" ? "timed" : "assignment"}/>;
      break;
    case "exam-preparation":
      content = school && <PreparationRouter schoolId={school.id} staff={false} rootHref={href(section)} paper4Href={href("paper4")} acslHref={acslEnabled ? href("acsl") : undefined}/>;
      break;
    case "paper4":
      content = school && <SchoolPaper4 schoolId={school.id} role="student" user={user}/>;
      break;
    case "acsl":
      content = school && <AcslPage schoolId={school.id} user={user} baseHref={href(section)}/>;
      break;
    default:
      content = school ? <SchoolStudentDashboard school={school} user={user}/> : <PublicStudyHome user={user}/>;
  }

  const fullscreen = ["problems","courses","assignments","timed"].includes(section) && search.has("problemId") || section==="acsl" && search.get("coding")==="1";
  return <PageHeadingProvider pathname={pathname+"?"+search.toString()}>
    <WorkspaceThemeProvider theme={resolvedPageTheme}>
      <PersonalAppearanceProvider pageTheme={settings.pageTheme} updatePageTheme={pageTheme=>update({pageTheme})}>
        <div className={resolvedPageTheme==="dark" ? "dark" : ""} style={{colorScheme:resolvedPageTheme}}>
          {!fullscreen && <StudentPresenceHeartbeat identityId={user.id} endpoint={school ? "presence" : "practice/presence"}/>}
          {fullscreen ? content : <WorkspaceFrame student schoolName={scopeName}
            workspaceSelector={schools.length > 0 ? <select aria-label={text("Learning workspace","学习工作区")} value={school?.id ?? ""}
              onChange={event=>switchWorkspace(event.target.value)} className="max-w-full rounded-sm bg-transparent text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">
              <option value="">{text("Open Platform","开放平台")}</option>
              {schools.map(s=><option key={s.id} value={s.id}>{schoolDisplayName(s,locale)}</option>)}</select> : undefined}
            breadcrumb={<LearnerBreadcrumb home={href("home")} homeLabel={text("Home","首页")} section={section} label={label}
              parent={section==="classes" && classId ? {href:href("classes"),label} : prep ? {href:href("exam-preparation"),label:text("Exam preparation","备考中心")} : undefined}/>}
            navigation={<WorkspaceNavigation items={navigation.map(item=>({...item,active:item.section===(prep ? "exam-preparation" : section),locked:item.section==="poker" && !(pokerStatus.data?.enabled && pokerStatus.data?.unlocked)}))}/>}
            account={<><ScholarshipBalance identityId={user.id} endpoint={wallet} href={href("scholarship")}/>
              <NotificationDropdown key={school?.id ?? "public"} workspace={school ? "student" : "public"} schoolId={school?.id} scholarshipHref={href("scholarship")}/>
              <AccountMenu user={user} profileHref={href("profile")} settingsHref={href("settings")} leaderboardHref={href("leaderboard")} busy={logout.busy}
                onLogout={()=>void logout.run(async()=>{try {await productionApi("auth/logout",{method:"POST"});} catch(error) {if (!(error instanceof ApiError && error.status===401)) throw error;} onLogout();})}/>
            </>}>
            <Feedback action={logout}/><section key={`${school?.id ?? "public"}:${section}:${resourceId ?? ""}:${classId ?? ""}`} className="min-w-0">{content}</section>
          </WorkspaceFrame>}
        </div>
      </PersonalAppearanceProvider>
    </WorkspaceThemeProvider>
  </PageHeadingProvider>;
}

function LearnerBreadcrumb({home,homeLabel,section,label,parent}:{home:string; homeLabel:string; section:string; label:string; parent?:{href:string;label:string}}) {
  const heading=useCurrentPageHeading();
  const Label = heading?.inContent ? "span" : "h1";
  const text = useSchoolText();
  return <nav aria-label={text("Breadcrumb","面包屑导航")} className="flex min-w-0 items-center gap-2 text-sm">{section!=="home" && <><AppLink href={home} className="text-muted-foreground hover:text-primary">{homeLabel}</AppLink><span aria-hidden="true">›</span></>}
    {parent && <><AppLink className="shrink-0 text-muted-foreground hover:text-primary" href={parent.href}>{parent.label}</AppLink><span aria-hidden="true">›</span></>}
    <Label aria-current="page" className="truncate font-semibold">{heading?.title || label}</Label></nav>;
}

function publicCourseHref(id: string) {
  return `/practice/courses/${encodeURIComponent(id)}`;
}

function PublicStudyHome({ user }: { user: CampusUser }) {
  const text = useSchoolText();
  const schools = useData<{ items: School[] }>("schools");
  const schoolAccessChanged = useSearchParams().get("schoolAccess") === "changed";
  const submissions = useData<{items:{id:string;schoolId:string;problemId:string;problemTitle:string;status:string;score:number|null}[]}>("practice/submissions");
  return <StudentDashboardView heading={text(`Hello, ${user.name}`, `你好，${user.name}`)}
    submissionsState={submissions} submissionsHref="/practice/submissions"
    submissions={(submissions.data?.items ?? []).map(item => ({...item,title:item.problemTitle,
      href:`/practice/submissions?${new URLSearchParams({submissionId:item.id,submissionSchoolId:item.schoolId})}`}))}
    featured={<>
      {schoolAccessChanged && <p role="status" className={panelClass}>{text("Your school workspace is no longer available.", "你的账号已无法进入原学校工作区。")}</p>}
      <div className={`${panelClass} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <AppLink href="/practice/problems" className="font-semibold text-primary">{text("Browse problems","浏览题目")} →</AppLink>
        {schools.data && <AppLink className="text-sm font-semibold text-primary" href={user.platformAdmin ? "/platform" : schools.data.items.length ? "/schools" : "/practice/settings#schools"}>
          {user.platformAdmin ? text("Platform administration","平台管理") : schools.data.items.length ? text("Return to school workspace","返回学校工作区") : text("Join a school with an invitation","通过邀请码加入学校")} →
        </AppLink>}
      </div>
    </>}/>;
}

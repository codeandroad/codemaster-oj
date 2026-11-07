"use client";
import { StudentPresenceHeartbeat } from "./student/student-presence";
import { PlatformPage } from "./schools/platform-page";
import { SchoolsPage } from "./schools/schools-page";
import {ProfileEditor} from "./profile-editor";
import {PointsPage} from "./points-page";
import { AdminLuqPage, StudentLuqPage, LuqBalance } from "./luq/account-pages";
import { TeacherLuqPage } from "./luq/teaching-page";

import { AppLink } from "@/components/navigation";
import { isCampusRoute, resolvePublicLearningBookmark } from "@/lib/campus-routes";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {NotificationDropdown} from "@/components/student/notification-dropdown";
import { AccountMenu } from "@/components/account-menu";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { workspaceNavigation, WorkspaceNavigation } from "@/components/workspace-navigation";
import { schoolDisplayName, type School } from "./schools/school-ui";
import { resolveLoginDestination } from "./auth/login-destination";
import { PersonalRegisterPage } from "./auth/personal-register-page";
import { PracticePage } from "./schools/practice-page";
import { JoinedSchoolSettings } from "./schools/joined-school-settings";
import { readSchoolPreference, writeSchoolPreference } from "./schools/school-selection";
import { PageHeadingProvider } from "@/components/page-heading-context";
import { PageBreadcrumbs, ShellPageHeading } from "@/components/page-breadcrumbs";
import { ProductionLoginPage } from "@/components/auth/login-page";
import { AuthNotice } from "@/components/auth/auth-shell";
import { ProductionRegisterPage } from "@/components/auth/register-page";
import { AdminAccountsPage, AdminPeoplePage } from "@/components/admin/accounts-people";
import { AdminDashboard } from "@/components/admin/dashboard";
import { legacyCourseAdmissionsHref, legacyCourseAdmissionsSchoolId, SchoolCourseAdmissions } from "@/components/schools/school-course-admissions";
import { AdminImportPage } from "@/components/admin/import-page";
import { AdminProblemBanks } from "@/components/admin/problem-banks";
import { AdminJudgePage, AdminSettingsPage } from "@/components/admin/system-pages";
import { Feedback, panelClass as panel, useData as useResource, useMutation as useAction } from "@/components/admin/common";
import { StudentPages, AlignedProfile } from "@/components/student/pages";
import { StudentPublicProfile } from "@/components/student/public-profile";
import {useWorkspaceSettings} from "@/components/student/workspace-settings";
import {WorkspaceThemeProvider} from "@/components/ui/theme-context";
import {PersonalAppearanceProvider, PersonalAppearanceSettings} from "@/components/personal-appearance-settings";
import {useLocale} from "@/components/locale-context";
import { TeacherPages } from "@/components/teacher/teacher-pages";
import { ApiError, apiMessage, clearProductionSession, productionApi, roleHome, type AuthResponse, type CampusRole, type CampusUser } from "@/lib/production-api";

export function ProductionApp() {
  const { locale } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<CampusUser | null>(null);
  const joinIntent = search.get("join") === "1";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [check, setCheck] = useState(0);
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    productionApi<AuthResponse>("auth/me", { signal: controller.signal })
      .then((response) => {
        setUser(response.user);
        setError("");
      })
      .catch((reason) => {
        if (!controller.signal.aborted && !(reason instanceof ApiError && reason.status === 401))
          setError(apiMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [check]);
  const signedInAccount = user?.id;
  useEffect(() => {
    if (!signedInAccount) return;
    let controller: AbortController | undefined;
    function refreshAccount() {
      if (controller) return;
      const request = new AbortController();
      controller = request;
      void productionApi<AuthResponse>("auth/me", { signal: request.signal })
        .then(({ user: latest }) => {
          if (!request.signal.aborted) setUser(current => current?.id === signedInAccount ? latest : current);
        })
        .catch(() => undefined)
        .finally(() => { controller = undefined; });
    }
    window.addEventListener("focus", refreshAccount);
    window.addEventListener("codemaster:schools-changed", refreshAccount);
    window.addEventListener("codemaster:school-access-check", refreshAccount);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", refreshAccount);
      window.removeEventListener("codemaster:schools-changed", refreshAccount);
      window.removeEventListener("codemaster:school-access-check", refreshAccount);
    };
  }, [signedInAccount]);

  const loggedIn = (next: CampusUser) => {
    setUser(next);
    const openWorkspace = (schools: School[]) => {
      const target = resolveLoginDestination({user: next, schools, preferredSchoolId: readSchoolPreference(next.id), joinIntent});
      if (target.schoolId) writeSchoolPreference(next.id, target.schoolId);
      router.replace(target.href);
    };
    if (next.platformAdmin) { openWorkspace([]); return; }
    void productionApi<{items:School[]}>("schools").then(result => openWorkspace(result.items))
      .catch(() => router.replace(roleHome(next)));
  };
  if (!isCampusRoute(pathname)) return null;
  const authPage = pathname === "/login" || pathname === "/register" || pathname === "/activate";
  if (loading && authPage) return <AuthNotice title={locale === "en" ? pathname === "/register" ? "Create account" : "Sign in" : pathname === "/register" ? "注册账号" : "登录"} message={locale === "en" ? "Connecting to CodeMaster…" : "正在连接 CodeMaster…"} />;
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <p role="status">{locale === "en" ? "Connecting to CodeMaster…" : "正在连接 CodeMaster…"}</p>
      </main>
    );
  if (error && authPage) return <AuthNotice error title={locale === "en" ? "Unable to connect" : "暂时无法连接服务"} message={error}><Button className="mt-5 w-fit" onClick={() => { setLoading(true); setError(""); setCheck(value => value + 1); }}>{locale === "en" ? "Retry" : "重试"}</Button></AuthNotice>;
  if (error)
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-bold">暂时无法连接服务</h1>
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
        <Button
          className="mt-5"
          onClick={() => {
            setLoading(true);
            setError("");
            setCheck((value) => value + 1);
          }}
        >
          重试
        </Button>
      </main>
    );
  if (pathname === "/activate") return <ProductionRegisterPage />;
  if (pathname === "/register") return <PersonalRegisterPage onRegistered={loggedIn} joinIntent={joinIntent}/>;
  if (!user) return <ProductionLoginPage onLogin={loggedIn} joinIntent={joinIntent} />;
  if (pathname === "/login") return <ProductionLoginPage onLogin={loggedIn} joinIntent={joinIntent} />;
  if (pathname === "/platform") return <PlatformPage key={user.id} user={user} onUserSaved={setUser} onLogout={() => {
    setUser(null);
    clearProductionSession();
    router.replace("/login");
  }} />;
  if (pathname === "/schools") return <SchoolsPage key={user.id} user={user} onUserSaved={setUser} onLogout={() => {
    setUser(null);
    clearProductionSession();
    router.replace("/login");
  }} />;
  if (!user.roles.length && (pathname === "/" || pathname.startsWith("/student/"))) {
    const publicBookmark = resolvePublicLearningBookmark(pathname, search);
    return <LearnerWorkspaceRedirect href={publicBookmark ?? (user.platformAdmin ? "/platform" : "/schools")}/>;
  }
  if (pathname.startsWith("/practice")) return <PracticePage user={user} pathname={pathname} onUserSaved={setUser} onLogout={() => { setUser(null); clearProductionSession(); router.replace("/login"); }}/>;
  const requestedRole: CampusRole = pathname.startsWith("/admin")
    ? "admin"
    : pathname.startsWith("/teacher")
      ? "teacher"
      : "student";
  const role =
    pathname === "/" && !user.roles.includes("student")
      ? user.roles.includes("admin")
        ? "admin"
        : "teacher"
      : requestedRole;
  const allowed = user.roles.includes(role) || (role === "teacher" && user.roles.includes("admin"));
  return <>
    {user.roles.includes("student") && <StudentPresenceHeartbeat identityId={user.identityId}/>}
    {allowed && (/^\/student\/problems\/[^/]+$/.test(pathname) || /^\/student\/paper4\/[^/]+$/.test(pathname)) ? <StudentPages pathname={pathname} user={user}/> :
    <ProductionShell
      user={user}
      role={role}
      pathname={pathname}
      onLogout={() => {
        setUser(null);
        clearProductionSession();
        router.replace("/login");
      }}
    >
      {allowed ? (
        <ProductionView key={viewKey(pathname)} pathname={pathname} role={role} user={user} profileVersion={profileVersion} onProfileSaved={(next) => { setUser(next); setProfileVersion(value => value + 1); }} />
      ) : (
        <div className={panel}>
          <h1 className="text-xl font-bold">没有访问权限</h1>
          <p className="mt-3 text-sm text-muted-foreground">你的学校账号没有此页面需要的角色。</p>
          <AppLink href={roleHome(user)} className={`${buttonVariants()} mt-5`}>
            返回工作台
          </AppLink>
        </div>
      )}
    </ProductionShell>}
  </>;
}

function LearnerWorkspaceRedirect({ href }: { href: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <p role="status" className="p-6 text-sm text-muted-foreground">
    {locale === "en" ? "Opening your learning workspace…" : "正在进入学习工作区…"}
  </p>;
}

function viewKey(pathname: string) {
  // Keep a course mounted while only its selected chapter changes.
  return pathname.replace(/^(\/student\/learning-paths\/[^/]+)\/chapters\/[^/]+$/, "$1");
}

function ProductionShell({
  user,
  role,
  pathname,
  onLogout,
  children,
}: {
  user: CampusUser;
  role: CampusRole;
  pathname: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const {locale,t}=useLocale();
  const {settings,update,resolvedPageTheme}=useWorkspaceSettings(user.id);
  const shellTheme=resolvedPageTheme;
  const schoolList = useResource<{items:School[]}>("schools");
  useEffect(() => {
    window.addEventListener("codemaster:schools-changed", schoolList.reload);
    return () => window.removeEventListener("codemaster:schools-changed", schoolList.reload);
  }, [schoolList.reload]);
  const school = schoolList.data?.items.find(item => item.legacy);
  useEffect(() => { if (school) writeSchoolPreference(user.id, school.id); }, [school, user.id]);
  const action = useAction();
  const activePath = (path: string) =>
    ["/", "/teacher", "/admin"].includes(path)
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
  const links = <WorkspaceNavigation items={workspaceNavigation[role].map((item) => ({ ...item, href: item.path, active: activePath(item.path) }))}/>;
  return <PageHeadingProvider pathname={pathname}><WorkspaceThemeProvider theme={shellTheme}><PersonalAppearanceProvider pageTheme={settings.pageTheme} updatePageTheme={pageTheme=>update({pageTheme})}><div style={{colorScheme:shellTheme}} className={shellTheme === "dark" ? "dark" : ""}>
    <WorkspaceFrame student={role === "student"} schoolName={school ? schoolDisplayName(school, locale) : t("校内学习平台")} navigation={links}
      breadcrumb={<div className="flex min-w-0 items-center"><PageBreadcrumbs pathname={pathname} role={role}/><ShellPageHeading pathname={pathname} role={role}/></div>}
      account={<>{role === "student" && <LuqBalance identityId={user.identityId}/>}<NotificationDropdown key={`${user.id}:${role}`} workspace={role === "student" ? "student" : "staff"}/><AccountMenu user={user} role={role} busy={action.busy} onLogout={() => action.run(async () => {
        try { await productionApi("auth/logout", {method:"POST"}); } catch(reason) { if (!(reason instanceof ApiError && reason.status === 401)) throw reason; } onLogout();
      })}/></>}>
      <Feedback action={action}/>{children}
    </WorkspaceFrame>
  </div></PersonalAppearanceProvider></WorkspaceThemeProvider></PageHeadingProvider>;
}


function ProductionView({pathname,role,user,profileVersion,onProfileSaved}:{pathname:string;role:CampusRole;user:CampusUser;profileVersion:number;onProfileSaved:(next:CampusUser)=>void}) {
  if (pathname === "/student/luq") return <StudentLuqPage/>;
  if (pathname === "/teacher/luq") return <TeacherLuqPage/>;
  if (pathname === "/admin/luq") return <AdminLuqPage/>;
  if(pathname.endsWith("/points"))return <PointsPage user={user} student={role==="student"} workspace={role}/>;
  if(/^\/(student|teacher|admin)\/people\/[^/]+$/.test(pathname))return <StudentPublicProfile identityId={pathname.split("/")[3]} viewer={user} workspace={role}/>;
  if(pathname==="/student/profile")return <><ProfileEditor user={user} onSaved={onProfileSaved}/><StudentPublicProfile key={profileVersion} identityId={user.identityId} viewer={user} embedded/></>;
  if(pathname.endsWith("/profile"))return <ProfileEditor user={user} onSaved={onProfileSaved}/>;
  if(pathname==="/student/settings"||pathname==="/teacher/settings"||pathname==="/admin/personal-settings")return <><AlignedProfile user={user} teacher={role==="teacher"} admin={role==="admin"}/><PersonalAppearanceSettings/><JoinedSchoolSettings user={user}/></>;
  if (role==="student") return <StudentPages pathname={pathname} user={user}/>;
  if (pathname==="/teacher/profile") return <AlignedProfile user={user} teacher/>;
  if (role==="teacher") return <TeacherPages pathname={pathname} user={user}/>;
  if (pathname==="/admin" || pathname==="/") return <AdminDashboard/>;
  if (pathname==="/admin/accounts") return <AdminAccountsPage currentAccountId={user.id}/>;
  if (pathname==="/admin/people") return <AdminPeoplePage/>;
  if (pathname==="/admin/imports") return <AdminImportPage/>;
  if (pathname==="/admin/problem-banks") return <AdminProblemBanks/>;
  if (pathname==="/admin/judge-service") return <AdminJudgePage/>;
  if (pathname==="/admin/settings") return <AdminSettingsPage/>;
  if (pathname===legacyCourseAdmissionsHref) return <SchoolCourseAdmissions schoolId={legacyCourseAdmissionsSchoolId} href={legacyCourseAdmissionsHref} coursesHref="/teacher/courses"/>;
  return <div className={`${panel} p-5`}><h1 className="text-xl font-bold">页面不存在</h1><AppLink href={roleHome(user)} className={`${buttonVariants()} mt-4`}>返回工作台</AppLink></div>;
}

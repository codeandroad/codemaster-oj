"use client";
import {ProfileEditor} from "./profile-editor";
import {PointsPage} from "./points-page";

import { AppLink } from "@/components/navigation";
import { isCampusRoute } from "@/lib/campus-routes";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BookOpen, BookOpenCheck, ClipboardList, Clock3, Code2, Database, FileClock, Gauge, Home, LayoutDashboard, Library, Menu, NotebookPen, Settings, Users, UserRound, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {NotificationDropdown} from "@/components/student/notification-dropdown";
import { AccountMenu } from "@/components/account-menu";
import { BrandLogo } from "@/components/brand-logo";
import { PageHeader } from "@/components/page-chrome";
import { ProductionLoginPage } from "@/components/auth/login-page";
import { ProductionRegisterPage } from "@/components/auth/register-page";
import { AdminAccountsPage, AdminPeoplePage } from "@/components/admin/accounts-people";
import { AdminImportPage } from "@/components/admin/import-page";
import { AdminProblemBanks } from "@/components/admin/problem-banks";
import { AdminJudgePage, AdminSettingsPage } from "@/components/admin/system-pages";
import { Feedback, Loading, panelClass as panel, useData as useResource, useMutation as useAction } from "@/components/admin/common";
import { StudentPages, AlignedProfile } from "@/components/student/pages";
import { StudentPublicProfile } from "@/components/student/public-profile";
import {useWorkspaceSettings} from "@/components/student/workspace-settings";
import {WorkspaceThemeProvider} from "@/components/ui/theme-context";
import {PersonalAppearanceProvider, PersonalAppearanceSettings} from "@/components/personal-appearance-settings";
import {useLocale} from "@/components/locale-context";
import { TeacherPages } from "@/components/teacher/teacher-pages";
import { ApiError, apiMessage, clearProductionSession, productionApi, roleHome, type AuthResponse, type CampusRole, type CampusUser, type Person, type SchoolClass } from "@/lib/production-api";

export function ProductionApp() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CampusUser | null>(null);
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
  const loggedIn = (next: CampusUser) => {
    setUser(next);
    router.replace(roleHome(next));
  };
  if (!isCampusRoute(pathname)) return null;
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <p role="status">正在连接校内服务…</p>
      </main>
    );
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
  if (pathname === "/register") return <ProductionRegisterPage />;
  if (!user) return <ProductionLoginPage onLogin={loggedIn} />;
  if (pathname === "/login") return <ProductionLoginPage onLogin={loggedIn} />;
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
  return (
    allowed && /^\/student\/problems\/[^/]+$/.test(pathname) ? <StudentPages pathname={pathname} user={user}/> :
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
    </ProductionShell>
  );
}

function viewKey(pathname: string) {
  // Keep a course mounted while only its selected chapter changes.
  return pathname.replace(/^(\/student\/learning-paths\/[^/]+)\/chapters\/[^/]+$/, "$1");
}

const navigation: Record<CampusRole, { label: string; path: string; icon: typeof Home }[]> = {
  student: [
    { label: "首页", path: "/", icon: Home },
    { label: "题目", path: "/student/problems", icon: Code2 },
    { label: "课程", path: "/student/learning-paths", icon: BookOpen },
    { label: "作业", path: "/student/assignments", icon: Library },
    { label: "限时训练", path: "/student/timed-practice", icon: FileClock },
    { label: "提交记录", path: "/student/submissions", icon: FileClock },
    { label: "订正本", path: "/student/review-notebook", icon: NotebookPen },
  ],
  teacher: [
    { label: "教师首页", path: "/teacher", icon: LayoutDashboard },
    { label: "班级与学生", path: "/teacher/classes", icon: Users },
    { label: "题库", path: "/teacher/problems", icon: BookOpenCheck },
    { label: "课程", path: "/teacher/courses", icon: BookOpen },
    { label: "作业管理", path: "/teacher/assignments", icon: ClipboardList },
    { label: "限时训练", path: "/teacher/timed-practice", icon: Clock3 },
    { label: "教学报告", path: "/teacher/reports", icon: BarChart3 },
    { label: "导入中心", path: "/teacher/imports", icon: Database },
  ],
  admin: [
    { label: "管理员首页", path: "/admin", icon: Home },
    { label: "账号与角色", path: "/admin/accounts", icon: Users },
    { label: "身份档案", path: "/admin/people", icon: UserRound },
    { label: "导入中心", path: "/admin/imports", icon: Database },
    { label: "题库管理", path: "/admin/problem-banks", icon: BookOpenCheck },
    { label: "判题服务", path: "/admin/judge-service", icon: Gauge },
    { label: "系统设置", path: "/admin/settings", icon: Settings },
  ],
};
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
  const [open, setOpen] = useState(false);
  const {locale,t}=useLocale();
  const {settings,update,resolvedPageTheme}=useWorkspaceSettings(user.id);
  const shellTheme=resolvedPageTheme;
  const site = useResource<{siteName:string;schoolName:string}>("site-info");
  const action = useAction();
  const activePath = (path: string) =>
    ["/", "/teacher", "/admin"].includes(path)
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
  const links = (
    <nav className="space-y-1 p-3" aria-label={t("工作区导航")}>
      {navigation[role].map((item) =>
        item.path ? (
          <AppLink
            key={item.label}
            href={item.path}
            onNavigate={() => setOpen(false)}
            aria-current={activePath(item.path) ? "page" : undefined}
            className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm ${activePath(item.path) ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <item.icon size={17} />
            <span className="min-w-0 truncate" title={t(item.label)}>{t(item.label)}</span>
          </AppLink>
        ) : (
          <div
            key={item.label}
            aria-disabled="true"
            title={t("后续版本")}
            className="flex min-h-11 items-center gap-3 px-3 text-sm text-muted-foreground/60"
          >
            <item.icon size={17} />
            <span>{t(item.label)}</span>
            <span className="ml-auto text-[10px]">{t("后续版本")}</span>
          </div>
        ),
      )}
    </nav>
  );
  return (
    <WorkspaceThemeProvider theme={shellTheme}><PersonalAppearanceProvider pageTheme={settings.pageTheme} updatePageTheme={pageTheme=>update({pageTheme})}><div data-od-id="production-shell" style={{colorScheme:shellTheme}} className={`production-shell min-h-screen bg-background text-foreground ${shellTheme==="dark"?"dark":""}`}>
      <div className={`grid min-h-screen ${role==="student"?"md:grid-cols-[224px_minmax(0,1fr)]":"md:grid-cols-[236px_minmax(0,1fr)]"}`}>
        <aside className="production-sidebar hidden flex-col border-r border-border bg-surface md:flex">
          <div className="flex h-16 flex-col justify-center border-b border-border px-4">
            <BrandLogo className="h-auto w-[170px] max-w-full" />
            <p className="mt-1 truncate text-[10px] text-muted-foreground">{role==="admin"?t("本地管理"):role==="teacher"?t("教学工具"):site.data?.schoolName??t("校内学习平台")}</p>
          </div>
          {links}

        </aside>
        <div className="min-w-0">
          <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t("打开导航")}
                aria-expanded={open}
                onClick={() => setOpen(true)}
              >
                <Menu size={18} />
              </Button>
              <BrandLogo className="h-auto w-[130px] max-w-full md:hidden" />
              <HeaderDate locale={locale}/>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {role==="student"&&<NotificationDropdown/>}
              <AccountMenu user={user} role={role} busy={action.busy} onLogout={() => action.run(async () => {
                try { await productionApi("auth/logout", {method:"POST"}); }
                catch(reason) { if (!(reason instanceof ApiError && reason.status===401)) throw reason; }
                onLogout();
              })}/>
            </div>
          </header>
          <div className="px-4">
            <Feedback action={action} />
          </div>
          <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">{children}</main>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-foreground/30 md:hidden">
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t("工作区导航")}
            className="h-full w-[min(85vw,300px)] overflow-auto bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <BrandLogo className="h-auto w-[185px] max-w-full" />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("关闭导航")}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            {links}
          </aside>
        </div>
      )}
    </div></PersonalAppearanceProvider></WorkspaceThemeProvider>
  );
}

function HeaderDate({locale}:{locale:"zh"|"en"}) {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(new Date()),30_000);
    return ()=>window.clearInterval(timer);
  },[]);
  const parts=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",weekday:"long"}).formatToParts(now);
  const part=(type:string)=>parts.find(value=>value.type===type)?.value??"";
  const iso=`${part("year")}-${part("month")}-${part("day")}`;
  const label=locale==="zh"?`${iso} ${part("weekday").replace("星期","周")}`:new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",dateStyle:"full"}).format(now);
  return <time dateTime={iso} suppressHydrationWarning className="min-w-0 truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</time>;
}

function ProductionView({pathname,role,user,profileVersion,onProfileSaved}:{pathname:string;role:CampusRole;user:CampusUser;profileVersion:number;onProfileSaved:(next:CampusUser)=>void}) {
  if(pathname.endsWith("/points"))return <PointsPage user={user} student={role==="student"} workspace={role}/>;
  if(/^\/(student|teacher|admin)\/people\/[^/]+$/.test(pathname))return <StudentPublicProfile identityId={pathname.split("/")[3]} viewer={user} workspace={role}/>;
  if(pathname==="/student/profile")return <><ProfileEditor user={user} onSaved={onProfileSaved}/><StudentPublicProfile key={profileVersion} identityId={user.identityId} viewer={user} embedded/></>;
  if(pathname.endsWith("/profile"))return <ProfileEditor user={user} onSaved={onProfileSaved}/>;
  if(pathname==="/student/settings"||pathname==="/teacher/settings"||pathname==="/admin/personal-settings")return <><AlignedProfile user={user} teacher={role==="teacher"} admin={role==="admin"}/><PersonalAppearanceSettings/></>;
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
  return <div className={`${panel} p-5`}><h1 className="text-xl font-bold">页面不存在</h1><AppLink href={roleHome(user)} className={`${buttonVariants()} mt-4`}>返回工作台</AppLink></div>;
}

function AdminDashboard() {
  const {t}=useLocale();
  const people=useResource<{items:Person[]}>("people"),classes=useResource<{items:SchoolClass[]}>("classes");
  return <><PageHeader eyebrow={t("管理员首页")} title={t("管理工作台")} description={t("维护学校身份与账号，查看导入、判题服务和系统设置。")}/><div className="mt-5 grid gap-4 sm:grid-cols-3">{navigation.admin.slice(1,4).map(item=><AppLink key={item.path} href={item.path} className={`${panel} flex items-center gap-4 p-5 hover:border-primary`}><item.icon className="text-primary"/><span className="font-bold">{t(item.label)}</span></AppLink>)}</div><div className="mt-6 grid gap-4 md:grid-cols-2"><section className={panel}><div className="flex justify-between border-b border-border p-4"><h2 className="font-bold">{t("身份档案")}</h2><AppLink href="/admin/people" className="text-sm font-semibold text-primary">{t("查看全部")}</AppLink></div><Loading resource={people}><div className="divide-y divide-border">{people.data?.items.slice(0,8).map(p=><div key={p.id} className="flex justify-between gap-3 p-4 text-sm"><AppLink href={`/admin/people?personId=${encodeURIComponent(p.id)}`} className="font-semibold text-primary hover:underline focus-visible:underline">{p.name}</AppLink><span className="font-mono text-xs text-muted-foreground">{p.number}</span></div>)}{!people.data?.items.length&&<p className="p-5 text-sm text-muted-foreground">{t("暂无身份，请先建立档案或导入名单。")}</p>}</div></Loading></section><section className={panel}><div className="border-b border-border p-4"><h2 className="font-bold">{t("学校班级")}</h2></div><Loading resource={classes}><div className="divide-y divide-border">{classes.data?.items.map(c=><div key={c.id} className="flex justify-between gap-3 p-4 text-sm"><AppLink href={`/admin/people?classId=${encodeURIComponent(c.id)}`} className="font-semibold text-primary hover:underline focus-visible:underline">{c.name}</AppLink><span className="text-muted-foreground">{c.studentIds.length} 位学生</span></div>)}{!classes.data?.items.length&&<p className="p-5 text-sm text-muted-foreground">{t("暂无班级，可在教学工作区建立。")}</p>}</div></Loading></section></div></>;
}

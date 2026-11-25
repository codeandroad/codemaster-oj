"use client";
import dynamic from "next/dynamic";

import { WorkspaceDataProvider } from "./workspace-data";
import { CourseLanguageProvider } from "./course-language";

import { isCampusAuthRoute, isCampusRoute, loginReturnTo, resolvePublicLearningBookmark } from "@/lib/campus-routes";

import { useEffect, useState } from "react";
import { redirect, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

import { schoolBookmarkQuery } from "./schools/school-workspace-location";
import { type School } from "./schools/school-ui";
import { resolveLoginDestination } from "./auth/login-destination";
import { readSchoolPreference, writeSchoolPreference } from "./schools/school-selection";

import { AuthConnectionNotice } from "@/components/auth/auth-shell";

import { AppLocaleProvider, HomeLocaleProvider, useLocale } from "@/components/locale-context";
import { ApiError, apiMessage, apiRequestTimeoutMs, clearProductionSession, productionApi, productionSessionExpiredEvent, roleHome, type AuthResponse, type CampusUser } from "@/lib/production-api";

// Keep unrelated workspaces and editors out of the authentication/catalog bundle.

const PlatformPage = dynamic(() => import("./schools/platform-page").then(module => module.PlatformPage), { loading: PageLoading });
const SchoolsPage = dynamic(() => import("./schools/schools-page").then(module => module.SchoolsPage), { loading: PageLoading });

const PersonalRegisterPage = dynamic(() => import("./auth/personal-register-page").then(module => module.PersonalRegisterPage), { loading: PageLoading });
const LearnerWorkspace = dynamic(() => import("./schools/learner-workspace").then(module => module.LearnerWorkspace), { loading: PageLoading });

const ProductionLoginPage = dynamic(() => import("@/components/auth/login-page").then(module => module.ProductionLoginPage), { loading: PageLoading });

function PageLoading() {
  const { locale } = useLocale();
  return <p role="status" className="p-5 text-sm text-muted-foreground">{locale === "en" ? "Loading…" : "正在加载…"}</p>;
}

export function ProductionApp() {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<CampusUser | null>(null);
  const joinIntent = search.get("join") === "1";
  const resetIntent = pathname === "/login" && search.get("reset") === "1";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    productionApi<AuthResponse>("auth/me", { signal: controller.signal, timeoutMs: apiRequestTimeoutMs })
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
  useEffect(() => {
    if (!error && !loading) return;
    const recover = () => { setLoading(true); setError(""); setCheck(value => value + 1); };
    window.addEventListener("online", recover);
    return () => window.removeEventListener("online", recover);
  }, [error, loading]);
  const signedInAccount = user?.id;
  useEffect(() => {
    if (!signedInAccount) return;
    let controller: AbortController | undefined;
    function expireSession() {
      const { pathname, search, hash } = window.location;
      const returnTo = loginReturnTo(`${pathname}${search}${hash}`);
      clearProductionSession();
      setUser(null);
      if (returnTo) router.replace(`/login?${new URLSearchParams({ returnTo })}`);
    }
    function refreshAccount() {
      if (controller || navigator.onLine === false) return;
      const request = new AbortController();
      controller = request;
      void productionApi<AuthResponse>("auth/me", { signal: request.signal, timeoutMs: apiRequestTimeoutMs })
        .then(({ user: latest }) => {
          if (!request.signal.aborted) setUser(current => current?.id === signedInAccount ? latest : current);
        })
        .catch(() => undefined)
        .finally(() => { if (controller === request) controller = undefined; });
    }
    window.addEventListener("focus", refreshAccount);
    window.addEventListener("online", refreshAccount);
    window.addEventListener("codemaster:schools-changed", refreshAccount);
    window.addEventListener("codemaster:school-access-check", refreshAccount);
    window.addEventListener(productionSessionExpiredEvent, expireSession);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", refreshAccount);
      window.removeEventListener("online", refreshAccount);
      window.removeEventListener("codemaster:schools-changed", refreshAccount);
      window.removeEventListener("codemaster:school-access-check", refreshAccount);
      window.removeEventListener(productionSessionExpiredEvent, expireSession);
    };
  }, [router, signedInAccount]);

  const loggedIn = (next: CampusUser) => {
    setUser(next);
    const returnTo = pathname === "/login" ? loginReturnTo(search.get("returnTo")) : null;
    if (returnTo) {
      router.replace(returnTo);
      return;
    }
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
  const authPage = pathname === "/" || isCampusAuthRoute(pathname);
  const retryConnection = () => { setLoading(true); setError(""); setCheck(value => value + 1); };
  if (authPage && (loading || error)) {
    const notice = <AuthConnectionNotice register={pathname === "/register"} error={loading ? "" : error} onRetry={retryConnection} />;
    return <HomeLocaleProvider>{notice}</HomeLocaleProvider>;
  }
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <p role="status">Connecting to CodeMaster…</p>
      </main>
    );
  if (error)
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-bold">无法连接服务</h1>
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={retryConnection}>重试</Button>
          <Button type="button" variant="secondary" onClick={() => window.location.reload()}>刷新整个页面</Button>
        </div>
      </main>
    );
  if (pathname === "/activate") redirect(user ? "/schools?join=1" : "/login?join=1");
  if (pathname === "/register") return <HomeLocaleProvider><PersonalRegisterPage onRegistered={loggedIn} joinIntent={joinIntent}/></HomeLocaleProvider>;
  if (!user || pathname === "/login") {
    const login = <ProductionLoginPage key={resetIntent ? "reset" : "login"} onLogin={loggedIn} joinIntent={joinIntent} resetIntent={resetIntent} />;
    return <HomeLocaleProvider>{login}</HomeLocaleProvider>;
  }
  const logout = () => {
    setUser(null);
    clearProductionSession();
    router.replace("/login");
  };
  return <AppLocaleProvider key={user.id} accountId={user.id}><CourseLanguageProvider key={user.id} accountId={user.id}><WorkspaceDataProvider key={`${user.id}:${user.identityId}:${user.roles.join(",")}`}>
    <AuthenticatedWorkspace user={user} pathname={pathname} search={search}
      onUserSaved={setUser} onLogout={logout}/>
  </WorkspaceDataProvider></CourseLanguageProvider></AppLocaleProvider>;
}

function AuthenticatedWorkspace({user,pathname,search,onUserSaved,onLogout}: {
  user: CampusUser; pathname: string; search: URLSearchParams;
  onUserSaved: (user: CampusUser) => void; onLogout: () => void;
}) {
  if (pathname === "/platform") return <PlatformPage user={user} onUserSaved={onUserSaved} onLogout={onLogout} />;
  if (pathname === "/schools") return <SchoolsPage user={user} onUserSaved={onUserSaved} onLogout={onLogout} />;
  if (pathname.startsWith("/practice")) return <LearnerWorkspace user={user} pathname={pathname} onUserSaved={onUserSaved} onLogout={onLogout}/>;
  {
    const publicBookmark = resolvePublicLearningBookmark(pathname, search);
    const schoolId = search.get("schoolId") ?? user.defaultSchoolId ?? user.teachingSchoolId;
    const [, scope, , resourceId] = pathname.split("/");
    const query = schoolBookmarkQuery(pathname,search,schoolId);
    const target = query.get("section")!;
    if (schoolId && resourceId && scope === "student" && (target === "problems" || target === "courses")) {
      return <ResourceBookmark schoolId={schoolId} id={resourceId} section={target} query={query.toString()}/>;
    }
    return <LearnerWorkspaceRedirect href={publicBookmark ?? (schoolId ? `/schools?${query}` : user.platformAdmin ? "/platform" : "/practice")}/>;
  }
}

function LearnerWorkspaceRedirect({ href }: { href: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <p role="status" className="p-6 text-sm text-muted-foreground">
    {locale === "en" ? "Opening your learning workspace…" : "正在进入学习工作区…"}
  </p>;
}

function ResourceBookmark({ schoolId,id,section,query }: {schoolId:string;id:string;section:string;query:string}) {
  const router=useRouter();
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams(query);
    productionApi<{scope?:string;id:string;chapterId?:string}>(`schools/${encodeURIComponent(schoolId)}/${section}/${encodeURIComponent(id)}${section==="courses"?"/bookmark":""}`,{signal:controller.signal})
      .then(resource=>{
        if(section==="courses"){
          params.set("courseId",resource.id);
          if(resource.chapterId&&!params.has("chapterId"))params.set("chapterId",resource.chapterId);
          if(resource.scope==="platform"){
            params.set("scope","public"); params.set("publicCourseId",resource.id); params.delete("courseId");
            router.replace(`/schools?${params}`);
            return;
          }
        }
        if (section === "problems") params.set("scope","school");
        router.replace(`/schools?${params}`);
      })
      .catch(error=>{
        if(controller.signal.aborted)return;
        if(!(error instanceof ApiError && error.status===404)){router.replace(`/schools?${params}`);return;}
        params.set("scope","public");
        if (section==="courses") {params.set("publicCourseId",id); params.delete("courseId");}
        router.replace(`/schools?${params}`);
      });
    return ()=>controller.abort();
  },[schoolId,id,section,query,router]);
  return <PageLoading/>;
}

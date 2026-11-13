"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
import { publicStudyNavigation, useWorkspaceNavigationLabel, WorkspaceNavigation } from "@/components/workspace-navigation";
import { ApiError, productionApi, type CampusUser } from "@/lib/production-api";
import { PersonalWorkspaceProfile } from "./personal-workspace-profile";
import { PersonalWorkspaceSettings } from "./personal-workspace-settings";
import { PublicCourseCatalog, PublicCoursePage } from "./public-course-catalog";
import { PublicPracticeLeaderboard } from "./public-practice-leaderboard";
import { PublicPracticePreferences } from "./public-practice-preferences";
import { PublicReviewNotebook, PublicSubmissions } from "./public-study-records";
import { PublicPractice } from "./school-practice";
import { useSchoolText, type School } from "./school-ui";

export function PracticePage({ user, pathname, onLogout, onUserSaved }: {
  user: CampusUser;
  pathname: string;
  onLogout: () => void;
  onUserSaved: (user: CampusUser) => void;
}) {
  const text = useSchoolText();
  const search = useSearchParams();
  const navLabel = useWorkspaceNavigationLabel();
  const { settings, update, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const logout = useMutation();
  const [, , route, courseId] = pathname.split("/");
  const section = route || "home";
  const item = publicStudyNavigation.find(item => item.section === section);
  const label = section === "settings" ? text("Personal settings", "个人设置")
    : section === "profile" ? text("Profile", "个人资料")
      : section === "people" ? text("Public profile", "公开主页")
      : section === "leaderboard" ? text("Leaderboard", "公开练习榜")
        : item ? navLabel(item) : text("Public learning", "公开学习");

  useEffect(() => { document.title = `${label} · CodeMaster`; }, [label]);

  let content;
  switch (section) {
    case "settings":
      content = <div className="space-y-4">
        <PublicPracticePreferences key={user.id}/>
        <PersonalWorkspaceSettings user={user} onUserSaved={onUserSaved}/>
      </div>;
      break;
    case "profile":
      content = <>
        <PersonalWorkspaceProfile user={user} onUserSaved={onUserSaved} publicPractice/>
        <StudentPublicProfile profileId={user.id} viewer={user} workspace="practice" embedded/>
      </>;
      break;
    case "people":
      content = <StudentPublicProfile key={courseId} profileId={courseId} viewer={user} workspace="practice"/>;
      break;
    case "problems":
      content = <PublicPractice accountId={user.id}/>;
      break;
    case "courses":
      content = courseId ? <PublicCoursePage key={courseId} id={courseId} homeHref="/practice/courses"/> : <PublicCourseCatalog courseHref={publicCourseHref}/>;
      break;
    case "submissions":
      content = <PublicSubmissions/>;
      break;
    case "review-notebook":
      content = <PublicReviewNotebook/>;
      break;
    case "leaderboard":
      content = <PublicPracticeLeaderboard/>;
      break;
    case "scholarship":
      content = <StudentScholarshipPage endpoint="practice/scholarship/me"/>;
      break;
    default:
      content = <PublicStudyHome user={user}/>;
  }

  return (
    <WorkspaceThemeProvider theme={resolvedPageTheme}>
      <PersonalAppearanceProvider pageTheme={settings.pageTheme} updatePageTheme={pageTheme => update({ pageTheme })}>
        <div className={resolvedPageTheme === "dark" ? "dark" : ""} style={{ colorScheme: resolvedPageTheme }}>
          {!(section === "problems" && search.get("problemId")) && <StudentPresenceHeartbeat identityId={user.id} endpoint="practice/presence"/>}
          {section === "problems" && search.get("problemId") ? content : <WorkspaceFrame
            student
            schoolName={text("Public learning", "公开学习")}
            breadcrumb={<div className="flex items-center gap-2 text-sm">
              {section !== "home" && <>
                <AppLink href="/practice" className="text-muted-foreground hover:text-primary">{text("Home", "首页")}</AppLink>
                <span aria-hidden="true">›</span>
              </>}
              <h1 className="truncate font-semibold">{label}</h1>
            </div>}
            navigation={<WorkspaceNavigation items={publicStudyNavigation.map(item => ({
              ...item, href: item.path, active: section === item.section,
            }))}/>}
            account={<>
              <ScholarshipBalance identityId={user.id} endpoint="practice/scholarship/me" href="/practice/scholarship"/>
              <NotificationDropdown key={user.id} workspace="public"/>
              <AccountMenu user={user} busy={logout.busy} leaderboardHref="/practice/leaderboard" onLogout={() => void logout.run(async () => {
                try {
                  await productionApi("auth/logout", { method: "POST" });
                } catch (error) {
                  if (!(error instanceof ApiError && error.status === 401)) throw error;
                }
                onLogout();
              })}/>
            </>}
          >
            <Feedback action={logout}/>
            {content}
          </WorkspaceFrame>}
        </div>
      </PersonalAppearanceProvider>
    </WorkspaceThemeProvider>
  );
}

function publicCourseHref(id: string) {
  return `/practice/courses/${encodeURIComponent(id)}`;
}

function PublicStudyHome({ user }: { user: CampusUser }) {
  const text = useSchoolText();
  const schools = useData<{ items: School[] }>("schools");
  const schoolAccessChanged = useSearchParams().get("schoolAccess") === "changed";
  return <div className="space-y-4">
    {schoolAccessChanged && <p role="status" className={`${panelClass} px-4 py-3 text-sm text-muted-foreground`}>
      {text("This school workspace is no longer available to your account. You can continue in public learning.", "你的账号已无法进入原学校工作区，可以在公开学习区继续练习。")}
    </p>}
    <section className={`${panelClass} flex flex-wrap items-center justify-between gap-4 p-4`}>
      <div>
        <h2 className="font-semibold">{text(`Welcome, ${user.name}`, `欢迎，${user.name}`)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{text("Learn from public courses and practice at your own pace.", "学习公开课程，按自己的节奏练习。")}</p>
      </div>
      {schools.data && (
        schools.data.items.length > 0 || user.platformAdmin
          ? <AppLink href={user.platformAdmin ? "/platform" : "/schools"} className="text-sm font-semibold text-primary hover:underline">
              {user.platformAdmin ? text("Platform administration", "平台管理") : text("Return to school workspace", "返回学校工作区")} →
            </AppLink>
          : <AppLink href="/practice/settings#schools" className="text-sm font-semibold text-primary hover:underline">
              {text("Join a school with an invitation", "通过邀请码加入学校")} →
            </AppLink>
      )}
    </section>
    <section className="space-y-3">
      <h2 className="font-semibold">{text("Public courses", "公开课程")}</h2>
      <PublicCourseCatalog courseHref={publicCourseHref} showSearch={false}/>
    </section>
    <section className={`${panelClass} flex flex-wrap items-center justify-between gap-3 p-4`}>
      <div>
        <h2 className="font-semibold">{text("Public problems", "公开题目")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{text("Write code and check your results in the practice workspace.", "在练习工作区编写代码并查看判题结果。")}</p>
      </div>
      <AppLink href="/practice/problems" className="text-sm font-semibold text-primary hover:underline">{text("Browse problems", "浏览题目")} →</AppLink>
    </section>
  </div>;
}

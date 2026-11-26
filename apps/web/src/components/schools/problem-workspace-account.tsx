"use client";
import { accountHomepageHref } from "@/lib/campus-routes";

import { useRouter, useSearchParams } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { useLocale } from "@/components/locale-context";
import { ScholarshipBalance } from "@/components/scholarship/account-pages";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { Feedback, useMutation } from "@/components/student/shared";
import { ApiError, clearProductionSession, productionApi, type CampusUser } from "@/lib/production-api";
import { schoolWorkspaceHref } from "./school-workspace-location";

export function ProblemWorkspaceAccount({ user, schoolId, dirty, staff = false, publicWallet = false }: {
  user: CampusUser; schoolId?: string | null; dirty: boolean; staff?: boolean; publicWallet?: boolean;
}) {
  const action = useMutation(), router = useRouter(), { locale } = useLocale();
  const schoolRole = useSearchParams().get("schoolRole") === "teacher" ? "teacher" : undefined;
  const href = (section: string) => schoolId ? schoolWorkspaceHref(schoolId, section, schoolRole) : `/practice/${section}`;
  const wallet = schoolId && !publicWallet ? `schools/${schoolId}/scholarship/me` as const : "practice/scholarship/me";
  return <>
    {!staff && <ScholarshipBalance identityId={user.id} endpoint={wallet} href={publicWallet ? "/practice/scholarship" : href("scholarship")}/>}
    {!staff && <NotificationDropdown workspace={schoolId ? "student" : "public"} schoolId={schoolId ?? undefined} scholarshipHref={href("scholarship")}/>}
    <AccountMenu user={user} busy={action.busy} homepageHref={accountHomepageHref(user.id,schoolId ? "school" : "practice",schoolId,schoolRole)} settingsHref={href(schoolId ? "personal-settings" : "settings")} leaderboardHref={href("leaderboard")}
      onLogout={() => {
        if (dirty && !window.confirm(locale === "en" ? "Your code has not been submitted. Sign out with the draft saved locally?" : "代码尚未提交，草稿保留在本机。确认退出登录？")) return;
        void action.run(async () => {
          try { await productionApi("auth/logout", { method: "POST" }); }
          catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
          clearProductionSession(); router.replace("/login");
        });
      }}/>
    <Feedback action={action}/>
  </>;
}

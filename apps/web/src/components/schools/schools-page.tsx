"use client";

import { AccountAccessAction } from "./account-access-action";

import { LearnerWorkspace } from "./learner-workspace";
import { PageHeadingProvider, useCurrentPageHeading } from "../page-heading-context";
import { StudentPublicProfile } from "../student/public-profile";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceData } from "@/components/workspace-data";
import { useAcslEnabled } from "@/components/acsl/use-acsl-enabled";
import { AcslTeacherPage } from "@/components/acsl/teacher-page";
import { ArrowLeftRight, Eye, EyeOff } from "lucide-react";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { AccountMenu } from "@/components/account-menu";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { AppLink } from "@/components/navigation";
import { PreparationRouter } from "@/components/written-papers/preparation-router";
import { resolvePublicLearningBookmark } from "@/lib/campus-routes";
import { useRouter, useSearchParams } from "next/navigation";

import { SchoolExitAdministration } from "./school-exit-administration";
import { SchoolActivities } from "./school-activities";
import { SchoolPaper4 } from "./school-paper4";
import { SchoolScholarship, SchoolLeaderboard } from "./school-scholarship";
import { WorkspaceNavigation, useWorkspaceNavigationLabel, workspaceNavigation } from "@/components/workspace-navigation";
import { AdminDashboard } from "@/components/admin/dashboard";
import { TeacherDashboard } from "@/components/teacher/dashboard-classes";
import { SchoolStaffImports, SchoolTeachingReports } from "./school-staff-pages";
import { SchoolSettings } from "./school-settings";
import { schoolWorkspaceHref, schoolWorkspaceRole } from "./school-workspace-location";
import { PublicProblemReview, SchoolPractice, SchoolJudgeStatus } from "./school-practice";
import { PersonalWorkspaceProfile } from "./personal-workspace-profile";
import { SchoolClasses } from "./school-classes";
import { PersonalWorkspaceSettings } from "./personal-workspace-settings";
import { useLocale } from "@/components/locale-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { PersonalAppearanceProvider } from "@/components/personal-appearance-settings";
import { WorkspaceThemeProvider } from "@/components/ui/theme-context";
import { useWorkspaceSettings } from "@/components/student/workspace-settings";
import {
  CopyCode,
  Feedback,
  inputClass,
  Loading,
  useData,
  useMutation,
} from "@/components/admin/common";
import { productionApi, type CampusUser } from "@/lib/production-api";
import {
  RoleLabel,
  schoolDisplayName,
  useSchoolError,
  useSchoolText,
  type School,
  type SchoolRole,
} from "./school-ui";
import { SchoolAccountDetails, SchoolAccountFilters, SchoolRoleEditor, type AccountFilters, type Member } from "./school-account-management";
import { SchoolActivationBatch } from "./school-activation-batch";
import { SchoolAdministration } from "./school-administration";
import { SchoolCourses } from "./school-courses";
import { SchoolCourseAdmissions } from "./school-course-admissions";
import {
  readSchoolPreference,
  resolveCurrentSchoolSelection,
  writeSchoolPreference,
} from "./school-selection";

type Invitation = { token: string; role: SchoolRole; expiresAt: string };
const teacherOnly = new Set<string>(workspaceNavigation.teacher
  .filter(item => !workspaceNavigation.admin.some(admin => admin.section === item.section))
  .map(item => item.section));
// Paper 4 bookmarks predate the shared preparation entry and still open the teaching workspace.
teacherOnly.add("paper4");

export function SchoolsPage({
  user,
  onLogout,
  onUserSaved,
}: {
  user: CampusUser;
  onLogout: () => void;
  onUserSaved: (user: CampusUser) => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const localError = useSchoolError();
  const schools = useWorkspaceData<{ items: School[] }>("schools");
  const logout = useMutation();
  const { settings, update, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [invitations, setInvitations] = useState<
    Record<string, Invitation | null>
  >({});
  const [issuingInvitation, setIssuingInvitation] = useState(false);
  const items = schools.data?.items ?? [];
  const loaded = !schools.loading && !schools.error && schools.data !== null;
  const requestedSchoolId = search.get("schoolId");
  const selected = loaded
    ? resolveCurrentSchoolSelection(items, {
        activeSchoolId: requestedSchoolId,
        savedSchoolId: readSchoolPreference(user.id),
        defaultSchoolId: user.defaultSchoolId,
      })
    : undefined;
  const lostSchool = requestedSchoolId !== null && selected?.id !== requestedSchoolId;
  const personalSettings =
    search.get("section") === "personal-settings" || search.get("join") === "1";
  const personalProfile = search.get("section") === "profile";
  const personalPage = personalSettings || personalProfile;
  const schoolName = selected
    ? schoolDisplayName(selected, locale)
    : text("School workspace", "学校工作区");
  const requestedSection = search.get("section");
  const workspaceRole = schoolWorkspaceRole(selected?.roles ?? [], search.get("schoolRole"), requestedSection, teacherOnly);
  const admin = workspaceRole === "admin";
  const teaching = workspaceRole !== "student";
  const role = selected?.roles.includes("school_admin") ? "school_admin" : workspaceRole === "teacher" ? "teacher" : "student";
  const acslEnabled = useAcslEnabled(selected?.id, teaching);
  const sections = workspaceNavigation[workspaceRole].filter(item => item.section !== "timed");
  const active = requestedSection === "acsl" ? (teaching
    ? {section: "acsl", label: "ACSL 题库", shortEnglish: "ACSL papers"} as const
    : {section: "acsl", label: "ACSL 真题练习", shortEnglish: "ACSL practice"} as const)
    : requestedSection === "paper4" ? (teaching
      ? {section: "paper4", label: "Paper 4 试卷", shortEnglish: "Paper 4 papers"} as const
      : {section: "paper4", label: "Paper 4 真题练习", shortEnglish: "Paper 4 past papers"} as const)
    : requestedSection === "leaderboard" ? {section: "leaderboard", label: "积分排行榜", shortEnglish: "Leaderboard"} as const
    : workspaceNavigation[workspaceRole].find(item => item.section === requestedSection) ?? sections[0];
  const preparationResource = active.section === "paper4" || active.section === "acsl";
  const preparationPage = preparationResource || active.section === "exam-preparation";
  const navigationSection = preparationResource ? "exam-preparation" : active.section;
  const navigationLabel = useWorkspaceNavigationLabel();
  const publicBookmark = lostSchool ? resolvePublicLearningBookmark("/schools", search) : null;
  const redirect =
    loaded && publicBookmark ? publicBookmark
    : loaded && user.platformAdmin && search.get("join") === "1"
      ? "/platform?section=settings#schools"
      : loaded && !selected
          ? user.platformAdmin
            ? personalSettings
              ? "/platform?section=settings#schools"
              : personalProfile
                ? "/platform?section=profile"
                : "/platform"
            : personalSettings
              ? "/practice/settings#schools"
              : personalProfile
                ? "/practice/profile"
                : lostSchool ? "/practice?schoolAccess=changed" : "/practice"
          : loaded && selected && lostSchool
            ? schoolWorkspaceHref(selected.id)
            : null;
  useEffect(() => {
    window.addEventListener("codemaster:schools-changed", schools.reload);
    window.addEventListener("focus", schools.reload);
    window.addEventListener("codemaster:school-access-check", schools.reload);
    return () => {
      window.removeEventListener("codemaster:schools-changed", schools.reload);
      window.removeEventListener("focus", schools.reload);
      window.removeEventListener("codemaster:school-access-check", schools.reload);
    };
  }, [schools.reload]);
  function refresh() {
    schools.reload();
    setRefreshRevision((value) => value + 1);
  }
  useEffect(() => {
    if (selected) writeSchoolPreference(user.id, selected.id);
    if (redirect) router.replace(redirect);
  }, [selected, redirect, router, user.id]);
  useEffect(() => {
    document.title = `${personalSettings ? text("Settings", "设置") : personalProfile ? text("Profile", "个人资料") : schoolName} · CodeMaster`;
  }, [schoolName, personalSettings, personalProfile, text]);
  if (!loaded || redirect)
    return (
      <main className="min-h-screen bg-background p-6">
        <Loading resource={schools}>
          <p role="status" className="text-sm text-muted-foreground">
            {text("Opening workspace…", "正在进入工作区…")}
          </p>
        </Loading>
      </main>
    );
  if (!selected) return null;
  if (!teaching) return <LearnerWorkspace key={selected.id} school={selected} pathname="/schools" user={user} onUserSaved={onUserSaved} onLogout={onLogout} onSchoolsChanged={refresh}/>;
  const members = (
    <SchoolMembers
      school={selected}
      refreshRevision={refreshRevision}
      invitation={invitations[selected.id] ?? null}
      onInvitation={(invitation) =>
        setInvitations((previous) => ({
          ...previous,
          [selected.id]: invitation,
        }))
      }
      onIssuing={setIssuingInvitation}
    />
  );
  const href = (section: string) => schoolWorkspaceHref(selected.id, section, workspaceRole);
  const courses = <SchoolCourses
    showTopicEditor={workspaceRole === "admin"}
    school={selected}
    initialCourseId={search.get("courseId")}
    refreshRevision={refreshRevision}
    onRefresh={refresh}
  />;
  const platformReviews = admin && search.get("reviewScope") === "platform";
  const schoolProblems = <SchoolPractice
    key={search.get("problemId") ?? "list"}
    accountId={user.id}
    schoolId={selected.id}
    role={role}
    initialProblemId={search.get("problemId") ?? undefined}
  />;
  const problems = admin ? <div className="space-y-4">
    <nav className="flex flex-wrap gap-2" aria-label={text("Problem banks", "题库")}>
      <AppLink href={href("problems")} aria-current={!platformReviews ? "page" : undefined} className={buttonVariants({ size: "sm", variant: !platformReviews ? "secondary" : "ghost" })}>{text("School problems", "校内题目")}</AppLink>
      <AppLink href={`${href("problems")}&reviewScope=platform`} aria-current={platformReviews ? "page" : undefined} className={buttonVariants({ size: "sm", variant: platformReviews ? "secondary" : "ghost" })}>{text("Delegated platform reviews", "平台授权待审")}</AppLink>
    </nav>
    {platformReviews ? <PublicProblemReview user={user} reviewSchoolId={selected.id} /> : schoolProblems}
  </div> : schoolProblems;
  return (
    <PageHeadingProvider pathname={search.toString()}><WorkspaceThemeProvider theme={resolvedPageTheme}>
      <PersonalAppearanceProvider
        pageTheme={settings.pageTheme}
        updatePageTheme={(pageTheme) => update({ pageTheme })}
      >
        <div
          className={resolvedPageTheme === "dark" ? "dark" : ""}
          style={{ colorScheme: resolvedPageTheme }}
        >
          <WorkspaceFrame
            student={!teaching}
            schoolName={schoolName}
            navigation={
              <WorkspaceNavigation
                items={sections.map(item => ({...item, href: href(item.section), active: !personalPage && navigationSection === item.section}))}
                disabled={issuingInvitation}
              />
            }
            breadcrumb={
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {personalPage || active.section !== "home" ? (
                  <>
                    <AppLink
                      href={href("home")}
                      className={`${preparationPage && !personalPage ? "hidden sm:block " : ""}truncate text-muted-foreground hover:text-foreground`}
                    >
                      {text(
                        admin
                          ? "Admin workspace"
                          : teaching
                            ? "Teacher workspace"
                            : "Home",
                        admin ? "管理工作台" : teaching ? "教师工作台" : "首页",
                      )}
                    </AppLink>
                    <span aria-hidden="true" className={preparationPage && !personalPage ? "hidden sm:block" : undefined}>›</span>
                  </>
                ) : null}
                {!personalPage && preparationResource && (
                  <>
                    <AppLink href={href("exam-preparation")} className="hidden shrink-0 text-muted-foreground hover:text-foreground sm:block">
                      {teaching ? text("Exam resources", "备考资源") : text("Exam preparation", "备考中心")}
                    </AppLink>
                    <span aria-hidden="true" className="hidden sm:block">›</span>
                  </>
                )}
                <SchoolPageTitle label={personalSettings ? text("Settings","设置") : personalProfile ? text("Profile","个人资料") : navigationLabel(active)}
                  parentHref={active.section === "classes" && search.has("classId") ? href("classes") : undefined}/>

              </div>
            }
            account={
              <div className="flex items-center gap-2">
              {selected.roles.includes("school_admin") && !issuingInvitation && (
                <AppLink
                  href={schoolWorkspaceHref(selected.id, "home", admin ? "teacher" : "admin")}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  aria-label={admin ? text("Switch to teaching workspace", "切换到教学工作区") : text("Switch to admin workspace", "切换到管理工作区")}
                >
                  <ArrowLeftRight size={14} aria-hidden="true" />
                  {admin ? text("Teaching workspace", "教学工作区") : text("Admin workspace", "管理工作区")}
                </AppLink>
              )}
              <NotificationDropdown key={`${user.id}:${selected.id}:${workspaceRole}`} schoolId={selected.id}
                workspace={teaching ? "staff" : "student"} scholarshipHref={href("scholarship")}/>
              <AccountMenu
                user={user}
                profileHref={href("profile")}
                settingsHref={href("personal-settings")}
                leaderboardHref={href("leaderboard")}
                busy={logout.busy || issuingInvitation}
                onLogout={() =>
                  void logout.run(async () => {
                    try {
                      await productionApi("auth/logout", { method: "POST" });
                      onLogout();
                    } catch (error) {
                      throw localError(error);
                    }
                  })
                }
              /></div>
            }
          >
            <Feedback action={logout} />
            {personalProfile ? (
              <PersonalWorkspaceProfile
                user={user}
                schoolRoles={selected.roles}
                onUserSaved={onUserSaved}
              />
            ) : personalSettings ? (
              <PersonalWorkspaceSettings
                user={user}
                onUserSaved={onUserSaved}
                onSchoolsChanged={refresh}
              />
            ) : (
              <section
                key={`${selected.id}:${workspaceRole}:${selected.roles.join(",")}:${active.section}`}
                className="min-w-0"
                aria-label={schoolName}
              >
                {active.section === "home" ? (
                  admin ? <AdminDashboard schoolId={selected.id}/> : <TeacherDashboard schoolId={selected.id}/>
                ) : active.section === "assignments" || active.section === "timed" ? (
                  <SchoolActivities school={selected} teacherAccountId={user.id} kind={active.section === "timed" ? "timed" : "assignment"} />
                ) : active.section === "exam-preparation" ? (
                  <PreparationRouter schoolId={selected.id} rootHref={href("exam-preparation")} staff={teaching} paper4Href={!admin ? href("paper4") : undefined} acslHref={acslEnabled ? href("acsl") : undefined} />
                ) : active.section === "acsl" ? (
                  <AcslTeacherPage schoolId={selected.id} user={user} baseHref={href("acsl")} />
                ) : active.section === "paper4" ? (
                  <SchoolPaper4 schoolId={selected.id} role={role} user={user} />
                ) : active.section === "scholarship" ? (
                  <SchoolScholarship schoolId={selected.id} role={role} />
                ) : active.section === "leaderboard" ? (
                  search.get("profileId") ? <StudentPublicProfile profileId={search.get("profileId")!} schoolId={selected.id} viewer={user} workspace={admin?"admin":teaching?"teacher":"student"} /> : <SchoolLeaderboard schoolId={selected.id} />
                ) : active.section === "classes" ? (
                  <SchoolClasses
                    school={selected}
                    refreshRevision={refreshRevision}
                  />
                ) : active.section === "problems" ? (
                  problems
                ) : active.section === "course-admissions" ? (
                  <SchoolCourseAdmissions schoolId={selected.id} href={href("course-admissions")}
                    coursesHref={schoolWorkspaceHref(selected.id, "courses", "teacher")}/>
                ) : active.section === "judge" ? (
                  <SchoolJudgeStatus schoolId={selected.id} />
                ) : active.section === "reports" ? (
                  <SchoolTeachingReports schoolId={selected.id}/>
                ) : active.section === "imports" ? (
                  <SchoolStaffImports school={selected} teacher={workspaceRole === "teacher"}/>
                ) : active.section === "system-settings" ? (
                  <SchoolSettings schoolId={selected.id} onSaved={refresh}/>
                ) : active.section === "members" || active.section === "identities" ? (
                  <SchoolAdministration
                    school={selected}
                    currentSection={active.section}
                    refreshRevision={refreshRevision}
                    navigationDisabled={issuingInvitation}
                    actions={null}
                    members={members}
                  />
                ) : (
                  courses
                )}
              </section>
            )}
          </WorkspaceFrame>
        </div>
      </PersonalAppearanceProvider>
    </WorkspaceThemeProvider></PageHeadingProvider>
  );
}

function SchoolPageTitle({ label, parentHref }: { label: string; parentHref?: string }) {
  const heading = useCurrentPageHeading();
  const Label = heading?.inContent ? "span" : "h1";
  return <>{parentHref && <><AppLink className="shrink-0 text-muted-foreground hover:text-primary" href={parentHref}>{label}</AppLink><span aria-hidden="true">›</span></>}
    <Label className="truncate font-semibold">{heading?.title || label}</Label></>;
}

function SchoolMembers({
  school,
  refreshRevision,
  invitation,
  onInvitation,
  onIssuing,
}: {
  school: School;
  refreshRevision: number;
  invitation: Invitation | null;
  onInvitation: (value: Invitation | null) => void;
  onIssuing: (busy: boolean) => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const [page, setPage] = useState(1);
  const [remove, setRemove] = useState<Member | null>(null);
  const [revision, setRevision] = useState(0);
  const [removed, setRemoved] = useState(false);
  const [activating, setActivating] = useState(false);
  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setActivating(true)}>{text("Generate activation codes", "批量生成激活码")}</Button>
        <AppLink href={schoolWorkspaceHref(school.id, "identities")} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {text("Manage identity records", "管理身份档案")}
        </AppLink>
      </div>
      {activating && <SchoolActivationBatch school={school} onClose={() => setActivating(false)} />}
      <IssueInvitation
        school={school}
        invitation={invitation}
        onInvitation={onInvitation}
        onIssuing={onIssuing}
      />
      {removed && (
        <p role="status" className="text-sm text-success">
          {text("School membership removed.", "已移除本校成员关系。")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {text("Password resets are available for student and teacher accounts managed exclusively by this school.",
          "本校独立管理的学生、教师账号，可在下方成员名单中重置密码。")}
      </p>
      <MemberList
        key={`${revision}-${refreshRevision}`}
        school={school}
        page={page}
        onPage={setPage}
        onRemove={setRemove}
      />
      <SchoolExitAdministration schoolId={school.id} onChanged={() => {
        setPage(1);
        setRevision(value => value + 1);
      }}/>
      {remove && (
        <RemoveMember
          member={remove}
          school={school}
          onClose={() => setRemove(null)}
          onRemoved={() => {
            setRemove(null);
            setPage(1);
            setRevision((value) => value + 1);
            setRemoved(true);
          }}
          text={text}
          localError={localError}
        />
      )}
    </div>
  );
}

function MemberList({
  school,
  page,
  onPage,
  onRemove,
}: {
  school: School;
  page: number;
  onPage: (page: number) => void;
  onRemove: (member: Member) => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const localError = useSchoolError();
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [credential, setCredential] = useState<{ username: string; resetCode: string; resetUrl: string } | null>(null);
  const [detail, setDetail] = useState<Member | null>(null);
  const [editingRoles, setEditingRoles] = useState<Member | null>(null);
  const [filters, setFilters] = useState<AccountFilters>({ q:"", className:"", role:"all", status:"all", access:"all" });
  const params = new URLSearchParams({ ...filters, page: String(page) });
  const members = useData<{ items: Member[]; page: number; hasMore: boolean }>(`schools/${school.id}/accounts?${params}`);
  return (
    <div className="min-h-48">
      <SchoolAccountFilters filters={filters} onChange={next => { onPage(1); setFilters(next); }}/>
      {editingRoles && <SchoolRoleEditor school={school} member={editingRoles} onClose={() => setEditingRoles(null)}
        onSaved={() => { setEditingRoles(null); members.reload(); }}/>}
      {detail && <SchoolAccountDetails school={school} accountId={detail.accountId} onClose={() => setDetail(null)} onIdentitySaved={members.reload} />}
      <Loading resource={{ ...members, loading: members.pending || members.loading }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {text("School members", "学校成员")}
            </caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">{text("Name", "姓名")}</th>
                <th className="py-2 pr-3">{text("Role", "角色")}</th>
                <th className="py-2 pr-3">{text("Classes", "关联班级")}</th>
                <th className="py-2 pr-3">{text("Platform login", "平台登录")}</th>
                <th className="py-2 pr-3">{text("School access", "本校访问")}</th>
                <th className="py-2 pr-3">{text("Last sign-in", "最后登录")}</th>
                <th className="py-2 text-right">{text("Actions", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {members.data?.items.map((member) => (
                <tr
                  key={member.accountId}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-2 pr-3 break-words">
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDetail(member)}>{member.name}</button>
                    <span className="block text-xs text-muted-foreground">{member.username} {member.number && `· ${member.number}`}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <RoleLabel role={member.role} />
                    {member.administrator && member.role !== "school_admin" && (
                      <span className="ml-2 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                        <RoleLabel role="school_admin" />
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{member.classes.join("、") || "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{member.disabled ? text("Disabled", "已禁用") : text("Enabled", "已启用")}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{member.suspended ? text("Suspended", "已暂停") : text("Active", "已开放")}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString(locale === "en" ? "en-GB" : "zh-CN") : "—"}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {member.canEditRoles && <Button variant="secondary" size="sm" onClick={() => setEditingRoles(member)}>{text("Edit roles", "编辑角色")}</Button>}
                      {member.canResetPassword && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setResetTarget(member)}
                        >
                          {text("Reset password", "重置密码")}
                        </Button>
                      )}
                      {member.canManageAccess && <AccountAccessAction account={member} access={{scope:"school", school, suspended:member.suspended}} onSaved={members.reload}/>}
                      {!member.suspended && member.role !== "school_admin" &&
                        member.role !== "student" && !member.administrator && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onRemove(member)}
                          >
                            {text("Remove", "移除")}
                          </Button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
              {!members.data?.items.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 text-center text-muted-foreground"
                  >
                    {text("No members on this page.", "本页没有成员。")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {text(
              `Page ${page} · Up to 50 members`,
              `第 ${page} 页 · 每页最多 50 人`,
            )}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 1}
              onClick={() => onPage(page - 1)}
            >
              {text("Previous", "上一页")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!members.data?.hasMore}
              onClick={() => onPage(page + 1)}
            >
              {text("Next", "下一页")}
            </Button>
          </div>
        </div>
      </Loading>
      {resetTarget && (
        <ResetMemberCredential
          member={resetTarget}
          school={school}
          onClose={() => setResetTarget(null)}
          onIssued={(issued) => {
            setResetTarget(null);
            setCredential({
              ...issued,
              resetUrl: `${window.location.origin}/login?reset=1`,
            });
          }}
          text={text}
          localError={localError}
        />
      )}
      {credential && (
        <Dialog open onOpenChange={(open) => { if (!open) setCredential(null); }}>
          <DialogContent>
            <DialogTitle>{text("One-time reset credential", "一次性密码重置凭据")}</DialogTitle>
            <DialogDescription>
              {text(
                "Valid for 30 minutes and shown only here. Give it to the account holder privately.",
                "凭据有效期 30 分钟，仅在此处展示，请私下交给本人。",
              )}
            </DialogDescription>
            <div className="space-y-3 text-sm">
              <p>
                {text("Username: ", "用户名：")}
                <code>{credential.username}</code>
              </p>
              <div className="border border-dashed border-border-strong bg-surface-subtle p-3">
                <code className="select-all break-all">{credential.resetCode}</code>
                <CopyCode text={credential.resetCode} />
              </div>
              <p className="text-muted-foreground">
                {text(
                  "Share the reset entry below with the newest code privately. The code works on the issuing site, and issuing a new code immediately invalidates the previous one.",
                  "请把下方重置入口和最新凭据私下交给本人。凭据只能在签发站点使用，重新签发后旧凭据立即失效。",
                )}
              </p>
              <div className="space-y-1">
                <a href={credential.resetUrl} className="break-all text-primary underline">
                  {credential.resetUrl}
                </a>
                <CopyCode text={credential.resetUrl} label={text("Copy reset link", "复制重置入口")} />
              </div>
              <Button onClick={() => setCredential(null)}>
                {text("Done — close", "已记录，关闭")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ResetMemberCredential({
  member,
  school,
  onClose,
  onIssued,
  text,
  localError,
}: {
  member: Member;
  school: School;
  onClose: () => void;
  onIssued: (issued: { username: string; resetCode: string }) => void;
  text: (en: string, zh: string) => string;
  localError: (error: unknown) => Error;
}) {
  const action = useMutation();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogTitle>
          {text(`Reset ${member.name}'s password?`, `重置 ${member.name} 的密码？`)}
        </DialogTitle>
        <DialogDescription>
          {text(
            `Generate a one-time reset code for ${member.name} at ${school.name} and hand it to them privately. Their old password is never shown; they set a new one on the sign-in page.`,
            `为 ${school.name} 的 ${member.name} 生成一次性重置凭据，当面交付本人。旧密码不会显示；本人通过登录页设置新密码。`,
          )}
        </DialogDescription>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button
            disabled={action.busy}
            aria-busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                try {
                  const issued = await productionApi<{ username: string; resetCode: string }>(
                    `schools/${school.id}/members/${member.accountId}/reset`,
                    { method: "POST" },
                  );
                  onIssued(issued);
                } catch (error) {
                  throw localError(error);
                }
              })
            }
          >
            {text("Issue reset code", "签发重置凭据")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueInvitation({
  school,
  invitation,
  onInvitation,
  onIssuing,
}: {
  school: School;
  invitation: Invitation | null;
  onInvitation: (value: Invitation | null) => void;
  onIssuing: (busy: boolean) => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const { locale } = useLocale();
  const action = useMutation();
  const [role, setRole] = useState<SchoolRole>("student");
  const [visible, setVisible] = useState(false);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (action.busy || invitation) return;
          onIssuing(true);
          void action.run(async () => {
            try {
              const next = await productionApi<Invitation>(
                `schools/${school.id}/invitations`,
                { method: "POST", body: { role } },
              );
              onInvitation(next);
              setVisible(false);
            } catch (error) {
              throw localError(error);
            } finally {
              onIssuing(false);
            }
          });
        }}
      >
        <label htmlFor="invitation-role" className="text-sm font-semibold">
          {text("Invite as", "邀请角色")}
          <select
            id="invitation-role"
            className={`${inputClass} mt-1 min-w-36`}
            value={role}
            disabled={action.busy}
            onChange={(event) => setRole(event.target.value as SchoolRole)}
          >
            <option value="student">{text("Student", "学生")}</option>
            <option value="teacher">{text("Teacher", "教师")}</option>
            <option value="school_admin">
              {text("School administrator", "学校管理员")}
            </option>
          </select>
        </label>
        <Button
          type="submit"
          variant="secondary"
          className="min-w-40"
          disabled={action.busy || !!invitation}
          aria-busy={action.busy}
        >
          {text("Create invitation", "创建邀请")}
        </Button>
      </form>
      {role === "school_admin" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {text(
            "This invitation grants permission to manage this school, including its members and settings.",
            "此邀请授予管理本学校成员、设置等业务的权限。",
          )}
        </p>
      )}

      <Feedback action={action} />
      {invitation && (
        <div className="mt-3 space-y-2">
          <label htmlFor="issued-invitation" className="block text-sm">
            {text("One-time invitation code", "一次性邀请码")}
          </label>
          <div className="flex flex-wrap items-center gap-1">
            <input
              id="issued-invitation"
              className={`${inputClass} max-w-sm font-mono`}
              type={visible ? "text" : "password"}
              value={invitation.token}
              readOnly
              autoComplete="off"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={text(
                visible ? "Hide invitation code" : "Show invitation code",
                visible ? "隐藏邀请码" : "显示邀请码",
              )}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </Button>
            <CopyCode text={invitation.token} />
          </div>
          <p className="text-xs text-muted-foreground">
            {text(
              "Give this code privately to one person. Expires",
              "请私下交给一位受邀者。有效期至",
            )}{" "}
            {new Date(invitation.expiresAt).toLocaleString(
              locale === "en" ? "en-GB" : "zh-CN",
            )}{" "}
            · <RoleLabel role={invitation.role} />
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onInvitation(null);
              setVisible(false);
            }}
          >
            {text("Done, clear code", "已记录，清除显示")}
          </Button>
        </div>
      )}
    </div>
  );
}

function RemoveMember({
  member,
  school,
  onClose,
  onRemoved,
  text,
  localError,
}: {
  member: Member;
  school: School;
  onClose: () => void;
  onRemoved: () => void;
  text: (en: string, zh: string) => string;
  localError: (error: unknown) => Error;
}) {
  const action = useMutation();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (action.busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (action.busy) event.preventDefault();
        }}
      >
        <DialogTitle>
          {text("Remove school member?", "移除学校成员？")}
        </DialogTitle>
        <DialogDescription>
          {text(
            `Remove ${member.name} from ${school.name}. This revokes their membership and unlinks their identity at this school. Their login and class records are retained. They will need a new invitation to rejoin.`,
            `将 ${member.name} 从 ${school.name} 移除。此操作撤销本校成员资格并解除本校身份关联，登录账号与班级档案保留。重新加入需要新的邀请。`,
          )}
        </DialogDescription>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button
            variant="danger"
            disabled={action.busy}
            aria-busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                try {
                  await productionApi(
                    `schools/${school.id}/members/${member.accountId}`,
                    { method: "DELETE" },
                  );
                  onRemoved();
                } catch (error) {
                  throw localError(error);
                }
              })
            }
          >
            {text("Remove member", "移除成员")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

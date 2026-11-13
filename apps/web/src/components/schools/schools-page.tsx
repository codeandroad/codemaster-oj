"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspaceData } from "@/components/workspace-data";
import { AcslPage, useAcslEnabled } from "@/components/acsl/acsl-page";
import { AcslTeacherPage } from "@/components/acsl/teacher-page";
import { Eye, EyeOff } from "lucide-react";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { AccountMenu } from "@/components/account-menu";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { AppLink } from "@/components/navigation";
import { resolvePublicLearningBookmark } from "@/lib/campus-routes";
import { useRouter, useSearchParams } from "next/navigation";
import { LearnerResourceScope } from "./learner-resource-scope";
import { PublicReviewNotebook } from "./public-study-records";
import { SchoolExitAdministration } from "./school-exit-administration";
import { SchoolActivities } from "./school-activities";
import { SchoolPaper4 } from "./school-paper4";
import { SchoolScholarship, SchoolLeaderboard, SchoolScholarshipBalance } from "./school-scholarship";
import { WorkspaceNavigation, useWorkspaceNavigationLabel, workspaceNavigation } from "@/components/workspace-navigation";
import { AdminDashboard } from "@/components/admin/dashboard";
import { TeacherDashboard } from "@/components/teacher/dashboard-classes";
import { SchoolStaffImports, SchoolTeachingReports } from "./school-staff-pages";
import { SchoolSettings } from "./school-settings";
import { schoolWorkspaceHref, schoolWorkspaceRole } from "./school-workspace-location";
import { SchoolPractice, SchoolJudgeStatus } from "./school-practice";
import { PersonalWorkspaceProfile } from "./personal-workspace-profile";
import { SchoolClasses } from "./school-classes";
import { SchoolStudentDashboard, SchoolSubmissions } from "./school-dashboard";
import { PersonalWorkspaceSettings } from "./personal-workspace-settings";
import { useLocale } from "@/components/locale-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { productionApi, roleHome, type CampusUser } from "@/lib/production-api";
import {
  RoleLabel,
  schoolDisplayName,
  useSchoolError,
  useSchoolText,
  type School,
  type SchoolRole,
} from "./school-ui";
import { SchoolAdministration } from "./school-administration";
import { SchoolCourses } from "./school-courses";
import { SchoolCourseAdmissions } from "./school-course-admissions";
import {
  readSchoolPreference,
  resolveCurrentSchoolSelection,
  writeSchoolPreference,
} from "./school-selection";

type Member = {
  accountId: string;
  name: string;
  role: SchoolRole;
  administrator?: boolean;
  joinedAt: string;
};
type Invitation = { token: string; role: SchoolRole; expiresAt: string };
const teacherOnly = new Set<string>(workspaceNavigation.teacher
  .filter(item => !workspaceNavigation.admin.some(admin => admin.section === item.section))
  .map(item => item.section));

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
  const acslEnabled = useAcslEnabled(!selected?.legacy ? selected?.id : undefined, teaching);
  const sections = workspaceNavigation[workspaceRole].filter(item => item.section !== "timed" && (item.section !== "acsl" || acslEnabled));
  const active = requestedSection === "acsl" ? (teaching
    ? {section: "acsl", label: "ACSL 题库", shortEnglish: "ACSL papers"} as const
    : {section: "acsl", label: "ACSL 真题练习", shortEnglish: "ACSL practice"} as const)
    : requestedSection === "leaderboard" ? {section: "leaderboard", label: "积分排行榜", shortEnglish: "Leaderboard"} as const
    : sections.find(item => item.section === requestedSection) ?? sections[0];
  const navigationLabel = useWorkspaceNavigationLabel();
  const publicBookmark = lostSchool ? resolvePublicLearningBookmark("/schools", search) : null;
  const redirect =
    loaded && publicBookmark ? publicBookmark
    : loaded && user.platformAdmin && search.get("join") === "1"
      ? "/platform?section=settings#schools"
      : loaded && selected?.legacy
        ? personalSettings
          ? user.roles.includes("admin")
            ? "/admin/personal-settings#schools"
            : user.roles.includes("teacher")
              ? "/teacher/settings#schools"
              : "/student/settings#schools"
          : personalProfile
            ? user.roles.includes("admin")
              ? "/admin/profile"
              : user.roles.includes("teacher")
                ? "/teacher/profile"
                : "/student/profile"
            : roleHome(user)
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
    school={selected}
    initialCourseId={search.get("courseId")}
    refreshRevision={refreshRevision}
    onRefresh={refresh}
  />;
  if (!teaching && active.section === "acsl" && search.get("coding") === "1") return <AcslPage key={selected.id} schoolId={selected.id} user={user} baseHref={href("acsl")} />;
  const problems = <SchoolPractice
    key={search.get("problemId") ?? "list"}
    accountId={user.id}
    schoolId={selected.id}
    role={role}
    initialProblemId={search.get("problemId") ?? undefined}
  />;
  return (
    <WorkspaceThemeProvider theme={resolvedPageTheme}>
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
                items={sections.map(item => ({...item, href: href(item.section), active: !personalPage && active.section === item.section}))}
                disabled={issuingInvitation}
              />
            }
            breadcrumb={
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {personalPage || active.section !== "home" ? (
                  <>
                    <AppLink
                      href={href("home")}
                      className="truncate text-muted-foreground hover:text-foreground"
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
                    <span aria-hidden="true">›</span>
                  </>
                ) : null}
                <h1 className="truncate font-semibold">
                  {personalSettings
                    ? text("Settings", "设置")
                    : personalProfile
                      ? text("Profile", "个人资料")
                      : navigationLabel(active)}
                </h1>
              </div>
            }
            account={
              <div className="flex items-center gap-2">
              {!teaching && <SchoolScholarshipBalance key={`${user.id}:${selected.id}`} schoolId={selected.id} href={href("scholarship")}/>}
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
                  admin ? <AdminDashboard schoolId={selected.id}/> :
                  teaching ? <TeacherDashboard schoolId={selected.id}/> :
                  <SchoolStudentDashboard school={selected} user={user}/>
                ) : active.section === "assignments" || active.section === "timed" ? (
                  <SchoolActivities school={selected} kind={active.section === "timed" ? "timed" : "assignment"} />
                ) : active.section === "acsl" ? (
                  teaching ? <AcslTeacherPage schoolId={selected.id} user={user} baseHref={href("acsl")} />
                    : <AcslPage schoolId={selected.id} user={user} baseHref={href("acsl")} />
                ) : active.section === "paper4" ? (
                  <SchoolPaper4 schoolId={selected.id} role={role} user={user} />
                ) : active.section === "scholarship" ? (
                  <SchoolScholarship schoolId={selected.id} role={role} />
                ) : active.section === "leaderboard" ? (
                  <SchoolLeaderboard schoolId={selected.id} />
                ) : active.section === "submissions" ? (
                  <LearnerResourceScope section="submissions" schoolHref={href("submissions")}>
                    <SchoolSubmissions schoolId={selected.id}/>
                  </LearnerResourceScope>
                ) : active.section === "review-notebook" ? (
                  <PublicReviewNotebook/>
                ) : active.section === "classes" ? (
                  <SchoolClasses
                    school={selected}
                    refreshRevision={refreshRevision}
                  />
                ) : active.section === "problems" ? (
                  teaching ? problems : <LearnerResourceScope section="problems" schoolHref={href("problems")} accountId={user.id}>{problems}</LearnerResourceScope>
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
                  teaching ? courses : <LearnerResourceScope section="courses" schoolHref={href("courses")}>{courses}</LearnerResourceScope>
                )}
              </section>
            )}
          </WorkspaceFrame>
        </div>
      </PersonalAppearanceProvider>
    </WorkspaceThemeProvider>
  );
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
  return (
    <div className="mt-3 space-y-4">
      <SchoolExitAdministration schoolId={school.id} onChanged={() => {
        setPage(1);
        setRevision(value => value + 1);
      }}/>
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
      <MemberList
        key={`${page}-${revision}-${refreshRevision}`}
        school={school}
        page={page}
        onPage={setPage}
        onRemove={setRemove}
      />
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
  const members = useData<{ items: Member[]; page: number; hasMore: boolean }>(
    `schools/${school.id}/members?page=${page}`,
  );
  return (
    <div className="min-h-48">
      <Loading resource={members}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {text("School members", "学校成员")}
            </caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">{text("Name", "姓名")}</th>
                <th className="py-2 pr-3">{text("Role", "角色")}</th>
                <th className="py-2 pr-3">{text("Joined", "加入日期")}</th>
                <th className="py-2 text-right">{text("Actions", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {members.data?.items.map((member) => (
                <tr
                  key={member.accountId}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-2 pr-3 break-words">{member.name}</td>
                  <td className="py-2 pr-3">
                    <RoleLabel role={member.role} />
                    {member.administrator && member.role !== "school_admin" && (
                      <span className="ml-2 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                        <RoleLabel role="school_admin" />
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString(
                      locale === "en" ? "en-GB" : "zh-CN",
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {member.role !== "school_admin" &&
                      member.role !== "student" && !member.administrator && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemove(member)}
                        >
                          {text("Remove", "移除")}
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
              {!members.data?.items.length && (
                <tr>
                  <td
                    colSpan={4}
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
    </div>
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

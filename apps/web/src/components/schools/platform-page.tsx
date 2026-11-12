"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Building2,
  BookOpen,
  BookOpenCheck,
  RefreshCw,
} from "lucide-react";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { AccountMenu } from "@/components/account-menu";
import { NotificationDropdown } from "@/components/student/notification-dropdown";
import { useSearchParams, useRouter } from "next/navigation";
import { PersonalWorkspaceSettings } from "./personal-workspace-settings";
import { PersonalWorkspaceProfile } from "./personal-workspace-profile";
import { useLocale } from "@/components/locale-context";
import {
  Feedback,
  Loading,
  useData,
  useMutation,
} from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { PersonalAppearanceProvider } from "@/components/personal-appearance-settings";
import { WorkspaceThemeProvider } from "@/components/ui/theme-context";
import { useWorkspaceSettings } from "@/components/student/workspace-settings";
import { productionApi, type CampusUser } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import { PlatformSchoolDialog } from "./platform-school-dialog";
import { PlatformCourses } from "./platform-courses";
import { PublicCourseReview } from "./public-course-review";
import { PublicProblemReview } from "./school-practice";
import {
  usePlatformError,
  type PlatformSchool,
  type PlatformSchoolAction,
} from "./platform-ui";

export function PlatformPage({
  user,
  onLogout,
  onUserSaved,
}: {
  user: CampusUser;
  onLogout: () => void;
  onUserSaved: (user: CampusUser) => void;
}) {
  const text = useSchoolText();
  const localError = usePlatformError();
  const { locale } = useLocale();
  const { settings, update, resolvedPageTheme } = useWorkspaceSettings(user.id);
  const logout = useMutation();
  const search = useSearchParams();
  const router = useRouter();
  const personalSettings = search.get("section") === "settings";
  const personalProfile = search.get("section") === "profile";
  const personalPage = personalSettings || personalProfile;
  const [action, setAction] = useState<PlatformSchoolAction | null>(null);
  const section =
    search.get("section") === "course-review"
      ? "course-review"
      : search.get("section") === "courses"
      ? "courses"
      : search.get("section") === "problems"
        ? "problems"
        : "schools";
  const setSection = (next: "schools" | "courses" | "course-review" | "problems") =>
    router.push(`/platform?section=${next}`);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const createTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const title = personalProfile
      ? locale === "en" ? "Profile" : "个人资料"
      : personalSettings
        ? locale === "en" ? "Settings" : "设置"
        : locale === "en" ? "Platform administration" : "平台管理";
    document.title = `${title} · CodeMaster`;
  }, [locale, personalProfile, personalSettings]);

  function openAction(next: PlatformSchoolAction, trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setAction(next);
  }

  return (
    <WorkspaceThemeProvider theme={resolvedPageTheme}>
      <PersonalAppearanceProvider
        pageTheme={settings.pageTheme}
        updatePageTheme={(pageTheme) => update({ pageTheme })}
      >
        <div
          className={`min-h-screen bg-background text-foreground ${resolvedPageTheme === "dark" ? "dark" : ""}`}
          style={{ colorScheme: resolvedPageTheme }}
        >
          <WorkspaceFrame
            schoolName={text("Platform administration", "平台管理")}
            navigation={
              <nav
                className="space-y-1 p-3"
                aria-label={text("Platform navigation", "平台导航")}
              >
                {(["schools", "courses", "course-review", "problems"] as const).map((item) => {
                  const Icon =
                    item === "schools"
                      ? Building2
                      : item === "courses"
                        ? BookOpen
                        : BookOpenCheck;
                  return (
                    <Button
                      key={item}
                      variant="ghost"
                      disabled={action !== null}
                      className={`min-h-10 w-full justify-start gap-3 px-3 text-sm ${!personalPage && section === item ? "bg-accent font-semibold" : "text-muted-foreground"}`}
                      aria-current={
                        !personalPage && section === item
                          ? "page"
                          : undefined
                      }
                      onClick={() => {
                        setSection(item);
                        setMessage("");
                      }}
                    >
                      <Icon size={17} />
                      {item === "schools"
                        ? text("Schools", "学校")
                        : item === "courses"
                          ? text("Platform courses", "平台课程")
                          : item === "course-review" ? text("Course review", "课程公开审核")
                          : text("Public problems", "公开题库")}
                    </Button>
                  );
                })}
              </nav>
            }
            breadcrumb={
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {text("Platform administration", "平台管理")}
                </span>
                <span aria-hidden="true">›</span>
                <h1 className="truncate font-semibold">
                  {personalSettings
                    ? text("Settings", "设置")
                    : personalProfile
                      ? text("Profile", "个人资料")
                    : section === "schools"
                      ? text("Schools", "学校")
                      : section === "courses"
                        ? text("Platform courses", "平台课程")
                        : section === "course-review" ? text("Course review", "课程公开审核")
                        : text("Public problems", "公开题库")}
                </h1>
              </div>
            }
            account={<div className="flex items-center gap-2">
              <NotificationDropdown key={user.id} workspace="platform"/>
              <AccountMenu
                user={user}
                busy={logout.busy || action !== null}
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
              />
            </div>}
          >
            {personalSettings ? (
              <PersonalWorkspaceSettings
                user={user}
                onUserSaved={onUserSaved}
              />
            ) : personalProfile ? (
              <PersonalWorkspaceProfile
                user={user}
                onUserSaved={onUserSaved}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {user.platformAdmin && section === "schools" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRevision((value) => value + 1)}
                        disabled={action !== null}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {text("Refresh", "刷新")}
                      </Button>
                      <Button
                        ref={createTrigger}
                        size="sm"
                        onClick={(event) =>
                          openAction({ mode: "create" }, event.currentTarget)
                        }
                      >
                        <Plus size={14} aria-hidden="true" />
                        {text("Create school", "创建学校")}
                      </Button>
                    </div>
                  )}
                </div>
                <Feedback action={logout} />
                <Feedback action={{ error: "", message }} />
                {user.platformAdmin ? (
                  <>
                    {section === "schools" ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {text(
                            "Manage schools and their administrators. School teaching and student records remain in each school's workspace.",
                            "管理学校及其管理员，教学和学生记录由各学校工作区管理。",
                          )}
                        </p>
                        <SchoolList
                          key={`${page}:${revision}`}
                          page={page}
                          onPage={setPage}
                          onAction={openAction}
                        />
                      </>
                    ) : section === "courses" ? (
                      <PlatformCourses />
                    ) : section === "course-review" ? (
                      <PublicCourseReview />
                    ) : (
                      <PublicProblemReview />
                    )}
                  </>
                ) : (
                  <p
                    role="alert"
                    className="rounded-lg border border-border bg-surface p-4 text-sm"
                  >
                    {text(
                      "This page requires platform administrator access.",
                      "此页面仅限平台管理员访问。",
                    )}
                  </p>
                )}
                {user.platformAdmin && action && (
                  <PlatformSchoolDialog
                    action={action}
                    onClose={() => setAction(null)}
                    restoreFocus={() => {
                      const target = lastTrigger.current;
                      if (target?.isConnected) target.focus();
                      else createTrigger.current?.focus();
                    }}
                    onSaved={(nextMessage) => {
                      setMessage(nextMessage);
                      if (action.mode === "create") setPage(1);
                      setRevision((value) => value + 1);
                      setAction(null);
                    }}
                  />
                )}
              </>
            )}
          </WorkspaceFrame>
        </div>
      </PersonalAppearanceProvider>
    </WorkspaceThemeProvider>
  );
}

function SchoolList({
  page,
  onPage,
  onAction,
}: {
  page: number;
  onPage: (page: number) => void;
  onAction: (action: PlatformSchoolAction, trigger: HTMLButtonElement) => void;
}) {
  const text = useSchoolText();
  const schools = useData<{
    items: PlatformSchool[];
    page: number;
    hasMore: boolean;
  }>(`platform/schools?page=${page}`);
  return (
    <Loading resource={schools}>
      <section
        className="rounded-lg border border-border bg-surface"
        aria-label={text("Schools", "学校")}
      >
        <div
          className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_9rem] gap-3 border-b border-border px-4 py-2 text-xs font-semibold text-muted-foreground lg:grid"
          aria-hidden="true"
        >
          <span>{text("School", "学校")}</span>
          <span>{text("People & classes", "成员与班级")}</span>
          <span>{text("Teaching resources", "教学资源")}</span>
          <span>{text("Administrators", "管理员")}</span>
          <span>{text("Actions", "操作")}</span>
        </div>
        {schools.data?.items.length ? (
          <ul className="divide-y divide-border">
            {schools.data.items.map((school) => (
              <li
                key={school.id}
                className="grid min-w-0 gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_9rem] lg:items-start"
              >
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold break-words">
                    {school.name}
                  </h2>
                  <p className="mt-0.5 text-xs break-all text-muted-foreground">
                    {school.slug}
                  </p>
                  {school.legacy && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {text("Existing school", "原系统学校")}
                    </p>
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {text(
                      `${school.counts.members} members`,
                      `${school.counts.members} 位成员`,
                    )}
                  </p>
                  <p>
                    {text(
                      `${school.counts.identities} identity records · ${school.counts.classes} classes`,
                      `${school.counts.identities} 份身份档案 · ${school.counts.classes} 个班级`,
                    )}
                  </p>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {text(
                      `${school.counts.banks} banks · ${school.counts.courses} courses`,
                      `${school.counts.banks} 个题库 · ${school.counts.courses} 门课程`,
                    )}
                  </p>
                  <p>
                    {text(
                      `${school.counts.assignments} assignments · ${school.counts.papers} papers`,
                      `${school.counts.assignments} 项作业 · ${school.counts.papers} 套试卷`,
                    )}
                  </p>
                </div>
                <div className="min-w-0 text-xs">
                  <p className="mb-1 font-medium lg:sr-only">
                    {text("Administrators", "管理员")}
                  </p>
                  {school.administrators.length ? (
                    <ul className="space-y-1">
                      {school.administrators.map((administrator) => (
                        <li
                          key={administrator.accountId}
                          className="break-words"
                        >
                          {administrator.name}
                          <span className="ml-1 text-muted-foreground break-all">
                            ({administrator.username})
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">
                      {text("No active administrator", "暂无有效管理员")}
                    </span>
                  )}
                  {school.legacy && (
                    <p className="mt-1 text-muted-foreground">
                      {text(
                        "Existing administrator roles retained.",
                        "保留原有管理员角色。",
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 sm:col-span-2 lg:col-span-1 lg:justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={text(
                      `Rename ${school.name}`,
                      `修改 ${school.name} 的名称`,
                    )}
                    onClick={(event) =>
                      onAction({ mode: "rename", school }, event.currentTarget)
                    }
                  >
                    {text("Rename", "修改名称")}
                  </Button>
                  {!school.legacy && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={text(
                        `Assign administrator for ${school.name}`,
                        `为 ${school.name} 指定管理员`,
                      )}
                      onClick={(event) =>
                        onAction(
                          { mode: "administrator", school },
                          event.currentTarget,
                        )
                      }
                    >
                      {text("Assign admin", "指定管理员")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {text("No schools on this page.", "本页没有学校。")}
          </p>
        )}
        {(page > 1 || schools.data?.hasMore) && (
          <nav
            aria-label={text("School pages", "学校列表分页")}
            className="flex items-center justify-end gap-2 border-t border-border px-4 py-2"
          >
            <span className="text-xs text-muted-foreground">
              {text(`Page ${page}`, `第 ${page} 页`)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              {text("Previous", "上一页")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!schools.data?.hasMore}
              onClick={() => onPage(page + 1)}
            >
              {text("Next", "下一页")}
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </nav>
        )}
      </section>
    </Loading>
  );
}

"use client";

import { BarChart3, BookOpen, BookOpenCheck, ClipboardList, Clock3, Code2, Database, FileClock, FileCode2, Gauge, Home, LayoutDashboard, Library, NotebookPen, Settings, UserRound, Users } from "lucide-react";
import { AppLink } from "./navigation";
import { useLocale } from "./locale-context";
import { ScholarshipIcon } from "./scholarship/scholarship-icon";

type WorkspaceNavigationItem = {
  section: string;
  path: string;
  label: string;
  shortEnglish?: string;
  icon: typeof Home;
};

export const workspaceNavigation = {
  student: [
    { section: "home", path: "/", label: "首页", icon: Home },
    { section: "problems", path: "/student/problems", label: "题目", icon: Code2 },
    { section: "courses", path: "/student/learning-paths", label: "课程", icon: BookOpen },
    { section: "classes", path: "/student/classes", label: "我的班级", shortEnglish: "My classes", icon: Users },
    { section: "assignments", path: "/student/assignments", label: "我的作业", shortEnglish: "My assignments", icon: Library },
    { section: "timed", path: "/student/timed-practice", label: "限时训练", icon: FileClock },
    { section: "paper4", path: "/student/paper4", label: "Paper 4 练习", icon: FileCode2 },
    { section: "acsl", path: "/student/acsl", label: "ACSL 真题练习", shortEnglish: "ACSL practice", icon: ClipboardList },
    { section: "submissions", path: "/student/submissions", label: "提交记录", icon: FileClock },
    { section: "review-notebook", path: "/student/review-notebook", label: "订正本", icon: NotebookPen },
    { section: "scholarship", path: "/student/scholarship", label: "我的奖学金", shortEnglish: "Scholarship", icon: ScholarshipIcon },
  ],
  teacher: [
    { section: "home", path: "/teacher", label: "教师首页", shortEnglish: "Dashboard", icon: LayoutDashboard },
    { section: "classes", path: "/teacher/classes", label: "班级与学生", shortEnglish: "Classes", icon: Users },
    { section: "problems", path: "/teacher/problems", label: "题库", icon: BookOpenCheck },
    { section: "courses", path: "/teacher/courses", label: "课程", icon: BookOpen },
    { section: "assignments", path: "/teacher/assignments", label: "作业管理", shortEnglish: "Assignments", icon: ClipboardList },
    { section: "timed", path: "/teacher/timed-practice", label: "限时训练", icon: Clock3 },
    { section: "paper4", path: "/teacher/paper4", label: "Paper 4 试卷", shortEnglish: "Paper 4", icon: FileCode2 },
    { section: "acsl", path: "/teacher/acsl", label: "ACSL 题库", shortEnglish: "ACSL papers", icon: ClipboardList },
    { section: "reports", path: "/teacher/reports", label: "教学报告", shortEnglish: "Reports", icon: BarChart3 },
    { section: "scholarship", path: "/teacher/scholarship", label: "奖学金管理", shortEnglish: "Scholarship", icon: ScholarshipIcon },
    { section: "imports", path: "/teacher/imports", label: "导入中心", shortEnglish: "Imports", icon: Database },
  ],
  admin: [
    { section: "home", path: "/admin", label: "管理员首页", shortEnglish: "Dashboard", icon: Home },
    { section: "members", path: "/admin/accounts", label: "账号与角色", shortEnglish: "Accounts", icon: Users },
    { section: "identities", path: "/admin/people", label: "身份档案", shortEnglish: "Identities", icon: UserRound },
    { section: "imports", path: "/admin/imports", label: "导入中心", shortEnglish: "Imports", icon: Database },
    { section: "problems", path: "/admin/problem-banks", label: "题库管理", shortEnglish: "Problem banks", icon: BookOpenCheck },
    { section: "acsl", path: "/admin/acsl", label: "ACSL 题库", shortEnglish: "ACSL papers", icon: ClipboardList },
    { section: "course-admissions", path: "/admin/course-admissions", label: "课程申请", shortEnglish: "Course applications", icon: ClipboardList },
    { section: "judge", path: "/admin/judge-service", label: "判题服务", icon: Gauge },
    { section: "system-settings", path: "/admin/settings", label: "系统设置", icon: Settings },
    { section: "scholarship", path: "/admin/scholarship", label: "奖学金管理", shortEnglish: "Scholarship", icon: ScholarshipIcon },
  ],
} as const satisfies Record<string, readonly WorkspaceNavigationItem[]>;

const publicStudyPaths: Record<string, string> = {
  home: "/practice",
  problems: "/practice/problems",
  courses: "/practice/courses",
  submissions: "/practice/submissions",
  "review-notebook": "/practice/review-notebook",
  scholarship: "/practice/scholarship",
};

export const publicStudyNavigation = workspaceNavigation.student
  .filter(item => Object.hasOwn(publicStudyPaths, item.section))
  .map(item => ({ ...item, path: publicStudyPaths[item.section] }));

export function useWorkspaceNavigationLabel() {
  const { locale, t } = useLocale();
  return (item: Pick<WorkspaceNavigationItem, "label" | "shortEnglish">) =>
    locale === "en" ? item.shortEnglish ?? t(item.label) : item.label;
}

export function WorkspaceNavigation({ items, disabled = false }: {
  items: ReadonlyArray<Pick<WorkspaceNavigationItem, "label" | "shortEnglish" | "icon"> & { href: string; active: boolean }>;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const label = useWorkspaceNavigationLabel();
  return (
    <nav className="space-y-1 p-3" aria-label={t("工作区导航")}>
      {items.map((item) => {
        const className = `flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm ${item.active ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
        const content = <>
          <item.icon size={17} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{label(item)}</span>
        </>;
        return disabled ? (
          <span key={item.href} aria-current={item.active ? "page" : undefined} aria-disabled="true" className={`${className} opacity-60`}>{content}</span>
        ) : (
          <AppLink key={item.href} href={item.href} aria-current={item.active ? "page" : undefined} className={className}>{content}</AppLink>
        );
      })}
    </nav>
  );
}

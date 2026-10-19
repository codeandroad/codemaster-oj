export type BreadcrumbRole = "student" | "teacher" | "admin";
export type BreadcrumbLocale = "zh" | "en";
export type PageBreadcrumb = { label: string; href: string };
type Label = readonly [zh: string, en: string];
const sections: Record<string, Label> = {
  "/login": ["登录", "Sign in"], "/register": ["注册", "Register"],
  "/student/problems": ["题目", "Problems"],
  "/student/learning-paths": ["课程", "Courses"],
  "/student/classes": ["我的班级", "My classes"],
  "/student/assignments": ["作业", "Assignments"],
  "/student/timed-practice": ["限时训练", "Timed practice"],
  "/student/paper4": ["Paper 4 练习", "Paper 4 practice"],
  "/student/submissions": ["提交记录", "Submissions"],
  "/student/review-notebook": ["订正本", "Review notebook"],
  "/teacher/classes": ["班级与学生", "Classes"],
  "/teacher/problems": ["题库", "Problem banks"],
  "/teacher/courses": ["课程", "Courses"],
  "/teacher/learning": ["课程", "Courses"],
  "/teacher/assignments": ["作业", "Assignments"],
  "/teacher/timed-practice": ["限时训练", "Timed practice"],
  "/teacher/paper4": ["Paper 4 试卷", "Paper 4"],
  "/teacher/reports": ["教学报告", "Reports"],
  "/teacher/imports": ["导入中心", "Imports"],
  "/admin/accounts": ["账号与角色", "Accounts"],
  "/admin/people": ["身份档案", "Identities"],
  "/admin/imports": ["导入中心", "Imports"],
  "/admin/problem-banks": ["题库管理", "Problem banks"],
  "/admin/judge-service": ["判题服务", "Judge service"],
  "/admin/settings": ["系统设置", "System settings"],
};
for (const role of ["student", "teacher", "admin"]) {
  sections[`/${role}/profile`] = ["个人资料", "Profile"];
  sections[`/${role}/points`] = ["积分排行榜", "Leaderboard"];
  sections[`/${role}/${role === "admin" ? "personal-settings" : "settings"}`] = ["个人设置", "Settings"];
}

/** Only declared campus pages become ancestors; identifiers are never labels. */
export function pageBreadcrumbs(pathname: string, role: BreadcrumbRole, locale: BreadcrumbLocale, currentTitle = "", search?: Pick<URLSearchParams, "get">): PageBreadcrumb[] {
  const label = (value: Label) => value[locale === "en" ? 1 : 0];
  const home = role === "student" ? "/" : `/${role}`;
  const root: PageBreadcrumb = { href: home, label: label(role === "student" ? ["首页", "Home"] : role === "teacher" ? ["教师工作台", "Teacher workspace"] : ["管理工作台", "Admin workspace"]) };
  if (pathname === home || pathname === "/") return [root];
  const detail = (ancestor: string, fallback: Label, middle?: PageBreadcrumb) => [
    root,
    { href: ancestor, label: label(sections[ancestor]) },
    ...(middle ? [middle] : []),
    { href: pathname, label: currentTitle.trim() || label(fallback) },
  ];
  if (pathname === "/admin/imports") {
    const trail = detail("/admin/people", sections[pathname]);
    const kind = search?.get("kind");
    if (kind === "teacher" || kind === "student") trail[1].href += `?${new URLSearchParams({ kind })}`;
    return trail;
  }
  if (pathname === "/teacher/imports" && ["students", "members"].includes(search?.get("kind") ?? "")) {
    const trail = detail("/teacher/classes", ["学生名单导入", "Import students"]);
    const classId = search?.get("classId");
    if (classId) trail[1].href += `?${new URLSearchParams({ classId })}`;
    return trail;
  }
  if (sections[pathname]) return [root, { href: pathname, label: label(sections[pathname]) }];
  if (/^\/teacher\/problems\/banks\/[^/]+$/.test(pathname)) return detail("/teacher/problems", ["题库详情", "Bank details"]);
  if (/^\/teacher\/problems\/[^/]+\/edit$/.test(pathname)) {
    const trail = detail("/teacher/problems", ["编辑题目", "Edit problem"]);
    const returnTo = search?.get("returnTo");
    if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
      const source = new URL(returnTo, "http://campus.local");
      if (source.pathname === "/teacher/problems") trail[1].href = source.pathname + source.search;
      else if (/^\/teacher\/problems\/banks\/[a-z0-9-]+$/i.test(source.pathname)) {
        trail.splice(2, 0, { href: source.pathname + source.search, label: label(["题库详情", "Bank details"]) });
      }
      else if (source.pathname === "/teacher/imports" || /^\/teacher\/assignments\/[a-z0-9-]+\/(edit|progress)$/i.test(source.pathname)) {
        const sourceTrail = pageBreadcrumbs(source.pathname, role, locale, "", source.searchParams);
        sourceTrail[sourceTrail.length - 1].href += source.search;
        return [...sourceTrail, trail[trail.length - 1]];
      }
    }
    return trail;
  }
  if (/^\/teacher\/assignments\/[^/]+\/(progress|edit)$/.test(pathname)) return detail("/teacher/assignments", pathname.endsWith("/edit") ? ["编辑作业", "Edit assignment"] : ["作业进度", "Assignment progress"]);
  if (/^\/teacher\/timed-practice\/[^/]+\/(edit|progress)$/.test(pathname)) return detail("/teacher/timed-practice", pathname.endsWith("/edit") ? ["编辑训练", "Edit practice"] : ["训练进度", "Practice progress"]);
  if (/^\/teacher\/(learning|courses)\/[^/]+$/.test(pathname)) return detail("/teacher/courses", ["课程详情", "Course details"]);
  if (/^\/teacher\/timed-practice\/[^/]+$/.test(pathname)) return detail("/teacher/timed-practice", ["训练详情", "Practice details"]);
  const review = pathname.match(/^\/teacher\/paper4\/([^/]+)\/review\/[^/]+$/);
  if (review) return detail("/teacher/paper4", ["作答评阅", "Review attempt"], { href: `/teacher/paper4/${review[1]}`, label: label(["试卷详情", "Paper details"]) });
  if (/^\/teacher\/paper4\/[^/]+$/.test(pathname)) return detail("/teacher/paper4", ["试卷详情", "Paper details"]);
  const chapter = pathname.match(/^\/student\/learning-paths\/([^/]+)\/chapters\/[^/]+$/);
  if (chapter) return detail("/student/learning-paths", ["章节学习", "Chapter"], { href: `/student/learning-paths/${chapter[1]}`, label: label(["课程详情", "Course details"]) });
  const studentDetail = pathname.match(/^\/student\/(classes|problems|assignments|submissions|learning-paths|timed-practice|paper4|review-notebook)\/[^/]+$/);
  if (studentDetail) {
    const fallback: Record<string, Label> = {
      classes: ["班级详情", "Class details"], problems: ["题目详情", "Problem details"],
      assignments: ["作业详情", "Assignment details"], submissions: ["提交详情", "Submission details"],
      "learning-paths": ["课程详情", "Course details"], "timed-practice": ["训练详情", "Practice details"],
      paper4: ["试卷练习", "Paper practice"], "review-notebook": ["订正详情", "Review details"],
    };
    return detail(`/student/${studentDetail[1]}`, fallback[studentDetail[1]]);
  }
  if (/^\/(student|teacher|admin)\/people\/[^/]+$/.test(pathname)) {
    const from = search?.get("from");
    const classId = search?.get("classId");
    const classQuery = classId ? `?${new URLSearchParams({ classId })}` : "";
    const source = from === "points" ? `/${role}/points`
      : from === "reports" && role === "admin" ? "/admin/settings"
      : from === "classes" && role === "teacher" ? "/teacher/classes"
      : from === "profile" && role === "student" ? "/student/profile" : null;
    if (source) {
      const trail = detail(source, ["个人主页", "Student profile"]);
      if (from === "reports") trail[1] = { href: `${source}?tab=reports`, label: label(["留言举报", "Message reports"]) };
      else if (from === "points" || from === "classes") trail[1].href += classQuery;
      return trail;
    }
    const ancestor = role === "admin" ? "/admin/people" : role === "teacher" ? "/teacher/classes" : "/student/classes";
    return detail(ancestor, ["个人主页", "Student profile"]);
  }
  return [root, { href: pathname, label: currentTitle.trim() || label(["页面", "Page"]) }];
}

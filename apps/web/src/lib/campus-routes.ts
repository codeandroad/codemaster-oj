const availablePages = new Set([
  "/student/acsl",
  "/teacher/acsl", "/admin/acsl",
  "/student/scholarship", "/teacher/scholarship", "/admin/scholarship",
  "/practice/scholarship",
  "/student/settings", "/teacher/settings", "/admin/personal-settings",
  "/student/points", "/teacher/points", "/admin/points", "/admin/profile",
  "/", "/login", "/register", "/admin", "/teacher", "/schools", "/platform", "/activate", "/practice", "/practice/courses", "/practice/problems", "/practice/settings", "/practice/profile", "/practice/submissions", "/practice/review-notebook", "/practice/leaderboard",
  "/admin/course-admissions", "/admin/people", "/admin/accounts", "/admin/imports", "/admin/problem-banks", "/admin/judge-service", "/admin/settings",
  "/teacher/classes", "/teacher/imports", "/teacher/problems", "/teacher/assignments", "/teacher/reports",
  "/teacher/learning", "/teacher/courses", "/teacher/timed-practice", "/teacher/paper4", "/teacher/profile",
  "/student/classes", "/student/problems", "/student/assignments", "/student/submissions", "/student/review-notebook",
  "/student/learning-paths", "/student/timed-practice", "/student/paper4", "/student/profile",
]);

const detailPages = [
  /^\/practice\/courses\/[^/]+$/,
  /^\/student\/classes\/[^/]+$/,
  /^\/teacher\/problems\/banks\/[^/]+$/,
  /^\/teacher\/paper4\/[^/]+$/,
  /^\/teacher\/paper4\/[^/]+\/review\/[^/]+$/,
  /^\/student\/paper4\/[^/]+$/,
  /^\/teacher\/problems\/[^/]+\/edit$/,
  /^\/teacher\/assignments\/[^/]+\/(progress|edit|preview)$/,
  /^\/teacher\/timed-practice\/[^/]+\/(edit|progress)$/,
  /^\/teacher\/(learning|courses|timed-practice)\/[^/]+$/,
  /^\/student\/learning-paths\/[^/]+\/chapters\/[^/]+$/,
  /^\/student\/review-notebook\/[^/]+$/,
  /^\/(student|teacher|admin)\/people\/[^/]+$/,
  /^\/student\/(problems|assignments|submissions|learning-paths|timed-practice)\/[^/]+$/,
];

export function isCampusRoute(pathname: string) {
  return availablePages.has(pathname) || detailPages.some((pattern) => pattern.test(pathname));
}

export function isCampusAuthRoute(pathname: string) {
  return pathname === "/login" || pathname === "/register" || pathname === "/activate";
}

export function loginReturnTo(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const origin = "https://campus.invalid";
  const url = new URL(value, origin);
  if (url.origin !== origin || !isCampusRoute(url.pathname) || isCampusAuthRoute(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}


const legacyLearnerSections: Record<string, string> = {
  "/student/problems": "problems",
  "/student/learning-paths": "courses",
  "/student/submissions": "submissions",
  "/student/review-notebook": "review-notebook",
};

const publicLearnerQuery: Record<string, string[]> = {
  problems: ["problemId"],
  courses: [],
  submissions: ["submissionId", "submissionSchoolId"],
  "review-notebook": ["submissionId", "submissionSchoolId", "review"],
};

/** Preserve a public bookmark when its former school workspace is no longer available. */
export function resolvePublicLearningBookmark(pathname: string, search: Pick<URLSearchParams, "get">) {
  if (search.get("scope") !== "public") return null;
  const section = pathname === "/schools" ? search.get("section") : legacyLearnerSections[pathname];
  if (!section || !Object.hasOwn(publicLearnerQuery, section)) return null;
  const base = `/practice/${section}`;
  const courseId = search.get("publicCourseId");
  if (section === "courses" && courseId) return `${base}/${encodeURIComponent(courseId)}`;
  const query = new URLSearchParams();
  for (const field of publicLearnerQuery[section]) {
    const value = search.get(field);
    if (value) query.set(field, value);
  }
  return query.size ? `${base}?${query}` : base;
}

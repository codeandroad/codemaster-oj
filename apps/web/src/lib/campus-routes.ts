const availablePages = new Set([
  "/student/settings", "/teacher/settings",
  "/student/points", "/teacher/points", "/admin/points", "/admin/profile",
  "/", "/login", "/register", "/admin", "/teacher",
  "/admin/people", "/admin/accounts", "/admin/imports", "/admin/judge-service", "/admin/settings",
  "/teacher/classes", "/teacher/imports", "/teacher/problems", "/teacher/assignments", "/teacher/reports",
  "/teacher/learning", "/teacher/timed-practice", "/teacher/profile",
  "/student/problems", "/student/assignments", "/student/submissions", "/student/review-notebook",
  "/student/learning-paths", "/student/timed-practice", "/student/profile",
]);

const detailPages = [
  /^\/teacher\/problems\/banks\/[^/]+$/,
  /^\/teacher\/problems\/[^/]+\/edit$/,
  /^\/teacher\/assignments\/[^/]+\/(progress|edit)$/,
  /^\/teacher\/timed-practice\/[^/]+\/(edit|progress)$/,
  /^\/teacher\/(learning|timed-practice)\/[^/]+$/,
  /^\/student\/learning-paths\/[^/]+\/chapters\/[^/]+$/,
  /^\/student\/review-notebook\/[^/]+$/,
  /^\/(student|teacher|admin)\/people\/[^/]+$/,
  /^\/student\/(problems|assignments|submissions|learning-paths|timed-practice)\/[^/]+$/,
];

export function isCampusRoute(pathname: string) {
  return availablePages.has(pathname) || detailPages.some((pattern) => pattern.test(pathname));
}

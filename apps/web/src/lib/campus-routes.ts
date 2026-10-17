const availablePages = new Set([
  "/student/settings", "/teacher/settings", "/admin/personal-settings",
  "/student/points", "/teacher/points", "/admin/points", "/admin/profile",
  "/", "/login", "/register", "/admin", "/teacher",
  "/admin/people", "/admin/accounts", "/admin/imports", "/admin/problem-banks", "/admin/judge-service", "/admin/settings",
  "/teacher/classes", "/teacher/imports", "/teacher/problems", "/teacher/assignments", "/teacher/reports",
  "/teacher/learning", "/teacher/courses", "/teacher/timed-practice", "/teacher/paper4", "/teacher/profile",
  "/student/classes", "/student/problems", "/student/assignments", "/student/submissions", "/student/review-notebook",
  "/student/learning-paths", "/student/timed-practice", "/student/paper4", "/student/profile",
]);

const detailPages = [
  /^\/student\/classes\/[^/]+$/,
  /^\/teacher\/problems\/banks\/[^/]+$/,
  /^\/teacher\/paper4\/[^/]+$/,
  /^\/teacher\/paper4\/[^/]+\/review\/[^/]+$/,
  /^\/student\/paper4\/[^/]+$/,
  /^\/teacher\/problems\/[^/]+\/edit$/,
  /^\/teacher\/assignments\/[^/]+\/(progress|edit)$/,
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

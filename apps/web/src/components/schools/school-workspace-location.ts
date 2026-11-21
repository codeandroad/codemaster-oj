export type SchoolWorkspaceRole = "admin" | "teacher" | "student";

export function schoolWorkspaceRole(
  roles: readonly string[],
  requested: string | null,
  section: string | null,
  teachingSections: ReadonlySet<string>,
): SchoolWorkspaceRole {
  if (roles.includes("school_admin")) {
    // Old bookmarks to teaching-only pages still work for administrators.
    return requested === "teacher" || (!requested && section !== null && teachingSections.has(section))
      ? "teacher" : "admin";
  }
  return roles.includes("teacher") ? "teacher" : "student";
}

export function schoolWorkspaceHref(schoolId: string, section = "home", role?: SchoolWorkspaceRole) {
  const params = new URLSearchParams({ schoolId, section });
  if (role === "teacher") params.set("schoolRole", "teacher");
  return `/schools?${params}`;
}

/** Resolve a saved role-based URL in the same school, including its open resource and view. */
export function schoolBookmarkQuery(pathname: string, search: URLSearchParams, schoolId?: string | null) {
  const [, role, section = "home", id, child, detailId] = pathname.split("/");
  const sections: Record<string,string> = {
    "learning-paths":"courses", learning:"courses", "timed-practice":"timed", points:"leaderboard",
    people:id ? "leaderboard" : "identities", accounts:"members", "problem-banks":"problems",
    "judge-service":"judge", settings:role === "admin" ? "system-settings" : "personal-settings",
  };
  const target = sections[section] ?? section;
  const query = new URLSearchParams(search);
  query.set("section",target);
  if (schoolId) query.set("schoolId",schoolId);
  if (role === "student" || role === "teacher" || role === "admin") query.set("schoolRole",role);
  const keys:Record<string,string> = {courses:"courseId",problems:"problemId",classes:"classId",assignments:"activityId",
    timed:"activityId",submissions:"submissionId",paper4:"paper4Id",leaderboard:"profileId"};
  if (id && keys[target]) query.set(keys[target],id);
  if (role === "teacher" && target === "courses" && id && !child) query.set("courseEdit","1");
  if (role === "teacher" && target === "problems" && child === "edit") query.set("problemEdit","1");
  if (role === "teacher" && target === "timed" && id && !child) query.set("activityReport","1");
  if (target === "review-notebook" && id) query.set("reviewEntryId",id);
  if (target === "courses" && child === "chapters" && detailId) query.set("chapterId",detailId);
  if (target === "exam-preparation" && id) {
    query.set("subject",id);
    if (child) query.set("component",child);
  }
  if ((target === "assignments" || target === "timed") && child) {
    const actions:Record<string,string> = {edit:"activityEdit",preview:"activityPreview",progress:"activityReport"};
    if (actions[child]) query.set(actions[child],"1");
  }
  if (target === "problems" && id === "banks" && child) {
    query.delete("problemId"); query.set("bankId",child); query.set("problemTab","problems");
  }
  if (target === "problems" && id === "solutions-review") {
    query.delete("problemId"); query.set("section","scholarship");
  }
  if (target === "paper4" && child === "review" && detailId) query.set("paper4AttemptId",detailId);
  return query;
}

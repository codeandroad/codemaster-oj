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

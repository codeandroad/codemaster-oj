type LoginUser = {
  roles: readonly string[];
  platformAdmin?: boolean;
  defaultSchoolId?: string | null;
};

type LoginSchool = { id: string; legacy: boolean };

/** Select only from current memberships; a saved preference never grants access. */
export function resolveLoginDestination({
  user,
  schools,
  preferredSchoolId,
  joinIntent = false,
}: {
  user: LoginUser;
  schools: readonly LoginSchool[];
  preferredSchoolId?: string | null;
  joinIntent?: boolean;
}): { href: string; schoolId: string | null } {
  if (user.platformAdmin) {
    return {
      href: joinIntent ? "/platform?section=settings#schools" : "/platform",
      schoolId: null,
    };
  }

  const legacyRole = user.roles.includes("admin")
    ? "admin"
    : user.roles.includes("teacher")
      ? "teacher"
      : user.roles.includes("student")
        ? "student"
        : null;
  const selected =
    schools.find((school) => school.id === user.defaultSchoolId) ??
    schools.find((school) => school.id === preferredSchoolId) ??
    (legacyRole ? schools.find((school) => school.legacy) : undefined) ??
    schools.find((school) => !school.legacy) ??
    schools[0];

  if (!selected) {
    return {
      href: joinIntent ? "/practice/settings#schools" : "/practice",
      schoolId: null,
    };
  }

  if (selected.legacy && legacyRole) {
    const home = legacyRole === "student" ? "/" : `/${legacyRole}`;
    const settings = legacyRole === "admin" ? "/admin/personal-settings" : `/${legacyRole}/settings`;
    return { href: joinIntent ? `${settings}#schools` : home, schoolId: selected.id };
  }

  return {
    href: joinIntent ? "/schools?section=personal-settings#schools" : "/schools",
    schoolId: selected.id,
  };
}

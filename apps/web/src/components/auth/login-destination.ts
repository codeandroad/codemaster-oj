type LoginUser = {
  roles: readonly string[];
  platformAdmin?: boolean;
  defaultSchoolId?: string | null;
};

type LoginSchool = { id: string };

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

  const selected =
    schools.find((school) => school.id === user.defaultSchoolId) ??
    schools.find((school) => school.id === preferredSchoolId) ??
    schools[0];

  if (!selected) {
    return {
      href: joinIntent ? "/practice/settings#schools" : "/practice",
      schoolId: null,
    };
  }


  return {
    href: joinIntent ? "/schools?section=personal-settings#schools" : "/schools",
    schoolId: selected.id,
  };
}

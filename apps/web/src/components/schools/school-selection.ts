/** A browser preference only. The server's current memberships remain authoritative. */
export type SchoolPreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function schoolSelectionStorageKey(accountId: string): string {
  return `codemaster:current-school:v1:${accountId.toLowerCase()}`;
}

export function resolveSchoolSelection<T extends { id: string; legacy: boolean }>(
  items: readonly T[],
  preferredId: string,
): T | undefined {
  return (
    items.find((school) => school.id === preferredId) ??
    items.find((school) => !school.legacy) ??
    items[0]
  );
}

/** Current navigation takes precedence over the default for the next sign-in. */
export function resolveCurrentSchoolSelection<T extends { id: string; legacy: boolean }>(
  items: readonly T[],
  {
    activeSchoolId,
    savedSchoolId,
    defaultSchoolId,
  }: {
    activeSchoolId?: string | null;
    savedSchoolId?: string | null;
    defaultSchoolId?: string | null;
  },
): T | undefined {
  for (const candidate of [activeSchoolId, savedSchoolId, defaultSchoolId]) {
    if (!candidate) continue;
    const memberSchool = items.find((school) => school.id === candidate);
    if (memberSchool) return memberSchool;
  }
  return resolveSchoolSelection(items, "");
}

function browserStorage(): SchoolPreferenceStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readSchoolPreference(
  accountId: string,
  storage?: SchoolPreferenceStorage,
): string {
  if (!UUID.test(accountId)) return "";
  try {
    const value = (storage ?? browserStorage())?.getItem(
      schoolSelectionStorageKey(accountId),
    );
    return value && UUID.test(value) ? value.toLowerCase() : "";
  } catch {
    // Private browsing or blocked storage must not prevent access to a school.
    return "";
  }
}

export function writeSchoolPreference(
  accountId: string,
  schoolId: string,
  storage?: SchoolPreferenceStorage,
): void {
  if (!UUID.test(accountId) || !UUID.test(schoolId)) return;
  try {
    (storage ?? browserStorage())?.setItem(
      schoolSelectionStorageKey(accountId),
      schoolId.toLowerCase(),
    );
  } catch {
    // Selection still works for this page when persistence is unavailable.
  }
}

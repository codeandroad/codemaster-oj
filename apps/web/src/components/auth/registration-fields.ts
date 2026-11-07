export type RegistrationField = "schoolSlug" | "number" | "name" | "activationCode" | "username" | "password" | "confirmation" | "email";
export type RegistrationValues = Record<RegistrationField, string>;
export type ActivationSchool = { id: string; slug: string; name: string; nameZh?: string | null; nameEn?: string | null };
export function activationSchoolName(school: ActivationSchool, locale: string): string {
  return (locale === "en" ? school.nameEn || school.nameZh : school.nameZh || school.nameEn) || school.name;
}
export function activationSchoolLabel(school: ActivationSchool, schools: ActivationSchool[], locale: string): string {
  const name = activationSchoolName(school, locale);
  return schools.some(other => other.id !== school.id && activationSchoolName(other, locale) === name)
    ? `${name} (${school.slug})` : name;
}
export type RegistrationIssue = { field: RegistrationField; kind: "required" | "username" | "password" | "confirmation" | "email" };

/** Presentation validation only; identity claims and creation remain server-authorized. */
export function registrationIssue(step: "verify" | "account", values: RegistrationValues): RegistrationIssue | null {
  if (step === "verify") {
    for (const field of ["schoolSlug", "number", "name", "activationCode"] as const) {
      if (!values[field].trim()) return { field, kind: "required" };
    }
    return null;
  }
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/i.test(values.username.trim())) return { field: "username", kind: "username" };
  if (values.password.length < 8 || values.password.length > 128) return { field: "password", kind: "password" };
  if (values.password !== values.confirmation) return { field: "confirmation", kind: "confirmation" };
  const email = values.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: "email", kind: "email" };
  return null;
}

export type ActivationSchool = { id: string; slug: string; name: string; nameZh?: string | null; nameEn?: string | null };
export function activationSchoolName(school: ActivationSchool, locale: string): string {
  return (locale === "en" ? school.nameEn || school.nameZh : school.nameZh || school.nameEn) || school.name;
}
export function activationSchoolLabel(school: ActivationSchool, schools: ActivationSchool[], locale: string): string {
  const name = activationSchoolName(school, locale);
  return schools.some(other => other.id !== school.id && activationSchoolName(other, locale) === name)
    ? `${name} (${school.slug})` : name;
}
type PersonalRegistration = {username:string; password:string; confirmation:string; email:string};
export function invalidAccountField(values: PersonalRegistration): keyof PersonalRegistration | null {
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/i.test(values.username.trim())) return "username";
  if (values.password.length < 8 || values.password.length > 128) return "password";
  if (values.password !== values.confirmation) return "confirmation";
  const email = values.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "email";
  return null;
}

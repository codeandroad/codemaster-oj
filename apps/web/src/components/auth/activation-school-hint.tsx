"use client";

import { useData } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { activationSchoolName, type ActivationSchool } from "./registration-fields";

/** Original-school credentials keep their existing IDs and issuing workflow. */
export function LegacyActivationSchoolHint() {
  const { locale } = useLocale();
  const schools = useData<{items:ActivationSchool[]}>("auth/activation-schools");
  const school = schools.data?.items.find(item => item.slug === "legacy-school");
  return <p className="text-sm text-muted-foreground">{locale === "en" ? "School" : "学校"}：{school ? activationSchoolName(school, locale) : locale === "en" ? "Original school" : "原学校"} · {locale === "en" ? "Select this school when activating your identity." : "激活身份时请选择本学校。"}</p>;
}

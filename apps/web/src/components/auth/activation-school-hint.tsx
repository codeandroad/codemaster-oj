"use client";

import { useLocale } from "@/components/locale-context";
import { activationSchoolName, type ActivationSchool } from "./registration-fields";

export type { ActivationSchool };

export function ActivationSchoolHint({ school }: { school?: ActivationSchool }) {
  const { locale } = useLocale();
  if (!school) return null;
  return <p className="text-sm text-muted-foreground">{activationSchoolName(school, locale)} · {locale === "en" ? "Select this school when activating your identity." : "激活身份时请选择本学校。"}</p>;
}

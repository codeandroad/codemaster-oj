"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { languageInfo, supportedLanguages } from "@/components/student/languages";
import type { SubmissionLanguage } from "@/lib/production-api";

export function CourseProgrammingLanguageField({ className, value, onChange }: {
  className: string;
  value?: SubmissionLanguage | null;
  onChange?: (value: SubmissionLanguage | null) => void;
}) {
  const { locale } = useLocale();
  const id = useId();
  const en = locale === "en";
  return <div className="grid gap-1">
    <label htmlFor={id} className="text-sm font-semibold">{en ? "Required programming language" : "必用编程语言"}</label>
    <select id={id} name="requiredLanguage" className={className} aria-describedby={`${id}-help`}
      value={value === undefined ? undefined : value ?? ""}
      onChange={onChange ? event => onChange((event.target.value || null) as SubmissionLanguage | null) : undefined}>
      <option value="">{en ? "Any supported language" : "不限语言"}</option>
      {supportedLanguages.map(language => <option key={language} value={language}>{languageInfo[language].name}</option>)}
    </select>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">
      {en ? "Applies to ordinary coding exercises in this course. Linked assignments keep the language requirement set when they are published." : "适用于课程中的普通编程练习。关联作业会保留发布时的语言要求。"}
    </p>
  </div>;
}

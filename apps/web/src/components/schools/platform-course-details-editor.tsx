"use client";

import { useId, useState } from "react";
import { useCourseLanguage } from "@/components/course-language";
import type { CourseLanguage, CourseLocalizedDetails, CourseLocalizations } from "@/components/course-localization";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/admin/common";
import { useSchoolText } from "./school-ui";

type Details = CourseLocalizedDetails & { localizations?: CourseLocalizations };
const equal = (left: CourseLocalizedDetails, right?: CourseLocalizedDetails) => Boolean(right && left.title === right.title && left.description === right.description);

/** Keep original fallbacks while presenting one editable language at a time. */
export function PlatformCourseDetailsEditor({ course, onChange, disabled }: {
  course: Details; onChange: (value: Details) => void; disabled?: boolean;
}) {
  const text = useSchoolText(), id = useId(), { language: preferred } = useCourseLanguage();
  const [originalLanguage, setOriginalLanguage] = useState<CourseLanguage | null>(() => {
    if (!course.localizations?.en || !course.localizations.zh) return null;
    const matches = (["en", "zh"] as const).filter(language => equal(course, course.localizations?.[language]));
    return matches.length === 1 ? matches[0] : null;
  });
  const [selected, setSelected] = useState<CourseLanguage | "original">(() => course.localizations?.en && course.localizations.zh ? preferred : "original");
  const value = selected === "original" ? course : course.localizations?.[selected];
  function update(field: keyof CourseLocalizedDetails, content: string) {
    if (!value) return;
    if (selected === "original") onChange({ ...course, [field]: content });
    else {
      const translated = { ...value, [field]: content };
      onChange({ ...course, ...(selected === originalLanguage && equal(course, value) ? translated : {}), localizations: { ...course.localizations, [selected]: translated } });
    }
  }
  return <section className="space-y-3" data-od-id="platform-course-details">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="flex min-w-0 max-w-full items-center gap-2 text-sm font-medium">
        <span className="shrink-0 whitespace-nowrap">{text("Course language", "课程信息语言")}</span>
        <select id={id} className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3" value={selected} disabled={disabled} onChange={event => setSelected(event.target.value as CourseLanguage | "original")}>
          {(!originalLanguage || selected === "original") && <option value="original">{text("Original", "原文")}</option>}
          <option value="en">English</option><option value="zh">中文</option>
        </select>
      </label>
      {selected !== "original" && value && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => {
        if (!window.confirm(text("Remove this language version? The original and other language will be kept.", "移除此语言版本？原文和另一语言的内容会保留。"))) return;
        const localizations = { ...course.localizations }; delete localizations[selected];
        if (originalLanguage === selected) setOriginalLanguage(null);
        onChange({ ...course, localizations }); setSelected("original");
      }}>{text("Remove this language", "移除此语言版本")}</Button>}
    </div>
    {!value ? <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm">
      <p>{text("This language has not been added. Students currently see the original.", "尚未添加此语言的内容，学生暂时看到原文。")}</p>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => {
        if (selected !== "original") onChange({ ...course, localizations: { ...course.localizations, [selected]: { title: course.title, description: course.description } } });
      }}>{text("Start from original", "复制原文并开始编辑")}</Button>
    </div> : <>
      <label className="grid gap-2 text-sm font-semibold">{text("Course title", "课程名称")}<input className={inputClass} required maxLength={200} value={value.title} disabled={disabled} data-od-id={`platform-course-title-${selected}`} onChange={event => update("title", event.target.value)}/></label>
      <label className="grid gap-2 text-sm font-semibold">{text("Description", "课程简介")}<textarea className={`${inputClass} h-24 py-2`} maxLength={4000} value={value.description} disabled={disabled} data-od-id={`platform-course-description-${selected}`} onChange={event => update("description", event.target.value)}/></label>
    </>}
  </section>;
}

"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useLocale } from "./locale-context";
import { Button } from "./ui/button";
import { inputClass } from "./admin/common";
import { localizedSection, type CourseSection } from "./course-sections";

export function CourseSectionsEditor({ sections, chapters, onChange, disabled = false }: {
  sections: CourseSection[]; chapters: { sectionKey?: string | null }[]; onChange: (sections: CourseSection[]) => void; disabled?: boolean;
}) {
  const { locale } = useLocale(), text = (zh: string, en: string) => locale === "en" ? en : zh;
  function update(index: number, patch: Partial<CourseSection>) { onChange(sections.map((section, i) => i === index ? { ...section, ...patch } : section)); }
  const groups = [...new Map(sections.filter(section => section.groupKey).map(section => [section.groupKey!, section])).values()];
  function translation(index: number, language: "en" | "zh", field: "title" | "groupTitle", value: string) {
    const section = sections[index];
    onChange(sections.map((item, i) => {
      if (field === "groupTitle" ? item.groupKey !== section.groupKey : i !== index) return item;
      const localizations = { ...item.localizations }, next = { ...localizations[language], [field]: value };
      if (!next.title && !next.groupTitle) delete localizations[language];
      else localizations[language] = { title: next.title || item.title, ...(next.groupTitle ? { groupTitle: next.groupTitle } : {}) };
      return { ...item, localizations };
    }));
  }
  function assignGroup(index: number, key: string) {
    const section = sections[index], group = groups.find(item => item.groupKey === key);
    const localizations = { ...section.localizations };
    for (const language of ["en", "zh"] as const) {
      const groupTitle = sections.find(item => item.groupKey === key && item.localizations?.[language]?.groupTitle)?.localizations?.[language]?.groupTitle;
      if (localizations[language] || groupTitle) localizations[language] = { title: localizations[language]?.title ?? section.title, ...(groupTitle ? { groupTitle } : {}) };
    }
    update(index, { groupKey: key === "__new__" ? `group-${crypto.randomUUID().slice(0, 8)}` : group?.groupKey,
      groupTitle: key === "__new__" ? text("新分组", "New group") : group?.groupTitle, localizations });
  }
  return <details className="rounded-lg border border-border bg-surface p-4" data-od-id="course-sections-editor">
    <summary className="min-h-8 cursor-pointer font-semibold">{text("专题组织", "Course topics")} · {sections.length}</summary>
    <p className="mt-2 text-sm text-muted-foreground">{text("专题归属同一门课程，共享学习进度。目录分组名称可填写 Contest 1、Contest 2。", "Topics belong to this course and share its progress. Use directory groups such as Contest 1 and Contest 2.")}</p>
    <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-4">
      {sections.map((section, index) => {
        const used = chapters.filter(chapter => chapter.sectionKey === section.key).length;
        return <div key={section.key} className="space-y-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{text("专题", "Topic")} {index + 1} · {used} {text("课时", "lessons")}</span><div className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" aria-label={text("专题上移", "Move topic up")} disabled={index === 0} onClick={() => { const next = [...sections]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}><ArrowUp size={15}/></Button>
            <Button type="button" size="sm" variant="ghost" aria-label={text("专题下移", "Move topic down")} disabled={index === sections.length - 1} onClick={() => { const next = [...sections]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }}><ArrowDown size={15}/></Button>
            <Button type="button" size="sm" variant="ghost" disabled={used > 0} title={used ? text("先调整课时归属，再删除专题", "Reassign its lessons before removing this topic") : undefined} aria-label={text("删除专题", "Remove topic")} onClick={() => onChange(sections.filter((_, i) => i !== index))}><Trash2 size={15}/></Button>
          </div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">{text("专题标题", "Topic title")}<input className={inputClass} maxLength={200} value={section.title} onChange={event => update(index, { title: event.target.value })}/></label>
            <label className="grid gap-1 text-sm">{text("目录分组（选填）", "Directory group (optional)")}<select className={inputClass} value={section.groupKey ?? ""} onChange={event => assignGroup(index, event.target.value)}><option value="">{text("不分组", "No group")}</option>{groups.map(group => <option key={group.groupKey} value={group.groupKey}>{group.groupTitle}</option>)}<option value="__new__">{text("新建分组…", "New group…")}</option></select></label>
            {section.groupKey && <label className="grid gap-1 text-sm sm:col-span-2">{text("分组名称（应用到整组）", "Group name (applies to all its topics)")}<input className={inputClass} maxLength={200} value={section.groupTitle ?? ""} onChange={event => onChange(sections.map(item => item.groupKey === section.groupKey ? { ...item, groupTitle: event.target.value } : item))}/></label>}
            {(["en", "zh"] as const).map(language => <label key={language} className="grid gap-1 text-sm">{language === "en" ? text("英文专题标题（选填）", "English topic title (optional)") : text("中文专题标题（选填）", "Chinese topic title (optional)")}<input className={inputClass} maxLength={200} value={section.localizations?.[language]?.title ?? ""} onChange={event => translation(index, language, "title", event.target.value)}/></label>)}
            {section.groupKey && (["en", "zh"] as const).map(language => <label key={`group-${language}`} className="grid gap-1 text-sm">{language === "en" ? text("英文分组名称（选填）", "English group name (optional)") : text("中文分组名称（选填）", "Chinese group name (optional)")}<input className={inputClass} maxLength={200} value={section.localizations?.[language]?.groupTitle ?? ""} onChange={event => translation(index, language, "groupTitle", event.target.value)}/></label>)}
          </div>
        </div>;
      })}
      <Button type="button" variant="secondary" size="sm" disabled={sections.length >= 100} onClick={() => onChange([...sections, { key: `topic-${crypto.randomUUID().slice(0, 8)}`, title: text("新专题", "New topic") }])}><Plus size={15}/>{text("添加专题", "Add topic")}</Button>
    </fieldset>
  </details>;
}

export function ChapterSectionSelect({ sections, value, onChange, disabled = false }: {
  sections: CourseSection[]; value?: string | null; onChange: (key: string | null) => void; disabled?: boolean;
}) {
  const { locale } = useLocale();
  if (!sections.length) return null;
  return <label className="grid gap-2 text-sm font-semibold">{locale === "en" ? "Topic" : "所属专题"}<select className={inputClass} disabled={disabled} value={value ?? ""} onChange={event => onChange(event.target.value || null)}><option value="">{locale === "en" ? "Other lessons" : "其他课时"}</option>{sections.map(section => <option key={section.key} value={section.key}>{localizedSection(section, locale).title}</option>)}</select></label>;
}

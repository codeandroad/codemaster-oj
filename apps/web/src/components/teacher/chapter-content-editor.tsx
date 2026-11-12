"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { MathContent } from "@/components/math-content";
import type { ChapterLocalizedDetails, CourseLanguage } from "@/components/course-localization";
import {
  addChapterTranslation,
  chapterEditorFields,
  updateChapterEditorField,
  type ChapterEditingLanguage,
  type ChapterEditorValue,
} from "./chapter-editor-model";
import { MathEditor } from "./math-editor";
import { input } from "./shared";

type LanguageProps = ChapterEditorValue & {
  language: ChapterEditingLanguage;
  originalLanguage: CourseLanguage | null;
  onLanguageChange: (language: ChapterEditingLanguage) => void;
  disabled?: boolean;
};

export function ChapterEditingLanguageControl({
  originalLanguage, language, onLanguageChange, disabled, preview = false,
}: LanguageProps & { preview?: boolean }) {
  const { locale } = useLocale(), id = useId();
  const showOriginal = language === "original" || !originalLanguage;
  return <label htmlFor={id} className="flex min-w-0 max-w-full items-center gap-3 text-sm font-medium" data-od-id={preview ? "chapter-preview-language" : "chapter-edit-language-control"}>
    <span className="shrink-0 whitespace-nowrap">{preview ? locale === "en" ? "Content language" : "内容语言" : locale === "en" ? "Editing language" : "编辑语言"}</span>
    <select id={id} data-od-id={preview ? "chapter-preview-language-select" : "chapter-edit-language"} className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={language} disabled={disabled} onChange={event => onLanguageChange(event.target.value as ChapterEditingLanguage)}>
      {showOriginal && <option value="original">{locale === "en" ? "Original" : "原文"}</option>}
      <option value="en">English</option>
      <option value="zh">中文</option>
    </select>
  </label>;
}

/** One form edits the same language that readers and the full preview display. */
export function ChapterContentEditor({
  original, localizations, originalLanguage, language, onLanguageChange, onChange, disabled,
}: LanguageProps & { onChange: (value: ChapterEditorValue) => void }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const fields = chapterEditorFields(original, localizations, language);
  const update = (field: keyof ChapterLocalizedDetails, value: string) =>
    onChange(updateChapterEditorField(original, localizations, language, field, value, originalLanguage));
  return <section className="min-w-0 space-y-4" data-od-id="chapter-content-editor">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <ChapterEditingLanguageControl original={original} localizations={localizations} originalLanguage={originalLanguage} language={language} onLanguageChange={onLanguageChange} disabled={disabled}/>
      {language !== "original" && localizations?.[language] && <Button type="button" variant="ghost" size="sm" disabled={disabled} data-od-id="chapter-remove-translation" onClick={() => {
        if (!window.confirm(tx("移除此语言版本？原文和另一语言的内容会保留；保存草稿后生效。", "Remove this language version? The original and the other language will be kept. This takes effect when you save the draft."))) return;
        const next = { ...localizations }; delete next[language];
        onChange({ original, localizations: next });
        onLanguageChange(originalLanguage && next[originalLanguage] ? originalLanguage : "original");
      }}>{tx("移除此语言版本", "Remove this language")}</Button>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">
      {language === "original"
        ? tx("未提供所选语言的内容时，学生将看到这份原文。切换语言会保留未保存的修改。", "Students see this original when their selected language is unavailable. Switching languages keeps unsaved edits.")
        : tx("这里编辑学生在该语言下看到的内容。切换语言会保留未保存的修改。", "Edit the content students see in this language. Switching languages keeps unsaved edits.")}
    </p>
    {!fields ? <div className="space-y-3 rounded-md border border-dashed border-border bg-surface-subtle p-4" data-od-id="chapter-translation-empty">
      <p className="text-sm">{tx("尚未添加此语言的内容，学生暂时看到原文。", "This language has not been added. Students currently see the original.")}</p>
      <Button type="button" variant="secondary" disabled={disabled} data-od-id="chapter-add-translation" onClick={() => {
        if (language !== "original") onChange(addChapterTranslation(original, localizations, language));
      }}>{tx("复制原文并开始编辑", "Start from original")}</Button>
    </div> : <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <label className="grid min-w-0 gap-1 text-sm font-semibold">
        {tx("章节标题", "Chapter title")}
        <input className={input} data-od-id={`chapter-title-${language}`} maxLength={200} value={fields.title} onChange={event => update("title", event.target.value)}/>
      </label>
      <label className="grid min-w-0 gap-1 text-sm font-semibold">
        {tx("学习目标", "Learning objective")}
        <textarea className={`${input} min-h-24 py-2`} data-od-id={`chapter-objective-${language}`} maxLength={4000} rows={3} value={fields.objective} onChange={event => update("objective", event.target.value)}/>
      </label>
      {(["content", "checkpoint", "checkpointAnswer"] as const).map(field => <MathEditor
        key={`${language}:${field}`}
        fieldName={`chapter-${field}-${language}`}
        label={field === "content" ? tx("正文 · 讲解与示例", "Content · explanations and examples") : field === "checkpoint" ? tx("检查点 · 独立练习", "Checkpoint · independent practice") : tx("检查点参考答案", "Checkpoint answer")}
        value={fields[field]}
        onChange={value => update(field, value)}
        rows={field === "content" ? 14 : 5}
        disabled={disabled}
        renderPreview={value => <MathContent content={value} language={language === "original" ? originalLanguage ?? undefined : language}/>}
      />)}
    </fieldset>}
  </section>;
}

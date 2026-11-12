"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  chapterTranslation,
  type CourseLanguage,
  type CourseLocalizations,
  type ChapterLocalizations,
  type ChapterLocalizedDetails,
} from "@/components/course-localization";
import { MathEditor } from "./math-editor";
import { input } from "./shared";

export function CourseTranslationFields({
  value,
  onChange,
  disabled,
}: {
  value?: CourseLocalizations;
  onChange: (value: CourseLocalizations) => void;
  disabled?: boolean;
}) {
  const { locale } = useLocale();
  return (
    <details
      className="rounded-md border border-border p-3"
      data-od-id="course-translations"
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {locale === "en"
          ? "English and Chinese course details"
          : "中英文课程信息"}
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {(["en", "zh"] as const).map((language) => (
          <fieldset key={language} disabled={disabled} className="space-y-3">
            <legend className="text-sm font-semibold">
              {language === "en" ? "English" : "中文"}
            </legend>
            {(["title", "description"] as const).map((field) => (
              <label key={field} className="grid gap-1 text-sm">
                {field === "title"
                  ? locale === "en"
                    ? "Course title"
                    : "课程名称"
                  : locale === "en"
                    ? "Description"
                    : "课程简介"}
                {field === "title" ? (
                  <input
                    data-od-id={`course-${field}-${language}`}
                    className={input}
                    maxLength={200}
                    value={value?.[language]?.[field] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [language]: {
                          ...{ title: "", description: "" },
                          ...value?.[language],
                          [field]: event.target.value,
                        },
                      })
                    }
                  />
                ) : (
                  <textarea
                    data-od-id={`course-${field}-${language}`}
                    className={`${input} min-h-24 py-2`}
                    maxLength={4000}
                    value={value?.[language]?.[field] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [language]: {
                          ...{ title: "", description: "" },
                          ...value?.[language],
                          [field]: event.target.value,
                        },
                      })
                    }
                  />
                )}
              </label>
            ))}
            {value?.[language] && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  const next = { ...value };
                  delete next[language];
                  onChange(next);
                }}
              >
                {locale === "en" ? "Remove translation" : "移除此译文"}
              </Button>
            )}
          </fieldset>
        ))}
      </div>
    </details>
  );
}

export function ChapterTranslationEditor({
  value,
  original,
  onChange,
  disabled,
}: {
  value?: ChapterLocalizations;
  original: ChapterLocalizedDetails;
  onChange: (value: ChapterLocalizations) => void;
  disabled?: boolean;
}) {
  const { locale } = useLocale(),
    [language, setLanguage] = useState<CourseLanguage>("en");
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh),
    fields = chapterTranslation({ localizations: value }, language);
  function update(field: keyof ChapterLocalizedDetails, content: string) {
    onChange({ ...value, [language]: { ...fields, [field]: content } });
  }
  return (
    <details
      className="rounded-md border border-border p-3"
      data-od-id="chapter-translations"
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {tx("English and Chinese chapter content", "中英文章节内容")}
      </summary>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          {tx("Editing language", "编辑语言")}
          <select
            className={`${input} w-auto`}
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as CourseLanguage)
            }
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {!value?.[language] && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onChange({ ...value, [language]: { ...original } })
              }
            >
              {tx("Start from original", "复制原有内容")}
            </Button>
          )}
          {value?.[language] && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const next = { ...value };
                delete next[language];
                onChange(next);
              }}
            >
              {tx("Remove translation", "移除此译文")}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {tx(
          "Both languages share this chapter and its progress. If a translation is absent, students see the original content.",
          "两种语言使用同一章节和学习进度。未提供译文时，学生看到原有内容。",
        )}
      </p>
      <fieldset disabled={disabled} className="mt-3 space-y-4">
        <label className="grid gap-1 text-sm font-medium">
          {tx("Chapter title", "章节标题")}
          <input
            className={input}
            data-od-id={`chapter-title-${language}`}
            maxLength={200}
            value={fields.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {tx("Learning objective", "学习目标")}
          <textarea
            className={`${input} min-h-20 py-2`}
            data-od-id={`chapter-objective-${language}`}
            value={fields.objective}
            maxLength={4000}
            onChange={(e) => update("objective", e.target.value)}
          />
        </label>
        {(["content", "checkpoint", "checkpointAnswer"] as const).map(
          (field) => (
            <MathEditor
              key={`${language}:${field}`}
              fieldName={`chapter-${field}-${language}`}
              label={
                field === "content"
                  ? tx("Chapter content", "章节正文")
                  : field === "checkpoint"
                    ? tx("Checkpoint", "检查点")
                    : tx("Checkpoint answer", "检查点参考答案")
              }
              value={fields[field]}
              onChange={(value) => update(field, value)}
              rows={field === "content" ? 14 : 5}
              disabled={disabled}
            />
          ),
        )}
      </fieldset>
    </details>
  );
}

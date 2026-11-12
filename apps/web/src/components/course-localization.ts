export type CourseLanguage = "en" | "zh";
export type CourseLocalizedDetails = { title: string; description: string };
export type ChapterLocalizedDetails = {
  title: string;
  content: string;
  objective: string;
  checkpoint: string;
  checkpointAnswer: string;
};
export type CourseLocalizations = Partial<
  Record<CourseLanguage, CourseLocalizedDetails>
>;
export type ChapterLocalizations = Partial<
  Record<CourseLanguage, ChapterLocalizedDetails>
>;

export function courseLanguageKey(accountId: string) {
  return `campus:course-language:${encodeURIComponent(accountId)}`;
}
export function validCourseLanguage(value: unknown): CourseLanguage | null {
  return value === "en" || value === "zh" ? value : null;
}
export function localizedCourse<
  T extends {
    title: string;
    description: string;
    localizations?: CourseLocalizations;
  },
>(course: T, language: CourseLanguage): T {
  return { ...course, ...course.localizations?.[language] };
}
export function localizedChapter<
  T extends {
    title: string;
    content?: string;
    body?: string;
    objective?: string;
    checkpoint?: string;
    checkpointAnswer?: string;
    localizations?: ChapterLocalizations;
  },
>(chapter: T, language: CourseLanguage) {
  return {
    ...chapter,
    content: chapter.content ?? chapter.body ?? "",
    ...chapter.localizations?.[language],
  };
}
export function chapterTranslation(
  chapter: { localizations?: ChapterLocalizations },
  language: CourseLanguage,
): ChapterLocalizedDetails {
  return (
    chapter.localizations?.[language] ?? {
      title: "",
      content: "",
      objective: "",
      checkpoint: "",
      checkpointAnswer: "",
    }
  );
}
export function courseLanguageHref(href: string, language: CourseLanguage) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("contentLanguage", language);
  return `${path}?${params}`;
}

export function parseCourseLocalizations(value: unknown): CourseLocalizations {
  return parseLocalizedEntries(value, { title: 200, description: 4000 }, [
    "title",
  ]) as CourseLocalizations;
}
export function parseChapterLocalizations(
  value: unknown,
): ChapterLocalizations {
  return parseLocalizedEntries(
    value,
    {
      title: 200,
      content: 100000,
      objective: 4000,
      checkpoint: 10000,
      checkpointAnswer: 10000,
    },
    ["title", "content"],
  ) as ChapterLocalizations;
}
function parseLocalizedEntries(
  value: unknown,
  limits: Record<string, number>,
  required: string[],
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["en", "zh"].includes(key))
  )
    throw new Error("Invalid course translation languages.");
  const result: Record<string, Record<string, string>> = {};
  for (const [language, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid course translation.");
    const fields = entry as Record<string, unknown>;
    if (Object.keys(fields).some((key) => !(key in limits)))
      throw new Error("Unknown course translation field.");
    result[language] = {};
    for (const [field, limit] of Object.entries(limits)) {
      const text = fields[field] ?? "";
      if (
        typeof text !== "string" ||
        text.length > limit ||
        (required.includes(field) && !text.trim())
      )
        throw new Error(`Invalid ${language} translation: ${field}.`);
      result[language][field] = text;
    }
  }
  return result;
}

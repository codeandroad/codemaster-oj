import type {
  ChapterLocalizedDetails,
  ChapterLocalizations,
  CourseLanguage,
} from "../course-localization";

export type ChapterEditingLanguage = "original" | CourseLanguage;
export type ChapterEditorValue = {
  original: ChapterLocalizedDetails;
  localizations: ChapterLocalizations | undefined;
};

const fields: (keyof ChapterLocalizedDetails)[] = [
  "title", "content", "objective", "checkpoint", "checkpointAnswer",
];

/** Only an existing bilingual pair can identify a unique fallback language. */
export function findOriginalLanguage(
  original: ChapterLocalizedDetails,
  localizations?: ChapterLocalizations,
): CourseLanguage | null {
  // One translation may be an untranslated copy made by “Start from original”.
  // Never treat that copy as evidence that the original has the same language.
  if (!localizations?.en || !localizations.zh) return null;
  const matches = (["en", "zh"] as const).filter(language => {
    const translation = localizations?.[language];
    return translation && fields.every(field => original[field] === translation[field]);
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function chapterEditorFields(
  original: ChapterLocalizedDetails,
  localizations: ChapterLocalizations | undefined,
  language: ChapterEditingLanguage,
): ChapterLocalizedDetails | null {
  return language === "original" ? original : localizations?.[language] ?? null;
}

/** Keep an identified fallback and its translation together, without replacing other prose. */
export function updateChapterEditorField(
  original: ChapterLocalizedDetails,
  localizations: ChapterLocalizations | undefined,
  language: ChapterEditingLanguage,
  field: keyof ChapterLocalizedDetails,
  value: string,
  originalLanguage?: CourseLanguage | null,
): ChapterEditorValue {
  if (language === "original") {
    return { original: { ...original, [field]: value }, localizations };
  }
  const translation = localizations?.[language];
  if (!translation) return { original, localizations };
  const next = { ...translation, [field]: value };
  const boundLanguage = originalLanguage === undefined
    ? findOriginalLanguage(original, localizations)
    : originalLanguage;
  const canSynchronize = boundLanguage === language
    && fields.every(field => original[field] === translation[field]);
  return {
    original: canSynchronize ? { ...next } : original,
    localizations: { ...localizations, [language]: next },
  };
}

/** Adding a language is explicit; selecting one must never copy or overwrite content. */
export function addChapterTranslation(
  original: ChapterLocalizedDetails,
  localizations: ChapterLocalizations | undefined,
  language: CourseLanguage,
): ChapterEditorValue {
  return {
    original,
    localizations: localizations?.[language]
      ? localizations
      : { ...localizations, [language]: { ...original } },
  };
}

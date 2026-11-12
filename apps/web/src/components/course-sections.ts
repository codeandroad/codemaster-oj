export type CourseSectionTranslation = { title: string; groupTitle?: string };
export type CourseSection = {
  key: string;
  title: string;
  groupKey?: string;
  groupTitle?: string;
  localizations?: Partial<Record<"en" | "zh", CourseSectionTranslation>>;
};

const keyPattern = /^[a-z][a-z0-9-]{0,59}$/;
function label(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw Error(`${name}须为 1–200 字的文字。`);
  return value.trim();
}
export function parseCourseSections(value: unknown): CourseSection[] {
  if (!Array.isArray(value) || value.length > 100) throw Error("课程最多包含 100 个专题。");
  const seen = new Set<string>(), groups = new Map<string, { title: string; translations: Partial<Record<"en" | "zh", string>> }>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.key !== "string" || !keyPattern.test(item.key) || seen.has(item.key)) throw Error("专题标识无效或重复。");
    seen.add(item.key);
    const section: CourseSection = { key: item.key, title: label(item.title, "专题标题") };
    if (item.groupKey != null || item.groupTitle != null) {
      if (typeof item.groupKey !== "string" || !keyPattern.test(item.groupKey)) throw Error("目录分组标识无效。");
      section.groupKey = item.groupKey; section.groupTitle = label(item.groupTitle, "目录分组标题");
    }
    if (item.localizations != null) {
      if (typeof item.localizations !== "object" || Array.isArray(item.localizations)) throw Error("专题双语标题无效。");
      section.localizations = {};
      for (const language of Object.keys(item.localizations)) {
        if (language !== "en" && language !== "zh") throw Error("专题仅支持中英文标题。");
        const translation = item.localizations[language];
        if (!translation || typeof translation !== "object" || Array.isArray(translation)) throw Error("专题双语标题无效。");
        section.localizations[language] = { title: label(translation.title, "专题译名"), ...(translation.groupTitle != null ? { groupTitle: label(translation.groupTitle, "分组译名") } : {}) };
      }
    }
    if (section.groupKey) {
      const group = groups.get(section.groupKey) ?? { title: section.groupTitle!, translations: {} };
      if (group.title !== section.groupTitle) throw Error("同一目录分组的名称必须一致。");
      for (const language of ["en", "zh"] as const) {
        const translated = section.localizations?.[language]?.groupTitle;
        if (translated && group.translations[language] && group.translations[language] !== translated) throw Error("同一目录分组的译名必须一致。");
        if (translated) group.translations[language] = translated;
      }
      groups.set(section.groupKey, group);
    } else if (Object.values(section.localizations ?? {}).some(translation => translation.groupTitle)) throw Error("目录分组译名需要对应的分组。");
    return section;
  });
}
export function parseSectionKey(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !keyPattern.test(value)) throw Error("所属专题标识无效。");
  return value;
}
export function validateChapterSections(sections: CourseSection[] | undefined, chapters: { sectionKey?: string | null }[]) {
  const keys = new Set((sections ?? []).map(section => section.key));
  for (const chapter of chapters) if (chapter.sectionKey && !keys.has(chapter.sectionKey)) throw Error("章节引用了课程中不存在的专题。");
}
export function localizedSection(section: CourseSection, language: "en" | "zh") {
  const translation = section.localizations?.[language];
  return { ...section, title: translation?.title ?? section.title, groupTitle: translation?.groupTitle ?? section.groupTitle };
}
/** Preserve lesson identities and within-topic order; the same order drives navigation. */
export function orderCourseChapters<T extends { sectionKey?: string | null }>(sections: CourseSection[] | undefined, chapters: T[]): T[] {
  if (!sections?.length) return chapters;
  const index = new Map(sections.map((section, position) => [section.key, position]));
  return [...chapters].sort((a, b) => (index.get(a.sectionKey ?? "") ?? sections.length) - (index.get(b.sectionKey ?? "") ?? sections.length));
}
/** Reordering a lesson stays inside its topic; use the topic selector to reassign it. */
export function courseChapterNeighbor(chapters: { sectionKey?: string | null }[], index: number, direction: -1 | 1): number {
  if (!chapters[index]) return -1;
  for (let next = index + direction; next >= 0 && next < chapters.length; next += direction)
    if ((chapters[next].sectionKey ?? null) === (chapters[index].sectionKey ?? null)) return next;
  return -1;
}
export function courseDirectorySections<T extends { sectionKey?: string | null }>(sections: CourseSection[] | undefined, chapters: T[], language: "en" | "zh") {
  return (sections ?? []).map(section => ({ ...localizedSection(section, language), chapters: chapters.filter(chapter => chapter.sectionKey === section.key) })).filter(section => section.chapters.length > 0);
}
/** Only rewrite recognized same-site legacy course paths; preserve all query context. */
export function canonicalCourseHref(href: string, fromId: string, toId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fromId) || !/^[0-9a-f-]{36}$/i.test(toId) || fromId === toId) return null;
  const url = new URL(href, "http://course.local");
  if (url.origin !== "http://course.local") return null;
  const segments = url.pathname.split("/");
  if (!((segments[1] === "student" && segments[2] === "learning-paths") || (segments[1] === "teacher" && ["courses", "learning"].includes(segments[2]))) || segments[3] !== fromId) return null;
  segments[3] = toId; url.pathname = segments.join("/");
  return `${url.pathname}${url.search}${url.hash}`;
}

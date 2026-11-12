import { fail, field } from './security.mjs';

const invalid = message => fail(400, 'INVALID_COURSE_SECTION', message);
const key = value => {
 if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,59}$/.test(value)) invalid('专题和分组标识须为 1–60 个小写字母、数字或连字符，并以字母开头。');
 return value;
};
// Group labels organize navigation; they do not alter course access or grading.
export function courseSections(value = []) {
 if (!Array.isArray(value) || value.length > 100) invalid('课程最多包含 100 个专题。');
 const seen = new Set(), groups = new Map(), translatedGroups = new Map();
 return value.map(item => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('课程专题格式无效。');
  const section = {key: key(item.key), title: field(item.title, '专题名称', {max: 200})};
  if (seen.has(section.key)) invalid('专题标识不能重复。');
  seen.add(section.key);
  if (item.groupKey !== undefined || item.groupTitle !== undefined) {
   section.groupKey = key(item.groupKey);
   section.groupTitle = field(item.groupTitle, '专题分组名称', {max: 200});
   const previous = groups.get(section.groupKey);
   if (previous && previous !== section.groupTitle) invalid('同一专题分组须使用一致的名称。');
   groups.set(section.groupKey, section.groupTitle);
  }
  if (item.localizations !== undefined) {
   const translations = item.localizations;
   if (!translations || typeof translations !== 'object' || Array.isArray(translations) || Object.keys(translations).some(language => !['en','zh'].includes(language))) invalid('专题译文只支持 en 和 zh。');
   section.localizations = Object.fromEntries(Object.entries(translations).map(([language, translation]) => {
    if (!translation || typeof translation !== 'object' || Array.isArray(translation) || Object.keys(translation).some(name => !['title','groupTitle'].includes(name))) invalid('专题译文字段无效。');
    const result = {title: field(translation.title, '专题译名', {max: 200})};
    if (translation.groupTitle !== undefined) {
     if (!section.groupKey) invalid('未分组的专题不能设置分组译名。');
     result.groupTitle = field(translation.groupTitle, '专题分组译名', {max: 200});
     const groupLanguage = `${section.groupKey}:${language}`, previous = translatedGroups.get(groupLanguage);
     if (previous && previous !== result.groupTitle) invalid('同一专题分组须使用一致的译名。');
     translatedGroups.set(groupLanguage, result.groupTitle);
    }
    return [language, result];
   }));
  }
  return section;
 });
}
export function chapterSectionKey(value, sections = []) {
 if (value === undefined || value === null) return null;
 const selected = key(value);
 if (!sections.some(section => section.key === selected)) invalid('章节引用的专题不存在于本课程。');
 return selected;
}
export function assertChapterSections(sections, chapters) {
 for (const chapter of chapters) chapterSectionKey(chapter.sectionKey ?? chapter.section_key, sections);
}

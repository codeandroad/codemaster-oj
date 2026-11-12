import { bytes, fail, field } from './security.mjs';

const fields = { title: 200, description: 4000, objective: 4000, checkpoint: 10000, checkpointAnswer: 10000 };
export function courseLocalizations(value, { chapter = false } = {}) {
  if (value === undefined || value === null) return null;
  const keys = chapter ? ['title','content','objective','checkpoint','checkpointAnswer'] : ['title','description'];
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['en','zh'].includes(key))) {
    fail(400, 'INVALID_COURSE_LOCALIZATIONS', '课程译文只支持 en 和 zh。');
  }
  if (!Object.keys(value).length) return null;
  return Object.fromEntries(Object.keys(value).map(language => {
    const item = value[language];
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !keys.includes(key))) {
      fail(400, 'INVALID_COURSE_LOCALIZATIONS', '课程双语内容字段无效。');
    }
    const result = Object.fromEntries(keys.map(key => [key, key === 'content' ? bytes(item[key], '章节译文')
      : field(item[key] ?? (key === 'title' ? undefined : ''), `课程译文 ${key}`, { min: key === 'title' ? 1 : 0, max: fields[key], trim: false })]));
    if (chapter && !result.content.trim()) fail(400, 'INVALID_COURSE_LOCALIZATIONS', '章节双语正文不能为空。');
    return [language, result];
  }));
}

export const localizedFields = value => value ? { localizations: value } : {};

// Public course review has always exported lesson prose, never school-only
// checkpoints or their reference answers. Translations keep that boundary.
export const publicChapterLocalizations = value => value ? Object.fromEntries(Object.entries(value).map(([language,item]) => [language,{title:item.title,content:item.content}])) : null;

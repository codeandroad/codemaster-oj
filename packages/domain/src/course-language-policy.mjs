import { LANGUAGES } from './languages.mjs';
import { enumValue, fail } from './security.mjs';

const languageName = { python: 'Python', cpp: 'C++', javascript: 'JavaScript' };

export function normalizeRequiredLanguage(value, previous = null) {
  if (value === undefined) return previous;
  return value === null ? null : enumValue(value, LANGUAGES, '课程编程语言');
}

export function assertRequiredLanguage(language, requiredLanguage) {
  if (requiredLanguage && language !== requiredLanguage) {
    fail(400, 'COURSE_LANGUAGE_REQUIRED', `本课程或作业要求使用 ${languageName[requiredLanguage]}`);
  }
}

import { fail, field } from './security.mjs';

// A short title is display metadata, independent of frozen judging content.
export function paper4ShortTitleInput(value) {
 return value === undefined ? '' : field(value, '试卷简称', { min: 0, max: 60 });
}
export function paper4ShortTitle(paper) {
 const custom=paper.short_title??paper.shortTitle;
 if(typeof custom==='string'&&custom.trim())return custom.trim();
 const exam=paper.definition?.exam??paper;
 if(exam.examYear&&exam.examVariant&&['summer','autumn'].includes(exam.examSession))
  return `9618/${exam.examVariant} ${exam.examSession==='summer'?'mj':'on'} ${String(exam.examYear).slice(-2)}`;
 return Array.from((paper.title??'Paper 4').trim()).slice(0,60).join('');
}

// Exam classification belongs to the immutable version definition, so exports
// and revisions retain it without rewriting existing attempts or source titles.
export function paper4ExamInput(value = {}, previous = {}) {
 const pick = name => Object.hasOwn(value, name) ? value[name] : previous?.[name] ?? null;
 const examYear = pick('examYear'), examSession = pick('examSession'), examVariant = pick('examVariant');
 if (examYear !== null && (!Number.isInteger(examYear) || examYear < 1900 || examYear > 2100))
  fail(400, 'VALIDATION', '试卷年份须为 1900–2100 的整数或空值');
 if (examSession !== null && !['summer', 'autumn'].includes(examSession))
  fail(400, 'VALIDATION', '试卷考季须为 summer、autumn 或空值');
 if (examVariant !== null && ![41, 42, 43].includes(examVariant))
  fail(400, 'VALIDATION', '试卷卷号须为 41、42、43 或空值');
 return { examYear, examSession, examVariant };
}

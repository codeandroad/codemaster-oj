import { randomUUID } from 'node:crypto';
import { bytes, fail, field, uuid } from './security.mjs';

const maxBodyLength = 200000;
const maxBundleBytes = 512 * 1024;
const programmingLanguages = ['python', 'cpp', 'javascript'];

function solutionLanguage(value) {
 if (value === undefined || value === null) return {};
 if (!programmingLanguages.includes(value)) fail(400, 'VALIDATION', '题解编程语言须为 Python、C++、JavaScript 或通用');
 return {programmingLanguage: value};
}

// Authoring source only. Callers must authorize management of this exact version;
// students receive only explicitly reviewed assistance content below.
export function originalProblemSolution({editorial, referenceCode, referenceLanguage = 'python'} = {}) {
 const parts = [];
 if (typeof editorial === 'string' && editorial.trim()) parts.push(editorial.trim());
 if (typeof referenceCode === 'string' && referenceCode.trim()) {
  const longestRun = [...referenceCode.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const language = ['python', 'cpp', 'javascript'].includes(referenceLanguage) ? referenceLanguage : 'python';
  parts.push(`${fence}${language}\n${referenceCode}${referenceCode.endsWith('\n') ? '' : '\n'}${fence}`);
 }
 return parts.length ? {body: parts.join('\n\n'), ...(typeof referenceCode === 'string' && referenceCode.trim()
  ? {programmingLanguage: programmingLanguages.includes(referenceLanguage) ? referenceLanguage : 'python'} : {})} : undefined;
}

function bundleEntries(content, primaryId) {
 const {primaryTitle, primaryLanguage, alternatives = []} = content.details;
 if (!primaryTitle) return undefined;
 return [{id: primaryId, title: primaryTitle, body: content.body, ...solutionLanguage(primaryLanguage)},
  ...alternatives.map(({id, title, body, programmingLanguage}) => ({id, title, body, ...solutionLanguage(programmingLanguage)}))];
}

export function approvedAssistanceContent(row) {
 return {body: row.body, solutions: bundleEntries({body: row.body, details: row.solution_details ?? {}}, row.id)};
}

export function editableAssistanceContent(row) {
 if (!row.pending_solution) return approvedAssistanceContent(row);
 return {body: row.pending_solution.body, solutions: bundleEntries(row.pending_solution, row.id), hasPendingSolutions: true};
}

export function readAssistanceDraft(input, {subjectKey, kind, previous, requireNonBlank = false}) {
 if (input.solutions === undefined) {
  if (previous?.pending_solution) fail(409, 'CONTENT_CHANGED', '此题解有待审核的修改，请重新载入后再保存');
  const body = field(input.body, '辅助正文', {max: maxBodyLength, trim: false});
  if (requireNonBlank && !body.trim()) fail(400, 'VALIDATION', '辅助正文不能为空');
  return {body, details: previous?.solution_details ?? {}};
 }
 if (kind !== 'FULL_SOLUTION' || !subjectKey.startsWith('problem:')) {
  fail(400, 'VALIDATION', '只有编程题的完整题解支持多个解法');
 }
 if (!Array.isArray(input.solutions) || input.solutions.length < 1 || input.solutions.length > 10) {
  fail(400, 'VALIDATION', '请填写 1–10 篇题解');
 }
 const ids = new Set();
 const entries = input.solutions.map((solution, index) => {
  const id = solution?.id === undefined ? randomUUID() : uuid(solution.id, '题解编号').toLowerCase();
  if (ids.has(id) || (index > 0 && id === previous?.id)) fail(400, 'VALIDATION', '题解编号重复');
  ids.add(id);
  const title = field(solution?.title, '题解标题', {max: 120});
  const body = field(solution?.body, '题解正文', {max: maxBodyLength, trim: false});
  if (!title.isWellFormed() || !body.isWellFormed()) fail(400, 'VALIDATION', '题解包含无效字符');
  if (!body.trim()) fail(400, 'VALIDATION', '题解正文不能为空');
  return {id, title, body, ...solutionLanguage(solution?.programmingLanguage)};
 });
 const [primary, ...alternatives] = entries;
 if (input.body !== undefined && input.body !== primary.body) fail(400, 'VALIDATION', '辅助正文必须与首篇题解一致');
 const draft = {body: primary.body, details: {primaryTitle: primary.title,
  ...(primary.programmingLanguage ? {primaryLanguage: primary.programmingLanguage} : {}), alternatives}};
 bytes(JSON.stringify(draft), '题解总内容', maxBundleBytes);
 return draft;
}

export function pendingSolution(row, draft) {
 // Keep the reviewed body available to students while staff edits are pending.
 const existing = approvedAssistanceContent(row);
 const proposed = bundleEntries(draft, row.id);
 return existing.body === draft.body && JSON.stringify(existing.solutions) === JSON.stringify(proposed) ? null : draft;
}

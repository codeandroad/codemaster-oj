import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCourseSections, validateChapterSections, localizedSection, orderCourseChapters, courseDirectorySections, canonicalCourseHref, courseChapterNeighbor } from '../src/components/course-sections.ts';
import { parseLearningMarkdown, serializeLearningMarkdown } from '../src/components/teacher/learning-document.ts';

const sections = [
  { key: 'numbers', title: 'Number systems', groupKey: 'c1', groupTitle: 'Contest 1', localizations: { zh: { title: '数制', groupTitle: '第一轮' }, en: { title: 'Number systems', groupTitle: 'Contest 1' } } },
  { key: 'tracing', title: 'Tracing', groupKey: 'c1', groupTitle: 'Contest 1' },
  { key: 'expressions', title: 'Expressions', groupKey: 'c2', groupTitle: 'Contest 2' },
  { key: 'future', title: 'Future topic' },
];
const lessons = [
  { id: 'b', sectionKey: 'tracing', completed: false },
  { id: 'a1', sectionKey: 'numbers', completed: true },
  { id: 'e', sectionKey: 'expressions', completed: false },
  { id: 'a2', sectionKey: 'numbers', completed: false },
  { id: 'unassigned', sectionKey: null, completed: false },
];

test('topic order drives reading sequence across boundaries without changing progress or lesson identities', () => {
  const ordered = orderCourseChapters(sections, lessons);
  assert.deepEqual(ordered.map(item => item.id), ['a1', 'a2', 'b', 'e', 'unassigned']);
  assert.equal(ordered[0], lessons[1]);
  assert.equal(ordered[0].completed, true);
  assert.equal(lessons[0].id, 'b');
  assert.equal(orderCourseChapters(undefined, lessons), lessons);
  assert.equal(orderCourseChapters([], lessons), lessons);
});
test('localized directory groups keep shared read state and omit empty topics', () => {
  assert.equal(localizedSection(sections[0], 'zh').title, '数制');
  assert.equal(localizedSection(sections[1], 'zh').title, 'Tracing');
  const result = courseDirectorySections(sections, lessons, 'zh');
  assert.deepEqual(result.map(item => item.key), ['numbers', 'tracing', 'expressions']);
  assert.equal(result[0].groupTitle, '第一轮');
  assert.equal(result[0].chapters.length, 2);
  assert.equal(result[0].chapters.filter(item => item.completed).length, 1);
});
test('topic metadata rejects duplicate or malformed keys and dangling lesson references', () => {
  assert.deepEqual(parseCourseSections(sections), sections);
  for (const invalid of [[sections[0], sections[0]], [{ key: '../x', title: 'X' }], [{ key: 'x', title: '' }], [{ key: 'x', title: 'X', groupKey: 'c1' }], [{ key: 'x', title: 'X', localizations: { fr: { title: 'X' } } }]]) assert.throws(() => parseCourseSections(invalid));
  assert.doesNotThrow(() => validateChapterSections(sections, lessons));
  assert.throws(() => validateChapterSections([], lessons));
  assert.doesNotThrow(() => validateChapterSections(undefined, [{ id: 'legacy' }]));
});
test('Markdown keeps topic translations, ordering, lesson membership and deliberate unassignment', () => {
  const sample = parseLearningMarkdown(readFileSync(new URL('../public/python-learning-path.md', import.meta.url), 'utf8'));
  const doc = { ...sample, sections, chapters: sample.chapters.slice(0, 3).map((chapter, i) => ({ ...chapter, sectionKey: i === 0 ? 'numbers' : i === 1 ? 'tracing' : null })) };
  const exported = serializeLearningMarkdown(doc);
  assert.match(exported, /### 所属专题/);
  assert.deepEqual(parseLearningMarkdown(exported), doc);
  assert.throws(() => parseLearningMarkdown(exported.replace('"numbers"', '"missing"')));
  assert.throws(() => parseLearningMarkdown(exported + '\n### 所属专题\n\n"numbers"\n'));
});
test('legacy Markdown serialization remains byte stable without introducing new fields', () => {
  const sample = readFileSync(new URL('../public/python-learning-path.md', import.meta.url), 'utf8');
  const doc = parseLearningMarkdown(sample), exported = serializeLearningMarkdown(doc);
  assert.equal(doc.sections, undefined);
  assert.ok(doc.chapters.every(chapter => chapter.sectionKey === undefined));
  assert.doesNotMatch(exported, /sections:|### 所属专题/);
  assert.equal(serializeLearningMarkdown(parseLearningMarkdown(exported)), exported);
});
test('old course routes retain explicit lesson, language, catalogue filters and return context', () => {
  const old = '11111111-1111-4111-8111-111111111111', canonical = '22222222-2222-4222-8222-222222222222';
  const search = '?preview=1&chapter=lesson&contentLanguage=zh&acslFrom=%2Fstudent%2Facsl%3Fdivision%3Dintermediate';
  assert.equal(canonicalCourseHref(`/teacher/courses/${old}${search}#review`, old, canonical), `/teacher/courses/${canonical}${search}#review`);
  assert.equal(canonicalCourseHref(`/student/learning-paths/${old}/chapters/lesson?contentLanguage=en`, old, canonical), `/student/learning-paths/${canonical}/chapters/lesson?contentLanguage=en`);
  for (const path of [`https://foreign.test/student/learning-paths/${old}`, `/student/problems/${old}`, `/student/learning-paths/${canonical}`]) assert.equal(canonicalCourseHref(path, old, canonical), null);
  assert.equal(canonicalCourseHref(`/teacher/courses/${old}`, old, old), null);
});

test('lesson moves stay within their topic while legacy lesson moves remain adjacent', () => {
  assert.equal(courseChapterNeighbor(lessons, 1, 1), 3);
  assert.equal(courseChapterNeighbor(lessons, 3, -1), 1);
  assert.equal(courseChapterNeighbor(lessons, 0, 1), -1);
  assert.equal(courseChapterNeighbor([{ id: 'a' }, { id: 'b' }], 0, 1), 1);
  assert.equal(courseChapterNeighbor([], 0, 1), -1);
});
test('one directory group cannot acquire conflicting names in different topics', () => {
  assert.throws(() => parseCourseSections([...sections, { key: 'conflicting', title: 'Conflicting', groupKey: 'c1', groupTitle: 'Another round' }]));
  assert.throws(() => parseCourseSections([...sections, { key: 'conflicting', title: 'Conflicting', groupKey: 'c1', groupTitle: 'Contest 1', localizations: { zh: { title: '另一专题', groupTitle: '第二轮' } } }]));
  assert.throws(() => parseCourseSections([{ key: 'orphan', title: 'Orphan', localizations: { zh: { title: '无组', groupTitle: '第一轮' } } }]));
});

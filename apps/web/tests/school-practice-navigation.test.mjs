import test from 'node:test';
import assert from 'node:assert/strict';
import {practiceCatalogFilters, practiceLocation, practiceNavigationItems, practiceProblemMatches, practicePublicationState} from '../src/components/schools/school-practice-navigation.ts';

const problem = (id, fields = {}) => ({id, schoolId: 'school-1', bankId: 'bank-1', bankName: 'Python', title: `Exercise ${id}`, revision: 1, published: true, versionId: `v-${id}`, canManage: false, ...fields});

test('opening, changing and returning from a problem preserve school, course, chapter and catalog filters', () => {
  const initial = 'schoolId=school-1&section=courses&courseId=course-2&chapterId=chapter-3&bankId=bank-1&problemQuery=loop%20%26%20array&problemStatus=not-started';
  const opened = new URL(practiceLocation('/schools', initial, {problemId: 'p1'}, '#chapter'), 'https://example.test');
  assert.equal(opened.searchParams.get('schoolId'), 'school-1');
  assert.equal(opened.searchParams.get('courseId'), 'course-2');
  assert.equal(opened.searchParams.get('chapterId'), 'chapter-3');
  assert.equal(opened.searchParams.get('problemQuery'), 'loop & array');
  assert.equal(opened.searchParams.get('problemStatus'), 'not-started');
  assert.equal(opened.hash, '#chapter');
  const next = new URL(practiceLocation(opened.pathname, opened.search, {problemId: 'p2'}, opened.hash), opened.origin);
  assert.equal(next.searchParams.get('problemId'), 'p2');
  const returned = new URL(practiceLocation(next.pathname, next.search, {problemId: null}, next.hash), next.origin);
  assert.equal(returned.searchParams.has('problemId'), false);
  assert.deepEqual([...returned.searchParams], [...new URLSearchParams(initial)]);
  assert.equal(returned.hash, '#chapter');
});

test('public practice navigation remains inside its own route and does not add a school context', () => {
  assert.equal(practiceLocation('/practice/problems', '', {problemId: 'p1'}), '/practice/problems?problemId=p1');
  assert.equal(practiceLocation('/practice/problems', 'problemId=p1', {problemId: null}), '/practice/problems');
  const href = practiceLocation('/schools', 'schoolId=s&problemQuery=old', {problemQuery: '链表 & arrays', problemStatus: ''});
  assert.equal(new URL(href, 'https://example.test').searchParams.get('problemQuery'), '链表 & arrays');
});

test('catalog URL filters validate role-specific status and restore staff tab/archive/search settings', () => {
  const params = new URLSearchParams('bankId=b&problemQuery=loop&problemStatus=draft&problemTab=problems&bankQuery=archive&bankArchived=1');
  assert.deepEqual(practiceCatalogFilters(params, true), {bankId: 'b', query: 'loop', status: 'draft', tab: 'problems', bankQuery: 'archive', archived: true});
  assert.equal(practiceCatalogFilters(params, false).status, '');
  assert.equal(practiceCatalogFilters(new URLSearchParams(), true).tab, 'banks');
  assert.equal(practiceCatalogFilters(new URLSearchParams('problemTab=banks'), false).tab, 'problems');
  assert.equal(practiceCatalogFilters(new URLSearchParams('problemStatus=unknown'), true).status, '');
});

test('navigation preserves filtered list order and anchors a current problem that has just become AC', () => {
  const rows = [problem('p3'), problem('p2', {solved: true}), problem('p1'), problem('other', {bankId: 'bank-2'}), problem('done', {solved: true})];
  const filters = practiceCatalogFilters(new URLSearchParams('bankId=bank-1&problemQuery=Exercise&problemStatus=not-started'), false);
  assert.deepEqual(rows.filter(row => practiceProblemMatches(row, filters, false)).map(row => row.id), ['p3', 'p1']);
  assert.deepEqual(practiceNavigationItems(rows, filters, false, 'p2').map(row => row.id), ['p3', 'p2', 'p1']);
  assert.deepEqual(rows.map(row => row.id), ['p3', 'p2', 'p1', 'other', 'done'], 'no source reordering');
});

test('practice navigation excludes draft and archived-bank rows even when addressed by URL', () => {
  const rows = [problem('live'), problem('draft', {published: false}), problem('archived', {bankId: 'old-bank'})];
  const filters = practiceCatalogFilters(new URLSearchParams(), true);
  assert.deepEqual(practiceNavigationItems(rows, filters, true, 'draft', ['old-bank']).map(row => row.id), ['live']);
  assert.deepEqual(practiceNavigationItems(rows, filters, true, 'archived', ['old-bank']).map(row => row.id), ['live']);
});

test('staff search uses the same publication status as the displayed catalog', () => {
  assert.equal(practicePublicationState(problem('published')), 'published');
  const revised = problem('revised', {hasDraftChanges: true, validation: {id: 'j1', state: 'done', status: 'AC'}});
  assert.equal(practicePublicationState(revised), 'review');
  const filters = practiceCatalogFilters(new URLSearchParams('problemStatus=review&problemQuery=PYTHON'), true);
  assert.equal(practiceProblemMatches(revised, filters, true), true);
  assert.equal(practiceProblemMatches(problem('published'), filters, true), false);
});

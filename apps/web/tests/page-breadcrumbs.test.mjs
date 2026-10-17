import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageBreadcrumbs } from '../src/lib/page-breadcrumbs.ts';
import { isCampusRoute } from '../src/lib/campus-routes.ts';

const identity = '6d1e89c5-83fd-48ce-8025-303e63d4eba0';
const roleFor = path => path.startsWith('/teacher') ? 'teacher' : path.startsWith('/admin') ? 'admin' : 'student';

test('every declared campus landing page has a readable breadcrumb in both languages', () => {
  const routeSource = readFileSync(new URL('../src/lib/campus-routes.ts', import.meta.url), 'utf8');
  const landingPages = [...routeSource.split('const detailPages')[0].matchAll(/"(\/[^"]*)"/g)].map(match => match[1]);
  for (const pathname of landingPages) {
    for (const locale of ['zh', 'en']) {
      const trail = pageBreadcrumbs(pathname, roleFor(pathname), locale);
      assert.ok(trail.length > 0, pathname);
      assert.ok(trail.every(item => item.label && item.label !== 'Page' && item.label !== '页面'), pathname);
      assert.ok(trail.every(item => isCampusRoute(item.href)), pathname);
    }
  }
});

test('role homes have one crumb and the root alias respects the current workspace', () => {
  assert.deepEqual(pageBreadcrumbs('/', 'student', 'en'), [{ href: '/', label: 'Home' }]);
  assert.deepEqual(pageBreadcrumbs('/teacher', 'teacher', 'en'), [{ href: '/teacher', label: 'Teacher workspace' }]);
  assert.deepEqual(pageBreadcrumbs('/', 'admin', 'zh'), [{ href: '/admin', label: '管理工作台' }]);
});

test('detail leaves use the loaded title and preserve the correct collection ancestor', () => {
  const trail = pageBreadcrumbs(`/teacher/problems/banks/${identity}`, 'teacher', 'en', 'Python practice');
  assert.deepEqual(trail.map(item => item.label), ['Teacher workspace', 'Problem banks', 'Python practice']);
  assert.equal(trail[1].href, '/teacher/problems');
  assert.equal(trail.at(-1).href, `/teacher/problems/banks/${identity}`);
  assert.equal(pageBreadcrumbs(`/student/assignments/${identity}`, 'student', 'zh', '第 2 课练习').at(-1).label, '第 2 课练习');
});

test('all campus detail route shapes hide identifiers and only link valid ancestors', () => {
  const paths = [
    `/student/classes/${identity}`, `/teacher/problems/banks/${identity}`,
    `/teacher/paper4/${identity}`, `/teacher/paper4/${identity}/review/attempt-1`,
    `/student/paper4/${identity}`, `/teacher/problems/${identity}/edit`,
    `/teacher/assignments/${identity}/progress`, `/teacher/assignments/${identity}/edit`,
    `/teacher/timed-practice/${identity}/edit`, `/teacher/timed-practice/${identity}/progress`,
    `/teacher/timed-practice/${identity}`, `/teacher/learning/${identity}`, `/teacher/courses/${identity}`,
    `/student/learning-paths/${identity}/chapters/chapter-1`, `/student/review-notebook/${identity}`,
    ...['student', 'teacher', 'admin'].map(role => `/${role}/people/${identity}`),
    ...['problems', 'assignments', 'submissions', 'learning-paths', 'timed-practice'].map(section => `/student/${section}/${identity}`),
  ];
  for (const pathname of paths) {
    assert.ok(isCampusRoute(pathname), pathname);
    for (const locale of ['zh', 'en']) {
      const trail = pageBreadcrumbs(pathname, roleFor(pathname), locale);
      assert.ok(trail.every(item => !item.label.includes(identity) && item.label !== 'Page' && item.label !== '页面'), pathname);
      assert.ok(trail.every(item => isCampusRoute(item.href)), pathname);
      assert.equal(trail.at(-1).href, pathname);
    }
  }
});

test('nested reviews and chapters provide safe navigation to their owning paper or course', () => {
  const review = pageBreadcrumbs(`/teacher/paper4/${identity}/review/attempt-1`, 'teacher', 'en');
  assert.deepEqual(review.map(item => item.href), ['/teacher', '/teacher/paper4', `/teacher/paper4/${identity}`, `/teacher/paper4/${identity}/review/attempt-1`]);
  const chapter = pageBreadcrumbs(`/student/learning-paths/${identity}/chapters/chapter-1`, 'student', 'en');
  assert.equal(chapter.at(-2).href, `/student/learning-paths/${identity}`);
});

test('static labels remain concise while long or punctuated content titles remain intact', () => {
  assert.equal(pageBreadcrumbs('/teacher/classes', 'teacher', 'en', 'Classes and students page introduction').at(-1).label, 'Classes');
  const title = 'Algorithms / data structures · ' + 'Advanced '.repeat(20);
  assert.equal(pageBreadcrumbs(`/teacher/courses/${identity}`, 'teacher', 'en', title).at(-1).label, title.trim());
  assert.equal(pageBreadcrumbs(`/teacher/courses/${identity}`, 'teacher', 'en', '   ').at(-1).label, 'Course details');
});

test('unknown locations do not expose path fragments as names or clickable ancestors', () => {
  const trail = pageBreadcrumbs(`/teacher/unknown/${identity}`, 'teacher', 'en');
  assert.deepEqual(trail.map(item => item.label), ['Teacher workspace', 'Page']);
  assert.deepEqual(trail.slice(0, -1).map(item => item.href), ['/teacher']);
});

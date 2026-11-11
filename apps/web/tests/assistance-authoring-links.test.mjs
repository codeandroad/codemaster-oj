import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCampusRoute, loginReturnTo } from '../src/lib/campus-routes.ts';
import { pageBreadcrumbs } from '../src/lib/page-breadcrumbs.ts';
import { contentAuthoringHref } from '../src/components/scholarship/authoring-links.ts';

test('problem solution links pin content without selecting an old problem editing snapshot', () => {
  const link = new URL(contentAuthoringHref({ targetType: 'problem', targetId: 'problem-a', versionId: 'historical', kind: 'FULL_TRANSLATION' }), 'https://example.test');
  assert.equal(link.pathname, '/teacher/problems/problem-a/edit');
  assert.equal(link.searchParams.get('tab'), 'solutions');
  assert.equal(link.searchParams.get('solutionVersionId'), 'historical');
  assert.equal(link.searchParams.get('versionId'), null);
  assert.equal(link.searchParams.get('kind'), 'FULL_TRANSLATION');
});

test('default student-solution links leave teaching context selection to the editor', () => {
  const link = new URL(contentAuthoringHref({ targetType: 'problem', targetId: 'problem-a' }, true), 'https://example.test');
  assert.equal(link.pathname, '/admin/problems/problem-a/edit');
  assert.equal(link.searchParams.get('solutionVersionId'), null);
  assert.equal(link.searchParams.get('kind'), 'FULL_SOLUTION');
});

test('Paper 4 links retain exact paper version, question and workspace', () => {
  for (const admin of [false, true]) {
    const link = new URL(contentAuthoringHref({ targetType: 'paper4', targetId: 'paper-a', versionId: 'paper-version', questionKey: 'Q2', kind: 'FULL_TRANSLATION' }, admin), 'https://example.test');
    assert.equal(link.pathname, `/${admin ? 'admin' : 'teacher'}/paper4/paper-a`);
    assert.equal(link.searchParams.get('versionId'), 'paper-version');
    assert.equal(link.searchParams.get('questionKey'), 'Q2');
    assert.equal(link.searchParams.get('kind'), 'FULL_TRANSLATION');
  }
});

test('every new authoring and review route is served by the App Router and retains login return targets', () => {
  const paths = [
    '/admin/problems/problem-a/edit?tab=solutions&solutionVersionId=old',
    '/admin/paper4/paper-a?tab=solutions&questionKey=Q2&versionId=exact',
    '/teacher/problems/solutions-review',
    '/admin/problems/solutions-review?targetType=paper4',
  ];
  for (const path of paths) {
    const url = new URL(path, 'https://example.test');
    assert.equal(isCampusRoute(url.pathname), true, path);
    assert.equal(loginReturnTo(path), path);
    for (const locale of ['zh', 'en']) {
      const trail = pageBreadcrumbs(url.pathname, url.pathname.startsWith('/admin') ? 'admin' : 'teacher', locale);
      assert.ok(trail.every(item => isCampusRoute(item.href)));
      assert.ok(trail.every(item => !['Page', '页面'].includes(item.label)));
    }
  }
});

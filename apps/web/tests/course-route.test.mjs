import test from 'node:test';
import assert from 'node:assert/strict';
import {isCampusRoute, loginReturnTo} from '../src/lib/campus-routes.ts';

test('teacher course list and detail routes coexist with existing learning links', () => {
  assert.equal(isCampusRoute('/teacher/courses'), true);
  assert.equal(isCampusRoute('/teacher/courses/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isCampusRoute('/teacher/learning'), true);
  assert.equal(isCampusRoute('/teacher/learning/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isCampusRoute('/teacher/courses/11111111-1111-4111-8111-111111111111/edit'), false);
});

test('sign-in can return to the exact chapter and rejects unsafe destinations', () => {
  const chapter = '/student/learning-paths/course/chapters/chapter?mode=reading#section';
  assert.equal(loginReturnTo(chapter), chapter);
  for (const href of ['https://example.test', '//example.test', '/\\example.test', '/.//example.test', '/login', '/register?join=1', '/activate', '/api/v1/auth/me']) {
    assert.equal(loginReturnTo(href), null, href);
  }
});

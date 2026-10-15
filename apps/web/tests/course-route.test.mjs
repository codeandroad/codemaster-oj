import test from 'node:test';
import assert from 'node:assert/strict';
import {isCampusRoute} from '../src/lib/campus-routes.ts';

test('teacher course list and detail routes coexist with existing learning links', () => {
  assert.equal(isCampusRoute('/teacher/courses'), true);
  assert.equal(isCampusRoute('/teacher/courses/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isCampusRoute('/teacher/learning'), true);
  assert.equal(isCampusRoute('/teacher/learning/11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isCampusRoute('/teacher/courses/11111111-1111-4111-8111-111111111111/edit'), false);
});

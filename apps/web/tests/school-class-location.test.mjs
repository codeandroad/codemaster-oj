import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolClassHref, schoolClassLocation } from '../src/components/schools/school-class-location.ts';

const params = href => new URL(href, 'http://localhost').searchParams;
test('class selection and page navigation survive reload and browser back', () => {
  const first = params('/schools?schoolId=alpha&section=classes&classPage=2');
  const selected = params(schoolClassHref(first, 'alpha', { classId: 'class-on-page-2' }));
  assert.deepEqual(schoolClassLocation(selected), { page: 2, archived: false, classId: 'class-on-page-2' });
  const next = params(schoolClassHref(selected, 'alpha', { page: 3, classId: '' }));
  assert.deepEqual(schoolClassLocation(next), { page: 3, archived: false, classId: '' });
  // Returning to the prior URL restores the selected row instead of page one's first row.
  assert.deepEqual(schoolClassLocation(params(`/schools?${selected}`)), schoolClassLocation(selected));
});
test('server-located archive/page replaces only class location; changing filters clears selection', () => {
  const selected = params('/schools?schoolId=alpha&section=classes&classId=target&classPage=1');
  const located = params(schoolClassHref(selected, 'alpha', { page: 4, archived: true, classId: 'target' }));
  assert.deepEqual(schoolClassLocation(located), { page: 4, archived: true, classId: 'target' });
  const active = params(schoolClassHref(located, 'alpha', { page: 1, archived: false, classId: '' }));
  assert.deepEqual(schoolClassLocation(active), { page: 1, archived: false, classId: '' });
  assert.equal(active.get('schoolId'), 'alpha');assert.equal(active.get('section'), 'classes');
});
test('invalid URL pagination cannot send unbounded or fractional list queries', () => {
  for (const invalid of ['0', '-1', '1.5', '100001', 'Infinity', 'NaN']) {
    assert.equal(schoolClassLocation(new URLSearchParams({ classPage: invalid })).page, 1);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSchoolPreference,
  resolveSchoolSelection,
  resolveCurrentSchoolSelection,
  schoolSelectionStorageKey,
  writeSchoolPreference,
} from '../src/components/schools/school-selection.ts';

const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';
const legacy = { id: '00000000-0000-4000-8000-000000000052', legacy: true, roles: ['admin'] };
const alpha = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', legacy: false, roles: ['student'] };
const beta = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', legacy: false, roles: ['teacher'] };
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('current school resolves only from server memberships and carries that school’s role', () => {
  assert.equal(resolveSchoolSelection([legacy, alpha, beta], beta.id), beta);
  assert.equal(resolveSchoolSelection([legacy, alpha, beta], legacy.id), legacy);
  assert.equal(resolveSchoolSelection([legacy, alpha, beta], ''), alpha);
});

test('removed or forged membership preferences cannot restore inaccessible schools', () => {
  assert.equal(resolveSchoolSelection([legacy, alpha], beta.id), alpha);
  assert.equal(resolveSchoolSelection([legacy], beta.id), legacy);
  assert.equal(resolveSchoolSelection([], beta.id), undefined);
  assert.equal(resolveSchoolSelection([alpha], '../../other-school'), alpha);
});

test('current navigation beats saved school and next-login default when all are memberships', () => {
  const items = [legacy, alpha, beta];
  assert.equal(resolveCurrentSchoolSelection(items, {
    activeSchoolId: beta.id, savedSchoolId: alpha.id, defaultSchoolId: legacy.id,
  }), beta);
  assert.equal(resolveCurrentSchoolSelection(items, {
    activeSchoolId: legacy.id, savedSchoolId: beta.id, defaultSchoolId: alpha.id,
  }), legacy);
});

test('removed URL school falls through to a valid saved current school instead of arbitrary first school', () => {
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha], {
    activeSchoolId: beta.id, savedSchoolId: legacy.id, defaultSchoolId: alpha.id,
  }), legacy);
});

test('removed saved school falls through to the still-valid server default', () => {
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha], {
    activeSchoolId: '../../foreign-school', savedSchoolId: beta.id, defaultSchoolId: legacy.id,
  }), legacy);
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha], {
    savedSchoolId: beta.id, defaultSchoolId: legacy.id,
  }), legacy);
});

test('empty browser preference preserves a URL school or server default', () => {
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha, beta], {
    activeSchoolId: beta.id, savedSchoolId: '', defaultSchoolId: legacy.id,
  }), beta);
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha], {
    activeSchoolId: null, savedSchoolId: '', defaultSchoolId: legacy.id,
  }), legacy);
});

test('all invalid candidates use only current memberships and never fabricate an accessible school', () => {
  const candidates = { activeSchoolId: beta.id, savedSchoolId: 'missing', defaultSchoolId: 'foreign' };
  assert.equal(resolveCurrentSchoolSelection([legacy, alpha], candidates), alpha);
  assert.equal(resolveCurrentSchoolSelection([legacy], candidates), legacy);
  assert.equal(resolveCurrentSchoolSelection([], candidates), undefined);
  assert.equal(resolveCurrentSchoolSelection([beta], {}), beta);
});

test('school preference is isolated by stable account ID and stores only the school UUID', () => {
  const storage = memoryStorage();
  writeSchoolPreference(accountA, alpha.id, storage);
  assert.equal(readSchoolPreference(accountB, storage), '');
  writeSchoolPreference(accountB, beta.id, storage);
  assert.equal(readSchoolPreference(accountA, storage), alpha.id);
  assert.equal(readSchoolPreference(accountB, storage), beta.id);
  writeSchoolPreference(accountA, beta.id, storage);
  assert.deepEqual([...storage.values], [
    [schoolSelectionStorageKey(accountA), beta.id],
    [schoolSelectionStorageKey(accountB), beta.id],
  ]);
});

test('malformed stored values and non-ID writes are ignored without persisting names or roles', () => {
  const storage = memoryStorage();
  for (const value of ['Alpha School', JSON.stringify(alpha), '  ' + alpha.id, alpha.id + '\n', '']) {
    storage.values.set(schoolSelectionStorageKey(accountA), value);
    assert.equal(readSchoolPreference(accountA, storage), '');
  }
  storage.values.clear();
  writeSchoolPreference('student.username', alpha.id, storage);
  writeSchoolPreference(accountA, 'Alpha School', storage);
  assert.equal(storage.values.size, 0);
  assert.equal(readSchoolPreference('student.username', storage), '');
  writeSchoolPreference(accountA, alpha.id.toUpperCase(), storage);
  assert.equal(readSchoolPreference(accountA, storage), alpha.id);
});

test('unavailable or throwing browser storage cannot break selection', () => {
  const unavailable = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Quota exceeded'); },
  };
  assert.equal(readSchoolPreference(accountA, unavailable), '');
  assert.doesNotThrow(() => writeSchoolPreference(accountA, alpha.id, unavailable));
  assert.equal(readSchoolPreference(accountA), '');
  assert.doesNotThrow(() => writeSchoolPreference(accountA, alpha.id));
  assert.equal(resolveSchoolSelection([alpha], readSchoolPreference(accountA, unavailable)), alpha);
});

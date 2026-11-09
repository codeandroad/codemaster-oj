import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLocaleStorageKey, resolveAppLocale } from '../src/lib/app-locale.ts';

test('a new browser, cleared preference or invalid preference uses English', () => {
  for (const preference of [undefined, null, '', 'invalid', 'zh-CN', 'zh-TW', 'zh-CN,zh;q=0.9,en;q=0.8', {}, false]) {
    assert.equal(resolveAppLocale(preference), 'en');
  }
});

test('explicit language preferences survive reload and switching back to English', () => {
  assert.equal(resolveAppLocale('zh'), 'zh');
  assert.equal(resolveAppLocale('en'), 'en');
  assert.equal(resolveAppLocale(null), 'en');
});

test('language preferences use separate keys for separate accounts', () => {
  const storage = new Map([['campus-judge:locale:v1', 'zh']]);
  storage.set(accountLocaleStorageKey('first-account'), 'zh');
  assert.equal(resolveAppLocale(storage.get(accountLocaleStorageKey('first-account'))), 'zh');
  assert.equal(resolveAppLocale(storage.get(accountLocaleStorageKey('second-account'))), 'en');
});

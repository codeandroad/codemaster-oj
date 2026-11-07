import test from 'node:test';
import assert from 'node:assert/strict';
import * as browser from '../src/lib/nickname-policy.ts';
import * as server from '../../../packages/domain/src/nickname-policy.mjs';

test('nickname width budget agrees in the browser and server at mixed-language boundaries', () => {
  for (const [name, units, tooLong] of [
    ['', 0, false], ['a'.repeat(20), 20, false], ['a'.repeat(21), 21, true],
    ['中'.repeat(10), 20, false], ['中'.repeat(11), 22, true],
    ['中'.repeat(5) + 'a'.repeat(10), 20, false],
    ['中'.repeat(5) + 'a'.repeat(11), 21, true],
    ['  中Alex  ', 6, false], ['𠮷'.repeat(10), 20, false],
    ['Ａ'.repeat(10), 20, false], ['👩🏽‍💻'.repeat(10), 20, false],
    ['e\u0301'.repeat(20), 20, false],
  ]) {
    for (const policy of [browser, server]) {
      assert.equal(policy.nicknameUnits(name), units, name);
      assert.equal(policy.nicknameTooLong(name), tooLong, name);
    }
  }
  assert.equal(browser.normalizeNickname(' e\u0301 '), server.normalizeNickname(' e\u0301 '));
  assert.equal(browser.normalizeNickname(' e\u0301 '), 'é');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistancePricePayload, parseAssistancePrice } from '../src/components/scholarship/assistance-price.ts';

test('saving only access rules does not freeze the displayed inherited price', () => {
  const defaultShown = '17';
  assert.deepEqual({ mode: 'free', ...assistancePricePayload('unchanged', defaultShown) }, { mode: 'free' });
  assert.deepEqual(assistancePricePayload('unchanged', '0'), {});
});

test('editing a number sets an explicit price, and only restoring defaults sends null', () => {
  assert.deepEqual(assistancePricePayload('custom', '17'), { price: 17 });
  assert.deepEqual(assistancePricePayload('custom', '0'), { price: 0 });
  assert.deepEqual(assistancePricePayload('default', '17'), { price: null });
});

test('empty or invalid prices cannot turn into defaults or silent free access', () => {
  for (const value of ['', ' ', '-1', '1001', '1.5', 'invalid']) {
    assert.equal(parseAssistancePrice(value), undefined);
    assert.throws(() => assistancePricePayload('custom', value));
  }
  assert.equal(parseAssistancePrice('0'), 0);
  assert.equal(parseAssistancePrice('1000'), 1000);
});

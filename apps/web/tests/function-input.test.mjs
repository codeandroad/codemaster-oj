import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFunctionInput } from '../src/lib/function-input.ts';
import { parseFunctionInput } from '../../../packages/domain/src/function-input.mjs';

test('student custom input accepts both function argument formats admitted by the judge', () => {
  for (const input of ['[]', '[1,2]', '{"args":[1],"kwargs":{"step":2}}', '{"args":[1]}']) {
    assert.doesNotThrow(() => validateFunctionInput(input));
    assert.doesNotThrow(() => parseFunctionInput(input));
  }
});

test('student custom input rejects malformed protocols and nonfinite JSON before submission', () => {
  for (const input of ['broken', '{}', '{"kwargs":{}}', '{"args":[],"kwargs":null}', '{"args":[],"kwargs":[]}', '{"args":[],"extra":1}', '[1e400]']) {
    assert.throws(() => validateFunctionInput(input));
    assert.throws(() => parseFunctionInput(input));
  }
});

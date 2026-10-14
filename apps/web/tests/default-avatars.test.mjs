import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AVATARS, defaultAvatarPath, randomDefaultAvatarPath } from '../src/lib/default-avatars.ts';

test('every default avatar points to an actual user-supplied image', async () => {
 assert.equal(DEFAULT_AVATARS.length,14);
 assert.equal(new Set(DEFAULT_AVATARS).size,14);
 assert.equal(defaultAvatarPath('123e4567-e89b-42d3-a456-426614174000'),'/avatars/oj-03.jpg');
 for (const path of DEFAULT_AVATARS) {
  const file = fileURLToPath(new URL(`../public${path}`,import.meta.url));
  const data = await readFile(file);
  const jpeg = data[0]===0xff && data[1]===0xd8 && data[2]===0xff;
  const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  assert.ok(path.endsWith(jpeg?'.jpg':'.png'),`${path} extension matches content`);
  assert.ok(jpeg||png,`${path} is a supported image`);
 }
});

test('random avatar selection avoids the current preset portrait', () => {
 for(const avatar of DEFAULT_AVATARS) {
  const next = randomDefaultAvatarPath(avatar);
  assert.notEqual(next,avatar);
  assert.ok(DEFAULT_AVATARS.includes(next));
 }
});

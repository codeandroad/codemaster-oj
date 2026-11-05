import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AVATARS, INITIAL_AVATARS, defaultAvatarPath, randomDefaultAvatarPath } from '../src/lib/default-avatars.ts';
import { DEFAULT_AVATARS as serverAvatars, INITIAL_AVATARS as serverInitialAvatars, defaultAvatarPath as serverDefaultAvatarPath } from '../../../packages/domain/src/avatars.mjs';

test('every default avatar points to an actual user-supplied image', async () => {
 assert.equal(DEFAULT_AVATARS.length,132);
 assert.equal(new Set(DEFAULT_AVATARS).size,132);
 assert.equal(defaultAvatarPath('123e4567-e89b-42d3-a456-426614174000'),'/avatars/oj-03.jpg');
 for (const path of DEFAULT_AVATARS) {
  const file = fileURLToPath(new URL(`../public${path}`,import.meta.url));
  const data = await readFile(file);
  const jpeg = data[0]===0xff && data[1]===0xd8 && data[2]===0xff;
  const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP';
  assert.ok(path.endsWith(jpeg?'.jpg':png?'.png':'.webp'),`${path} extension matches content`);
  assert.ok(jpeg||png||webp,`${path} is a supported image`);
 }
});

test('random avatar selection avoids the current preset portrait', () => {
 for(const avatar of DEFAULT_AVATARS) {
  const next = randomDefaultAvatarPath(avatar);
  assert.notEqual(next,avatar);
  assert.ok(DEFAULT_AVATARS.includes(next));
 }
});

test('picker paths are accepted by the server and original identity defaults remain stable', () => {
 assert.deepEqual([...DEFAULT_AVATARS],[...serverAvatars]);
 assert.deepEqual([...INITIAL_AVATARS],[...serverInitialAvatars]);
 assert.equal(INITIAL_AVATARS.length,14);
 assert.deepEqual([...DEFAULT_AVATARS.slice(0,14)],[...INITIAL_AVATARS]);
 for (const identity of ['123e4567-e89b-42d3-a456-426614174000','ABCDEF01-2345-6789-ABCD-EF0123456789','student-unchanged']) {
  assert.equal(defaultAvatarPath(identity),serverDefaultAvatarPath(identity));
  assert.ok(INITIAL_AVATARS.includes(defaultAvatarPath(identity)));
 }
});

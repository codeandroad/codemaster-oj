import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarForIdentity, defaultAvatarPath, DEFAULT_AVATARS, isPresetAvatar } from '../src/avatars.mjs';

test('preset avatars provide a stable fallback while preserving chosen portraits', () => {
 assert.equal(DEFAULT_AVATARS.length,14);
 assert.equal(new Set(DEFAULT_AVATARS).size,DEFAULT_AVATARS.length);
 const identityId='123e4567-e89b-42d3-a456-426614174000';
 const initial=defaultAvatarPath(identityId);
 assert.equal(initial,'/avatars/oj-03.jpg');
 assert.ok(isPresetAvatar(initial));
 assert.equal(defaultAvatarPath(identityId),initial);
 assert.equal(avatarForIdentity('',identityId),initial);
 assert.equal(avatarForIdentity('/avatars/oj-03.jpg',identityId),'/avatars/oj-03.jpg');
 assert.equal(avatarForIdentity('data:image/png;base64,dGVzdA==',identityId),'data:image/png;base64,dGVzdA==');
 assert.equal(isPresetAvatar('/avatars/../private.png'),false);
 assert.equal(isPresetAvatar('https://example.test/avatar.png'),false);
});

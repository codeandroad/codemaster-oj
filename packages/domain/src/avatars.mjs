// These paths correspond to the 14 user-supplied images in apps/web/public/avatars.
// Keep this catalog aligned with apps/web/src/lib/default-avatars.ts.
export const DEFAULT_AVATARS = Object.freeze([
 '/avatars/oj-01.jpg', '/avatars/oj-02.jpg', '/avatars/oj-03.jpg',
 '/avatars/oj-04.png', '/avatars/oj-05.png', '/avatars/oj-06.png',
 '/avatars/oj-07.png', '/avatars/oj-08.png', '/avatars/oj-09.jpg',
 '/avatars/oj-10.jpg', '/avatars/oj-11.jpg', '/avatars/oj-12.jpg',
 '/avatars/oj-13.png', '/avatars/oj-14.jpg',
]);

const presetSet = new Set(DEFAULT_AVATARS);

export function isPresetAvatar(value) {
 return presetSet.has(value);
}

export function defaultAvatarPath(identityId) {
 // Identity UUIDs are randomly assigned. A deterministic hash makes the
 // initial portrait look randomly chosen while remaining stable everywhere.
 let hash = 0x811c9dc5;
 for (const character of String(identityId).toLowerCase()) {
  hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
 }
 return DEFAULT_AVATARS[hash % DEFAULT_AVATARS.length];
}

export function avatarForIdentity(avatar, identityId) {
 return avatar || defaultAvatarPath(identityId);
}

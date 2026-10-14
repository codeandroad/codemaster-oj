// These paths correspond to the 14 user-supplied images in public/avatars.
// Keep this catalog and hash aligned with packages/domain/src/avatars.mjs.
export const DEFAULT_AVATARS = [
  "/avatars/oj-01.jpg", "/avatars/oj-02.jpg", "/avatars/oj-03.jpg",
  "/avatars/oj-04.png", "/avatars/oj-05.png", "/avatars/oj-06.png",
  "/avatars/oj-07.png", "/avatars/oj-08.png", "/avatars/oj-09.jpg",
  "/avatars/oj-10.jpg", "/avatars/oj-11.jpg", "/avatars/oj-12.jpg",
  "/avatars/oj-13.png", "/avatars/oj-14.jpg",
] as const;

export function defaultAvatarPath(identityId: string): string {
  let hash = 0x811c9dc5;
  for (const character of identityId.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  return DEFAULT_AVATARS[hash % DEFAULT_AVATARS.length];
}

export function randomDefaultAvatarPath(current = ""): string {
  const alternatives = DEFAULT_AVATARS.filter(path => path !== current);
  const random = new Uint32Array(1);
  globalThis.crypto.getRandomValues(random);
  return alternatives[random[0] % alternatives.length];
}

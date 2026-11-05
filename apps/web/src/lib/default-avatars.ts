// Keep the original fallback pool fixed so adding choices never changes an
// existing identity’s default portrait. Keep both catalogs aligned with domain.
export const INITIAL_AVATARS = [
  "/avatars/oj-01.jpg", "/avatars/oj-02.jpg", "/avatars/oj-03.jpg",
  "/avatars/oj-04.png", "/avatars/oj-05.png", "/avatars/oj-06.png",
  "/avatars/oj-07.png", "/avatars/oj-08.png", "/avatars/oj-09.jpg",
  "/avatars/oj-10.jpg", "/avatars/oj-11.jpg", "/avatars/oj-12.jpg",
  "/avatars/oj-13.png", "/avatars/oj-14.jpg",
] as const;

// User-supplied portraits available through the picker and random selection.
export const DEFAULT_AVATARS = [
  ...INITIAL_AVATARS,
  "/avatars/oj-15.webp", "/avatars/oj-16.webp", "/avatars/oj-17.webp",
  "/avatars/oj-18.webp", "/avatars/oj-19.webp", "/avatars/oj-20.webp",
  "/avatars/oj-21.webp", "/avatars/oj-22.webp", "/avatars/oj-23.webp",
  "/avatars/oj-24.webp", "/avatars/oj-25.webp", "/avatars/oj-26.webp",
  "/avatars/oj-27.webp", "/avatars/oj-28.webp", "/avatars/oj-29.webp",
  "/avatars/oj-30.webp", "/avatars/oj-31.webp", "/avatars/oj-32.webp",
  "/avatars/oj-33.webp", "/avatars/oj-34.webp", "/avatars/oj-35.webp",
  "/avatars/oj-36.webp", "/avatars/oj-37.webp", "/avatars/oj-38.webp",
  "/avatars/oj-39.webp", "/avatars/oj-40.webp", "/avatars/oj-41.webp",
  "/avatars/oj-42.webp", "/avatars/oj-43.webp", "/avatars/oj-44.webp",
  "/avatars/oj-45.webp", "/avatars/oj-46.webp", "/avatars/oj-47.webp",
  "/avatars/oj-48.webp", "/avatars/oj-49.webp", "/avatars/oj-50.webp",
  "/avatars/oj-51.webp", "/avatars/oj-52.webp", "/avatars/oj-53.webp",
  "/avatars/oj-54.webp", "/avatars/oj-55.webp", "/avatars/oj-56.webp",
  "/avatars/oj-57.webp", "/avatars/oj-58.webp", "/avatars/oj-59.webp",
  "/avatars/oj-60.webp", "/avatars/oj-61.webp", "/avatars/oj-62.webp",
  "/avatars/oj-63.webp", "/avatars/oj-64.webp", "/avatars/oj-65.webp",
  "/avatars/oj-66.webp", "/avatars/oj-67.webp", "/avatars/oj-68.webp",
  "/avatars/oj-69.webp", "/avatars/oj-70.webp", "/avatars/oj-71.webp",
  "/avatars/oj-72.webp", "/avatars/oj-73.webp", "/avatars/oj-74.webp",
  "/avatars/oj-75.webp", "/avatars/oj-76.webp", "/avatars/oj-77.webp",
  "/avatars/oj-78.webp", "/avatars/oj-79.webp", "/avatars/oj-80.webp",
  "/avatars/oj-81.webp", "/avatars/oj-82.webp", "/avatars/oj-83.webp",
  "/avatars/oj-84.webp", "/avatars/oj-85.webp", "/avatars/oj-86.webp",
  "/avatars/oj-87.webp", "/avatars/oj-88.webp", "/avatars/oj-89.webp",
  "/avatars/oj-90.webp", "/avatars/oj-91.webp", "/avatars/oj-92.webp",
  "/avatars/oj-93.webp", "/avatars/oj-94.webp", "/avatars/oj-95.webp",
  "/avatars/oj-96.webp", "/avatars/oj-97.webp", "/avatars/oj-98.webp",
  "/avatars/oj-99.webp", "/avatars/oj-100.webp", "/avatars/oj-101.webp",
  "/avatars/oj-102.webp", "/avatars/oj-103.webp", "/avatars/oj-104.webp",
  "/avatars/oj-105.webp", "/avatars/oj-106.webp", "/avatars/oj-107.webp",
  "/avatars/oj-108.webp", "/avatars/oj-109.webp", "/avatars/oj-110.webp",
  "/avatars/oj-111.webp", "/avatars/oj-112.webp", "/avatars/oj-113.webp",
  "/avatars/oj-114.webp", "/avatars/oj-115.webp", "/avatars/oj-116.webp",
  "/avatars/oj-117.webp", "/avatars/oj-118.webp", "/avatars/oj-119.webp",
  "/avatars/oj-120.webp", "/avatars/oj-121.webp", "/avatars/oj-122.webp",
  "/avatars/oj-123.webp", "/avatars/oj-124.webp", "/avatars/oj-125.webp",
  "/avatars/oj-126.webp", "/avatars/oj-127.webp", "/avatars/oj-128.webp",
  "/avatars/oj-129.webp", "/avatars/oj-130.webp", "/avatars/oj-131.webp",
  "/avatars/oj-132.webp",
] as const;

export function defaultAvatarPath(identityId: string): string {
  let hash = 0x811c9dc5;
  for (const character of identityId.toLowerCase()) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  return INITIAL_AVATARS[hash % INITIAL_AVATARS.length];
}

export function randomDefaultAvatarPath(current = ""): string {
  const alternatives = DEFAULT_AVATARS.filter(path => path !== current);
  const random = new Uint32Array(1);
  globalThis.crypto.getRandomValues(random);
  return alternatives[random[0] % alternatives.length];
}

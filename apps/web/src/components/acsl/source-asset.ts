const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const assetUrl = new RegExp(
  `^/api/v1/schools/${uuid}/acsl/${uuid}/assets/[A-Za-z0-9-]{1,100}\\?versionId=${uuid}$`,
  "i",
);

/** Only the authenticated ACSL asset route can become an image in learning content. */
export function acslSourceImageBlock(text: string) {
  const match = text.trim().match(/^!\[([^\]\n]+)\]\(([^\s()]+)\)$/);
  if (!match || !assetUrl.test(match[2])) return null;
  return { label: match[1], src: match[2] };
}

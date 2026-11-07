export const courseSearchParameter = "courseQ";
export const courseSearchMaxLength = 100;

export function courseSearchQuery(value: string) {
  return value.trim().slice(0, courseSearchMaxLength);
}

export function courseSearchHref(href: string, value: string) {
  const hashStart = href.indexOf("#");
  const location = hashStart === -1 ? href : href.slice(0, hashStart);
  const hash = hashStart === -1 ? "" : href.slice(hashStart);
  const queryStart = location.indexOf("?");
  const pathname = queryStart === -1 ? location : location.slice(0, queryStart);
  const params = new URLSearchParams(queryStart === -1 ? "" : location.slice(queryStart + 1));
  const query = courseSearchQuery(value);
  if (query) params.set(courseSearchParameter, query);
  else params.delete(courseSearchParameter);
  const suffix = params.toString();
  return pathname + (suffix ? `?${suffix}` : "") + hash;
}

export function filterCourseCatalog<T extends { title: string; description: string }>(items: T[], value: string): T[] {
  const query = courseSearchQuery(value).toLowerCase();
  if (!query) return items;
  return items.filter(({ title, description }) => `${title} ${description}`.toLowerCase().includes(query));
}

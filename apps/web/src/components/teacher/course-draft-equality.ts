/**
 * Course drafts are immutable JSON-shaped values. Skip unchanged subtrees so a
 * title edit does not serialize every chapter and both translations on each key.
 * Omitted optional properties and undefined retain their JSON save semantics.
 */
export function courseDraftEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => courseDraftEqual(value, right[index]));
  }
  const previous = left as Record<string, unknown>, current = right as Record<string, unknown>;
  const previousKeys = Object.keys(previous).filter(key => previous[key] !== undefined);
  const currentKeys = Object.keys(current).filter(key => current[key] !== undefined);
  return previousKeys.length === currentKeys.length
    && previousKeys.every(key => Object.hasOwn(current, key) && courseDraftEqual(previous[key], current[key]));
}

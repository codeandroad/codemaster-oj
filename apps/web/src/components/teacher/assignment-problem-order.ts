/** Keep the teacher's saved order separate from the course display order. */
export function savedProblemOrder<T extends { position?: number }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.position ?? a.index) - (b.item.position ?? b.index) || a.index - b.index)
    .map(({ item }) => item);
}

/** Course IDs are already in chapter/within-chapter order. Others keep their order. */
export function courseProblemOrder<T>(items: readonly T[], orderedIds: readonly string[], id: (item: T) => string): T[] {
  const order = new Map<string, number>();
  for (const key of orderedIds) if (!order.has(key)) order.set(key, order.size);
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => (order.get(id(a.item)) ?? order.size) - (order.get(id(b.item)) ?? order.size) || a.index - b.index)
    .map(({ item }) => item);
}

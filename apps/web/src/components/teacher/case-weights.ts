/** Enabled formal cases divide 100 points exactly in four decimal places. */
export function equalCaseWeights<T extends { enabled?: boolean }>(cases: T[]) {
  const enabledCount = cases.filter((test) => test.enabled !== false).length;
  const base = enabledCount ? Math.floor(1_000_000 / enabledCount) : 0;
  let remaining = enabledCount ? 1_000_000 % enabledCount : 0;
  return cases.map((test) => ({
    ...test,
    // The API requires positive weights on disabled records; only enabled cases count towards the total.
    weight:
      test.enabled === false ? 1 : (base + (remaining-- > 0 ? 1 : 0)) / 10_000,
  }));
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  acslPreferenceKey,
  catalogPreferenceQuery,
  restoreCatalogPreferences,
} from "../src/components/acsl/catalog-preferences.ts";

const seasons = ["2025-2026", "2024-2025", "2023-2024"];
const saved =
  "acslDivision=Junior&acslSeason=2024-2025&acslRound=2&acslSeasons=3";

test("returning without filters restores all selections and preserves unrelated URL state", () => {
  const restored = new URLSearchParams(
    restoreCatalogPreferences("contentLanguage=zh", saved, seasons),
  );
  assert.equal(restored.get("contentLanguage"), "zh");
  for (const [key, value] of new URLSearchParams(saved))
    assert.equal(restored.get(key), value);
});
test("explicit links and an explicit reset override saved preferences", () => {
  for (const query of [
    "acslDivision=Senior",
    "acslDivision=",
    "acslSeasons=1",
    "acslRound=4",
  ])
    assert.equal(restoreCatalogPreferences(query, saved, seasons), null);
  const reset = catalogPreferenceQuery(new URLSearchParams(), seasons);
  assert.equal(reset, "acslSeasons=1");
  assert.equal(restoreCatalogPreferences("", reset, seasons), "acslSeasons=1");
});
test("saved state is restricted to valid catalog preferences", () => {
  const query = new URLSearchParams(
    "acslDivision=invalid&acslSeason=1900-1901&acslRound=7&acslSeasons=999&paperId=private&answer=A",
  );
  assert.equal(catalogPreferenceQuery(query, seasons), "acslSeasons=3");
  assert.equal(restoreCatalogPreferences("", null, seasons), null);
});
test("preferences are isolated by account and school", () => {
  assert.notEqual(acslPreferenceKey("a", "one"), acslPreferenceKey("b", "one"));
  assert.notEqual(acslPreferenceKey("a", "one"), acslPreferenceKey("a", "two"));
  assert.notEqual(acslPreferenceKey("a:b", "c"), acslPreferenceKey("a", "b:c"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { luqPolicyDescription } from "../src/lib/luq-policy-display.ts";

test("per-item prices are disclosed without changing disabled or free policy labels", () => {
  assert.equal(luqPolicyDescription({ mode: "paid", price: 4 }, "en"), "4 Luq");
  assert.equal(luqPolicyDescription({ mode: "paid", price: 0 }, "zh"), "0 Luq");
  assert.equal(luqPolicyDescription({ mode: "paid", price: null }, "en"), "Paid");
  assert.equal(luqPolicyDescription({ mode: "disabled", price: 8 }, "en"), "Disabled");
  assert.equal(luqPolicyDescription({ mode: "free", price: 8 }, "zh"), "免费");
});

test("published assistance modes are disclosed independently in both languages", () => {
  for (const [mode, english, chinese] of [
    ["disabled", "Disabled", "禁用"],
    ["paid", "Paid", "付费"],
    ["free", "Free", "免费"],
  ]) {
    assert.equal(luqPolicyDescription({ mode, opensAt: null }, "en"), english);
    assert.equal(luqPolicyDescription({ mode, opensAt: null }, "zh"), chinese);
  }
});

test("opening times use the school timezone rather than the browser timezone", () => {
  const policy = { mode: "paid", opensAt: "2026-10-20T01:30:00.000Z" };
  const english = luqPolicyDescription(policy, "en");
  assert.match(english, /Paid.*20\/10\/2026.*09:30.*Asia\/Shanghai/);
  assert.match(
    luqPolicyDescription({ ...policy, mode: "free" }, "zh"),
    /免费.*2026\/10\/20.*09:30.*Asia\/Shanghai/,
  );
});

test("disabled policies never promise a later opening and invalid dates are not shown", () => {
  assert.equal(
    luqPolicyDescription(
      { mode: "disabled", opensAt: "2026-10-20T01:30:00Z" },
      "en",
    ),
    "Disabled",
  );
  assert.equal(
    luqPolicyDescription({ mode: "paid", opensAt: "invalid" }, "en"),
    "Paid",
  );
});

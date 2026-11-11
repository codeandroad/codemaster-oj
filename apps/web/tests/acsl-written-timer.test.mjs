import test from "node:test";
import assert from "node:assert/strict";
import {
  ACSL_WRITTEN_DURATION_MS,
  acslWrittenTimerKey,
  acslWrittenTimerReading,
  formatAcslWrittenTime,
  mergeAcslWrittenTimers,
  parseAcslWrittenTimer,
  resolveAcslWrittenTimer,
} from "../src/components/acsl/written-timer-model.ts";

const start = Date.parse("2026-11-11T02:00:00Z");
const initial = { startedAt: start, stoppedAt: null };

test("practice timers are isolated by account, school, paper and edition", () => {
  const key = acslWrittenTimerKey("student", "school", "paper", "v1");
  for (const fields of [["other", "school", "paper", "v1"], ["student", "other", "paper", "v1"], ["student", "school", "other", "v1"], ["student", "school", "paper", "v2"]])
    assert.notEqual(acslWrittenTimerKey(...fields), key);
  assert.notEqual(acslWrittenTimerKey("a:b", "c", "p", "v"), acslWrittenTimerKey("a", "b:c", "p", "v"));
});

test("first entry starts once and persisted starts survive page changes and delayed ticks", () => {
  const first = resolveAcslWrittenTimer(null, start, false, null);
  assert.deepEqual(first, initial);
  const restored = parseAcslWrittenTimer(JSON.stringify(first));
  assert.deepEqual(resolveAcslWrittenTimer(restored, start + 12000, false, null), initial);
  assert.equal(acslWrittenTimerReading(restored, start + 37 * 60 * 1000).remainingSeconds, 23 * 60);
  assert.equal(acslWrittenTimerReading(restored, start + 3 * 60 * 60 * 1000).phase, "expired");
});

test("multiple tabs preserve the earliest start and a recorded stop", () => {
  const later = { startedAt: start + 5000, stoppedAt: null };
  const stopped = { startedAt: start + 1000, stoppedAt: start + 120000 };
  for (const records of [[initial, later, stopped], [stopped, later, initial], [later, initial, stopped]])
    assert.deepEqual(mergeAcslWrittenTimers(...records), { startedAt: start, stoppedAt: start + 120000 });
  assert.deepEqual(resolveAcslWrittenTimer(stopped, start + 999999, false, null), stopped);
});

test("submission freezes recorded time without fabricating duration for old results", () => {
  assert.equal(resolveAcslWrittenTimer(null, start + 5000, true, new Date(start + 4000).toISOString()), null);
  const stopped = resolveAcslWrittenTimer(initial, start + 5000, true, new Date(start + 4000).toISOString());
  assert.deepEqual(stopped, { startedAt: start, stoppedAt: start + 4000 });
  assert.deepEqual(acslWrittenTimerReading(stopped, start + 10000), acslWrittenTimerReading(stopped, start + 999999));
  assert.deepEqual(resolveAcslWrittenTimer(stopped, start + 999999, true, new Date(start + 9000).toISOString()), stopped);
  assert.equal(resolveAcslWrittenTimer(initial, start + 5000, true, "invalid").stoppedAt, start + 5000);
});

test("countdown warns once by phase, reaches zero and records overtime without enforcing submission", () => {
  assert.equal(formatAcslWrittenTime(acslWrittenTimerReading(initial, start).remainingSeconds), "01:00:00");
  assert.equal(acslWrittenTimerReading(initial, start + ACSL_WRITTEN_DURATION_MS - 300001).phase, "running");
  assert.equal(acslWrittenTimerReading(initial, start + ACSL_WRITTEN_DURATION_MS - 300000).phase, "warning");
  const expired = acslWrittenTimerReading(initial, start + ACSL_WRITTEN_DURATION_MS);
  assert.equal(expired.remainingSeconds, 0); assert.equal(expired.phase, "expired");
  const overtime = resolveAcslWrittenTimer(initial, start + ACSL_WRITTEN_DURATION_MS + 65000, true, null);
  assert.equal(acslWrittenTimerReading(overtime, start).overTime, true);
  assert.equal(formatAcslWrittenTime(acslWrittenTimerReading(overtime, start).elapsedSeconds), "01:01:05");
});

test("malformed storage cannot produce NaN, negative time or a fake completed result", () => {
  for (const value of [null, "bad json", "null", "{}", "[]", '{"startedAt":"123","stoppedAt":null}', '{"startedAt":-1,"stoppedAt":null}', '{"startedAt":12,"stoppedAt":11}', '{"startedAt":12,"stoppedAt":"later"}'])
    assert.equal(parseAcslWrittenTimer(value), null);
  assert.equal(resolveAcslWrittenTimer(null, start, true, null), null);
  assert.deepEqual(resolveAcslWrittenTimer(parseAcslWrittenTimer("broken"), start, false, null), initial);
  assert.equal(parseAcslWrittenTimer(JSON.stringify({ startedAt: start + 60000, stoppedAt: null }), start), null);
  assert.equal(parseAcslWrittenTimer(JSON.stringify({ startedAt: start, stoppedAt: start + 60000 }), start), null);
  assert.equal(acslWrittenTimerReading(initial, start - 5000).elapsedSeconds, 0);
});

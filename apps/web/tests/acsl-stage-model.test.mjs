import test from "node:test";
import assert from "node:assert/strict";
import { acslReviewHref, acslStageSummary } from "../src/components/acsl/stage-model.ts";

const paper = { graded: false, hasProgramming: true, programmingSolved: false, questions: [] };

test("whole-paper completion requires saved written grading and an accepted programming result when present", () => {
  for (const graded of [false, true]) for (const hasProgramming of [false, true]) for (const programmingSolved of [false, true]) {
    assert.equal(acslStageSummary({ ...paper, graded, hasProgramming, programmingSolved }).complete, graded && (!hasProgramming || programmingSolved));
  }
  assert.equal(acslStageSummary({ ...paper, graded: true, programming: null }).complete, true);
  assert.equal(acslStageSummary({ ...paper, graded: true, hasProgramming: false, programming: { id: "p" } }).complete, false);
  assert.equal(acslStageSummary({ graded: true, programmingSolved: false }).complete, false);
});

test("points are the durable amounts returned by the server, not rule estimates", () => {
  const state = acslStageSummary({ ...paper, writtenPointsAwarded: 4, programmingPointsAwarded: 10, pointRules: { writtenPerCorrect: 100, programming: 900 } });
  assert.equal(state.pointsAwarded, 14);
  assert.equal(state.writtenPoints, 4);
  assert.equal(state.programmingPoints, 10);
  assert.equal(acslStageSummary({ ...paper, pointRules: { writtenPerCorrect: 100, programming: 900 } }).pointsAwarded, 0);
  for (const value of [-1, NaN, Infinity, "10", undefined]) assert.equal(acslStageSummary({ ...paper, writtenPointsAwarded: value, programmingPointsAwarded: value }).pointsAwarded, 0);
});

test("wrong-answer review uses graded verdicts and exposes none before the written section is graded", () => {
  const questions = [{ id: "q1", lastSubmission: { correct: true } }, { id: "q2", lastSubmission: { correct: false } }, { id: "q3", lastSubmission: null }, { id: "q4", lastSubmission: { correct: false } }];
  assert.deepEqual(acslStageSummary({ ...paper, questions }).wrongQuestionIds, []);
  assert.deepEqual(acslStageSummary({ ...paper, graded: true, questions }).wrongQuestionIds, ["q2", "q4"]);
});

test("review links preserve school, filters and language while removing question or programming destinations", () => {
  const base = "/schools/school-id?section=acsl&acslDivision=Senior&acslSeason=2025-2026&contentLanguage=en&paperId=old&coding=1&questionId=q1&explanation=1&reviewMode=wrong";
  const all = new URL(acslReviewHref(base, "new", "all", "zh"), "https://localhost");
  assert.equal(all.pathname, "/schools/school-id");
  assert.equal(all.searchParams.get("section"), "acsl");
  assert.equal(all.searchParams.get("acslDivision"), "Senior");
  assert.equal(all.searchParams.get("acslSeason"), "2025-2026");
  assert.equal(all.searchParams.get("paperId"), "new");
  assert.equal(all.searchParams.get("review"), "1");
  assert.equal(all.searchParams.get("contentLanguage"), "zh");
  for (const key of ["questionId", "coding", "explanation", "reviewMode"]) assert.equal(all.searchParams.has(key), false);
  assert.equal(new URL(acslReviewHref(base, "new", "wrong"), "https://localhost").searchParams.get("reviewMode"), "wrong");
});

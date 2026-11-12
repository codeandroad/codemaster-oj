import test from "node:test";
import assert from "node:assert/strict";
import {
  safeAcslHref, safeCourseHref, acslLearningHref, acslPracticeHref,
  preserveAcslLearningContext, courseReturnHref, acslReturnHref,
} from "../src/components/course-acsl-navigation.ts";

const school = "00000000-0000-4000-8000-000000000052";
const otherSchool = "00000000-0000-4000-8000-000000000053";
const courseId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const paperId = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const otherPaper = "55555555-5555-4555-8555-555555555555";
const course = `/student/learning-paths/${courseId}/chapters/${chapterId}`;
const written = `/student/acsl?paperId=${paperId}&paperVersionId=${version}`;
const filters = "acslDivision=Intermediate&acslSeason=2024-2025&acslRound=1&acslSeasons=3";
const url = value => new URL(value, "https://campus.invalid");

test("question → lesson → same question preserves language, filters, version and explicit review context", () => {
  const from = `${written}&questionId=q2&explanation=1&${filters}&contentLanguage=en`;
  const lesson = acslLearningHref(course, from, school, "zh");
  assert.equal(url(lesson).pathname, course);
  assert.equal(url(lesson).searchParams.get("contentLanguage"), "zh");
  const practice = acslPracticeHref(`${written}&questionId=q2`, lesson, school);
  const params = url(practice).searchParams;
  assert.equal(params.get("contentLanguage"), "zh");
  assert.equal(params.get("explanation"), "1");
  assert.equal(params.get("questionId"), "q2");
  assert.equal(params.get("paperVersionId"), version);
  for (const [key, value] of new URLSearchParams(filters)) assert.equal(params.get(key), value);
  const back = courseReturnHref(params, school);
  assert.equal(url(back).pathname, course);
  assert.equal(url(back).searchParams.get("contentLanguage"), "zh");
  assert.equal(url(acslReturnHref(url(back).searchParams, school)).searchParams.get("questionId"), "q2");
  assert.equal(url(acslReturnHref(url(back).searchParams, school)).searchParams.get("contentLanguage"), "zh");
});

test("wrong-only results survive a round trip to the same written section", () => {
  const from = `${written}&review=1&reviewMode=wrong&${filters}`;
  const lesson = acslLearningHref(course, from, school, "en");
  const practice = acslPracticeHref(written, lesson, school);
  assert.equal(url(practice).searchParams.get("review"), "1");
  assert.equal(url(practice).searchParams.get("reviewMode"), "wrong");
});

test("a different paper, question, programming section or explicit version never inherits the previous verdict view", () => {
  const from = `${written}&questionId=q2&explanation=1&review=1&reviewMode=wrong&${filters}`;
  const lesson = acslLearningHref(course, from, school);
  for (const target of [
    `/student/acsl?paperId=${otherPaper}`,
    `${written}&questionId=q3`, `${written}&coding=1`,
    `/student/acsl?paperId=${paperId}&paperVersionId=${otherPaper}&questionId=q2`,
  ]) {
    const result = url(acslPracticeHref(target, lesson, school)).searchParams;
    assert.equal(result.has("review"), false);
    assert.equal(result.has("reviewMode"), false);
    assert.equal(result.has("explanation"), false);
    assert.equal(result.get("paperId"), url(target).searchParams.get("paperId"));
    assert.equal(result.get("questionId"), url(target).searchParams.get("questionId"));
    assert.equal(result.get("acslDivision"), "Intermediate");
  }
});

test("safe return addresses reject external, teacher, other-school and ambiguous routes", () => {
  for (const unsafe of ["https://evil.test/student/acsl", "//evil.test/student/acsl", "/\\evil.test/student/acsl", "/%2f%2fevil.test", "/student/../student/acsl", "/student/%61csl", "/student/acsl\n", "/teacher/acsl", "/student/acsl?paperId=invalid", `${written}&paperId=${otherPaper}`]) {
    assert.equal(safeAcslHref(unsafe, school), null, unsafe);
  }
  assert.equal(safeCourseHref(`/teacher/courses/${courseId}`, school), null);
  assert.equal(safeCourseHref(course, otherSchool), null);
  assert.equal(safeAcslHref(written, otherSchool), null);
  assert.equal(safeAcslHref(`/schools?schoolId=${otherSchool}&section=acsl`, school), null);
  assert.equal(safeAcslHref(`/schools?schoolId=${otherSchool}&section=acsl&schoolRole=teacher`, otherSchool), null);
  assert.equal(safeCourseHref(`/schools?schoolId=${otherSchool}&section=courses&courseId=bad`, otherSchool), null);
});

test("school-scoped routes keep their school and chapter when both directions are followed", () => {
  const schoolCourse = `/schools?schoolId=${otherSchool}&section=courses&courseId=${courseId}&chapterId=${chapterId}`;
  const schoolPaper = `/schools?schoolId=${otherSchool}&section=acsl&paperId=${paperId}&questionId=q1`;
  const lesson = acslLearningHref(schoolCourse, schoolPaper, otherSchool, "zh");
  const practice = acslPracticeHref(schoolPaper, lesson, otherSchool);
  const returned = url(courseReturnHref(url(practice).searchParams, otherSchool)).searchParams;
  assert.equal(returned.get("schoolId"), otherSchool);
  assert.equal(returned.get("section"), "courses");
  assert.equal(returned.get("chapterId"), chapterId);
  assert.equal(acslLearningHref(course, schoolPaper, otherSchool), null);
});

test("context survives normal view transitions without carrying arbitrary query data or growing recursively", () => {
  let practice = `${written}&${filters}&review=1&reviewMode=wrong&answer=D&identityId=private`;
  for (let i = 0; i < 20; i++) {
    const lesson = acslLearningHref(course, practice, school, "zh");
    practice = acslPracticeHref(written, lesson, school);
    assert.ok(practice.length < 1400);
    for (const key of ["acslFrom", "courseFrom"]) {
      const inner = url(url(practice).searchParams.get(key)).searchParams;
      assert.equal(inner.has("acslFrom"), false);
      assert.equal(inner.has("courseFrom"), false);
      assert.equal(inner.has("answer"), false);
      assert.equal(inner.has("identityId"), false);
    }
  }
  const switched = preserveAcslLearningContext(`${written}&questionId=q4&contentLanguage=en`, url(practice).searchParams, school);
  assert.equal(url(switched).searchParams.get("questionId"), "q4");
  assert.equal(url(switched).searchParams.get("contentLanguage"), "en");
  assert.ok(courseReturnHref(url(switched).searchParams, school));
  assert.equal(url(courseReturnHref(url(switched).searchParams, school)).searchParams.get("contentLanguage"), "en");
  const chapterSwitch = preserveAcslLearningContext(course, url(switched).searchParams, school);
  assert.equal(url(chapterSwitch).searchParams.get("contentLanguage"), "en");
  assert.equal(courseReturnHref(new URLSearchParams({ courseFrom: "//evil.test/" }), school), null);
  assert.equal(acslReturnHref(new URLSearchParams({ acslFrom: "/teacher/acsl" }), school), null);
});

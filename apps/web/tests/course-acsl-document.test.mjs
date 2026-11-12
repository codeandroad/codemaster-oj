import test from "node:test";
import assert from "node:assert/strict";
import { parseLearningMarkdown, serializeLearningMarkdown } from "../src/components/teacher/learning-document.ts";
import { courseAcslReferences, parseCourseAcslReferences } from "../src/components/course-acsl.ts";

const versionId = "11111111-1111-4111-8111-111111111111";
const localized = { en: { title: "Binary", content: "```text\n### 双语内容\n101\n```\n\n$101_2=5$", objective: "Convert", checkpoint: "Check", checkpointAnswer: "5" }, zh: { title: "二进制", content: "$101_2=5$", objective: "转换", checkpoint: "检查", checkpointAnswer: "5" } };
const doc = { format: "codemaster-learning-path", version: 1, title: "Original", description: "Base", category: "ACSL", estimatedMinutes: 60, localizations: { en: { title: "Number systems", description: "Practice" }, zh: { title: "数制", description: "练习" } }, chapters: [{ title: "Original chapter", content: "Original body", objective: "", checkpoint: "", checkpointAnswer: "", problemIds: [], localizations: localized, acslLinks: [{ paperSlug: "acsl-2025-2026-junior-1", kind: "question", questionId: "q1", versionId }, { paperSlug: "acsl-2025-2026-junior-1", kind: "programming", versionId }] }] };

test("course Markdown roundtrip preserves both languages, formulas, code and exact ACSL edition links", () => {
  assert.deepEqual(parseLearningMarkdown(serializeLearningMarkdown(doc)), doc);
});
test("optional single-language content roundtrips without labeling the base as another translation", () => {
  const value = structuredClone(doc); delete value.localizations.en; delete value.chapters[0].localizations.en;
  assert.deepEqual(parseLearningMarkdown(serializeLearningMarkdown(value)), value);
});
test("saving a displayed ACSL reference excludes derived verdicts and answer-bearing fields", () => {
  const link = { ...doc.chapters[0].acslLinks[0], completed: true, status: "accepted", historical: true, title: { en: "Paper", zh: "试卷" }, correctOptionIds: ["C"] };
  assert.deepEqual(courseAcslReferences([link]), [doc.chapters[0].acslLinks[0]]);
});
test("malformed or duplicate ACSL links are rejected before an import request", () => {
  const valid = doc.chapters[0].acslLinks[0];
  for (const links of [[{ ...valid, versionId: "other" }], [{ ...valid, paperSlug: "../secret" }], [{ ...valid, kind: "answer" }], [{ ...valid, questionId: "../q1" }], [valid, valid]]) assert.throws(() => parseCourseAcslReferences(links));
});
test("translation progress or access fields are rejected rather than imported", () => {
  const value = structuredClone(doc); value.chapters[0].localizations.en.completed = true;
  assert.throws(() => parseLearningMarkdown(serializeLearningMarkdown(value)));
});

test("reverse lesson links follow the actual question, wrong-answer review or programming target", async () => {
  const { acslLearningLinkApplies } = await import('../src/components/course-acsl.ts');
  const chapter = { questionIds: ['q1', 'q3'], written: false, programming: false };
  assert.equal(acslLearningLinkApplies(chapter, { programming: false, questionIds: ['q1'] }), true);
  assert.equal(acslLearningLinkApplies(chapter, { programming: false, questionIds: ['q2'] }), false);
  assert.equal(acslLearningLinkApplies(chapter, { programming: false, questionIds: ['q2', 'q3'] }), true);
  assert.equal(acslLearningLinkApplies(chapter, { programming: true }), false);
  assert.equal(acslLearningLinkApplies({ questionIds: [], written: true, programming: false }, { programming: false, questionIds: ['q2'] }), true);
  assert.equal(acslLearningLinkApplies({ questionIds: [], written: false, programming: true }, { programming: true }), true);
});

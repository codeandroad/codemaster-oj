import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseLearningMarkdown } from "../src/components/teacher/learning-document.ts";
import { canUseLegacyPythonPractice } from "../src/components/teacher/legacy-python-practice.ts";

const sample = parseLearningMarkdown(fs.readFileSync(new URL("../public/python-learning-path.md", import.meta.url), "utf8"));

test("original 20-chapter course retains its companion practice controls", () => {
  assert.equal(canUseLegacyPythonPractice(sample), true);
});

test("other Python courses do not show the original course's practice controls", () => {
  assert.equal(canUseLegacyPythonPractice({chapters: [{title: "基础语法 | Basics"}]}), false);
  const changed = structuredClone(sample);
  changed.chapters[0].title = "基础语法 | Basics";
  assert.equal(canUseLegacyPythonPractice(changed), false);
});

test("an existing companion bundle remains manageable after chapter titles change", () => {
  assert.equal(canUseLegacyPythonPractice({chapters: [{title: "已改名的章节"}], practiceBundle: [{}]}), true);
});

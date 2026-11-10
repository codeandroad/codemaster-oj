import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validAcslDiagrams, parseAcslDiagrams } from "../src/components/acsl/diagram-validation.ts";
import { acslTeacherHref, acslTeacherInput } from "../src/components/acsl/teacher-model.ts";
import { validateAcslDiagrams } from "../../../packages/domain/src/acsl-diagrams.mjs";

const diagram = { id: "tree", width: 100, height: 80, alt: { en: "Tree", zh: "树" }, elements: [{ type: "line", x1: 10, y1: 10, x2: 20, y2: 20, stroke: "ink" }] };
const localized = elements => ({ en: [{ ...diagram, elements }], zh: [diagram] });

test("advanced diagram preview accepts safe primitives and rejects unsafe or malformed content", () => {
  assert.equal(validAcslDiagrams(localized(diagram.elements)), true);
  for (const element of [
    { ...diagram.elements[0], stroke: ["ink"] },
    { ...diagram.elements[0], onload: "alert(1)" },
    { ...diagram.elements[0], style: "stroke:red" },
    { ...diagram.elements[0], x1: Infinity },
    { type: "foreignObject", x: 0, y: 0 },
    { type: "path", d: "M 0 0 A 3 4 0 0 1 8 8" },
    { type: "path", d: "M 0 0 L 4" },
    { type: "text", x: 0, y: 0, text: "A", weight: ["bold"] },
  ]) {
    assert.equal(validAcslDiagrams(localized([element])), false);
    assert.throws(() => validateAcslDiagrams(localized([element])));
  }
  assert.equal(parseAcslDiagrams("<svg onload='alert(1)'>"), null);
  assert.equal(validAcslDiagrams({ en: [diagram, diagram], zh: [] }), false);
  assert.equal(validAcslDiagrams({ en: [diagram], zh: [], extra: true }), false);
});

test("every current paper's bilingual diagrams remain editable without changing their schema", async () => {
  const root = fileURLToPath(new URL("../../../packages/domain/content/acsl/", import.meta.url));
  let papers = 0, fields = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === "paper.json" || entry.name === "sample.json") {
        const paper = JSON.parse(await readFile(path, "utf8"));
        papers++;
        const check = (value, name) => {
          if (value === undefined) return;
          fields++;
          validateAcslDiagrams(value);
          assert.equal(validAcslDiagrams(value), true, `${path}: ${name}`);
        };
        for (const q of paper.questions) {
          check(q.statementDiagrams, `${q.id} statement`);
          check(q.explanationDiagrams, `${q.id} explanation`);
          for (const o of q.options) check(o.diagrams, `${q.id} option ${o.id}`);
        }
        check(paper.programming?.statementDiagrams, "programming");
      }
    }
  }
  await visit(root);
  assert.ok(papers >= 96, `${papers} current papers`);
  assert.ok(fields > 100, `${fields} diagram fields`);
});

test("teacher updates contain editable content only and clone the original", () => {
  const paper = { title: { en: "Paper", zh: "试卷" }, id: "paper-id", contentHash: "hash", writtenRevision: "revision", questions: [{ id: "q1", number: 1, type: "single", topic: { en: "Topic", zh: "主题" }, statement: { en: "Question", zh: "题干" }, options: [{ id: "A", text: { en: "A", zh: "A" } }], correctOptionIds: ["A"], explanation: { en: "Explanation", zh: "解析" } }], programming: { id: "program", title: "Code", statement: "English", statementZh: "中文", samples: [{ input: "1", expected: "2" }], readOnlyJudge: { testCount: 10 }, tests: ["private"], referenceCode: "private" } };
  const input = acslTeacherInput(paper);
  assert.deepEqual(Object.keys(input), ["title", "questions", "programming"]);
  assert.deepEqual(Object.keys(input.programming), ["title", "statement", "statementZh"]);
  assert.equal("number" in input.questions[0], false);
  assert.equal("type" in input.questions[0], false);
  input.questions[0].options[0].text.en = "Revised";
  assert.equal(paper.questions[0].options[0].text.en, "A");
});

test("teacher links preserve school and catalog filters while clearing prior export or editing state", () => {
  const href = acslTeacherHref("/schools/school?section=acsl&acslDivision=Senior&acslSeason=2025-2026&export=answers&edit=1&paperId=old&questionId=q3", "new", false, "zh");
  const url = new URL(href, "https://localhost");
  assert.equal(url.pathname, "/schools/school");
  assert.equal(url.searchParams.get("section"), "acsl");
  assert.equal(url.searchParams.get("acslDivision"), "Senior");
  assert.equal(url.searchParams.get("paperId"), "new");
  assert.equal(url.searchParams.get("contentLanguage"), "zh");
  for (const key of ["export", "edit", "questionId"]) assert.equal(url.searchParams.has(key), false);
});

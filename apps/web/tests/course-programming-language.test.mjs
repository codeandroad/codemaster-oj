import assert from "node:assert/strict";
import test from "node:test";
import { initialWorkspaceLanguage, workspaceEditorCode } from "../src/components/student/drafts.ts";
import { parseLearningMarkdown, serializeLearningMarkdown } from "../src/components/teacher/learning-document.ts";

test("course language takes precedence over the most recent submission and unsent drafts", () => {
  const latest = { language: "javascript", code: "last submitted JavaScript" };
  const pythonDraft = { code: "unsent Python", receivedCode: "Python starter", updatedAt: "" };
  const readDraft = language => language === "python" ? pythonDraft : null;

  const unrestricted = initialWorkspaceLanguage("python", latest, "python", readDraft);
  assert.equal(unrestricted, "python");
  const locked = initialWorkspaceLanguage("python", latest, "python", readDraft, "cpp");
  assert.equal(locked, "cpp");
  assert.deepEqual(workspaceEditorCode(locked, readDraft(locked), latest, "C++ starter"), {
    code: "C++ starter",
    receivedCode: "C++ starter",
  });
  assert.deepEqual(readDraft("python"), pythonDraft);
});

test("course Markdown round-trips required and unrestricted languages and rejects unknown languages", () => {
  const document = {
    format: "codemaster-learning-path", version: 1, title: "Course", description: "",
    category: "Programming", estimatedMinutes: 60,
    chapters: [{ title: "Chapter", content: "Lesson body", objective: "", checkpoint: "", checkpointAnswer: "", problemIds: [] }],
  };
  assert.equal(parseLearningMarkdown(serializeLearningMarkdown(document)).requiredLanguage, undefined);
  for (const requiredLanguage of [null, "python", "cpp", "javascript"]) {
    assert.equal(parseLearningMarkdown(serializeLearningMarkdown({ ...document, requiredLanguage })).requiredLanguage, requiredLanguage);
  }
  assert.throws(() => parseLearningMarkdown(serializeLearningMarkdown({ ...document, requiredLanguage: "ruby" })), /必用编程语言无效/);
});

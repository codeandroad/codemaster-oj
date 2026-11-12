import test from "node:test";
import assert from "node:assert/strict";
import { courseLanguageKey, validCourseLanguage, localizedCourse, localizedChapter, parseCourseLocalizations, parseChapterLocalizations, courseLanguageHref } from "../src/components/course-localization.ts";

const translations = {
  en: { title: "Place value", content: "Convert $101_2$.", objective: "Read binary", checkpoint: "What is 101?", checkpointAnswer: "5" },
  zh: { title: "位值", content: "转换 $101_2$。", objective: "理解二进制", checkpoint: "101 是多少？", checkpointAnswer: "5" },
};
test("language projection shares chapter identity, progress and practice references", () => {
  const chapter = { id: "one", title: "Original", content: "original", completed: true, problems: [{ id: "problem", completed: true }], localizations: translations };
  const en = localizedChapter(chapter, "en"), zh = localizedChapter(chapter, "zh");
  assert.equal(en.title, "Place value"); assert.equal(zh.title, "位值");
  for (const item of [en, zh]) { assert.equal(item.id, chapter.id); assert.equal(item.completed, true); assert.equal(item.problems, chapter.problems); }
  assert.equal(chapter.title, "Original"); assert.equal(chapter.content, "original");
});
test("legacy and school single-language content falls back without fabricating a translation", () => {
  assert.equal(localizedChapter({ title: "Original", body: "School content" }, "en").content, "School content");
  const chapter = { title: "Original", content: "Original content", localizations: { zh: translations.zh } };
  assert.equal(localizedChapter(chapter, "en").title, "Original");
  assert.equal(localizedChapter(chapter, "zh").title, "位值");
  assert.equal(localizedCourse({ title: "Original", description: "old", localizations: { en: { title: "English", description: "" } } }, "en").description, "");
});
test("partial language sets can be added or cleared but each present translation must be complete", () => {
  assert.deepEqual(parseCourseLocalizations({ zh: { title: "课", description: "" } }), { zh: { title: "课", description: "" } });
  assert.deepEqual(parseChapterLocalizations({ en: translations.en }), { en: translations.en });
  assert.deepEqual(parseChapterLocalizations({}), {});
  for (const value of [{ en: { title: "Missing body" } }, { fr: translations.en }, { en: { ...translations.en, progress: true } }]) assert.throws(() => parseChapterLocalizations(value));
});
test("language preference is account scoped and independent from interface locale values", () => {
  assert.notEqual(courseLanguageKey("account-one"), courseLanguageKey("account-two"));
  assert.equal(validCourseLanguage("zh"), "zh"); assert.equal(validCourseLanguage("en"), "en");
  assert.equal(validCourseLanguage("auto"), null); assert.equal(validCourseLanguage("zh-CN"), null);
});
test("changing the content language keeps chapter and return navigation", () => {
  const result = new URL(courseLanguageHref("/schools?schoolId=one&section=courses&chapterId=chapter&acslFrom=%2Fstudent%2Facsl", "zh"), "https://test.invalid");
  assert.equal(result.searchParams.get("chapterId"), "chapter"); assert.equal(result.searchParams.get("contentLanguage"), "zh"); assert.equal(result.searchParams.get("acslFrom"), "/student/acsl");
});

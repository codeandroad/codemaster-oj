import test from "node:test";
import assert from "node:assert/strict";
import {
  findOriginalLanguage,
  chapterEditorFields,
  updateChapterEditorField,
  addChapterTranslation,
} from "../src/components/teacher/chapter-editor-model.ts";
import {
  localizedChapter,
  parseChapterLocalizations,
} from "../src/components/course-localization.ts";

const english = {
  title: "Shifts and rotations",
  content: "Keep the width of $101101_2$.",
  objective: "Track every bit.",
  checkpoint: "Shift left once.",
  checkpointAnswer: "011010",
};
const chinese = {
  title: "移位与旋转",
  content: "保持 $101101_2$ 的位宽。",
  objective: "追踪每一位。",
  checkpoint: "向左移位一次。",
  checkpointAnswer: "011010",
};
const translated = () => ({ en: { ...english }, zh: { ...chinese } });

test("only a unique exact match identifies the original language, including all five fields", () => {
  assert.equal(findOriginalLanguage(english, translated()), "en");
  assert.equal(findOriginalLanguage(chinese, translated()), "zh");
  assert.equal(findOriginalLanguage(english), null);
  assert.equal(findOriginalLanguage(english, { en: { ...english } }), null);
  assert.equal(findOriginalLanguage(english, { zh: { ...english } }), null);
  for (const field of Object.keys(english)) {
    assert.equal(findOriginalLanguage({ ...english, [field]: english[field] + " " }, translated()), null, field);
  }
  assert.equal(findOriginalLanguage(english, { en: { ...english }, zh: { ...english } }), null);
});

test("selecting a language returns one source without creating translations or dirty content", () => {
  const original = { ...english }, localizations = translated();
  assert.equal(chapterEditorFields(original, localizations, "original"), original);
  assert.equal(chapterEditorFields(original, localizations, "en"), localizations.en);
  assert.equal(chapterEditorFields(original, localizations, "zh"), localizations.zh);
  assert.equal(chapterEditorFields(original, undefined, "en"), null);
  assert.deepEqual(original, english);
  assert.deepEqual(localizations, translated());
});

test("editing an identified English source updates its fallback and survives save and student projection", () => {
  const original = { ...english }, localizations = translated();
  let result = updateChapterEditorField(original, localizations, "en", "content", "Use zero-filled shifts.");
  result = updateChapterEditorField(result.original, result.localizations, "en", "checkpointAnswer", "New answer");
  assert.equal(result.original.content, "Use zero-filled shifts.");
  assert.deepEqual(result.original, result.localizations.en);
  assert.equal(result.localizations.zh, localizations.zh);
  assert.deepEqual(original, english);
  assert.deepEqual(localizations, translated());
  const persisted = JSON.parse(JSON.stringify({
    id: "unchanged-chapter", ...result.original,
    localizations: parseChapterLocalizations(result.localizations), completed: true,
    acslLinks: [{ paperId: "paper", versionId: "pinned" }],
  }));
  for (const language of ["en", "zh"]) {
    const shown = localizedChapter(persisted, language);
    assert.equal(shown.id, persisted.id);
    assert.equal(shown.completed, true);
    assert.equal(shown.acslLinks, persisted.acslLinks);
    assert.equal(shown.content, result.localizations[language].content);
    assert.equal(shown.checkpointAnswer, result.localizations[language].checkpointAnswer);
  }
  const fallback = localizedChapter({ ...persisted, localizations: { zh: result.localizations.zh } }, "en");
  assert.equal(fallback.content, result.original.content);
});

test("editing Chinese is independent when the original matches English, and vice versa", () => {
  const original = { ...english }, localizations = translated();
  const result = updateChapterEditorField(original, localizations, "zh", "title", "新的中文标题");
  assert.equal(result.original, original);
  assert.equal(result.localizations.en, localizations.en);
  assert.equal(result.localizations.zh.title, "新的中文标题");
  const chineseSource = updateChapterEditorField(chinese, translated(), "zh", "objective", "新的目标");
  assert.deepEqual(chineseSource.original, chineseSource.localizations.zh);
  const other = updateChapterEditorField(chinese, translated(), "en", "objective", "New objective");
  assert.equal(other.original, chinese);
  assert.deepEqual(other.localizations.zh, chinese);
});

test("adding a missing language explicitly copies the original and never replaces an existing translation", () => {
  const original = { ...english };
  const ignored = updateChapterEditorField(original, undefined, "zh", "title", "Do not invent a translation");
  assert.equal(ignored.original, original);
  assert.equal(ignored.localizations, undefined);
  const added = addChapterTranslation(original, undefined, "zh");
  assert.equal(added.original, original);
  assert.deepEqual(added.localizations, { zh: english });
  assert.notEqual(added.localizations.zh, original);
  const existing = translated(), preserved = addChapterTranslation(original, existing, "zh");
  assert.equal(preserved.localizations, existing);
  assert.deepEqual(preserved.localizations.zh, chinese);
});

test("divergent legacy content and ambiguous duplicate languages are preserved rather than reconciled silently", () => {
  const original = { ...english, content: "An older independently edited passage." }, localizations = translated();
  const en = updateChapterEditorField(original, localizations, "en", "content", "New English version");
  assert.equal(en.original, original);
  assert.equal(en.localizations.zh, localizations.zh);
  const legacy = updateChapterEditorField(original, localizations, "original", "content", "Edited original");
  assert.equal(legacy.localizations, localizations);
  assert.equal(legacy.original.content, "Edited original");
  const ambiguous = updateChapterEditorField(english, { en: { ...english }, zh: { ...english } }, "en", "content", "English edit");
  assert.equal(ambiguous.original, english);
  assert.deepEqual(ambiguous.localizations.zh, english);
});

test("temporarily empty fields stay with their editing source until validation permits saving", () => {
  const state = updateChapterEditorField(english, translated(), "en", "content", "");
  assert.equal(findOriginalLanguage(state.original, state.localizations), "en");
  assert.equal(chapterEditorFields(state.original, state.localizations, "en").content, "");
  assert.throws(() => parseChapterLocalizations(state.localizations));
  const completed = updateChapterEditorField(state.original, state.localizations, "en", "content", "Replacement passage");
  assert.equal(findOriginalLanguage(completed.original, completed.localizations), "en");
  assert.equal(parseChapterLocalizations(completed.localizations).en.content, "Replacement passage");
  assert.deepEqual(completed.localizations.zh, chinese);
});

test("a single untranslated copy never becomes the original language after save and reload", () => {
  const added = addChapterTranslation(english, undefined, "zh");
  assert.equal(findOriginalLanguage(added.original, added.localizations), null);
  const saved = JSON.parse(JSON.stringify({
    original: added.original,
    localizations: parseChapterLocalizations(added.localizations),
  }));
  assert.equal(findOriginalLanguage(saved.original, saved.localizations), null);
  const edited = updateChapterEditorField(saved.original, saved.localizations, "zh", "content", "真正的中文正文");
  assert.deepEqual(edited.original, english);
  assert.equal(edited.localizations.zh.content, "真正的中文正文");
});

test("the editing session binding survives translation removal and temporarily identical languages", () => {
  const withoutChinese = { en: { ...english } };
  const edit = updateChapterEditorField(english, withoutChinese, "en", "title", "Updated English title", "en");
  assert.equal(edit.original.title, "Updated English title");
  assert.deepEqual(edit.original, edit.localizations.en);
  const copied = addChapterTranslation(edit.original, edit.localizations, "zh");
  assert.equal(findOriginalLanguage(copied.original, copied.localizations), null);
  const continued = updateChapterEditorField(copied.original, copied.localizations, "en", "content", "New source passage", "en");
  assert.deepEqual(continued.original, continued.localizations.en);
  assert.equal(continued.localizations.zh.content, english.content);
  const translatedCopy = updateChapterEditorField(copied.original, copied.localizations, "zh", "content", "译文", "en");
  assert.equal(translatedCopy.original, copied.original);
  assert.equal(translatedCopy.localizations.en, copied.localizations.en);
});

test("an explicit unbound session never starts synchronizing after a second language is added", () => {
  const copied = addChapterTranslation(english, { en: { ...english } }, "zh");
  const chineseEdit = updateChapterEditorField(copied.original, copied.localizations, "zh", "content", "中文正文", null);
  assert.equal(findOriginalLanguage(chineseEdit.original, chineseEdit.localizations), "en");
  const englishEdit = updateChapterEditorField(chineseEdit.original, chineseEdit.localizations, "en", "content", "Independent English", null);
  assert.equal(englishEdit.original, english);
  assert.equal(englishEdit.localizations.en.content, "Independent English");
});

test("a previously bound source cannot overwrite an independently changed original", () => {
  const original = { ...english, checkpointAnswer: "An original-only edit" };
  const edited = updateChapterEditorField(original, translated(), "en", "content", "Updated English", "en");
  assert.equal(edited.original, original);
  assert.equal(edited.original.checkpointAnswer, "An original-only edit");
  assert.equal(edited.localizations.en.checkpointAnswer, english.checkpointAnswer);
  assert.equal(edited.localizations.en.content, "Updated English");
});

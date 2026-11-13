import test from "node:test";
import assert from "node:assert/strict";
import { courseDraftEqual } from "../src/components/teacher/course-draft-equality.ts";

const lesson = {
  id: "chapter-one", title: "Original", content: "Original content", sectionKey: "topic-one",
  localizations: { en: { title: "English", content: "English content" }, zh: { title: "中文", content: "中文内容" } },
  problems: [{ problemId: "problem-one", versionId: "version-one" }],
  acslLinks: [{ paperId: "paper-one", versionId: "edition-one", kind: "written" }],
};
const course = { title: "Course", sections: [{ key: "topic-one", title: "Topic" }], chapters: [lesson] };

test("draft equality keeps unsaved content, translations, order and pinned references protected", () => {
  assert.equal(courseDraftEqual(course, structuredClone(course)), true);
  const mutations = [
    draft => { draft.title = "Renamed"; },
    draft => { draft.sections[0].title = "Renamed topic"; },
    draft => { draft.chapters[0].content = "Changed original"; },
    draft => { draft.chapters[0].localizations.zh.content = "修改"; },
    draft => { delete draft.chapters[0].localizations.en; },
    draft => { draft.chapters[0].problems[0].versionId = "version-two"; },
    draft => { draft.chapters[0].acslLinks[0].versionId = "edition-two"; },
    draft => { draft.chapters.push({ ...lesson, id: "chapter-two" }); },
    draft => { draft.chapters = []; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(course);
    mutate(changed);
    assert.equal(courseDraftEqual(changed, course), false);
  }
  const chapters = [lesson, { ...lesson, id: "chapter-two" }];
  assert.equal(courseDraftEqual(chapters, [...chapters].reverse()), false);
});

test("reverting an edit clears dirty state and optional JSON fields remain equivalent", () => {
  const changed = { ...course, chapters: [{ ...lesson, content: "Changed" }] };
  assert.equal(courseDraftEqual(changed, course), false);
  changed.chapters[0].content = lesson.content;
  assert.equal(courseDraftEqual(changed, course), true);
  assert.equal(courseDraftEqual({ ...lesson, objective: undefined }, lesson), true);
  assert.equal(courseDraftEqual({ ...lesson, objective: null }, lesson), false);
});

test("unchanged chapter bodies are never traversed during an edit elsewhere", () => {
  let reads = 0;
  const largeUnchangedChapter = {
    id: "large-chapter",
    get content() { reads++; throw new Error("Unchanged chapter body must not be traversed"); },
  };
  const baseline = { chapters: [largeUnchangedChapter, lesson] };
  const edited = { chapters: [largeUnchangedChapter, { ...lesson, title: "Changed" }] };
  assert.equal(courseDraftEqual(baseline, edited), false);
  assert.equal(courseDraftEqual(baseline, { chapters: [largeUnchangedChapter, { ...lesson }] }), true);
  assert.equal(reads, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { chapterDirectoryTitle } from "../src/lib/learning-chapter-title.ts";

test("numbered imported titles show one current chapter number", () => {
  for (const title of ["01 Searching", "01. Searching", "1. 01 Searching", "第1章 Searching", "第一章：Searching", "Chapter 1: Searching"]) {
    assert.equal(chapterDirectoryTitle(title, 0), "1. Searching", title);
  }
  assert.equal(chapterDirectoryTitle("01 Searching", 4), "5. Searching");
  assert.equal(chapterDirectoryTitle("2 Sorting", 1), "2. Sorting");
  assert.equal(chapterDirectoryTitle("Searching", 0), "1. Searching");
});

test("numbers belonging to the subject remain in the title", () => {
  for (const title of ["2D Arrays", "9618 Paper 4", "3.14 calculations", "2 ways to search"]) {
    assert.equal(chapterDirectoryTitle(title, 0), `1. ${title}`);
  }
});


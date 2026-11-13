import assert from "node:assert/strict";
import { test } from "node:test";
import { filterTeacherBankDetailRows, filterTeacherProblemRows } from "../src/components/teacher/problem-bank-rows.ts";
import { adjacentProblemRows } from "../src/components/teacher/problem-editor-navigation.ts";
import { problemEditorHref } from "../src/components/teacher/platform-problem-source.ts";

const first = { id: "first", title: "Python 01", bankId: "python", canEdit: true, published: false };
const readOnly = { id: "read-only", title: "Python 02", bankId: "python", canEdit: false, published: false };
const saved = { id: "current", title: "Renamed problem", bankId: "python", canEdit: true, published: true };
const last = { id: "last", title: "Python 04", bankId: "python", canEdit: true, published: false };
const other = { id: "other", title: "Python 05", bankId: "other", canEdit: true, published: false };
const items = [first, readOnly, saved, last, other];
const filters = { query: "Python", bank: "python", group: "", status: "draft", archived: false, showBanks: false };
const banks = [{ id: "python" }, { id: "other" }];

test("editor steps follow filtered list order, skip read-only rows, and keep the current item as an anchor after saving", () => {
  const { rows } = filterTeacherProblemRows({ items, filters, banks, currentId: saved.id });
  const editableRows = rows.filter(row => row.canEdit);
  assert.deepEqual(editableRows, [first, saved, last]);
  assert.deepEqual(adjacentProblemRows(editableRows, saved.id), { previous: first, next: last });
  assert.equal(adjacentProblemRows(editableRows, first.id).previous, undefined);
  assert.equal(adjacentProblemRows(editableRows, last.id).next, undefined);
  assert.deepEqual(adjacentProblemRows(editableRows, other.id), {});
  assert.deepEqual(filterTeacherProblemRows({ items, filters, banks }).rows, [first, readOnly, last]);
});

test("bank detail steps use the visible bank and group without reordering by membership", () => {
  const groups = [{ id: "arrays", name: "Arrays", bankId: "python", problemIds: [last.id, other.id, first.id] }];
  assert.deepEqual(filterTeacherBankDetailRows(items, "python", "arrays", groups).rows, [first, last]);
  assert.deepEqual(filterTeacherBankDetailRows(items, "python", "none", groups).rows, [readOnly, saved]);
});

test("editor links preserve the originating list and explicitly select the platform editor for platform problems", () => {
  const origin = "/teacher/problems/banks/python";
  const platform = { ...last, ownerScope: "platform" };
  const target = new URL(problemEditorHref(platform, origin, "solutions", "FULL_TRANSLATION"), "http://campus.local");
  assert.equal(target.pathname, "/teacher/problems/last/edit");
  assert.equal(target.searchParams.get("source"), "platform");
  assert.equal(target.searchParams.get("returnTo"), origin);
  assert.equal(target.searchParams.get("tab"), "solutions");
  assert.equal(target.searchParams.get("kind"), "FULL_TRANSLATION");
  assert.equal(problemEditorHref(first), "/teacher/problems/first/edit");
});

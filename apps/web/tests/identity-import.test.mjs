import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as xlsx from 'xlsx';
import { availableIdentityImportModes, identityCsvTemplate, parseIdentityRows } from '../src/components/admin/import-rows.ts';

test('teacher import defaults rows without kind to teacher identities', () => {
  const rows = parseIdentityRows([{ 工号: 'T001', 姓名: '陈老师', 性别: '女', 负责班级: '高一 1 班' }], 'teachers');
  assert.equal(rows[0].kind, 'teacher');
  assert.equal(rows[0].number, 'T001');
  assert.equal(rows[0].className, '高一 1 班');
  assert.equal(rows[0].gender, 'female');
  assert.equal(rows[0].issue, '');
});

test('each import mode rejects a row explicitly naming the other identity kind', () => {
  assert.match(parseIdentityRows([{ number: 'S001', name: '学生', kind: 'student' }], 'teachers')[0].issue, /仅导入教师/);
  assert.match(parseIdentityRows([{ number: 'T001', name: '教师', kind: 'teacher' }], 'students')[0].issue, /仅导入学生/);
  assert.match(parseIdentityRows([{ 学号: 'S001', 姓名: '学生' }], 'teachers')[0].issue, /工号列/);
  assert.match(parseIdentityRows([{ 工号: 'T001', 姓名: '教师' }], 'students')[0].issue, /学号列/);
});

test('templates name the intended identity and repeated rows are not silently imported', () => {
  const teacherTemplate = decodeURIComponent(identityCsvTemplate('teachers').split(',')[1]);
  const studentTemplate = decodeURIComponent(identityCsvTemplate('students').split(',')[1]);
  const teacherWorkspaceTemplate = decodeURIComponent(identityCsvTemplate('students', true).split(',')[1]);
  assert.match(teacherTemplate, /^\uFEFF工号,姓名,性别,负责班级/);
  assert.match(studentTemplate, /^\uFEFF学号,姓名,性别,班级/);
  assert.match(teacherWorkspaceTemplate, /^\uFEFF学号,姓名,性别\n/);
  const rows = parseIdentityRows([{ number: 'T001', name: '陈老师' }, { number: 'T001', name: '陈老师' }], 'teachers');
  assert.equal(rows[0].issue, '');
  assert.match(rows[1].issue, /文件中编号重复/);
});

test('teacher workspace offers only student roster import while admin offers teacher import too', () => {
  assert.deepEqual(availableIdentityImportModes(true), ['students']);
  assert.deepEqual(availableIdentityImportModes(false), ['students', 'teachers']);
});

test('downloaded teacher CSV imports through the same spreadsheet reader as the page', () => {
  const csv = decodeURIComponent(identityCsvTemplate('teachers').split(',')[1]) + 'T900,陈老师,女,高一 1 班\n';
  const book = xlsx.read(new TextEncoder().encode(csv).buffer, { type: 'array', raw: true, codepage: 65001 });
  const data = xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '', raw: false });
  const rows = parseIdentityRows(data, 'teachers');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'teacher');
  assert.equal(rows[0].className, '高一 1 班');
  assert.equal(rows[0].issue, '');
});

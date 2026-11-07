import test from 'node:test';
import assert from 'node:assert/strict';
import * as xlsx from 'xlsx';
import {
  IdentityImportParseError,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  identityRowsFromMatrix,
  parseIdentityCsv,
  parseIdentityFile,
  schoolIdentityCsvTemplate,
} from '../src/components/schools/school-identity-import-parser.ts';

const isError = code => error => error instanceof IdentityImportParseError && error.code === code;
function workbookFile(matrix, { changeSheet, secondSheet, name = 'identities.xlsx' } = {}) {
  const book = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(matrix);
  changeSheet?.(sheet);
  xlsx.utils.book_append_sheet(book, sheet, 'Identities');
  if (secondSheet) xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(secondSheet), 'Ignored');
  return new File([xlsx.write(book, { type: 'array', bookType: 'xlsx' })], name);
}

test('school CSV preserves leading zero identifiers and accepts BOM, CRLF, and either header order', () => {
  assert.deepEqual(parseIdentityCsv('\uFEFF NAME , NUMBER \r\n 张同学 , 000001 \r\n 李老师 , T0002 \r\n'), [
    { number: '000001', name: '张同学' }, { number: 'T0002', name: '李老师' },
  ]);
  assert.deepEqual(parseIdentityCsv('number,name\n000000000000000000001,Long identifier'), [
    { number: '000000000000000000001', name: 'Long identifier' },
  ]);
});

test('school CSV handles quoted commas, escaped quotes, and multiline cells without evaluating them', () => {
  assert.deepEqual(parseIdentityCsv('number,name\r\n"00,01","A ""quoted"" name"\r\n"002","Two\nlines"\r\n=1+1,Formula-looking text'), [
    { number: '00,01', name: 'A "quoted" name' },
    { number: '002', name: 'Two\nlines' },
    { number: '=1+1', name: 'Formula-looking text' },
  ]);
});

test('school parser retains duplicate and incomplete rows for authoritative server validation', () => {
  assert.deepEqual(parseIdentityCsv('number,name\n001,First\n001,First\n\n002\n003,Last\n\n'), [
    { number: '001', name: 'First' },
    { number: '001', name: 'First' },
    { number: '', name: '' },
    { number: '002', name: '' },
    { number: '003', name: 'Last' },
  ]);
  assert.deepEqual(identityRowsFromMatrix([['number', 'name'], [12, null], ['013', 'Last'], ['', '']]), [
    { number: '12', name: '' }, { number: '013', name: 'Last' },
  ]);
});

test('school CSV rejects ambiguous quoting, missing headers, extra columns, and empty content', () => {
  for (const csv of ['number,name\n01,"unfinished', 'number,name\n01,a"b', 'number,name\n01,"closed"suffix']) {
    assert.throws(() => parseIdentityCsv(csv), isError('CSV_FORMAT'));
  }
  for (const csv of ['id,name\n01,Name', 'number,number\n01,Name', 'number,name,role\n01,Name,student', '01,Name']) {
    assert.throws(() => parseIdentityCsv(csv), isError('HEADER'));
  }
  assert.throws(() => parseIdentityCsv('number,name\n01,Name,unexpected'), isError('COLUMNS'));
  for (const csv of ['', '\uFEFF\r\n', 'number,name\r\n', 'number,name\n,\n']) {
    assert.throws(() => parseIdentityCsv(csv), isError('EMPTY_FILE'));
  }
});

test('school parser accepts exactly 500 data rows and rejects larger imports', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => [String(index).padStart(6, '0'), 'Name ' + index]);
  assert.equal(identityRowsFromMatrix([['number', 'name'], ...rows]).length, 500);
  assert.throws(() => identityRowsFromMatrix([['number', 'name'], ...rows, ['extra', 'Extra']]), isError('ROW_LIMIT'));
});

test('school file parser rejects unsupported, empty, and over-limit files before reading them', async () => {
  await assert.rejects(parseIdentityFile(new File(['number,name\n01,Name'], 'identities.xls')), isError('FILE_TYPE'));
  await assert.rejects(parseIdentityFile(new File([], 'identities.csv')), isError('EMPTY_FILE'));
  await assert.rejects(parseIdentityFile(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], 'identities.xlsx')), isError('FILE_SIZE'));
  assert.deepEqual(await parseIdentityFile(new File(['number,name\n00001,Name'], 'IDENTITIES.CSV')), [
    { number: '00001', name: 'Name' },
  ]);
});

test('school XLSX parser reads the first sheet and preserves text and formatted zero-padded numbers', async () => {
  const file = workbookFile([['number', 'name'], ['000001', 'Text number'], [12, 'Formatted number']], {
    changeSheet: sheet => { sheet.A3.z = '000000'; },
    secondSheet: [['not', 'valid', 'headers'], ['Ignored', 'row', 'data']],
  });
  assert.deepEqual(await parseIdentityFile(file), [
    { number: '000001', name: 'Text number' },
    { number: '000012', name: 'Formatted number' },
  ]);
});

test('school XLSX parser rejects formula cells and reports malformed workbooks', async () => {
  const formula = workbookFile([['number', 'name'], ['001', 'Name']], {
    changeSheet: sheet => { sheet.A2 = { t: 's', v: '001', f: 'TEXT(1,"000")' }; },
  });
  await assert.rejects(parseIdentityFile(formula), isError('FORMULA'));
  await assert.rejects(parseIdentityFile(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'broken.xlsx')), isError('WORKBOOK'));
});

test('school XLSX parser rejects extra columns and rows beyond the 500-row boundary', async () => {
  await assert.rejects(parseIdentityFile(workbookFile([['number', 'name'], ['001', 'Name', 'Extra']])), isError('COLUMNS'));
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => [String(index), 'Name']);
  await assert.rejects(parseIdentityFile(workbookFile([['number', 'name'], ...rows])), isError('ROW_LIMIT'));
});

test('school student and teacher templates round-trip through the same file parser', async () => {
  for (const kind of ['student', 'teacher']) {
    const content = schoolIdentityCsvTemplate(kind);
    assert.ok(content.startsWith('\uFEFFnumber,name\r\n'));
    const rows = await parseIdentityFile(new File([content], kind + '.csv'));
    assert.deepEqual(rows.map(row => row.number), ['000001', '000002']);
    assert.ok(rows.every(row => row.name.includes(kind === 'student' ? 'Student' : 'Teacher')));
  }
});

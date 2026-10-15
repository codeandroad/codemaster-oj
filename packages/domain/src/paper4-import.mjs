// A Paper 4 package is a JSON manifest, optionally wrapped in a ZIP with
// small UTF-8 text assets. This parser never extracts entries to disk and
// never interprets a PDF or an arbitrary source ZIP as a question paper.
import { inflateRawSync } from 'node:zlib';
import { fail } from './security.mjs';

const MAX_PACKAGE = 1024 * 1024;
const MAX_EXPANDED = 2 * 1024 * 1024;
const MAX_ENTRY = 256 * 1024;
const MAX_ENTRIES = 100;
const MAX_RATIO = 100;
const FILE_REF = /^assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,118}\.(?:txt|csv|dat|md|py)$/i;
const DECODER = new TextDecoder('utf-8', { fatal: true });

function invalid(message) { fail(400, 'PAPER4_IMPORT', message); }
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    invalid(`${label} must be an object.`);
  return value;
}
function allowed(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`${label} has an unknown field: ${key}.`);
  return value;
}
function text(buffer, label) {
  let result;
  try { result = DECODER.decode(buffer); } catch { invalid(`${label} must be UTF-8 text.`); }
  if (result.includes('\0')) invalid(`${label} contains a NUL byte.`);
  return result;
}
function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PACKAGE / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    invalid('Package must be a base64-encoded JSON or ZIP file of at most 1 MiB.');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_PACKAGE || buffer.toString('base64') !== value)
    invalid('Package must be a base64-encoded JSON or ZIP file of at most 1 MiB.');
  return buffer;
}
function zipName(name, directory = false) {
  if (name === 'manifest.json') return name;
  if (directory && /^assets\/(?:[A-Za-z0-9][A-Za-z0-9_-]{0,39}\/)*$/.test(name)) return name;
  const trimmed = directory ? name.slice(0, -1) : name;
  if (!FILE_REF.test(trimmed) || trimmed.includes('..') || trimmed.includes('//') || name.includes('\\') ||
      (directory && !name.endsWith('/'))) invalid(`Unsafe ZIP entry: ${name}.`);
  return name;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipManifest(buffer) {
  // ZIP's end-of-central-directory is in its final 65,557 bytes. Reject
  // multi-disk, ZIP64, encrypted and unsupported methods instead of making
  // assumptions about offsets or silently skipping unknown entries.
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      eocd = offset; break;
    }
  }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0)
    invalid('Invalid or multi-disk ZIP package.');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralStart = buffer.readUInt32LE(eocd + 16);
  if (count < 1 || count > MAX_ENTRIES || count === 65535 || centralStart + centralSize !== eocd ||
      buffer.readUInt16LE(eocd + 8) !== count) invalid('ZIP entry count or directory is invalid.');
  const entries = new Map();
  const seenLower = new Set();
  let offset = centralStart;
  let expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) invalid('ZIP central directory is invalid.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const disk = buffer.readUInt16LE(offset + 34);
    const external = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || nameLength < 1 || disk !== 0 || compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff || localOffset === 0xffffffff || flags & 1 || ![0, 8].includes(method))
      invalid('Unsupported ZIP entry.');
    const name = text(buffer.subarray(offset + 46, offset + 46 + nameLength), 'ZIP filename');
    const directory = name.endsWith('/');
    zipName(name, directory);
    const lower = name.toLowerCase();
    if (seenLower.has(lower)) invalid(`Duplicate ZIP entry: ${name}.`);
    seenLower.add(lower);
    // A symlink's Unix mode is stored in the high word of external attrs.
    if ((external >>> 16 & 0xf000) === 0xa000) invalid(`Symlinks are not allowed in ZIP packages: ${name}.`);
    if (uncompressedSize > MAX_ENTRY || (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize > compressedSize * MAX_RATIO))
      invalid(`ZIP entry exceeds its size or compression-ratio limit: ${name}.`);
    expandedTotal += uncompressedSize;
    if (expandedTotal > MAX_EXPANDED) invalid('ZIP package expands beyond 2 MiB.');
    if (localOffset + 30 > centralStart || buffer.readUInt32LE(localOffset) !== 0x04034b50 ||
        buffer.readUInt16LE(localOffset + 8) !== method || buffer.readUInt16LE(localOffset + 6) !== flags)
      invalid('ZIP local entry does not match its directory.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    if (dataStart + compressedSize > centralStart ||
        !buffer.subarray(localNameStart, localNameStart + localNameLength).equals(Buffer.from(name)))
      invalid('ZIP local entry path or data is invalid.');
    let contents;
    try {
      const zipped = buffer.subarray(dataStart, dataStart + compressedSize);
      contents = method === 0 ? zipped : inflateRawSync(zipped, { maxOutputLength: Math.min(MAX_ENTRY, uncompressedSize) + 1 });
    } catch { invalid(`ZIP entry cannot be decompressed: ${name}.`); }
    if (contents.length !== uncompressedSize || crc32(contents) !== expectedCrc)
      invalid(`ZIP entry checksum or length is invalid: ${name}.`);
    if (!directory) entries.set(name, text(contents, name));
    else if (contents.length) invalid('ZIP directory entry must be empty.');
    offset = end;
  }
  if (offset !== eocd || !entries.has('manifest.json')) invalid('ZIP must contain manifest.json.');
  return entries;
}

function parseJson(value, label) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { invalid(`${label} is not valid JSON.`); }
  return plain(parsed, label);
}
function resolveText(value, entries, used, label) {
  if (typeof value === 'string') return value;
  allowed(value, ['file'], label);
  if (typeof value.file !== 'string' || !FILE_REF.test(value.file) || value.file.includes('..') ||
      value.file.includes('//') || !entries.has(value.file)) invalid(`${label} references a missing or unsafe text asset.`);
  used.add(value.file);
  return entries.get(value.file);
}
function resolveMap(value, entries, used, label) {
  const map = plain(value ?? {}, label);
  if (Object.keys(map).length > 16) invalid(`${label} has too many entries.`);
  return Object.fromEntries(Object.entries(map).map(([name, content]) => [name, resolveText(content, entries, used, `${label} ${name}`)]));
}

export function parsePaper4Import({ filename, contentBase64 }) {
  if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(?:json|zip)$/i.test(filename))
    invalid('Choose a .json manifest or .zip package with manifest.json.');
  const buffer = decodeBase64(contentBase64);
  const zip = filename.toLowerCase().endsWith('.zip');
  const entries = zip ? unzipManifest(buffer) : new Map([['manifest.json', text(buffer, filename)]]);
  const manifest = parseJson(entries.get('manifest.json'), 'manifest.json');
  allowed(manifest, ['format', 'version', 'paper', 'questions', 'runnerCases', 'referenceSolutions'], 'manifest');
  if (manifest.format !== 'codemaster-paper4' || manifest.version !== 1)
    invalid('Unsupported Paper 4 package format or version.');
  const used = new Set(['manifest.json']);
  const paper = allowed(manifest.paper, ['title', 'description', 'classId', 'startsAt', 'endsAt'], 'paper');
  if (!Array.isArray(manifest.questions) || manifest.questions.length < 1 || manifest.questions.length > 3)
    invalid('Paper must contain 1–3 questions.');
  const questions = manifest.questions.map((item, questionIndex) => {
    const q = allowed(item, ['key', 'title', 'statement', 'starterCode', 'initialFiles', 'outputFiles', 'stages'], `question ${questionIndex + 1}`);
    if (!Array.isArray(q.stages) || !q.stages.length || q.stages.length > 30) invalid('Each question needs 1–30 stages.');
    return { key: q.key, title: q.title, statement: resolveText(q.statement, entries, used, 'question statement'),
      starterCode: resolveText(q.starterCode ?? '', entries, used, 'starter code'),
      initialFiles: resolveMap(q.initialFiles, entries, used, 'initial files'), outputFiles: q.outputFiles ?? [],
      stages: q.stages.map((stage, stageIndex) => {
        allowed(stage, ['id', 'title', 'description', 'maxMarks', 'judgeMode'], `stage ${stageIndex + 1}`);
        return { id: stage.id, title: stage.title, description: resolveText(stage.description ?? '', entries, used, 'stage description'),
          maxMarks: stage.maxMarks, judgeMode: stage.judgeMode };
      }) };
  });
  const rawCases = plain(manifest.runnerCases ?? {}, 'runnerCases');
  const runnerCases = Object.fromEntries(Object.entries(rawCases).map(([stageId, cases]) => {
    if (!Array.isArray(cases) || cases.length > 12) invalid(`runnerCases.${stageId} must be an array of up to 12 cases.`);
    return [stageId, cases.map((item, caseIndex) => {
      const c = allowed(item, ['id', 'stdin', 'inputFiles', 'expectedStdout', 'expectedFiles', 'public', 'driverCode'], `case ${caseIndex + 1}`);
      return { id: c.id, stdin: resolveText(c.stdin ?? '', entries, used, 'case stdin'),
        inputFiles: resolveMap(c.inputFiles, entries, used, 'case input files'),
        ...(c.expectedStdout === undefined ? {} : { expectedStdout: resolveText(c.expectedStdout, entries, used, 'expected stdout') }),
        expectedFiles: resolveMap(c.expectedFiles, entries, used, 'case expected files'),
        ...(c.public === undefined ? {} : { public: c.public }),
        ...(c.driverCode === undefined ? {} : { driverCode: resolveText(c.driverCode, entries, used, 'driver code') }) };
    })];
  }));
  const rawReferences = plain(manifest.referenceSolutions ?? {}, 'referenceSolutions');
  const referenceSolutions = Object.fromEntries(Object.entries(rawReferences).map(([questionKey, source]) =>
    [questionKey, resolveText(source, entries, used, `reference solution ${questionKey}`)]));
  for (const name of entries.keys()) if (!used.has(name)) invalid(`Unused ZIP asset: ${name}.`);
  const createBody = { title: paper.title, description: paper.description ?? '',
    classId: paper.classId ?? null, startsAt: paper.startsAt ?? null, endsAt: paper.endsAt ?? null,
    questions, runnerCases, referenceSolutions };
  const preview = { title: createBody.title, description: createBody.description,
    questionCount: questions.length, totalMarks: questions.flatMap(q => q.stages).reduce((sum, stage) => sum + Number(stage.maxMarks || 0), 0),
    autoStageCount: questions.flatMap(q => q.stages).filter(stage => stage.judgeMode === 'auto').length,
    manualStageCount: questions.flatMap(q => q.stages).filter(stage => stage.judgeMode === 'manual').length,
    evidenceStageCount: questions.flatMap(q => q.stages).filter(stage => stage.judgeMode === 'evidence').length,
    caseCount: Object.values(runnerCases).reduce((sum, cases) => sum + cases.length, 0),
    referenceSolutionCount: Object.keys(referenceSolutions).length,
    questions: questions.map(q => ({ key: q.key, title: q.title,
      marks: q.stages.reduce((sum, stage) => sum + Number(stage.maxMarks || 0), 0),
      stageCount: q.stages.length, autoStageCount: q.stages.filter(stage => stage.judgeMode === 'auto').length,
      evidenceStageCount: q.stages.filter(stage => stage.judgeMode === 'evidence').length,
      caseCount: q.stages.reduce((sum, stage) => sum + (runnerCases[stage.id]?.length ?? 0), 0),
      hasReferenceSolution: Object.hasOwn(referenceSolutions, q.key) })) };
  return { preview, createBody };
}

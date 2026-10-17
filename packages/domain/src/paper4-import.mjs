// A Paper 4 package is a JSON manifest, optionally wrapped in a ZIP with
// small UTF-8 text assets. This parser never extracts entries to disk and
// never interprets a PDF or an arbitrary source ZIP as a question paper.
import { readPaper4Archive } from './paper4-archive.mjs';
import { fail } from './security.mjs';
import { paper4ExamInput, paper4ShortTitle, paper4ShortTitleInput } from './paper4-catalog.mjs';

const MAX_PACKAGE = 1024 * 1024;
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

function unzipManifest(buffer) {
 const entries=readPaper4Archive(buffer,{nameAllowed:zipName});
 if(!entries.has('manifest.json'))invalid('ZIP must contain manifest.json.');
 return new Map([...entries].map(([name,contents])=>[name,text(contents,name)]));
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
  const paper = allowed(manifest.paper, ['title', 'shortTitle', 'description', 'classId', 'startsAt', 'endsAt', 'examYear', 'examSession', 'examVariant'], 'paper');
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
  const createBody = { title: paper.title, shortTitle:paper4ShortTitleInput(paper.shortTitle),description: paper.description ?? '', ...paper4ExamInput(paper),
    classId: paper.classId ?? null, startsAt: paper.startsAt ?? null, endsAt: paper.endsAt ?? null,
    questions, runnerCases, referenceSolutions };
  const preview = { title: createBody.title, shortTitle:paper4ShortTitle(createBody),description: createBody.description, ...paper4ExamInput(paper),
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

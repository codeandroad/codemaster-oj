import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { enumValue, fail, field, uuid } from './security.mjs';
import { validatePaperDefinition } from './acsl-grading.mjs';
import { readAcslSolutionPrice, updateAcslSolutionPrice } from './acsl-pricing.mjs';
import { acslManagementCatalog } from './acsl-catalog.mjs';

const reply = body => ({ status: 200, body });
const questionFields = ['topic', 'statement', 'statementDiagrams', 'correctOptionIds', 'explanation', 'explanationDiagrams'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function only(value, keys, label) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, 'INVALID_ACSL_EDIT', `Invalid ${label} fields.`);
}
function assign(target, patch, keys) {
  for (const key of keys) if (Object.hasOwn(patch, key)) {
    if (key.endsWith('Diagrams') && patch[key] === null) delete target[key];
    else target[key] = patch[key];
  }
}

async function staffAccess(db, schoolId, user, write) {
  await lockSchoolTeaching(db, schoolId, { shared: !write });
  if (schoolId === LEGACY_SCHOOL_ID) {
    await activeAccount(db, user.id);
    const result = await db.query(`SELECT 1 FROM legacy_school_account_ownership o JOIN account_roles r ON r.account_id=o.account_id
      WHERE o.account_id=$1 AND r.role IN ('teacher','admin')`, [user.id]);
    if (!result.rowCount) fail(403, 'FORBIDDEN', 'Teaching access to this school is required.');
  } else if (!['teacher', 'school_admin'].includes(await schoolRole(db, schoolId, user.id))) {
    fail(403, 'FORBIDDEN', 'Teaching access to this school is required.');
  }
  await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
}

async function load(db, schoolId, paperId) {
  const paper = (await db.query('SELECT * FROM acsl_papers WHERE school_id=$1 AND id=$2', [schoolId, uuid(paperId)])).rows[0];
  if (!paper) fail(404, 'NOT_FOUND', 'ACSL paper is unavailable.');
  return paper;
}

function catalogItem(paper) {
  const { title, division, season, round, roundLabel, questions } = paper.definition;
  return { id: paper.id, versionId: paper.version_id, slug: paper.slug, title, division, season, round,
    ...(roundLabel ? { roundLabel } : {}), questionCount: questions.length, hasProgramming: Boolean(paper.programming_problem_id),
    enabled: paper.enabled, canEdit: true, canExport: true };
}

function teacherQuestion(question) {
  return { id: question.id, number: question.number, type: question.type,
    ...Object.fromEntries(questionFields.filter(key => question[key] !== undefined).map(key => [key, question[key]])),
    options: question.options.map(({ id, text, diagrams }) => ({ id, text, ...(diagrams ? { diagrams } : {}) })) };
}

function detail(paper) {
  const program = paper.definition.programming;
  return { ...catalogItem(paper), contentHash: paper.content_hash, writtenRevision: paper.written_revision ?? paper.version_id,
    writtenRevisionAt: paper.written_revision_at, changedQuestionIds: paper.written_changed_question_ids,
    questions: paper.definition.questions.map(teacherQuestion), programming: program ? {
      id: paper.programming_problem_id, title: program.definition.title, statement: program.definition.statement,
      statementZh: program.statementZh, ...(program.statementDiagrams ? { statementDiagrams: program.statementDiagrams } : {}),
      samples: program.definition.samples.map(({ input, expected }) => ({ input, expected })),
      ...(program.solution ? { solution: program.solution } : {}),
      readOnlyJudge: { mode: program.definition.mode, comparator: program.definition.comparator,
        timeLimitMs: program.definition.timeLimitMs, memoryLimitMb: program.definition.memoryLimitMb, testCount: program.definition.tests.length },
    } : null };
}

export function mergeAcslManagementEdit(before, body) {
  only(body, ['expectedContentHash', 'requestId', 'reason', 'title', 'questions', 'programming'], 'ACSL edit');
  if (typeof body.expectedContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedContentHash)) fail(400, 'INVALID_ACSL_EDIT', 'Include the current content hash.');
  uuid(body.requestId, 'Edit request ID'); field(body.reason, 'Edit reason', { max: 2000 });
  const after = structuredClone(before);
  if (Object.hasOwn(body, 'title')) after.title = body.title;
  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions) || body.questions.length > before.questions.length ||
        new Set(body.questions.map(question => question?.id)).size !== body.questions.length) fail(400, 'INVALID_ACSL_EDIT', 'Question edits must use unique existing IDs.');
    for (const patch of body.questions) {
      only(patch, ['id', ...questionFields, 'options'], 'question');
      const question = after.questions.find(question => question.id === patch.id);
      if (!question) fail(400, 'INVALID_ACSL_EDIT', 'Question IDs and order are fixed.');
      assign(question, patch, questionFields);
      if (patch.options !== undefined) {
        if (!Array.isArray(patch.options) || patch.options.length > question.options.length ||
            new Set(patch.options.map(option => option?.id)).size !== patch.options.length) fail(400, 'INVALID_ACSL_EDIT', 'Option edits must use unique existing IDs.');
        for (const optionPatch of patch.options) {
          only(optionPatch, ['id', 'text', 'diagrams'], 'option');
          const option = question.options.find(option => option.id === optionPatch.id);
          if (!option) fail(400, 'INVALID_ACSL_EDIT', 'Option IDs and order are fixed.');
          if (Object.hasOwn(optionPatch, 'text')) option.text = optionPatch.text;
          if (Object.hasOwn(optionPatch, 'diagrams')) {
            if (optionPatch.diagrams === null) delete option.diagrams;
            else option.diagrams = optionPatch.diagrams;
          }
        }
      }
    }
  }
  if (body.programming !== undefined) {
    only(body.programming, ['title', 'statement', 'statementZh', 'statementDiagrams'], 'programming presentation');
    if (!after.programming) fail(400, 'INVALID_ACSL_EDIT', 'This paper has no programming section.');
    const patch = body.programming;
    for (const key of ['title', 'statement']) if (Object.hasOwn(patch, key)) {
      after.programming.definition[key] = field(patch[key], `Programming ${key}`, { max: key === 'title' ? 200 : 100000, trim: false });
    }
    assign(after.programming, patch, ['statementZh', 'statementDiagrams']);
  }
  try { validatePaperDefinition(after); }
  catch { fail(400, 'INVALID_ACSL_EDIT', 'Check the bilingual text, diagrams and answer selections.'); }
  return after;
}

export function acslExportDocument(content, include, language) {
  if (include === 'package') return content;
  const solutions = include === 'answers';
  const program = content.programming;
  return { schemaVersion: 1, kind: include, language, slug: content.slug, title: content.title[language],
    division: content.division, season: content.season, round: content.round,
    ...(content.roundLabel ? { roundLabel: content.roundLabel[language] } : {}),
    questions: content.questions.map(question => ({ id: question.id, number: question.number, type: question.type,
      topic: question.topic[language], statement: question.statement[language], statementDiagrams: question.statementDiagrams?.[language] ?? [],
      options: question.options.map(option => ({ id: option.id, text: option.text[language], diagrams: option.diagrams?.[language] ?? [] })),
      ...(solutions ? { correctOptionIds: question.correctOptionIds, explanation: question.explanation[language], explanationDiagrams: question.explanationDiagrams?.[language] ?? [] } : {}),
    })),
    programming: program ? { title: program.definition.title, statement: language === 'zh' ? program.statementZh : program.definition.statement,
      statementDiagrams: program.statementDiagrams?.[language] ?? [], samples: program.definition.samples.map(({ input, expected }) => ({ input, expected })),
      ...(solutions && program.solution ? { solution: { language: program.solution.language, provenance: program.solution.provenance,
        code: program.solution.code, explanation: program.solution.explanation[language], complexity: program.solution.complexity[language] } } : {}),
    } : null };
}

export async function handleAcslManagement({ pool, user, schoolId, tail, method, body, url }) {
  const parts = (tail ?? '').split('/').filter(Boolean);
  if (parts.length > 2 || parts.length === 2 && !['export', 'solution-price'].includes(parts[1]) || !['GET', 'PATCH'].includes(method) ||
      method === 'PATCH' && !(parts.length === 1 || parts.length === 2 && parts[1] === 'solution-price')) return null;
  return transaction(pool, async db => {
    await staffAccess(db, schoolId, user, method === 'PATCH');
    if (!parts.length) {
      const items = await acslManagementCatalog(db, schoolId);
      return reply({ enabled: items.length > 0, items });
    }
    let paper = await load(db, schoolId, parts[0]);
    if (parts[1] === 'solution-price') {
      if (!paper.programming_problem_id) fail(404, 'NOT_FOUND', 'This ACSL paper has no programming section.');
      return reply(method === 'GET' ? await readAcslSolutionPrice(db, paper) : await updateAcslSolutionPrice(db, paper, user, body));
    }
    if (parts[1] === 'export') {
      const include = enumValue(url.searchParams.get('include') ?? 'questions', ['questions', 'answers', 'package'], 'Export content');
      const language = enumValue(url.searchParams.get('language') ?? 'en', ['en', 'zh'], 'Export language');
      const content = acslExportDocument(paper.definition, include, language);
      return reply({ filename: `${paper.slug}-${include === 'package' ? 'package' : `${language}-${include}`}.json`,
        contentType: 'application/json', contentBase64: Buffer.from(JSON.stringify(content, null, 2)).toString('base64') });
    }
    if (method === 'GET') return reply(detail(paper));
    const content = mergeAcslManagementEdit(paper.definition, body);
    let edit;
    try {
      edit = (await db.query('SELECT acsl_edit_paper($1,$2,$3,$4,$5) AS result',
        [schoolId, paper.id, user.id, JSON.stringify(body), JSON.stringify(content)])).rows[0].result;
    } catch (error) {
      const errors = { ACSL_FORBIDDEN: [403, 'FORBIDDEN', 'Teaching access to this school is required.'],
        ACSL_NOT_FOUND: [404, 'NOT_FOUND', 'ACSL paper is unavailable.'],
        ACSL_CONTENT_CONFLICT: [409, 'CONTENT_CONFLICT', 'This paper changed. Reload before saving.'],
        ACSL_REQUEST_CONFLICT: [409, 'REQUEST_CONFLICT', 'This edit request ID was already used with different content.'],
        ACSL_INVALID_EDIT: [400, 'INVALID_ACSL_EDIT', 'Check the editable fields and answer selections.'] };
      if (errors[error.message]) fail(...errors[error.message]);
      throw error;
    }
    paper = await load(db, schoolId, paper.id);
    return reply({ ...detail(paper), edit });
  });
}

import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching, schoolRole } from './schools.mjs';
import { bytes, canonicalHash, enumValue, fail, integer, uuid } from './security.mjs';
import { gradeAnswer, paperAssetPurposes, selectedOptions } from './acsl-grading.mjs';
import { validateTask } from '../judge.mjs';
import { LANGUAGES, languageLimitsFor, starterCodesFor } from './languages.mjs';
import { submissionCaseFeedback } from './submission-feedback.mjs';
import { handleAcslManagement } from './acsl-management.mjs';
import { acslTranslation, acslSolution, requireAcslTranslation } from './acsl-translation.mjs';
import { acslCatalog } from './acsl-catalog.mjs';
import { acslLearningCourses, acslLearningLinks, courseAcslPicker } from './course-acsl.mjs';

const reply = (body, status = 200) => ({ status, body });

async function access(db, schoolId, user) {
  await lockSchoolTeaching(db, schoolId, { shared: true });
  if (schoolId === LEGACY_SCHOOL_ID) {
    await activeAccount(db, user.id);
    if (!(await db.query('SELECT 1 FROM legacy_school_account_ownership WHERE account_id=$1', [user.id])).rowCount) {
      fail(404, 'NOT_FOUND', 'School workspace is unavailable.');
    }
  } else {
    await schoolRole(db, schoolId, user.id);
  }
  await db.query("SELECT set_config('campus.school_id',$1,true)", [schoolId]);
}

async function loadPaper(db, schoolId, paperId) {
  const paper = (await db.query(`SELECT p.*,r.written_points_per_correct,r.programming_points
    FROM acsl_papers p LEFT JOIN acsl_point_rules r
      ON (r.school_id,r.paper_id,r.version_id)=(p.school_id,p.id,p.version_id) AND r.enabled_at<=clock_timestamp()
    WHERE p.school_id=$1 AND p.id=$2 AND p.enabled`, [schoolId, uuid(paperId)])).rows[0];
  if (!paper) fail(404, 'NOT_FOUND', 'ACSL paper is unavailable.');
  return paper;
}

function checkVersion(paper, versionId) {
  if (uuid(versionId, 'Paper version') !== paper.version_id) fail(409, 'VERSION_CONFLICT', 'Refresh this paper before continuing.');
}

function checkWrittenRevision(paper, revision) {
  // Before the first semantic repair, existing clients remain compatible.
  if (revision === undefined && paper.written_revision === null) return;
  if (revision !== (paper.written_revision ?? paper.version_id)) {
    fail(409, 'WRITTEN_REVISION_CONFLICT', 'This written section was revised. Reload and review the changed questions.');
  }
}

async function loadGrade(db, paper, accountId) {
  return (await db.query(`SELECT g.id,g.answers,g.correct_count AS "correctCount",g.question_count AS "questionCount",
      g.created_at AS "createdAt",a.points AS "pointsAwarded",s.questions AS "questionSnapshot",s.written_revision AS "writtenRevision"
    FROM acsl_paper_grades g LEFT JOIN acsl_point_awards a ON a.school_id=g.school_id AND a.grade_id=g.id
    LEFT JOIN acsl_grade_question_snapshots s ON s.school_id=g.school_id AND s.grade_id=g.id
    WHERE g.school_id=$1 AND g.paper_id=$2 AND g.version_id=$3 AND g.account_id=$4`,
    [paper.school_id, paper.id, paper.version_id, accountId])).rows[0] ?? null;
}

async function loadDrafts(db, paper, accountId) {
  return (await db.query(`SELECT question_id AS "questionId",selected_option_ids AS "selectedOptionIds",revision,
      coalesce(updated_at<($5::jsonb->>question_id)::timestamptz,false) AS "requiresReview" FROM acsl_drafts
    WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4`,
    [paper.school_id, paper.id, paper.version_id, accountId, JSON.stringify(paper.written_question_revisions)])).rows;
}

async function lockPaperAnswers(db, paper, accountId) {
  const key = `acsl-paper:${paper.school_id}:${paper.id}:${paper.version_id}:${accountId}`;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
}

async function programmingVersions(db, paper) {
  if (!paper.programmingVersionLineage) {
    const { rows } = await db.query(`WITH RECURSIVE lineage(id) AS (
      SELECT $3::uuid
      UNION
      SELECT revision.before_programming_version_id FROM acsl_programming_revisions revision
      JOIN lineage ON lineage.id=revision.after_programming_version_id
      WHERE revision.school_id=$1 AND revision.paper_id=$2 AND revision.problem_id=$4
    ) SELECT id FROM lineage`, [paper.school_id, paper.id, paper.programming_version_id, paper.programming_problem_id]);
    paper.programmingVersionLineage = rows.map(row => row.id);
  }
  return paper.programmingVersionLineage;
}

async function codingProgress(db, paper, accountId) {
  if (!paper.programming_problem_id) return { attempts: 0, solved: false };
  return (await db.query(`SELECT count(*)::integer attempts, coalesce(bool_or(state='completed' AND result->>'status'='AC'),false) solved,
    (SELECT award.points FROM acsl_point_awards award
      JOIN accounts actor ON actor.identity_id=award.identity_id AND actor.id=$4
      JOIN identities person ON person.id=actor.identity_id AND person.kind='student' AND person.archived_at IS NULL
      JOIN legacy_school_account_ownership membership ON membership.account_id=actor.id AND membership.school_id=award.school_id
      JOIN legacy_school_identity_ownership ownership ON ownership.identity_id=person.id AND ownership.school_id=award.school_id
      WHERE award.school_id=$1 AND award.paper_id=$5 AND award.version_id=$6 AND award.section='programming'
        AND actor.disabled_at IS NULL AND actor.binding_released_at IS NULL
        AND EXISTS(SELECT 1 FROM account_roles role WHERE role.account_id=actor.id AND role.role='student')) AS "pointsAwarded"
    FROM school_judge_jobs WHERE school_id=$1 AND problem_id=$2 AND version_id=ANY($3::uuid[]) AND account_id=$4 AND access_context='acsl' AND kind='submit'`,
    [paper.school_id, paper.programming_problem_id, await programmingVersions(db, paper), accountId, paper.id, paper.version_id])).rows[0];
}

async function progress(db, paper, accountId) {
  const grade = await loadGrade(db, paper, accountId);
  const drafts = await loadDrafts(db, paper, accountId);
  const coding = await codingProgress(db, paper, accountId);
  return { grade, drafts, coding };
}

function summary(paper, state) {
  const { title, division, season, round, roundLabel } = paper.definition;
  const answeredCount = state.grade ? state.grade.questionCount : paper.definition.questions.filter(question =>
    state.drafts.some(draft => draft.questionId === question.id && draft.selectedOptionIds.length > 0)).length;
  return { id: paper.id, versionId: paper.version_id, slug: paper.slug, title, division, season, round,
    ...(roundLabel ? { roundLabel } : {}), hasProgramming: paper.programming_problem_id !== null,
    questionCount: paper.definition.questions.length, answeredCount,
    graded: state.grade !== null, gradeId: state.grade?.id ?? null, gradedAt: state.grade?.createdAt ?? null,
    score: state.grade?.correctCount ?? null, maxScore: paper.definition.questions.length,
    ...(state.grade?.pointsAwarded > 0 ? { writtenPointsAwarded: state.grade.pointsAwarded } : {}),
    ...(state.coding.pointsAwarded > 0 ? { programmingPointsAwarded: state.coding.pointsAwarded } : {}),
    correctCount: state.grade?.correctCount ?? null, programmingSolved: state.coding.solved };
}

function assetUrls(paper, references) {
  if (!references) return undefined;
  return Object.fromEntries(['en', 'zh'].map(language => [language, references[language].map(id =>
    `/api/v1/schools/${paper.school_id}/acsl/${paper.id}/assets/${id}?versionId=${paper.version_id}`)]));
}

async function paperDetail(db, paper, user) {
  const state = await progress(db, paper, user.id);
  const questions = (state.grade?.questionSnapshot ?? paper.definition.questions).map(question => {
    const answer = state.grade?.answers.find(answer => answer.questionId === question.id);
    const current = state.drafts.find(draft => draft.questionId === question.id);
    return { id: question.id, number: question.number, type: question.type, topic: question.topic, statement: question.statement,
      ...(question.statementAssets ? { statementAssets: assetUrls(paper, question.statementAssets) } : {}),
      ...(question.statementDiagrams ? { statementDiagrams: question.statementDiagrams } : {}),
      options: question.options.map(option => ({ id: option.id, text: option.text, ...(option.diagrams ? { diagrams: option.diagrams } : {}) })),
      requiresReview: !state.grade && (current?.requiresReview ?? false),
      draft: answer ? { selectedOptionIds: answer.selectedOptionIds, revision: answer.draftRevision }
        : { selectedOptionIds: current?.selectedOptionIds ?? [], revision: current?.revision ?? 0 },
      lastSubmission: answer ? { id: state.grade.id, selectedOptionIds: answer.selectedOptionIds, correct: answer.correct,
        createdAt: state.grade.createdAt, draftRevision: answer.draftRevision } : null };
  });
  const pointRules = user.roles.includes('student') && paper.written_points_per_correct !== null
    ? { writtenPerCorrect: paper.written_points_per_correct, programming: paper.programming_points } : undefined;
  return { ...summary(paper, state), questions, pointRules, learningLinks: await acslLearningLinks(db,paper.school_id,paper,user),
    writtenRevision: paper.written_revision ?? paper.version_id,
    writtenRevisionAt: paper.written_revision_at,
    changedQuestionIds: paper.written_changed_question_ids,
    historicalWrittenVersion: Boolean(state.grade?.writtenRevision && state.grade.writtenRevision !== (paper.written_revision ?? paper.version_id)),
    programming: paper.programming_problem_id ? { id: paper.programming_problem_id,
    title: paper.definition.programming.definition.title, solved: state.coding.solved } : null };
}

async function submitPaper(db, paper, user, body) {
  checkVersion(paper, body.versionId);
  await lockPaperAnswers(db, paper, user.id);
  if (await loadGrade(db, paper, user.id)) return reply(await paperDetail(db, paper, user));
  checkWrittenRevision(paper, body.writtenRevision);
  const revisions = body.revisions;
  const questions = paper.definition.questions;
  if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions) ||
      Object.keys(revisions).length !== questions.length || questions.some(question => !Object.hasOwn(revisions, question.id))) {
    fail(400, 'INVALID_REVISIONS', 'Include the saved revision of every written question.');
  }
  const drafts = await loadDrafts(db, paper, user.id);
  const answers = questions.map(question => {
    const expectedRevision = integer(revisions[question.id], 0, 2147483645, 'Draft revision');
    const current = drafts.find(draft => draft.questionId === question.id);
    if ((current?.revision ?? 0) !== expectedRevision) fail(409, 'REVISION_CONFLICT', 'Your answers changed on another page. Reload before turning in.');
    if (current?.requiresReview) fail(409, 'ANSWER_REVIEW_REQUIRED', 'Review and save the revised questions before turning in.');
    if (!current?.selectedOptionIds.length) fail(400, 'INCOMPLETE_PAPER', 'Answer every written question before turning in.');
    const selectedOptionIds = selectedOptions(question, current.selectedOptionIds);
    return { questionId: question.id, selectedOptionIds, draftRevision: current.revision, correct: gradeAnswer(question, selectedOptionIds) };
  });
  await db.query(`INSERT INTO acsl_paper_grades(school_id,paper_id,version_id,account_id,answers,correct_count,question_count)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [paper.school_id, paper.id, paper.version_id, user.id, JSON.stringify(answers), answers.filter(answer => answer.correct).length, answers.length]);
  return reply(await paperDetail(db, paper, user));
}

async function draft(db, paper, accountId, questionId) {
  const key = [paper.school_id, paper.id, paper.version_id, accountId, questionId];
  await db.query(`INSERT INTO acsl_drafts(school_id,paper_id,version_id,account_id,question_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, key);
  return (await db.query(`SELECT selected_option_ids AS "selectedOptionIds",revision FROM acsl_drafts
    WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4 AND question_id=$5 FOR UPDATE`, key)).rows[0];
}

async function saveDraft(db, paper, accountId, questionId, selected, revision) {
  return (await db.query(`UPDATE acsl_drafts SET selected_option_ids=$6, revision=revision+1,updated_at=clock_timestamp()
    WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND account_id=$4 AND question_id=$5 AND revision=$7
    RETURNING selected_option_ids AS "selectedOptionIds",revision`,
  [paper.school_id, paper.id, paper.version_id, accountId, questionId, JSON.stringify(selected), revision])).rows[0];
}

async function questionOperation(db, paper, user, questionId, action, method, body, url) {
  const question = paper.definition.questions.find(item => item.id === questionId);
  if (!question) fail(404, 'NOT_FOUND', 'Question is unavailable.');
  checkVersion(paper, method === 'GET' ? url.searchParams.get('versionId') : body.versionId);
  if (action === 'explanation' && method === 'GET') {
    const grade = await loadGrade(db, paper, user.id);
    if (!grade) fail(403, 'PAPER_NOT_GRADED', 'Turn in the written section before viewing explanations.');
    const gradedQuestion = grade.questionSnapshot?.find(item => item.id === questionId) ?? question;
    return reply({ correctOptionIds: gradedQuestion.correctOptionIds, explanation: gradedQuestion.explanation,
      ...(gradedQuestion.explanationDiagrams ? { explanationDiagrams: gradedQuestion.explanationDiagrams } : {}),
      ...(gradedQuestion.explanationAssets ? { explanationAssets: assetUrls(paper, gradedQuestion.explanationAssets) } : {}) });
  }
  if (action === 'submissions' && method === 'POST') {
    fail(409, 'WHOLE_PAPER_REQUIRED', 'Turn in the entire written section to receive results.');
  }
  if (action !== 'draft' || method !== 'PATCH') return null;
  await lockPaperAnswers(db, paper, user.id);
  if (await loadGrade(db, paper, user.id)) fail(409, 'PAPER_GRADED', 'This written section has already been turned in.');
  checkWrittenRevision(paper, body.writtenRevision);
  const selected = selectedOptions(question, body.selectedOptionIds, { allowEmpty: true });
  const expectedRevision = integer(body.expectedRevision, 0, 2147483645, 'Draft revision');
  const current = await draft(db, paper, user.id, questionId);
  if (current.revision !== expectedRevision) fail(409, 'REVISION_CONFLICT', 'Your answer changed on another page. Reload before saving.');
  return reply({ ...await saveDraft(db, paper, user.id, questionId, selected, expectedRevision), requiresReview: false });
}

function jobResult(job) {
  const result = job.result;
  const measures = Array.isArray(result?.privateResults) ? result.privateResults : [];
  const runtimeMs = measures.length && measures.every(item => Number.isFinite(item.cpuMs)) ? measures.reduce((total,item) => total + item.cpuMs, 0) : null;
  const memoryKb = measures.length && measures.every(item => Number.isFinite(item.memoryBytes)) ? Math.ceil(Math.max(...measures.map(item => item.memoryBytes)) / 1024) : null;
  return { id: job.id, problemId: job.problem_id, versionId: job.version_id, problemTitle: job.payload.version.title,
    code: job.payload.code, language: job.payload.language, kind: job.kind, state: job.state, createdAt: job.created_at,
    status: result?.status ?? (job.state === 'failed' ? 'System Error' : job.state === 'leased' ? 'Judging' : 'Waiting'),
    runtimeMs, memoryKb, score: result?.score ?? null, passed: result?.passed ?? 0, total: result?.total ?? 0, resultsVisible: true,
    message: result?.publicMessage ?? '',
    caseFeedback: submissionCaseFeedback({ kind: job.kind, status: result?.status, context_resolved: false,
      custom_input: job.kind === 'custom' ? job.payload.tests[0]?.input : undefined }, job.payload.version, result?.privateResults) };
}

function programmingStatement(paper, language) {
  const programming = paper.definition.programming;
  const native = language === 'zh' ? programming.statementZh : programming.definition.statement;
  const images = assetUrls(paper, programming.statementAssets)?.[language] ?? [];
  return { statement: [native, ...images.map((src, index) =>
    `![ACSL ${language === 'zh' ? '原题' : 'original statement'} ${index + 1}](${src})`)].join('\n\n'),
    ...(programming.statementDiagrams ? { statementDiagrams: programming.statementDiagrams[language] } : {}) };
}

async function programmingOperation(db, paper, user, tail, method, body, url) {
  if (!paper.programming_problem_id) fail(404, 'NOT_FOUND', 'This ACSL paper has no programming section.');
  const translation = tail?.match(/^translation\/(quote|unlock|provide)$/);
  if (translation && method === 'POST') return reply(await acslTranslation(db, paper, user, translation[1], body, () => {
    const { statement, statementDiagrams } = programmingStatement(paper, 'zh');
    return { body: statement, statementDiagrams };
  }));
  if (!tail && method === 'GET' && url.searchParams.get('view') === 'solution') {
    const coding = await codingProgress(db, paper, user.id);
    const provided = await acslSolution(db, paper, user, 'provide', { contentLanguage: url.searchParams.get('language') }, coding.solved);
    return reply(provided.solution);
  }
  const solution = tail?.match(/^solution\/(quote|unlock|provide)$/);
  if (solution && method === 'POST') {
    const coding = await codingProgress(db, paper, user.id);
    return reply(await acslSolution(db, paper, user, solution[1], body, coding.solved));
  }
  const version = (await db.query('SELECT definition FROM school_problem_versions WHERE school_id=$1 AND id=$2', [paper.school_id, paper.programming_version_id])).rows[0].definition;
  if (!tail && method === 'GET') {
    const coding = await codingProgress(db, paper, user.id);
    const programming = paper.definition.programming;
    const tutorialLanguage = url.searchParams.get('language') === 'zh' ? 'zh' : 'en';
    return reply({ id: paper.programming_problem_id, versionId: paper.programming_version_id, paperVersionId: paper.version_id,
      title: programming.definition.title, ...programmingStatement(paper, 'en'),
      ...(programming.tutorial?.[tutorialLanguage] ? { tutorial: { source: 'custom', body: programming.tutorial[tutorialLanguage] } } : {}),
      mode: version.mode, functionName: version.function_name, comparator: version.comparator,
      timeLimitMs: version.time_limit_ms, memoryLimitMb: version.memory_limit_mb, supportedLanguages: LANGUAGES,
      languageLimits: languageLimitsFor(version), starterCode: version.starter_code, starterCodes: starterCodesFor(version),
      samples: version.samples.map(({ input, expected }) => ({ input, expected })), tags: ['ACSL', paper.definition.division],
      solved: coding.solved, referenceAvailable: Boolean(programming.solution), attempts: coding.attempts, published: true });
  }
  if (tail === 'submissions' && method === 'GET') {
    const formalJobs = `FROM school_judge_jobs WHERE school_id=$1 AND problem_id=$2 AND version_id=ANY($3::uuid[])
      AND account_id=$4 AND access_context='acsl' AND kind='submit'`;
    const scope = [paper.school_id, paper.programming_problem_id, await programmingVersions(db, paper), user.id];
    if (url.searchParams.get('view') === 'resume') {
      const versionId = url.searchParams.get('versionId');
      if (versionId && uuid(versionId) !== paper.programming_version_id) fail(409, 'VERSION_CONFLICT', 'Programming version changed.');
      const { rows } = await db.query(`SELECT payload->>'code' code,COALESCE(payload->>'language','python') language
        ${formalJobs} ORDER BY created_at DESC,id DESC LIMIT 1`, scope);
      return reply({ submission: rows[0] ?? null });
    }
    const coding = await codingProgress(db, paper, user.id);
    const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, 'Page');
    const pageSize = integer(Number(url.searchParams.get('pageSize') ?? 20), 1, 100, 'Page size');
    const order = enumValue(url.searchParams.get('order') ?? 'desc', ['asc','desc'], 'Order');
    const sort = enumValue(url.searchParams.get('sort') ?? 'createdAt', ['createdAt','language','status','runtimeMs','memoryKb'], 'Sort');
    const columns = { createdAt: 'created_at', language: "payload->>'language'", status: "result->>'status'",
      runtimeMs: "(SELECT sum((r->>'cpuMs')::numeric) FROM jsonb_array_elements(result->'privateResults') r)",
      memoryKb: "(SELECT max((r->>'memoryBytes')::numeric) FROM jsonb_array_elements(result->'privateResults') r)" };
    const jobs = (await db.query(`SELECT * ${formalJobs}
      ORDER BY ${columns[sort]} ${order} NULLS LAST,id DESC LIMIT $5 OFFSET $6`,
      [...scope, pageSize, (page-1)*pageSize])).rows;
    const items = jobs.map(job => {
      const result = jobResult(job);
      return { id: result.id, displayName: user.name ?? user.username ?? 'Student', createdAt: result.createdAt,
        language: result.language, status: result.status, runtimeMs: result.runtimeMs, memoryKb: result.memoryKb, isOwn: true };
    });
    return reply({ items, solved: coding.solved, page, pageSize, total: coding.attempts, attempts: coding.attempts, hasMore: page*pageSize < coding.attempts });
  }
  if (tail?.startsWith('submissions/') && method === 'GET') {
    const job = (await db.query(`SELECT * FROM school_judge_jobs WHERE school_id=$1 AND problem_id=$2 AND version_id=ANY($3::uuid[]) AND account_id=$4 AND access_context='acsl' AND id=$5`,
      [paper.school_id, paper.programming_problem_id, await programmingVersions(db, paper), user.id, uuid(tail.split('/')[1])])).rows[0];
    if (!job) fail(404, 'NOT_FOUND', 'Submission is unavailable.');
    const result = jobResult(job);
    if (job.kind === 'submit' && job.state === 'completed' && result.status === 'AC') {
      const award = (await db.query('SELECT points FROM acsl_point_awards WHERE school_id=$1 AND job_id=$2',
        [paper.school_id, job.id])).rows[0];
      if (award) result.practicePointsAwarded = award.points;
    }
    return reply(result);
  }
  if (tail !== 'submissions' || method !== 'POST') return null;
  if (uuid(body.versionId) !== paper.programming_version_id) fail(409, 'VERSION_CONFLICT', 'Programming version changed.');
  const kind = enumValue(body.kind, ['samples', 'custom', 'submit'], 'Submission kind');
  const language = enumValue(body.language ?? 'python', LANGUAGES, 'Language');
  const code = bytes(body.code, 'Code');
  const input = kind === 'custom' ? bytes(body.input ?? '', 'Input', 262144) : null;
  const requestId = uuid(body.requestId);
  const requestHash = canonicalHash({ paperId: paper.id, versionId: paper.programming_version_id, kind, language, code, input, accessContext: 'acsl' });
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('school-submit:'||$1,0))", [user.id]);
  const old = (await db.query('SELECT id,state,request_hash FROM school_judge_jobs WHERE account_id=$1 AND request_id=$2', [user.id, requestId])).rows[0];
  if (old) {
    if (old.request_hash !== requestHash) fail(409, 'REQUEST_CONFLICT', 'Request ID was used for another submission.');
    return reply({ id: old.id, state: old.state }, 202);
  }
  const counts = (await db.query(`SELECT count(*) FILTER(WHERE state IN ('queued','leased'))::integer pending,count(*) FILTER(WHERE created_at>now()-interval '5 minutes')::integer recent FROM school_judge_jobs WHERE account_id=$1`, [user.id])).rows[0];
  if (counts.pending >= 5 || counts.recent >= 60) fail(429, 'RATE_LIMIT', 'Too many judge requests. Please wait.');
  const tests = kind === 'custom' ? [{ position: 1, input }] : kind === 'samples' ? version.samples : version.tests;
  const payload = { kind, language, code, tests, version: { ...version, reference_code: undefined, tests: undefined } };
  validateTask(payload);
  const job = (await db.query(`INSERT INTO school_judge_jobs(school_id,problem_id,version_id,account_id,request_id,request_hash,kind,access_context,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,'acsl',$8) RETURNING id,state`,
    [paper.school_id, paper.programming_problem_id, paper.programming_version_id, user.id, requestId, requestHash, kind, JSON.stringify(payload)])).rows[0];
  return reply(job, 202);
}

export async function handleAcsl({ pool, user, route, method, body = {}, url }) {
  const match = route.match(/^\/schools\/([^/]+)\/acsl(?:\/([^/]+))?(?:\/(.*))?$/);
  if (!match) return null;
  const schoolId = uuid(match[1]);
  if (match[2] === 'manage') return handleAcslManagement({ pool, user, schoolId, tail: match[3], method, body, url });
  if (match[2] === 'links' && !match[3] && method === 'GET') return reply(await courseAcslPicker(pool,schoolId,user));
  return transaction(pool, async db => {
    await access(db, schoolId, user);
    if (!match[2] && method === 'GET') {
      if (url.searchParams.get('view') === 'availability') {
        const { rows } = await db.query('SELECT EXISTS(SELECT 1 FROM acsl_papers WHERE school_id=$1 AND enabled) enabled', [schoolId]);
        return reply(rows[0]);
      }
      const items = await acslCatalog(db, schoolId, user.id);
      return reply({ enabled: items.length > 0, items, learningCourses:await acslLearningCourses(db,schoolId,user,items) });
    }
    const paper = await loadPaper(db, schoolId, match[2]);
    if (!match[3] && method === 'GET') {
      if(url.searchParams.has('paperVersionId'))checkVersion(paper,url.searchParams.get('paperVersionId'));
      return reply(await paperDetail(db, paper, user));
    }
    const assetMatch = match[3]?.match(/^assets\/([A-Za-z0-9-]{1,100})$/);
    if (assetMatch && method === 'GET') {
      checkVersion(paper, url.searchParams.get('versionId'));
      const currentPurpose = paperAssetPurposes(paper.definition).get(assetMatch[1]);
      if (!currentPurpose) fail(404, 'NOT_FOUND', 'ACSL source image is unavailable.');
      const asset = (await db.query(`SELECT purpose,content FROM acsl_assets
        WHERE school_id=$1 AND paper_id=$2 AND version_id=$3 AND asset_id=$4`,
        [schoolId, paper.id, paper.version_id, assetMatch[1]])).rows[0];
      if (!asset || asset.purpose !== currentPurpose) fail(404, 'NOT_FOUND', 'ACSL source image is unavailable.');
      if (asset.purpose === 'explanation' && !(await loadGrade(db, paper, user.id))) {
        fail(403, 'PAPER_NOT_GRADED', 'Turn in the written section before viewing explanations.');
      }
      const translated = paper.definition.programming?.statementAssets;
      if (translated?.zh.includes(assetMatch[1]) && !translated.en.includes(assetMatch[1]) &&
          !paper.definition.questions.some(q => q.statementAssets?.en.includes(assetMatch[1]) || q.statementAssets?.zh.includes(assetMatch[1]))) {
        await requireAcslTranslation(db, paper, user);
      }
      return reply({ content: asset.content });
    }
    if (match[3] === 'submit' && method === 'POST') return submitPaper(db, paper, user, body);
    const question = match[3]?.match(/^questions\/([^/]+)\/(draft|submissions|explanation)$/);
    if (question) return questionOperation(db, paper, user, question[1], question[2], method, body, url);
    const programming = match[3]?.match(/^programming(?:\/(submissions(?:\/[^/]+)?|(?:translation|solution)\/(?:quote|unlock|provide)))?$/);
    if (programming) {
      const paperVersionId = method === 'GET' ? url.searchParams.get('paperVersionId') : body.paperVersionId;
      if (paperVersionId) checkVersion(paper, paperVersionId);
      return programmingOperation(db, paper, user, programming[1], method, body, url);
    }
    return null;
  });
}

// Read-only course projections share the existing account and formal-AC rules.
export { access as requireAcslCourseAccess, loadGrade as acslCourseGrade, codingProgress as acslCourseCodingProgress };

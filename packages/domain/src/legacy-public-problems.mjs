import { validateTask } from '../judge.mjs';
import { transaction } from './db.mjs';
import { publicProblemMetadata, studentPublicStatementRows } from './problem-public-statements.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { fail, uuid } from './security.mjs';
import { liveProblemVersionIdSql } from './live-problem-version.mjs';

const snapshotBankId = '00000000-0000-4000-8000-000000000074';
const scope = db => db.query("SELECT set_config('campus.school_id',$1,true)", [LEGACY_SCHOOL_ID]);
const sourceColumns = `p.id AS problem_id,p.bank_id,p.owner_account_id,b.name AS bank_name,
 v.id,v.title,v.statement,v.metadata,v.tags,v.mode,v.function_name,v.comparator,v.starter_code,
 v.starter_codes,v.time_limit_ms,v.memory_limit_mb,v.samples`;
const sourceTables = `problems p
 JOIN problem_banks b ON b.id=p.bank_id
 JOIN problem_versions v ON v.id=${liveProblemVersionIdSql('p')} AND v.problem_id=p.id`;
// A problem reused by a timed practice remains outside public practice, even
// if the author creates another edition with the same exercise.
const sourceAccess = `p.archived_at IS NULL AND b.archived_at IS NULL AND b.visibility='school'
 AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL
 AND v.rank_review_status='approved' AND v.validation_status='AC'
 AND NOT EXISTS(SELECT 1 FROM timed_practice_problems t WHERE t.problem_id=p.id)
 AND (EXISTS(SELECT 1 FROM problem_public_statements current WHERE current.version_id=v.id)
   OR NOT EXISTS(SELECT 1 FROM problem_public_statements configured
     JOIN problem_versions original ON original.id=configured.version_id WHERE original.problem_id=p.id))`;

async function findSource(db, problemId, versionId, { lock = false } = {}) {
 const { rows } = await db.query(`SELECT ${sourceColumns} FROM ${sourceTables}
  WHERE p.id=$1 AND ($2::uuid IS NULL OR v.id=$2) AND ${sourceAccess}${lock ? ' FOR SHARE OF p,b,v' : ''}`,
 [problemId, versionId ?? null]);
 const [source] = await studentPublicStatementRows(db, rows);
 return source && !source.public_statement_pending ? source : null;
}

function learnerStatement(source) {
 const { inputDescription, outputDescription } = publicProblemMetadata(source.metadata);
 const chinese = source.statement_language !== 'en' && /\p{Script=Han}/u.test(source.statement);
 const sections = [
  [chinese ? '输入' : 'Input', inputDescription],
  [chinese ? '输出' : 'Output', outputDescription],
 ];
 return [source.statement, ...sections.filter(([, content]) => content?.trim())
  .map(([title, content]) => `### ${title}\n\n${content}`)].join('\n\n');
}

function visibleSamples(source) {
 return (source.samples ?? []).filter(sample => sample.enabled !== false)
  .map(({ input, expected }) => ({ input, expected }));
}

function visibleProblem(source, state, schoolName) {
 return {
  id: source.problem_id, schoolId: LEGACY_SCHOOL_ID, bankId: source.bank_id,
  bankName: source.bank_name, schoolName, title: source.title, versionId: source.id,
  ...state,
 };
}

async function statusFor(db, problemId, versionId) {
 const { rows: [state] } = await db.query(`
  SELECT EXISTS(SELECT 1 FROM school_problem_publications WHERE school_id=$1 AND problem_id=$2
    AND withdrawn_at IS NULL) AS "platformPublished",
  (SELECT status FROM legacy_public_problem_requests WHERE problem_id=$2 AND version_id=$3) AS "publicRequestStatus"
 `, [LEGACY_SCHOOL_ID, problemId, versionId]);
 return state;
}

/** Called only after the public listing and its school scope have been checked. */
export async function legacyPublicProblemPresentation(db, problemId, versionId) {
 const source = await findSource(db, problemId, versionId, { lock: true });
 return source && {
  statement: learnerStatement(source), metadata: publicProblemMetadata(source.metadata),
  tags: Array.isArray(source.tags) ? source.tags.filter(tag => typeof tag === 'string') : [],
 };
}

/** Reuse the original school’s publication checks without fetching problem bodies. */
export async function availableLegacyPublicProblemVersions(db, versionIds) {
 const { rows } = await db.query(`SELECT v.id FROM ${sourceTables}
  WHERE v.id=ANY($1::uuid[]) AND ${sourceAccess}`, [versionIds]);
 return new Set(rows.map(row => row.id));
}

// An active publication grants public access to the stable problem. Its saved
// version remains an approval/audit snapshot; learning uses the same current
// source version as the school catalogue.
export async function currentLegacyPublicProblems(db, problemIds) {
 return (await db.query(`SELECT p.id AS problem_id,v.id,v.title FROM ${sourceTables}
  JOIN school_problem_publications publication ON publication.school_id=$1 AND publication.problem_id=p.id
   AND publication.withdrawn_at IS NULL
  WHERE p.id=ANY($2::uuid[]) AND ${sourceAccess}`,[LEGACY_SCHOOL_ID,problemIds])).rows;
}

// Listing a current publication does not need a judge snapshot. Preserve the
// existing snapshot metadata when present, including the revision a later
// detail request would assign, while keeping prose and private cases in the DB.
// The caller holds the school's shared teaching lock and its RLS scope.
export async function legacyPublicProblemCatalogRows(db,problemIds) {
 return (await db.query(`SELECT p.id,$1::uuid AS "schoolId",
  COALESCE(projected.bank_id,$3::uuid) AS "bankId",b.name AS "bankName",
  COALESCE(snapshot.definition->>'title',v.title) title,COALESCE(projected.revision,1) revision,
  true published,v.id AS "versionId",v.tags,v.mode,
  CASE WHEN jsonb_typeof(COALESCE(presentation.metadata,v.metadata)->'difficulty')='string'
   THEN COALESCE(presentation.metadata,v.metadata)->>'difficulty' END difficulty,
  COALESCE(snapshot.draft_revision,(SELECT COALESCE(max(history.draft_revision),0)+1
   FROM school_problem_versions history WHERE history.school_id=$1 AND history.problem_id=p.id))
   <>COALESCE(projected.revision,1) AS "hasDraftChanges"
  FROM ${sourceTables}
  JOIN school_problem_publications publication ON publication.school_id=$1 AND publication.problem_id=p.id
   AND publication.withdrawn_at IS NULL
  LEFT JOIN school_problems projected ON projected.school_id=$1 AND projected.id=p.id
  LEFT JOIN school_problem_versions snapshot ON snapshot.school_id=$1 AND snapshot.problem_id=p.id AND snapshot.id=v.id
  LEFT JOIN problem_public_statements presentation ON presentation.version_id=v.id
  WHERE p.id=ANY($2::uuid[]) AND ${sourceAccess}
  FOR SHARE OF p,b,v`,[LEGACY_SCHOOL_ID,problemIds,snapshotBankId])).rows;
}

export async function prepareLegacyPublicProblem(db, problemId) {
 const source=await findSource(db,problemId,null,{lock:true});
 if(!source)return null;
 const publication=await db.query(`SELECT 1 FROM school_problem_publications
  WHERE school_id=$1 AND problem_id=$2 AND withdrawn_at IS NULL`,[LEGACY_SCHOOL_ID,problemId]);
 if(!publication.rowCount)return null;
 return snapshotProblem(db,source);
}

export async function listLegacyPublicProblemReviews(db) {
 await scope(db);
 const { rows } = await db.query(`
  SELECT p.id AS problem_id,p.bank_id,b.name AS bank_name,v.id,v.title,CASE WHEN p.owner_scope='platform' THEN 'CodeMaster' ELSE s.name END AS school_name,
   EXISTS(SELECT 1 FROM school_problem_publications publication WHERE publication.school_id=s.id
    AND publication.problem_id=p.id AND publication.withdrawn_at IS NULL) AS "platformPublished",
   request.status AS "publicRequestStatus"
  FROM ${sourceTables}
  LEFT JOIN legacy_public_problem_requests request ON request.problem_id=p.id AND request.version_id=v.id
  JOIN schools s ON s.id=$1
  WHERE ${sourceAccess}
  ORDER BY (request.status='pending') DESC NULLS LAST,request.requested_at DESC NULLS LAST,v.title,p.id LIMIT 500`, [LEGACY_SCHOOL_ID]);
 return rows.map(source => visibleProblem(source, {
   platformPublished: source.platformPublished,
   publicRequestStatus: source.publicRequestStatus,
  }, source.school_name));
}

export async function previewLegacyPublicProblem(db, problemId) {
 const source = await findSource(db, problemId);
 if (!source) fail(404, 'NOT_FOUND', 'Problem is unavailable.');
 const state = await statusFor(db, problemId, source.id);
 return {
  ...visibleProblem(source, state),
  definition: {
   title: source.title, statement: learnerStatement(source), mode: source.mode,
   ...publicProblemMetadata(source.metadata),
   tags: Array.isArray(source.tags) ? source.tags.filter(tag => typeof tag === 'string') : [],
   functionName: source.function_name, comparator: source.comparator,
   timeLimitMs: source.time_limit_ms, memoryLimitMb: source.memory_limit_mb,
   starterCode: source.starter_code, samples: visibleSamples(source),
  },
 };
}

async function writeSnapshot(db, source, { activate = true } = {}) {
 const { rows } = await db.query(`SELECT position,input,expected,weight FROM test_cases
  WHERE version_id=$1 AND enabled ORDER BY position`, [source.id]);
 const definition = {
  title: source.title, statement: learnerStatement(source), mode: source.mode,
  metadata: publicProblemMetadata(source.metadata),
  tags: Array.isArray(source.tags) ? source.tags.filter(tag => typeof tag === 'string') : [],
  function_name: source.function_name, comparator: source.comparator, starter_code: source.starter_code,
  starter_codes: source.starter_codes, time_limit_ms: source.time_limit_ms, memory_limit_mb: source.memory_limit_mb,
  samples: visibleSamples(source).map((sample, index) => ({ ...sample, position: index + 1, enabled: true })),
  tests: rows.map(test => ({ ...test, weight: Number(test.weight) })),
 };
 try {
  validateTask({ kind: 'submit', version: definition, language: 'python', code: '', tests: definition.tests });
  if (definition.samples.length) {
   validateTask({ kind: 'samples', version: definition, language: 'python', code: '', tests: definition.samples });
  }
 } catch {
  fail(409, 'INCOMPATIBLE_JUDGE_CASES', 'This version cannot be used by the public judge.');
 }
 await db.query(`INSERT INTO school_problem_banks(school_id,id,owner_account_id,name,request_id)
  VALUES($1,$2,$3,'Public practice',$2) ON CONFLICT(school_id,id) DO NOTHING`,
 [LEGACY_SCHOOL_ID, snapshotBankId, source.owner_account_id]);
 await db.query(`INSERT INTO school_problems(school_id,id,bank_id,owner_account_id,draft,request_id)
  VALUES($1,$2,$3,$4,'{}',$2) ON CONFLICT(school_id,id) DO NOTHING`,
 [LEGACY_SCHOOL_ID, source.problem_id, snapshotBankId, source.owner_account_id]);
 await db.query(`INSERT INTO school_problem_versions(school_id,id,problem_id,draft_revision,definition)
  SELECT $1,$2,$3,COALESCE(max(draft_revision),0)+1,$4 FROM school_problem_versions WHERE school_id=$1 AND problem_id=$3
  ON CONFLICT(school_id,id) DO NOTHING`, [LEGACY_SCHOOL_ID, source.id, source.problem_id, JSON.stringify(definition)]);
 if(activate) await db.query(`UPDATE school_problems p SET published=true,published_version_id=v.id,
  revision=v.draft_revision,updated_at=clock_timestamp()
  FROM school_problem_versions v WHERE p.school_id=$1 AND p.id=$2
   AND v.school_id=p.school_id AND v.problem_id=p.id AND v.id=$3`, [LEGACY_SCHOOL_ID, source.problem_id, source.id]);
}

// The platform operation owns the exclusive school lock and RLS scope.
export async function decideLegacyPublicProblem(db, { problemId, versionId: expectedVersion, decision, actorId }) {
 let versionId;
 if (decision === 'withdraw') {
  const { rows: [publication] } = await db.query(`UPDATE school_problem_publications
   SET withdrawn_at=clock_timestamp() WHERE school_id=$1 AND problem_id=$2 AND withdrawn_at IS NULL
   AND ($3::uuid IS NULL OR version_id=$3 OR $3=(SELECT ${liveProblemVersionIdSql('p')} FROM problems p WHERE p.id=$2)) RETURNING version_id`,
  [LEGACY_SCHOOL_ID, problemId, expectedVersion ? uuid(expectedVersion) : null]);
  if (!publication) fail(409, 'REVISION_CONFLICT', 'Refresh the current platform listing.');
  versionId = publication.version_id;
 } else {
  versionId = uuid(expectedVersion);
  const source = await findSource(db, problemId, versionId, { lock: true });
  if (!source) fail(409, 'REVISION_CONFLICT', 'The requested version is no longer eligible for public practice.');
  const state = await statusFor(db, problemId, versionId);
  if (decision === 'approve' && state.platformPublished) return;
  const request = await db.query(`UPDATE legacy_public_problem_requests
   SET status=$3,decided_by=$4,decided_at=clock_timestamp()
   WHERE problem_id=$1 AND version_id=$2 AND ($3='approved' OR status='pending')`,
  [problemId, versionId, decision === 'approve' ? 'approved' : 'rejected', actorId]);
  if (decision === 'reject' && !request.rowCount) fail(409, 'NO_PENDING_REQUEST', 'No request is pending for this version.');
  if (decision === 'approve') {
   await writeSnapshot(db, source);
   const publication = await db.query(`INSERT INTO school_problem_publications(school_id,problem_id,version_id,approved_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(problem_id) DO UPDATE SET version_id=EXCLUDED.version_id,
    approved_by=EXCLUDED.approved_by,approved_at=clock_timestamp(),withdrawn_at=NULL
    WHERE school_problem_publications.school_id=EXCLUDED.school_id`, [LEGACY_SCHOOL_ID, problemId, versionId, actorId]);
   if (!publication.rowCount) fail(409, 'PROBLEM_ID_CONFLICT', 'A different school already published this problem identifier.');
  }
 }
 await db.query(`INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail)
  VALUES($1,$2,$3,$4)`, [actorId, 'problem.' + decision, LEGACY_SCHOOL_ID, JSON.stringify({ problemId, versionId })]);
}

export async function handleLegacyPublicProblemRequest({ pool, user, route, method, body, url }) {
 const match = route.match(/^\/admin\/problems\/([^/]+)\/publication-request$/);
 if (!match || !['GET', 'POST'].includes(method)) return null;
 const problemId = uuid(match[1]);
 const versionId = uuid(method === 'POST' ? body.versionId : url.searchParams.get('versionId'));
 return transaction(pool, async db => {
  await activeAccount(db, user.id);
  const { rowCount: admin } = await db.query(`SELECT 1 FROM legacy_school_account_ownership o
   JOIN account_roles r ON r.account_id=o.account_id AND r.role='admin' WHERE o.account_id=$1`, [user.id]);
  if (!admin) fail(403, 'FORBIDDEN', 'School administrator required.');
  await lockSchoolTeaching(db, LEGACY_SCHOOL_ID, { shared: method === 'GET' });
  await scope(db);
  const source = await findSource(db, problemId, versionId, { lock: method === 'POST' });
  const state = await statusFor(db, problemId, versionId);
  if (method === 'GET') return { status: 200, body: { eligible: Boolean(source), ...state } };
  if (!source) fail(409, 'INELIGIBLE_FOR_PUBLIC_PRACTICE', 'Choose a current, school-approved version that is not used in timed practice.');
  if (state.platformPublished || state.publicRequestStatus === 'pending') {
   return { status: 200, body: { eligible: true, ...state } };
  }
  await db.query(`INSERT INTO legacy_public_problem_requests(problem_id,version_id,requested_by)
   VALUES($1,$2,$3) ON CONFLICT(version_id) DO UPDATE SET status='pending',
   requested_by=EXCLUDED.requested_by,requested_at=clock_timestamp(),decided_by=NULL,decided_at=NULL`,
  [problemId, versionId, user.id]);
  await auditSchool(db, LEGACY_SCHOOL_ID, user.id, 'problem.public_request', versionId);
  return { status: 200, body: { eligible: true, platformPublished: false, publicRequestStatus: 'pending' } };
 });
}

// Course links identify the problem; stored version references remain audit
// history. New practice always receives the current published source version.
export async function preparePlatformCourseProblem(db,problemId) {
 const {platformProblemReadySql}=await import('./platform-course-problems.mjs');
 const rows=(await db.query(`SELECT ${sourceColumns} FROM problems p
 JOIN problem_banks b ON b.id=p.bank_id JOIN problem_versions v ON v.id=${liveProblemVersionIdSql('p')}
 WHERE p.id=$1 AND ${platformProblemReadySql()} FOR SHARE OF p,b,v`,[problemId])).rows;
 const [source]=await studentPublicStatementRows(db,rows);
 if(!source||source.public_statement_pending)return null;
 return snapshotProblem(db,source);
}

async function snapshotProblem(db,source) {
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('course-problem-snapshot:'||$1,0))",[source.problem_id]);
 await writeSnapshot(db,source,{activate:false});
 const p=(await db.query('SELECT * FROM school_problems WHERE school_id=$1 AND id=$2',[LEGACY_SCHOOL_ID,source.problem_id])).rows[0];
 return {...p,published:true,published_version_id:source.id,archived:false,bank_name:source.bank_name,
 public_statement:learnerStatement(source),public_metadata:publicProblemMetadata(source.metadata),public_tags:source.tags};
}

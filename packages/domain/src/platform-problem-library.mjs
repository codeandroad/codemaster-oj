import { transaction } from './db.mjs';
import { activeAccount, LEGACY_SCHOOL_ID, lockSchoolTeaching } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { canonicalHash, enumValue, fail, field, integer, uuid } from './security.mjs';

const reply = (body, status = 200) => ({ status, body });
const bankShape = row => ({ id: row.id, name: row.name, description: row.description, revision: row.revision,
 archivedAt: row.archived_at, problemCount: Number(row.problem_count ?? 0), archivedProblemCount: Number(row.archived_count ?? 0), canManage: true });

export async function platformStorageBank(db, accountId) {
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('platform-source-bank',0))");
 let bank = (await db.query("SELECT id FROM problem_banks WHERE name='CodeMaster' AND description='Platform source problems' AND archived_at IS NULL ORDER BY created_at,id LIMIT 1")).rows[0];
 if (!bank) bank = (await db.query("INSERT INTO problem_banks(name,description,visibility,owner_account_id) VALUES('CodeMaster','Platform source problems','school',$1) RETURNING id", [accountId])).rows[0];
 return bank.id;
}

export async function platformCategory(db, rawId) {
 if (rawId === undefined || rawId === null || rawId === '') return null;
 const id = uuid(rawId, '分类 ID');
 if (!(await db.query('SELECT 1 FROM platform_problem_banks WHERE id=$1 AND archived_at IS NULL FOR SHARE', [id])).rowCount)
  fail(409, 'BANK_UNAVAILABLE', '分类不存在或已归档，请重新选择');
 return id;
}

export async function handlePlatformProblemLibrary({ pool, user, route, method, body = {}, url, helpers }) {
 const banks = route.match(/^\/platform\/problem-banks(?:\/([^/]+)(?:\/(archive|restore))?)?$/);
 const importing = route === '/platform/source-problems/import';
 const batch = route === '/platform/source-problems/batch';
 if (!banks && !importing && !batch) return null;
 return transaction(pool, async db => {
  await lockSchoolTeaching(db, LEGACY_SCHOOL_ID, { shared: method === 'GET' });
  await activeAccount(db, user.id);
  if (!await isPlatformAdministrator(db, user.id)) fail(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理员权限');
  await db.query("SELECT set_config('campus.school_id',$1,true)", [LEGACY_SCHOOL_ID]);
  const audit = (action, detail) => db.query('INSERT INTO platform_audit_events(actor_account_id,action,detail) VALUES($1,$2,$3)', [user.id, action, detail]);
  if (banks) {
   if (!banks[1] && method === 'GET') {
    const rows = (await db.query(`SELECT b.*,count(p.id) FILTER(WHERE p.archived_at IS NULL) problem_count,
     count(p.id) FILTER(WHERE p.archived_at IS NOT NULL) archived_count FROM platform_problem_banks b
     LEFT JOIN problems p ON p.platform_bank_id=b.id AND p.owner_scope='platform'
     WHERE ($1 OR b.archived_at IS NULL) GROUP BY b.id ORDER BY b.name,b.id`, [url.searchParams.get('includeArchived') === '1'])).rows;
    return reply({ items: rows.map(bankShape) });
   }
   if (!banks[1] && method === 'POST') {
    const name = field(body.name, '分类名称', { max: 120 }), description = field(body.description ?? '', '分类说明', { min: 0, max: 2000 });
    if ((await db.query('SELECT 1 FROM platform_problem_banks WHERE lower(name)=lower($1) AND archived_at IS NULL', [name])).rowCount)
     fail(409, 'BANK_NAME_EXISTS', '已有同名分类');
    const row = (await db.query('INSERT INTO platform_problem_banks(name,description,created_by) VALUES($1,$2,$3) RETURNING *', [name, description, user.id])).rows[0];
    await audit('platform.problem_bank.create', { bankId: row.id });
    return reply(bankShape(row), 201);
   }
   if (!banks[1]) return null;
   const id = uuid(banks[1]), row = (await db.query('SELECT * FROM platform_problem_banks WHERE id=$1 FOR UPDATE', [id])).rows[0];
   if (!row) fail(404, 'NOT_FOUND', '分类不存在');
   if (method !== 'PATCH' && !(method === 'POST' && banks[2])) return null;
   if (integer(body.revision, 1, 2147483647, '修订号') !== row.revision) fail(409, 'REVISION_CONFLICT', '分类已更改，请刷新后重试');
   const name = field(body.name ?? row.name, '分类名称', { max: 120 }), description = field(body.description ?? row.description, '分类说明', { min: 0, max: 2000 });
   const archived = banks[2] === 'archive' ? true : banks[2] === 'restore' ? false : !!row.archived_at;
   if (archived && (await db.query('SELECT 1 FROM problems WHERE platform_bank_id=$1 LIMIT 1', [id])).rowCount)
    fail(409, 'BANK_NOT_EMPTY', '请先将分类内的题目（包括已删除题目）移至其他分类');
   if (!archived && (await db.query('SELECT 1 FROM platform_problem_banks WHERE lower(name)=lower($1) AND id<>$2 AND archived_at IS NULL', [name, id])).rowCount)
    fail(409, 'BANK_NAME_EXISTS', '已有同名分类');
   const updated = (await db.query(`UPDATE platform_problem_banks SET name=$2,description=$3,revision=revision+1,
    updated_at=clock_timestamp(),archived_at=CASE WHEN $4 THEN COALESCE(archived_at,clock_timestamp()) ELSE NULL END WHERE id=$1 RETURNING *`, [id, name, description, archived])).rows[0];
   await audit(`platform.problem_bank.${banks[2] ?? 'update'}`, { bankId: id, previousRevision: row.revision });
   return reply(bankShape(updated));
  }
  if (method !== 'POST') return null;
  if (importing) {
   const key = field(body.idempotencyKey, '导入请求键', { min: 8, max: 120 });
   if (!Array.isArray(body.problems) || body.problems.length < 1 || body.problems.length > 100) fail(400, 'VALIDATION', '每批须包含 1–100 道题目');
   const hash = canonicalHash({ bankId: body.bankId ?? null, problems: body.problems });
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`platform-import:${user.id}:${key}`]);
   const previous = (await db.query('SELECT request_hash,result FROM platform_problem_imports WHERE account_id=$1 AND idempotency_key=$2', [user.id, key])).rows[0];
   if (previous) { if (previous.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '同一导入请求不能对应不同内容'); return reply(previous.result); }
   const categoryId = await platformCategory(db, body.bankId), bankId = await platformStorageBank(db, user.id);
   // Validate every row before creating anything; failed batches leave no partial imports.
   const inputs = body.problems.map(value => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'VALIDATION', '题目格式无效'); return helpers.problemInput({ ...value, bankId }); });
   const items = [];
   for (const input of inputs) {
    const problem = (await db.query("INSERT INTO problems(bank_id,platform_bank_id,owner_account_id,owner_scope) VALUES($1,$2,$3,'platform') RETURNING id", [bankId, categoryId, user.id])).rows[0];
    const version = await helpers.insertVersion(db, user, problem.id, input);
    items.push({ id: problem.id, title: input.title, versionId: version.id });
   }
   const result = { items, importedCount: items.length, summary: { created: items.length, total: items.length, failed: 0 } };
   await db.query('INSERT INTO platform_problem_imports(account_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)', [user.id, key, hash, result]);
   await audit('platform.problem.import', { bankId: categoryId, problemIds: items.map(item => item.id), count: items.length });
   return reply(result, 201);
  }
  const action = enumValue(body.action, ['archive', 'restore', 'move'], '批量操作');
  if (!Array.isArray(body.problemIds) || !body.problemIds.length || body.problemIds.length > 200) fail(400, 'VALIDATION', '每批请选择 1–200 道题目');
  const ids = [...new Set(body.problemIds.map(id => uuid(id)))].sort();
  const problems = (await db.query("SELECT * FROM problems WHERE id=ANY($1::uuid[]) AND owner_scope='platform' ORDER BY id FOR UPDATE", [ids])).rows;
  if (problems.length !== ids.length) fail(404, 'NOT_FOUND', '所选内容包含非平台题目或不存在的题目');
  if (action === 'move') {
   const categoryId = await platformCategory(db, body.bankId);
   await db.query('UPDATE problems SET platform_bank_id=$2 WHERE id=ANY($1::uuid[])', [ids, categoryId]);
  } else if (action === 'archive') {
   const referenced = (await db.query(`SELECT id FROM problems p WHERE p.id=ANY($1::uuid[]) AND p.archived_at IS NULL AND (
    EXISTS(SELECT 1 FROM chapter_problems cp JOIN learning_chapters c ON c.id=cp.chapter_id JOIN learning_paths lp ON lp.id=c.path_id
     WHERE cp.problem_id=p.id AND c.archived_at IS NULL AND lp.archived_at IS NULL)
    OR EXISTS(SELECT 1 FROM assignment_problems ap JOIN assignments a ON a.id=ap.assignment_id WHERE ap.problem_id=p.id AND a.archived_at IS NULL)
    OR EXISTS(SELECT 1 FROM timed_practice_problems tp JOIN timed_practices t ON t.id=tp.practice_id WHERE tp.problem_id=p.id AND t.archived_at IS NULL))`, [ids])).rows;
   if (referenced.length) fail(409, 'PROBLEM_REFERENCED', `${referenced.length} 道题目仍被课程、作业或训练引用，请先解除关联；本批未删除任何题目`);
   await db.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE school_id=$1 AND problem_id=ANY($2::uuid[]) AND withdrawn_at IS NULL', [LEGACY_SCHOOL_ID, ids]);
   await db.query('UPDATE problems SET archived_at=COALESCE(archived_at,clock_timestamp()) WHERE id=ANY($1::uuid[])', [ids]);
  } else {
   if ((await db.query(`SELECT 1 FROM problems p JOIN problem_banks b ON b.id=p.bank_id
    LEFT JOIN platform_problem_banks category ON category.id=p.platform_bank_id
    WHERE p.id=ANY($1::uuid[]) AND (b.archived_at IS NOT NULL OR category.archived_at IS NOT NULL)`, [ids])).rowCount)
    fail(409, 'BANK_UNAVAILABLE', '请先恢复题库分类');
   await db.query('UPDATE problems SET archived_at=NULL WHERE id=ANY($1::uuid[])', [ids]);
  }
  await audit(`platform.problem.batch_${action}`, { problemIds: ids, ...(action === 'move' ? { bankId: body.bankId ?? null } : {}) });
  return reply({ updated: ids.length });
 });
}

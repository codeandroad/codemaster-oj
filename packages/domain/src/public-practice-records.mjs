import { transaction } from './db.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import { activeAccount } from './schools.mjs';

export const publicPracticeFirstAc = `SELECT DISTINCT ON (j.problem_id)
  j.id,j.problem_id,j.payload->'version'->>'title' AS title,j.created_at
 FROM school_judge_jobs j
 WHERE j.account_id=$1 AND j.access_context='public' AND j.kind='submit'
  AND j.activity_id IS NULL AND j.state='completed' AND j.result->>'status'='AC'
 ORDER BY j.problem_id,j.created_at,j.id`;

export function setPublicPracticeHistoryAccount(db, accountId) {
 return db.query("SELECT set_config('campus.public_history_account_id',$1,true)", [accountId]);
}

export async function handlePublicPracticeRecords({ pool, user, route, url, method, body }, projectJob) {
 const detail = route.match(/^\/practice\/submissions\/([^/]+)\/([^/]+)(\/note)?$/);
 const notebook = route === '/practice/review-notebook';
 if (!detail && !notebook && route !== '/practice/submissions') return null;
 if (method !== 'GET' && !(detail?.[3] && method === 'PATCH')) return null;
 return transaction(pool, async db => {
  await activeAccount(db, user.id);
  await setPublicPracticeHistoryAccount(db, user.id);
  if (detail) {
   const schoolId = uuid(detail[1]), id = uuid(detail[2]);
   const { rows: [job] } = await db.query(`
    SELECT j.*,n.note,n.updated_at AS note_updated_at FROM school_judge_jobs j
    LEFT JOIN public_practice_notes n ON n.account_id=j.account_id AND n.school_id=j.school_id AND n.submission_id=j.id
    WHERE j.school_id=$1 AND j.id=$2 AND j.account_id=$3 AND j.access_context='public' AND j.kind='submit'
   `, [schoolId, id, user.id]);
   if (!job) fail(404, 'NOT_FOUND', 'Submission not found.');
   if (method === 'PATCH') {
    const note = field(body.note, 'Note', { max: 8000 });
    if (job.state !== 'completed') fail(409, 'NOT_READY', 'Wait for a completed submission.');
    const { rows: [saved] } = await db.query(`
     INSERT INTO public_practice_notes (account_id,school_id,submission_id,note) VALUES($1,$2,$3,$4)
     ON CONFLICT (account_id,school_id,submission_id) DO UPDATE SET note=EXCLUDED.note,updated_at=clock_timestamp()
     RETURNING note,updated_at
    `, [user.id, schoolId, id, note]);
    return { status: 200, body: { note: saved.note, noteUpdatedAt: saved.updated_at } };
   }
   if (detail[3]) return null;
   return { status: 200, body: { ...await projectJob(db, job), note: job.note, noteUpdatedAt: job.note_updated_at } };
  }
  const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, 'Page');
  const rawStatus = url.searchParams.get('status');
  const status = !notebook && rawStatus ? enumValue(rawStatus,
   ['Waiting','Judging','AC','WA','CE','RE','TLE','MLE','OLE','System Error'], 'Verdict') : null;
  const { rows } = await db.query(`
   SELECT j.id,j.school_id,j.problem_id,j.payload->'version'->>'title' AS title,j.payload->>'language' AS language,
          j.created_at,outcome.status,j.result->>'score' AS score,n.updated_at AS note_updated_at
   FROM school_judge_jobs j
   CROSS JOIN LATERAL (SELECT COALESCE(j.result->>'status',
    CASE j.state WHEN 'failed' THEN 'System Error' WHEN 'leased' THEN 'Judging' ELSE 'Waiting' END) AS status) outcome
   LEFT JOIN public_practice_notes n ON n.account_id=j.account_id AND n.school_id=j.school_id AND n.submission_id=j.id
   WHERE j.account_id=$1 AND j.access_context='public' AND j.kind='submit'
     AND (NOT $2::boolean OR n.submission_id IS NOT NULL)
     AND ($4::text IS NULL OR outcome.status=$4)
   ORDER BY COALESCE(CASE WHEN $2 THEN n.updated_at END,j.created_at) DESC,j.id DESC,j.school_id
   LIMIT 26 OFFSET $3
  `, [user.id, notebook, (page - 1) * 25, status]);
  return { status: 200, body: { page, hasMore: rows.length > 25, items: rows.slice(0, 25).map(j => ({
   id: j.id, schoolId: j.school_id, problemId: j.problem_id, problemTitle: j.title, language: j.language,
   createdAt: j.created_at, status: j.status,
   score: j.score === null ? null : Number(j.score), noteUpdatedAt: j.note_updated_at,
  })) } };
 });
}

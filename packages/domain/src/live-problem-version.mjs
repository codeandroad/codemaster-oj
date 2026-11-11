import { fail, uuid } from './security.mjs';

// Activity links identify the exercise. Their stored version remains an audit
// snapshot; current teaching always uses this one publication decision.
// School approval is independent of teaching publication: a pending replacement
// must not displace the approved exercise already used across the school.
export function liveProblemVersionIdSql(problemAlias = 'p') {
 if (!/^[a-z_][a-z0-9_]*$/i.test(problemAlias)) throw new TypeError('Invalid problem SQL alias');
 return `(SELECT live_version.id FROM problem_versions live_version
  JOIN problem_banks live_bank ON live_bank.id=${problemAlias}.bank_id
  WHERE live_version.problem_id=${problemAlias}.id AND live_version.published_at IS NOT NULL
  ORDER BY (live_bank.visibility='school' AND live_version.school_visible_at IS NOT NULL
    AND live_version.rank_review_status='approved') DESC,
   (live_bank.visibility<>'school' AND live_version.id=${problemAlias}.current_version_id) DESC,
   live_version.published_at DESC,live_version.created_at DESC,live_version.id DESC LIMIT 1)`;
}

export async function resolveLiveProblemVersion(db, problemId, { lock = true, allowArchived = false } = {}) {
 uuid(problemId, '题目 ID');
 // Publishing, school review and archival lock the parent first. Hold that
 // lock until the judge task has captured its immutable version snapshot.
 const { rows: [problem] } = await db.query(`SELECT p.id,p.archived_at,b.archived_at bank_archived_at
  FROM problems p JOIN problem_banks b ON b.id=p.bank_id WHERE p.id=$1${lock ? ' FOR SHARE OF p,b' : ''}`, [problemId]);
 if (!problem || (!allowArchived && (problem.archived_at || problem.bank_archived_at))) fail(404, 'NOT_FOUND', '题目不存在或已归档');
 const { rows: [version] } = await db.query(`SELECT v.* FROM problems p
  JOIN problem_versions v ON v.id=${liveProblemVersionIdSql('p')} WHERE p.id=$1`, [problemId]);
 if (!version) fail(404, 'NOT_FOUND', '题目尚未发布');
 return version;
}

export function assertLiveProblemVersion(requestedId, resolvedId) {
 if (requestedId && requestedId !== resolvedId) fail(409, 'PROBLEM_UPDATED', '题目已更新，请刷新页面后重新运行或提交；已保存的代码和历史成绩不受影响。');
}

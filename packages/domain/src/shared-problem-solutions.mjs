import {fail} from './security.mjs';
import {liveProblemVersionIdSql} from './live-problem-version.mjs';

// A problem owns one reviewed solution bundle. Saved problem revisions only
// identify historical source material; they do not create authoring branches.
export function sharedSolutionIdSql(problemId, versionId) {
 const preferred=`COALESCE((SELECT ${liveProblemVersionIdSql('solution_problem')} FROM problems solution_problem WHERE solution_problem.id=${problemId}),${versionId})`;
 return `COALESCE((SELECT content_id FROM luq_problem_solutions WHERE problem_id=${problemId}),
  (SELECT candidate.id FROM luq_assistance_contents candidate
   JOIN problem_versions source ON source.id=candidate.version_id AND source.problem_id=${problemId}
   WHERE candidate.subject_key='problem:'||(${problemId})::text AND candidate.kind='FULL_SOLUTION' AND candidate.language=''
   ORDER BY (candidate.status='published' AND candidate.published_at IS NOT NULL) DESC,
    (candidate.version_id=${preferred}) DESC,candidate.published_at DESC NULLS LAST,candidate.updated_at DESC,candidate.id DESC LIMIT 1))`;
}

export async function sharedProblemSolution(db, problemId, versionId, {lock=false}={}) {
 const {rows:[row]}=await db.query(`SELECT c.* FROM luq_assistance_contents c
  WHERE c.id=${sharedSolutionIdSql('$1::uuid','$2::uuid')}${lock?' FOR UPDATE':''}`,[problemId,versionId]);
 return row;
}

export async function retainSharedSolution(db, problemId, contentId) {
 await db.query(`INSERT INTO luq_problem_solutions(problem_id,content_id)
  SELECT $1::uuid,$2::uuid WHERE NOT EXISTS(SELECT 1 FROM luq_problem_solutions WHERE problem_id=$1)
  ON CONFLICT(problem_id) DO NOTHING`,[problemId,contentId]);
 const {rows:[pointer]}=await db.query('SELECT content_id FROM luq_problem_solutions WHERE problem_id=$1',[problemId]);
 if(pointer.content_id!==contentId)fail(409,'CONTENT_CHANGED','题解已更新，请重新载入统一题解后再保存');
}

export async function assertSharedSolution(db, row) {
 if(row.kind!=='FULL_SOLUTION'||!row.subject_key.startsWith('problem:'))return;
 const problemId=row.subject_key.slice('problem:'.length);
 const current=await sharedProblemSolution(db,problemId,row.version_id);
 if(current?.id!==row.id)fail(409,'SHARED_SOLUTION_REQUIRED','此内容已归入历史素材，请打开题目编辑页维护统一题解');
 await retainSharedSolution(db,problemId,row.id);
}

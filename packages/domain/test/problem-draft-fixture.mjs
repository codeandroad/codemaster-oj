import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { completeTask } from '../worker.mjs';

export const draftIdentity = problem => ({
  expectedVersionId: problem.versionId,
  expectedRevision: problem.editRevision,
});

export const reviewIdentity = problem => ({
  versionId: problem.versionId,
  expectedRevision: problem.editRevision,
});

// These transport tests control the validator result for one specific draft.
// The worker integration tests separately run the reference in the executor.
export async function acceptDraftValidation(pool, problem) {
  const { rows: [task] } = await pool.query(`UPDATE judge_tasks t
    SET state='leased', lease_id=$3, lease_expires_at=now()+interval '1 minute', attempts=attempts+1
    FROM problem_versions v
    WHERE v.id=$1 AND v.edit_revision=$2 AND v.draft_validation_task_id=t.id
      AND t.draft_revision=v.edit_revision AND t.state='queued'
    RETURNING t.*`, [problem.versionId, problem.editRevision, randomUUID()]);
  assert.ok(task, 'The current draft must have a queued validation task');
  assert.equal(await completeTask(pool, task, {
    status: 'AC', score: 100, passed: 1, total: 1,
    publicOutput: '', publicMessage: '', privateResults: [], environmentVersion: 'test-validator',
  }), true);
}

const text = (value, limit = 8192) => typeof value === 'string' ? value.slice(0, limit) : '';

// This is the only projection from private judge logs to public case feedback.
// Formal/correction runs deliberately return measurements only, even for staff.
export function submissionCaseFeedback(submission, version, results) {
 if (submission.results_visible === false) return [];
 const visible = ['samples', 'custom'].includes(submission.kind);
 const samples = (version?.samples ?? []).filter(sample => sample.enabled !== false);
 return (Array.isArray(results) ? results : []).slice(0, 100).map((raw, index) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const position = Number.isInteger(r.position) ? r.position : index + 1;
  const item = { position, status: typeof r.status === 'string' ? r.status : 'NotRun',
   ...(Number.isFinite(r.cpuMs) ? { timeMs: r.cpuMs } : {}),
   ...(Number.isFinite(r.memoryBytes) ? { memoryKb: Math.ceil(r.memoryBytes / 1024) } : {}) };
  if (!visible || !version) return item;
  const sample = submission.kind === 'samples' ? samples[position - 1] : null;
  if (submission.kind === 'samples' && !sample || submission.kind === 'custom' && position !== 1) return item;
  const hasReturn = version.mode === 'function' && ['AC', 'WA', 'Executed'].includes(item.status) && typeof r.returned === 'string' && r.reason !== 'input_mutation';
  return { ...item, visibility: 'public', mode: version.mode, comparator: version.comparator,
   input: text(sample?.input ?? submission.custom_input, 262144),
   ...(sample ? { expected: text(sample.expected, 262144) } : {}),
   output: item.status === 'NotRun' ? null : version.mode === 'function' ? hasReturn ? text(r.returned) : null : text(r.stdout),
   ...(version.mode === 'function' ? { stdout: text(r.stdout) } : {}),
   stderr: text(r.stderr),
   ...(r.reason === 'input_mutation' ? { reason: 'input_mutation' } : {}),
   truncated: r.outputTruncated === true || r.stderrTruncated === true };
 });
}

export async function loadSubmissionCaseFeedback(db, submission, masked) {
 if (masked.results_visible === false || ['Waiting', 'Judging', 'System Error', 'Submitted'].includes(masked.status)) return [];
 const run = (await db.query(`SELECT r.private_results FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id
  WHERE r.submission_id=$1 AND r.id IS DISTINCT FROM $2::uuid AND r.status=$3 AND r.score IS NOT DISTINCT FROM $4::numeric
   AND (NOT t.rejudge OR EXISTS(SELECT 1 FROM audit_events e WHERE e.action='submission.rejudge_confirm'
    AND e.resource_id=$1::text AND e.metadata->>'runId'=r.id::text))
  ORDER BY r.created_at DESC,r.id DESC LIMIT 1`, [submission.id, submission.pending_judge_run_id ?? null, submission.status, submission.score])).rows[0];
 const version = ['samples', 'custom'].includes(submission.kind) ?
  (await db.query('SELECT mode,comparator,samples FROM problem_versions WHERE id=$1', [submission.version_id])).rows[0] : null;
 return submissionCaseFeedback(masked, version, run?.private_results);
}

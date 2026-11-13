const OUTPUT_LIMIT = 8192;
const CASE_LIMIT = 262144;
const text = (value, limit = OUTPUT_LIMIT) => typeof value === 'string' ? value.slice(0, limit) : '';

// Both the submission detail and sortable history use the complete saved run.
// A missing measurement must not turn a partial sum into the reported total.
export const submissionMeasurementsSql = `SELECT
 CASE WHEN count(*)>0 AND count(*)=count(cpu) THEN sum(cpu) END runtime_ms,
 CASE WHEN count(*)>0 AND count(*)=count(memory) THEN ceil(max(memory)/1024) END memory_kb
 FROM (SELECT
  CASE WHEN jsonb_typeof(item->'cpuMs')='number' AND (item->>'cpuMs')::numeric>=0 THEN (item->>'cpuMs')::numeric END cpu,
  CASE WHEN jsonb_typeof(item->'memoryBytes')='number' AND (item->>'memoryBytes')::numeric>=0 THEN (item->>'memoryBytes')::numeric END memory
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.private_results)='array' THEN r.private_results ELSE '[]'::jsonb END) item) measurements`;

export function submissionMeasurements(row) {
 const number = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
 return { runtimeMs: number(row?.runtime_ms), memoryKb: number(row?.memory_kb) };
}

const resolvedPractice = submission =>
 (submission.kind === 'submit' || submission.kind === 'correction' && submission.original_submission_id != null) &&
 submission.context_resolved === true && !submission.timed_attempt_id && !submission.access_timed_attempt_id;

function formalFailureIndex(submission, results) {
 if (submission.status !== 'WA' || !resolvedPractice(submission) || !Array.isArray(results)) return -1;
 return results.slice(0, 100).findIndex(result => result?.status === 'WA');
}

// This is the only projection from private judge logs to public case feedback.
export function submissionCaseFeedback(submission, version, results, { formalTests = [] } = {}) {
 if (submission.results_visible === false) return [];
 const visible = ['samples', 'custom'].includes(submission.kind);
 const showRuntimeError = resolvedPractice(submission);
 const formalIndex = Array.isArray(formalTests) && formalTests.length ? formalFailureIndex(submission, results) : -1;
 const samples = (version?.samples ?? []).filter(sample => sample.enabled !== false);
 return (Array.isArray(results) ? results : []).slice(0, 100).map((raw, index) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const position = Number.isInteger(r.position) ? r.position : index + 1;
  const item = { position, status: typeof r.status === 'string' ? r.status : 'NotRun',
   ...(Number.isFinite(r.cpuMs) ? { timeMs: r.cpuMs } : {}),
   ...(Number.isFinite(r.memoryBytes) ? { memoryKb: Math.ceil(r.memoryBytes / 1024) } : {}) };
  if (!visible) {
   if (version && index === formalIndex) {
    // Legacy school snapshots without IDs still have the exact test array from this job.
    const test = r.testId != null ? formalTests.find(test => test?.id === r.testId) : formalTests[index];
    if (test && (r.testId != null || test.id == null) && typeof test.input === 'string' && typeof test.expected === 'string') {
     const mutatedInput = r.reason === 'input_mutation';
     const actual = version.mode === 'function' ? r.returned : r.stdout;
     return { ...item, visibility: 'public', mode: version.mode, comparator: version.comparator,
      input: text(test.input, CASE_LIMIT), expected: text(test.expected, CASE_LIMIT),
      output: !mutatedInput && typeof actual === 'string' ? text(actual) : null,
      ...(mutatedInput ? { reason: 'input_mutation' } : {}),
      truncated: r.outputTruncated === true || typeof actual === 'string' && actual.length > OUTPUT_LIMIT };
    }
   }
   const runtimeError = showRuntimeError && item.status === 'RE' ? text(r.stderr) : '';
   return runtimeError ? { ...item, runtimeError, mode: version?.mode,
    ...(r.stderrTruncated === true || r.stderr.length > runtimeError.length ? { truncated: true } : {}) } : item;
  }
  if (!version) return item;
  const sample = submission.kind === 'samples' ? samples[position - 1] : null;
  if (submission.kind === 'samples' && !sample || submission.kind === 'custom' && position !== 1) return item;
  const hasReturn = version.mode === 'function' && ['AC', 'WA', 'Executed'].includes(item.status) && typeof r.returned === 'string' && r.reason !== 'input_mutation';
  return { ...item, visibility: 'public', mode: version.mode, comparator: version.comparator,
   input: text(sample?.input ?? submission.custom_input, CASE_LIMIT),
   ...(sample ? { expected: text(sample.expected, CASE_LIMIT) } : {}),
   output: item.status === 'NotRun' ? null : version.mode === 'function' ? hasReturn ? text(r.returned) : null : text(r.stdout),
   ...(version.mode === 'function' ? { stdout: text(r.stdout) } : {}),
   stderr: text(r.stderr),
   ...(r.reason === 'input_mutation' ? { reason: 'input_mutation' } : {}),
   truncated: r.outputTruncated === true || r.stderrTruncated === true };
 });
}

export async function loadSubmissionResult(db, submission, masked, { revealFormalFailure = false } = {}) {
 if (masked.results_visible === false || ['Waiting', 'Judging', 'System Error', 'Submitted'].includes(masked.status)) {
  return { runtimeMs: null, memoryKb: null, testResults: [] };
 }
 const run = (await db.query(`SELECT r.private_results,r.problem_snapshot,m.runtime_ms,m.memory_kb FROM (
  SELECT r.private_results,t.problem_snapshot FROM judge_runs r JOIN judge_tasks t ON t.id=r.task_id
   WHERE r.submission_id=$1 AND r.id IS DISTINCT FROM $2::uuid AND r.status=$3 AND r.score IS NOT DISTINCT FROM $4::numeric
    AND r.version_id=$5
    AND (NOT t.rejudge OR EXISTS(SELECT 1 FROM audit_events e WHERE e.action='submission.rejudge_confirm'
     AND e.resource_id=$1::text AND e.metadata->>'runId'=r.id::text))
   ORDER BY r.created_at DESC,r.id DESC LIMIT 1
 ) r CROSS JOIN LATERAL (${submissionMeasurementsSql}) m`,
 [submission.id, submission.pending_judge_run_id ?? null, submission.status, submission.score, submission.version_id])).rows[0];
 const formalIndex = revealFormalFailure ? formalFailureIndex(masked, run?.private_results) : -1;
 const failure = formalIndex >= 0 ? run.private_results[formalIndex] : null;
 const snapshot = run?.problem_snapshot;
 const formalTests = typeof failure?.testId === 'string'
  ? (snapshot?.tests ?? []).filter(test => test.id === failure.testId) : [];
 const version = snapshot?.version ?? { mode: submission.problem_mode };
 return { ...submissionMeasurements(run), testResults: submissionCaseFeedback(masked,
  version, run?.private_results, { formalTests }) };
}

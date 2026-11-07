# School and public practice

The trial uses the existing Next.js UI components, Nest transport and isolated go-judge executor. New schools do not receive legacy global roles or access to the original school's teaching tables.

## Publication flow

1. A teacher creates a bank and drafts a Python reference problem in that bank. The school administrator can manage all banks in that school.
2. **Validate reference** submits an immutable problem version to the worker. Both hidden formal tests and public samples must pass. Validation only enables review; it does not publish anything.
3. A school administrator reviews the statement, reference and tests, then selects **Review & publish**. Students in that school can run samples, run custom input and submit a formal answer.
4. The platform administrator separately previews the student-facing statement and public samples, then approves public practice. Only this explicit approval makes a version available to personal accounts and other schools.
5. Unpublishing the school problem, archiving its bank, withdrawing platform approval, or publishing a newer version without renewed platform approval removes public access. Reads and submissions recheck approval after acquiring the school publication lock.

Draft edits do not replace a currently published version. Reference validation is tied to a draft revision. Existing school publication and platform approval are distinct.

## Storage and execution

Migration `060_school_practice.sql` adds school-scoped banks, problems, immutable versions, a judge job queue, and a separate platform publication directory. Forced PostgreSQL RLS requires a transaction-local school scope for application access. The public directory stores only identifiers and approval metadata.

The API creates trusted job snapshots after membership/publication authorization. The worker can read snapshots and update only lease/result fields in the new queue. It cannot read school banks, versions, identities or courses, or modify the queued source and test payload. Student code continues to execute only in the existing isolated executor, which has no database credentials or socket access.

The ordinary, Paper 4 and school queues share the same node capacity lock and active-lease count. The worker rotates its first-choice queue, renews leases and retries infrastructure failures up to three times. Results from expired/stale leases cannot overwrite a completed result.

School/public practice stores its own submissions. It does not insert legacy submissions, award legacy points or alter Luq. Formal feedback exposes verdicts and resource measurements, never hidden inputs, expected answers or private execution output. Public sample and custom runs reuse the established feedback projection.

## API entry points

- `/schools/:schoolId/problem-banks`: list/create; `PATCH /:bankId`: rename/archive with expected revision.
- `/schools/:schoolId/problems`: list/create; `GET/PATCH /:problemId`: read/edit.
- `/schools/:schoolId/problems/:problemId/validate`, `/publish`, `/unpublish`: explicit actions with expected revision.
- `/schools/:schoolId/problems/:problemId/submissions`: enqueue `samples`, `custom` or `submit` with a UUID request ID.
- `/schools/:schoolId/judge-jobs/:jobId`: the current account's result; `/judge-status`: administrator-only school counts and executor readiness.
- `/practice/problems`, `/:problemId`, `/:problemId/submissions`, `/:problemId/submissions/:jobId`: approved public practice.
- `/platform/problem-publications`: review queue/approve; `GET /:problemId?schoolId=...`: safe preview; `POST /:problemId/withdraw`: withdraw public access.

Mutations use the existing origin, CSRF and session checks. Responses use the existing `no-store` transport. Requests use optimistic draft revisions and idempotency IDs.

## Validation and current limits

`packages/domain/test/school-practice.integration.test.mjs` exercises PostgreSQL runtime roles, cross-school authorization, public approval, private content projection, concurrent request reuse, leases, public withdrawal races and legacy submission/Luq isolation. Its executor subtest runs real AC sample/formal and WA sample cases when the existing go-judge environment is supplied. `apps/api/test/school-practice-http.integration.test.mjs` verifies the same entry points through Nest using the restricted application role.

The initial authoring UI supports Python standard I/O and JSON function interfaces. It reuses the existing code editor, Vim mode, theme settings and detailed result panel. Learner drafts are browser-local and keyed by account, school, problem and version. New-school course-to-problem links, assignments, Paper 4 and Luq are not included in this slice; the new workspace does not expose placeholder actions for them. Original-school teaching continues through the existing paths.

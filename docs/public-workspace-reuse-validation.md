# Public course and problem workspace validation

## 2026-11-08 — shared presentation, separate authorization

The public learning reader and problem workspace use the same presentation components as school learning. Their adapters continue to call the public learning endpoints. Reusing a component does not grant school membership, school-only data access, or access to private authoring fields.

The public course DTO now provides the published metadata and progress needed by the shared reader: source school, category, difficulty, cover, author, chapter positions, exercise count, and completed exercise count. Exercise completion comes from the requesting account's formal public AC on the exact linked published version. The problem DTO contains approved statement, starter code for supported languages, and public samples; the job DTO includes version and available runtime/memory measurements.

### Tests rerun on this implementation

| Check | Actual result |
| --- | --- |
| API TypeScript build (`npm --prefix apps/api run build`) | Passed |
| Real PostgreSQL / Nest transport catalogue suite: `personal-public-http.integration.test.mjs`, `school-courses-http.integration.test.mjs`, `school-practice-http.integration.test.mjs`; rerun after reviewed-version metadata/tag changes | 18 passed, 0 failed, 1 skipped; 9.168 seconds |
| Separate real isolated-executor run of `school-practice-http.integration.test.mjs` with `GO_JUDGE_TEST_URL` configured | 3 passed, 0 failed, 0 skipped |

The skipped test in the catalogue run is specifically the real-executor case, because that invocation did not provide an executor endpoint. It was then run successfully in the separate executor invocation; the skipped invocation is not counted as an executor pass.

The integration tests used disposable `campus_qa_*` databases on the local pilot PostgreSQL service. Each schema was migrated, then exercised through Nest using the restricted `campus_app` role and through the worker using the separate `campus_worker` role. The executor ran outside the API and had no database credentials. Temporary databases, schemas, proxy container and network were removed after the tests. Existing application databases were not reset or restored.

The security and behavior assertions cover:

- Anonymous access, CSRF, school membership boundaries, and owner-only submission detail.
- No course body or read-progress writes before admission or while an application is pending; admission is scoped to the reviewed edition and invalidated by relevant publication changes.
- Published chapter order, metadata, exact-version practice links, account-specific reading/exercise progress, and removal of withdrawn practice links.
- Problem difficulty, objective, input/output descriptions, return type, parameters, and string tags come from the exact approved version. Private parameter keys, teacher notes, editorials, translations, and unrelated draft metadata are absent. An existing public snapshot adopts the exact version's subsequently reviewed English presentation without exposing its authoring fields; an unpublished version is rejected.
- No unpublished chapters, checkpoint answers, private checkpoint text, author reference programs, hidden tests, other students' code, or teacher private notes in public DTOs. Content responses use `Cache-Control: no-store`.
- Formal public AC updates the requesting account's exact-version practice progress without changing another account's progress.
- Real standard-input and function-mode execution: reference validation, public samples, custom input, runtime exceptions, formal AC, and measured resources. Formal results omit hidden input/output/expected values; public runs expose only their permitted diagnostics.
- Public leaderboard aggregation remains separate from school submissions and private content.

A pre-existing secrecy assertion searched entire JSON for a short numeric hidden-test value, which could also occur inside a random UUID. It was corrected to check the exact serialized hidden value, alongside explicit assertions that private fields are absent. No response leak was found in that failure.

### Reproducing integration validation

Build the API first. Provide `TEST_DATABASE_URL` for a disposable QA database whose name starts with `campus_qa`; never point these tests at an application database. To exercise real execution, also provide `GO_JUDGE_TEST_URL` and, when required, `GO_JUDGE_TEST_TOKEN` from a private environment. No credentials belong in source or this document.

```sh
node --test --test-concurrency=1 \
  apps/api/test/personal-public-http.integration.test.mjs \
  apps/api/test/school-courses-http.integration.test.mjs \
  apps/api/test/school-practice-http.integration.test.mjs
```

Local ignored orchestration scripts were used for the recorded runs to create/drop the disposable databases and attach the executor temporarily. They are not required application runtime configuration.

### Local manual QA preparation and limits

A dedicated local personal QA account was granted access to the already published Python course through the existing application/admission flow. The course has 17 published chapters. Other accounts' course application states were compared before and after and remained unchanged. Authentication material and local fixture identifiers remain in ignored private files. No existing student's submissions or drafts were used for execution tests.

### Browser and local deployment verification

The final implementation was deployed with `npm run start:pilot` to `http://localhost:3004`. Web/API/worker builds passed. Deployment verification compared 153 existing tables before and after migration, found no added tables for this update, and confirmed the worker's school-table restrictions and course RLS. Existing passwords and data were retained; no reset, push, or online deployment was performed.

`npm run typecheck` and `npm run lint` passed after the final navigation change. The targeted web tests for public workspace mapping, navigation, draft context, learning documents/titles/search, and workspace layout passed: 35 tests, 0 failures, 0 skipped. These targeted tests ran before the final keyed-remount navigation fix; the final fix was then checked by typecheck, lint, build, and browser navigation. The complete repository test suite was not run.

Browser checks used the dedicated personal QA account, not `jjj` or another student's code. The shared course reader showed the original chapter directory, dual progress indicators, lesson formatting, and exercise actions. The public exercise opened the original full-screen `ProblemWorkspace`, with its navigation, editor controls, language selector, resizable panels, samples and custom-input/result panels.

- A real sample run passed 2/2 cases; a formal submission passed 5/5 and displayed Accepted, 100/100, measured runtime/memory, and Solved. Hidden-case input and expected output were not shown.
- The submissions table displayed the QA account and its own-row marker. Returning to the course updated practice completion to 1/115 and the exercise to Accepted.
- Leaving unsubmitted code prompted correctly. Returning retained the code. After formal submission, navigating away did not show a false unsaved warning.
- After the final navigation fix, Next and Previous moved between the exact linked questions, retained saved code, and restored Solved without showing the prior question under the next URL.

Screenshots are retained locally under ignored `.campus-local/multischool-pilot/ui-proof/` as `public-course-reader.png` and `public-problem-workspace.png`. Other students' application states and existing records were preserved. Public translation/solution purchases and online presence are not connected in this adapter yet; their unavailable controls are hidden, and school-only APIs are not called as a fallback.

## 2026-11-08 — public online directory follow-up

The preceding browser record describes the first shared-workspace deployment. The follow-up adds dedicated `/practice/presence` endpoints for the existing compact online-students component. It does not reuse the school directory or infer public presence merely from being signed in. A session must send an explicit public-context heartbeat; it expires after 90 seconds and logged-out sessions disappear immediately. Multiple tabs and devices count once per account.

The public directory uses the same opted-in nickname or generated public alias as the public leaderboard. It omits legal names, usernames, identity numbers and school membership. Search operates only on that public display name. An activity card is available only while its target remains public-online. Its points, solved count and AC rate derive only from formal public submissions through the first accepted result for each problem. School submissions, samples, custom runs, infrastructure failures and later submissions after AC are excluded. Recent titles must still belong to the exact currently published and approved public versions. Scholarship is read from the existing global identity wallet; presence neither initializes a wallet nor exposes any school-specific scholarship account.

Migration `081_public_presence.sql` adds a separate nullable heartbeat timestamp and a narrowly scoped aggregate function. It does not backfill school sessions or change existing student records. The worker cannot execute the aggregate function or read session presence. Existing school presence routes remain separate.

### Follow-up tests rerun

| Check | Actual result |
| --- | --- |
| API TypeScript build (`npm --prefix apps/api run build`) | Passed |
| New public presence PostgreSQL + Nest transport suite alone | 5 passed, 0 failed, 0 skipped |
| New public presence suite plus original school presence HTTP and domain regression suites | 9 passed, 0 failed, 0 skipped; 5.009 seconds |

The combined run used `public-presence-http.integration.test.mjs`, `presence-routes.test.mjs`, and `presence.integration.test.mjs` in a disposable local QA database. Assertions cover authentication, CSRF and origin validation, rejection of client-supplied identity/timestamps, explicit public context, safe aliases and search, pagination, multi-session deduplication, account/identity disablement, expiry and logout, public-only metrics, wallet separation, withdrawn/archived/superseded content, response whitelists, and restricted application/worker grants. No existing application database, student account, deployment or production service was modified by these tests. These backend results do not claim browser acceptance of the follow-up.

## 2026-11-08 — public scholarship security review

Independent review of migration `080_public_scholarship.sql` and the public assistance/submission paths found two blockers before deployment. A new-school public exercise could bypass its source school's assistance restrictions, and a public solution delivery was missing from a later school submission's assistance snapshot. Regression fixtures reproduced disabled subject access, an assigned assessment without an attempt, an ended assessment awaiting published results, and an incorrectly awarded school first-AC bonus after public solution delivery. The implementation was corrected and the same regression cases passed.

Public assistance now honors source-school disabled/opening policies and assigned assessment restrictions even when the student switches entry points or already holds a paid entitlement. Public and school submission snapshots both include earlier solution delivery from the other entry point. A delivery after server acceptance of the submission does not retroactively remove the reward. Global public purchases and balances remain separate from new-school purchases and balances, and free delivery creates no permanent paid entitlement.

| Check rerun after the security fixes | Actual result |
| --- | --- |
| Independent cross-entry security suite (`public-scholarship-security.integration.test.mjs`) | 9 passed, 0 failed, 0 skipped within the combined run |
| Combined real PostgreSQL security, scholarship transaction/migration, and Nest HTTP suites | 27 passed, 0 failed, 0 skipped; 5.327 seconds |

The combined run used `apps/api/test/public-scholarship-security.integration.test.mjs`, `packages/domain/test/public-scholarship.integration.test.mjs`, and `apps/api/test/public-scholarship-http.integration.test.mjs`. It also verified concurrent first-AC callbacks, stable cross-entry deduplication, balance competition, purchase retries, one-time refunds with retained rights, translation credit, exact-version reviewed content, content withdrawal, historical-AC migration without backpay or job changes, session/CSRF checks, and absence of private reference code, hidden tests or teacher notes in public responses. Restricted worker grants continued to deny direct access to money and assistance records.

These tests used fresh migrated schemas and real application/worker database roles inside a disposable local QA database, which was removed afterwards. Worker result callbacks were controlled fixtures in this financial-security run; this is not a new execution-sandbox validation. No existing local student data, remote database, deployment, or Git remote was changed by the review.

### Real executor rerun after public scholarship integration

`school-practice-http.integration.test.mjs` was rerun against the isolated executor with the current scholarship changes: **3 passed, 0 failed, 0 skipped; 3.774 seconds**. Both standard input/output and function-mode public questions completed actual sample runs, custom-input runs, runtime-error feedback, and formal accepted submissions. The checks require measured runtime and memory, preserve public Solved/attempt status, and reject hidden test input/output in student responses.

The first run stopped before reaching the executor subtest because an older assertion required the global scholarship ledger to stay empty after successful public submissions. The test now verifies that registration/login still creates no wallet entries, and that only the three eligible first public ACs in its fixtures produce the configured +4 rewards. It continues to exclude school ACs, sample/custom runs, and repeated ACs from public credits; no application behavior was changed to satisfy the test.

The rerun used `PAPER4_REAL_EXECUTOR=1` with the ignored local `run-public-workspace-executor-tests.mjs` helper. It created and removed only a disposable `campus_qa_public_executor_*` database and a temporary executor proxy/network, with no existing business data changed. Private output is retained in ignored `.campus-local/multischool-pilot/public-aid-real-executor.log`; credentials are not recorded here.

## 2026-11-08 — final public assistance and presence deployment

The public adapter now uses the original `LuqAssistance`, `SolutionContent`, scholarship balance/history, and compact online-students components inside the shared `ProblemWorkspace`. The earlier note that these public controls were unavailable describes the preceding deployment and is superseded by this follow-up. The default reference-code theme remains GitHub Dark, with the existing theme selector retained. Public routes use explicit public APIs; they never fall back to a school-only endpoint.

### Final checks on the deployed implementation

| Check | Actual result |
| --- | --- |
| Repository `npm run typecheck` | Passed |
| Repository `npm run lint` | Passed |
| Repository `npm test` without database/executor environment | 375 passed, 0 failed, 193 skipped |
| Combined real PostgreSQL/Nest scholarship, public aid, presence and original-rule regression | 110 passed, 0 failed, 0 skipped; 44.396 seconds |
| Separate real isolated-executor transport suite | 3 passed, 0 failed, 0 skipped; 3.774 seconds |
| Repository `npm run build` | Passed on the final rerun |
| Local `npm run start:pilot` | Passed; web/API/worker available on the pilot deployment |

The skipped cases in the default repository invocation require database or executor environment variables and are not counted as passed. The separate 110-test run covers the changed transactional and authorization boundaries, including duplicate/concurrent callbacks, first-AC deduplication across entry points, balance competition, retry-safe purchases and initialization, refund deduplication, answer-delivery/submission ordering, assessment restrictions across entrances, unpublished/withdrawn/exact-version content, response secrecy, public-only presence, and existing school ledger/assistance rules. It used a disposable QA database with actual restricted application and worker roles. The executor suite separately exercised real isolated student code execution.

The initial repository build stopped at a Next.js security upgrade reminder after compilation. The final rerun completed, while still reporting that the installed Next.js dependency has a known security vulnerability. No dependency upgrade was included in this change; this remains an outstanding dependency maintenance issue.

### Migration and existing-data preservation

Only the local pilot at `http://localhost:3004` was updated. Migrations `080_public_scholarship.sql` and `081_public_presence.sql` add public reward receipts/results and a nullable public-presence heartbeat. Deployment created a private backup and compared all 153 pre-existing tables. Existing account credentials, courses and chapter links, submissions, grades and scholarship ledger records were retained. The verifier permits only the new nullable session column and the exact pre-measured historical public-AC claims: those claims are ineligible, have no ledger entry and do not backpay rewards. Application/worker grants and course RLS passed verification. No reset, Git push or online deployment was performed.

Public practice uses the stable identity's global scholarship account and existing configured prices. It does not copy or expose balances from new-school-specific scholarship accounts. Initial allowance is granted once through explicit account access, not by login, heartbeat or page duration. No extra configuration is needed for the original school's already reviewed public Python content. Publishing a public problem alone does not publish its private author reference code, hidden tests or teacher notes; only explicitly reviewed assistance for the actual version is deliverable.

### Browser verification

A dedicated local personal QA account was used; `jjj`'s scholarship balance, code and application state were not used or changed. The current shared workspace was verified through the approved public course:

- Translation confirmation showed 3 scholarship and changed the QA balance from 100 to 97. Chinese content retained the problem structure and code/variable names.
- Solution confirmation showed the configured price of 8, a translation credit of 3 and a charge of 5, leaving 92. The reviewed explanation and reference code rendered with the original theme selector; GitHub Dark and GitHub Light both worked.
- After a reload, the already-unlocked solution quoted 0 and opened successfully. The ledger still contained only the initial +100, translation -3 and solution -5 entries.
- The online panel opened upward, searched public display names, showed an empty result for a non-match, opened the compact recent-activity card without navigation, and minimized. The card displayed public points, solved count, AC rate and global scholarship in that order; withdrawn titles were absent.
- Existing editor code remained unchanged across the assistance views, theme changes, reload and navigation. No new formal submission was needed for this browser check. Historical public ACs received no retroactive reward.

The QA session was signed out and its temporary browser tab closed. Screenshot evidence is retained in ignored `.campus-local/multischool-pilot/ui-proof/public-assistance-presence.png`. Build and test logs remain in ignored local storage; no credentials, database backups or student data were added to project documentation.

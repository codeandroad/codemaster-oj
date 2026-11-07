# School Paper 4

New-school Paper 4 uses the existing Paper 4 question model, import/export formats, PDF excerpt renderer, Python editor and isolated runner. Its persisted papers, versions, activities, attempts, files, review marks and jobs are separate from the legacy school's data. The legacy school continues to use its existing Paper 4 routes.

## Teaching workflow

- Teachers create or import their own papers. School administrators can manage all papers in their school. Import accepts structured JSON packages and ZIP collections; it does not convert arbitrary PDFs or ordinary `problems.json` files.
- An editable draft contains 1–3 questions with 75 total marks. Each question has its own starter code, input files, automatic/manual/evidence stages, private runner cases and private reference program.
- Validation runs the reference programs through the existing isolated executor. The school administrator explicitly publishes the validated current revision. Editing a draft does not replace an already published snapshot until validation and publication are repeated.
- The compact library supports year/session filters, Shift range selection, batch export, validation, publication and assignment. Export is staff-only and includes private authoring material needed for an editable round trip.
- Batch assignment accepts individual school identities across the teacher's responsible classes and unassigned students; administrators can select all school students. It pins the published paper version and participant identities. Mock exams require a future start and end. Practice may be untimed.
- Optional scholarship reward conditions are initialized with the activity in the same transaction, defaulting to zero. The school scholarship service validates the administrator's cap and freezes rules once the activity starts. The activity's compact rule display is shared with other school activities.

## Student workflow

The answer workspace retains the original statement's verified PDF excerpts and 120% default zoom, with text fallback when no matching excerpt is available. The outer problem list and previous/next controls follow the filtered school paper library; the question selector changes questions within a paper. The URL retains the school, filters, attempt and question for refresh/back navigation.

Each question saves independently using a revision check. Save status and navigation protection share the existing Paper 4 save reducer; a lost response is retried against the acknowledged revision. Local recovery preserves unsynced code without automatically overwriting the server copy. Run uses only public runner cases; Submit freezes the paper and queues its formal assessment. Free practice can start another attempt after submission.

Translation and Solution use the school scholarship service's reviewed content, quotation, confirmation, unlock and provision endpoints. The Solution renderer retains its code-theme selector. A private reference program is never automatically exposed as a solution.

Teachers can review manual/evidence marks and private notes, then publish results. Notes never appear in student DTOs. Exam results remain hidden until the activity's results are released; submitted attempts remain accessible for review afterward. Exam restrictions also block parallel practice entrances for the same paper while results remain unreleased.

## Isolation and execution

Migration `069_school_paper4.sql` creates composite school-key foreign keys and row-level policies. New-school membership is checked before each operation; identities, activities and versions must belong to the same school. The module rejects the legacy-school ID rather than opening the old global tables.

The API produces immutable job payloads. The worker can lease and update `school_paper4_jobs`, and uses the existing `runPaper4Snapshot` sandbox implementation. It does not gain access to student identities, private content tables or the scholarship ledger. The executor receives no database credentials. The shared worker-capacity calculation includes ordinary, legacy Paper 4, new-school ordinary and new-school Paper 4 jobs.

Migration `070_school_scholarship.sql` supplies school-scoped assistance and reward accounting. The stable Paper 4 assistance/reward subject is `paper4:<paperId>:<questionKey>`; actual content is tied to the fixed paper version. Its server-side delivery snapshot and settlement rules apply to Paper 4 just as they do to ordinary school problems.

## Integration

- Nest module: `SchoolPaper4Module`, transport dispatch `schoolPaper4`.
- Domain dispatcher: `handleSchoolPaper4({pool,user,route,method,body,url})`.
- Routes: `/schools/:schoolId/paper4/{papers,activities,attempts,jobs,audience}`.
- Worker: `processSchoolPaper4One` in `packages/domain/school-paper4-worker.mjs`.
- Web entry: `SchoolPaper4({schoolId,role})` in `components/schools/school-paper4.tsx`.

Migration application and code deployment do not copy legacy school papers, students or attempts. Existing records and volumes are retained. Platform-wide Paper 4 publication and course chapter links to these new-school Paper 4 records are outside this module's current scope; no inactive controls are shown for them.

## Validation

The module has domain input tests, real PostgreSQL authorization/transaction/worker tests and Nest HTTP integration tests. `school-paper4-model.test.mjs` checks URL context, deterministic filtering, PDF metadata and draft independence; the shared `paper4-save-state.test.mjs` covers concurrent saves, reverted edits and lost acknowledgements. Run these against the current revision and report an unavailable database or isolated executor as skipped, never as a pass. Use an isolated QA database, not the pilot school's business tables.

# School-wide student presence

The problem workspace shows current online **students across the school**, including the current student. This is not a count of students viewing the current problem. The service records no problem, course, class, assignment or page location.

## Session lifecycle

- Migration `051_student_presence.sql` adds nullable `sessions.presence_seen_at` and a partial index. Existing sessions and records are retained; a session is initially offline until it sends a heartbeat.
- An authenticated student sends `POST /api/v1/presence/heartbeat` with `{}` every 30 seconds while the application is visible. Existing origin and session CSRF checks apply. The server derives identity and time; a client cannot set either or submit a page location.
- Repeated heartbeats within 15 seconds do not rewrite the timestamp. A session is considered online for 90 seconds after its latest heartbeat. Multiple tabs/devices count the stable student identity once.
- A logged-out, expired, revoked, unbound, disabled or archived account/session is excluded immediately. Closing all tabs or losing connection expires by TTL. A remaining valid device can keep the same student online.
- This is temporary session state, not a durable activity log. It creates no submission, grade, leaderboard or Luq event. Existing application-role session access is sufficient; judge worker and executor database privileges do not change.

## Read contract and public fields

Authenticated students, teachers and administrators can read `GET /api/v1/presence?q=&page=1&pageSize=20`. The maximum page size is 50; search is a literal, case-insensitive substring of the displayed public name, up to 80 characters. Results sort by displayed name and stable identity ID. Both the counts and page use the same database snapshot.

Response:

```json
{
  "onlineCount": 1,
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "ttlSeconds": 90,
  "items": [{"identityId": "<stable identity ID>", "displayName": "<public name>", "avatar": "<avatar path>"}]
}
```

`onlineCount` is the global count; `total` is the search match count. The displayed name follows the existing leaderboard preference: identity name by default, nickname only when the student has explicitly enabled nickname display and set a nonempty nickname. Search does not search hidden alternatives. No account IDs, numbers, email addresses, session tokens, private annotations, last-seen times or locations are returned. Existing API `Cache-Control: no-store` applies.

The successful heartbeat response is `{ "ok": true, "ttlSeconds": 90, "heartbeatIntervalSeconds": 30 }`. Teachers and administrators can read the list, but do not appear as online students and cannot send student heartbeats.

## Validation

Dedicated real PostgreSQL integration coverage checks session deduplication and concurrent callbacks, literal/name-only search, bounded pagination, TTL, logout/revocation/expiry/account state, and absence of Luq/submission effects. Nest transport coverage checks authentication, CSRF, origin, payload validation, public-only response fields, cache policy and multi-session logout. Tests create isolated schemas in the QA database and drop only those schemas; deployment must apply the migration without replacing any database volume.

## Workspace and class interface

The ordinary and Paper 4 workspaces use the same compact footer in the statement panel. It remains below the scrolling statement, with an upward list, name search, public-profile links, pagination, and a minimize button. Escape closes the list and restores trigger focus. Search cancels stale requests; shrinking online populations clamp the current page; errors stay within the widget and offer retry. Existing navigation protections preserve unsaved code. The counter and list poll every 30 seconds while visible; heartbeats also request a refresh. The count can lag remote changes until the next poll.

The compact follow-up removes the separate title row: search and minimize share a toolbar. The popup is 240 pixels wide, with 24-pixel avatars and 32-pixel student rows; long names truncate visually while preserving the full accessible name and tooltip. Touch controls have a larger minimum target. The list grows with its contents up to a bounded scroll area instead of reserving unused height.

Class details add a compact, searchable Students panel. Current membership is checked server-side, and only active, bound student accounts are listed. The response contains only `id`, `displayName`, `avatar`, and the boolean `isOnline`. The roster refreshes through `GET /api/v1/classes/:id/members`, which repeats the active-class and current-member/assigned-teacher checks and returns the same public member fields. Online status uses the existing 90-second session heartbeat TTL, excludes expired/revoked sessions, and requires an active, bound student account with original-school ownership. Multiple sessions still produce one student row. No session identifiers, last-seen times or page locations are returned.

The roster polls every 30 seconds while visible and refreshes after a heartbeat or returning to the tab. Each row shows a status dot and localized Online/Offline text; a failed refresh shows Unknown with retry instead of incorrectly marking students offline. Selecting a student opens the existing recent-activity card as a floating panel below that row, outside the scrolling list. The panel flips above the row when needed to stay in the viewport; list dimensions and row positions do not change. Online text and its dot are both green. The heading, search, and full roster stay mounted and usable; selecting another student switches the disclosure. Clicking the same row, its close button, or Escape collapses the card. Outside click or moving focus away dismisses the panel. Close/Escape restores focus to that student without scrolling. School student profile headers also poll the authorized student-preview endpoint for its boolean `student.isOnline`; errors display Unknown. The preview is fetched only when expanded, and the avatar links to the existing public profile route. `memberCount` retains total enrolled identities, while the Students panel count reflects currently available public profiles, so unactivated or disabled members can make the counts differ.

The visible brand, wordmark SVGs and page metadata now use **CodeMaster**. Existing asset filenames and historical records keep their identifiers. The default locale is English even if the browser advertises Chinese. Only an explicit `zh` setting selects Chinese; Settings persists it through the existing cookie and browser preference. Existing explicit Chinese preferences are retained; clearing a preference returns to English. The login page no longer offers a competing language switch. Course names, statements and user content are not translated by this preference.

## Local rollout and verification (2026-11-05)

This rollout is local to port 3000. No Git push or online deployment was performed. A private PostgreSQL backup was created before migration, then migration 051 and normal runtime grants were applied. Only API and Web containers were replaced; persistent volumes and judge containers were retained. Backup and detailed QA artifacts are under Git-ignored `.campus-local/presence-validation/` and related presence/class QA directories; they must not be committed.

Before/after counts and content hashes matched for 32 business tables, including course links, submissions, student code, grades and Luq records. Session state and normal authentication audit events are not part of this comparison; the existing comparison also excludes account login timestamps and the earlier assignment-order display field. No business content was migrated or republished in this task.

Current verification, distinct from earlier task results:

- API and Web typecheck, Web lint, production build and separation check passed. The first host build stopped at an existing Next.js security-upgrade reminder; the unchanged retry and final Docker production build succeeded. This task does not upgrade the framework; the existing dependency advisory remains to be addressed separately.
- Domain tests: 243 passed; 33 executor-dependent checks were **SKIPPED** because the test command did not supply the isolated executor environment. Those are not counted as passes. Real PostgreSQL integration tests ran in an isolated QA database, including presence session lifecycle and class membership/field authorization.
- Nest tests: 20 passed. The first full run exposed one old expected brand string; after updating that assertion for the requested rename, all Nest tests passed. Web tests: 216 passed.
- Real local HTTP verification: 28 checks passed, including two sessions for one student, concurrent heartbeats, logout, teacher exclusion, authentication, CSRF, field allowlist and cache policy. All QA sessions for that check were signed out.
- Browser checks passed for default English with Chinese browser headers, Settings switching both ways and persistence, CodeMaster wordmarks, ordinary-workspace search races, error retry, empty results, pagination after expiry, collapse/focus/keyboard and light/dark appearance. The online popover fits 320/768/1024/1440 pixel viewports.
- The real Paper 4 workspace passed live heartbeat/count, bottom-right placement, upward expansion, minimize/Escape/focus, unchanged editor content and four viewport checks. Existing class details passed active roster, search, empty state and profile navigation checks. Browser checks created no submissions, solution unlocks or Luq changes.
- Final local browser verification also checked the responsive shell header: at 320/390 pixels it is 85 pixels tall, and at 768/1440 pixels it is 56 pixels tall, with no overlapping controls or horizontal overflow. Class roster and profile navigation passed again after the final Web rebuild; the QA session was signed out.

Compact-popup follow-up: Web typecheck, targeted ESLint, Docker Web build and local health check passed again. Ordinary-workspace fixture checks and real Paper 4 browser checks measured a 240×76-pixel single-student popup on desktop, and 240×90 pixels at 320-pixel width after selecting the Problem tab. Search, empty/error states, pagination, minimize/Escape focus, light/dark colors and viewport containment passed. The real check preserved editor content, made no business API writes and signed out its QA session. Evidence is in ignored `.campus-local/presence-compact-qa/`. Backend integration tests were not rerun for this presentation-only follow-up.

## Class roster disclosure follow-up (2026-11-12)

Current checks: Web typecheck, targeted ESLint, all 386 Web tests, and application separation passed. Browser checks used the current Web implementation and a temporary Nest API with disposable accounts in an isolated QA schema. They verified real session presence, no preview prefetch, retained roster/search, switching and collapsing disclosures, keyboard focus and scroll restoration, failed-request retry, Chinese/English, dark mode, and 320/768/1024/1440-pixel layouts. Even on the narrow viewport, another classmate stays visible below the expanded card. No browser runtime errors were observed.

Five domain/Nest presence and roster test groups passed with no skips in a source snapshot containing this change and the tracked migration baseline through 105. The initial whole-workspace run failed before executing these checks because the concurrently added, unrelated migration `106_platform_course_admissions.sql` contained an ambiguous `school_id` reference. That migration was excluded only from the QA snapshot; it was not changed by this task. These results do not claim that the in-progress whole-workspace migration chain passes. Evidence is in ignored `.campus-local/class-roster-20261112/`.

This follow-up changes read-only roster transport and presentation. No production deployment or database migration was performed. Grading and sandbox behavior were unchanged and their checks were not rerun.

# 2026 Paper 4 authoring coverage

These three packages retain the supplied question-paper English requirements and75 marks per paper. The original candidate-file ZIPs were missing. The user explicitly approved synthetic classroom replacements. No original data file is claimed or recreated. Each Q2 statement and paper description labels its replacement, and file-dependent expected outputs refer only to that classroom data.

## Rebuild and provenance

Run `python3 content/paper4-pastpapers/2026/authoring.py`. Editable references are in refs/; source-data.json preserves extracted original question requirements, original QP/MS checksums and the clearly synthetic text attachments. The replacements contain16 toys,30 avatars and15 characters respectively, preserving original formats. Only the first example row in each file comes from the supplied question paper. No prototype files/assets/packages are used.

## Current validation

Authoring validation parses all reference/driver Python, checks3 questions and75 marks each, stage/case allocation, unique stage identifiers, byte limits and case limits. It does not run reference/candidate Python on the host/API/web. Central isolated-executor validation and deliberate wrong-answer checks must be reported separately.

## Marking caveats

- The v1 model supports the final edited program. s26_41 Q1(c) asks for an earlier11-input main; Q1(e) explicitly amends it to six inputs. The earlier main and its evidence are manually reviewed, while the final six-input FIFO behavior is tested automatically.
- Teachers review actual algorithms, recursion, early stopping, avoidance of prohibited built-ins, public/private attributes, comments, local/global declarations and required method calls. Automatic behavior passing does not award these marks.
- Toy-difficulty menus and the two character-criteria input representations remain manual because the question paper prescribes no exact numeric/text menu. The teacher reference accepts difficulty1/2/3 or Easy/Medium/Expert and character criteria such as Colour=Black then Fly=Yes. Students may use any clear equivalent interface.
- Avatar matching-array identifiers and hair-choice menus are unspecified, so EnterChoices and the final main are manually reviewed, including yes/invalid blue/black and no/green. Functional tests check constructor/getters, conjunction criteria and loading all30 records. Load-array tests accept both dynamic append and preallocated-index implementations, matching the original language flexibility.
- Function tests AST-load safe declarations and definitions wherever located without running the main. No main guard is imposed. Teacher drivers convert exceptions to FAIL and use independently specified expected outcomes.
- Hidden cases cover full/empty capacity, FIFO, lowercase conversion, absent counts, sort lengths/ties, both criteria, file errors, list pointers/free-list exhaustion, tree capacity and unbalanced traversal.
- File tests compare CSV fields and tolerate an optional final newline. Word evidence templates are not imported. Evidence stages preserve teacher review of code/run/file evidence, including SelectedToys.txt filename and content.

## 9618 Paper 4 · May/June 2026 · Paper 41

Cases: 17. Marks:75. Synthetic attachment: Toys.txt.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 1(b) | 7 | auto | enqueue-capacity (public), enqueue-extreme-integers (hidden) |
| 1(c)(i) | 5 | manual | Review the earlier 11-input main, failed-Enqueue message and non-destructive array output. Part (e) explicitly amends that main to six inputs; its final behavior is tested separately. |
| 1(c)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 1(d) | 6 | auto | fifo-empty (public), full-drain (hidden) |
| 1(e)(i) | 3 | auto | final-six-input-main (public), different-final-six (hidden) |
| 1(e)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(b)(i) | 8 | auto | read-classroom-toys (public), toy-read-error (hidden) |
| 2(b)(ii) | 3 | auto | output-toy-data (public) |
| 2(b)(iii) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 2(b)(iv) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(c)(i) | 5 | manual | Check validated difficulty choice, matching records and returned array. The original permits implementation-defined menus (including numeric choices), so no menu spelling is enforced. |
| 2(c)(ii) | 3 | auto | write-selected-records (public), empty-selection (hidden) |
| 2(c)(iii) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(c)(iv) | 1 | evidence | Review a medium-difficulty run and SelectedToys.txt with filename/content visible, using the labelled classroom dataset. |
| 3(a)(i) | 4 | manual | Teacher checks the source structure required by this subpart. |
| 3(a)(ii) | 4 | manual | Check public NumberSpaces and BoardArray of100 independent empty objects, declaration comments and GetNumberSpaces. |
| 3(a)(iii) | 3 | auto | initialise-order-and-capacity (public), initialise-fewer-than-spaces (hidden) |
| 3(a)(iv) | 2 | auto | path-format (public), path-skips-empty-objects (hidden) |
| 3(a)(v) | 1 | auto | get-object-indices (public) |
| 3(b)(i) | 6 | auto | five-path-objects (public) |
| 3(b)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |

Supplied source checksums: {"ms": {"sha256": "8e46a3b44b97281092faded669e75b19720f7b8ab62db0d1dac7781646939597", "pages": 41}, "qp": {"sha256": "e73afe72bcaf254e96300aaf476fe013af81a240d29749161bfcddb7a96acb95", "pages": 12}}

## 9618 Paper 4 · May/June 2026 · Paper 42

Cases: 17. Marks:75. Synthetic attachment: AvatarFile.txt.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 1(b)(i) | 5 | auto | original-extremes (public), different-unique-extremes (hidden) |
| 1(b)(ii) | 1 | auto | main-lengths (public) |
| 1(b)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 1(c)(i) | 5 | auto | sort-original (public), sort-empty-single-and-duplicates (hidden) |
| 1(c)(ii) | 3 | auto | before-after-arrays (public) |
| 1(c)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a)(i) | 4 | manual | Teacher checks the source structure required by this subpart. |
| 2(a)(ii) | 3 | auto | avatar-name-age (public) |
| 2(a)(iii) | 2 | auto | both-criteria-required (public), false-glasses-match (hidden) |
| 2(b)(i) | 7 | auto | load-classroom-avatars (public), avatar-read-error (hidden) |
| 2(b)(ii) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 2(c)(i) | 6 | manual | Check both validation loops, MeetCriteria calls and a global array of matches. The paper does not prescribe the matching array identifier. |
| 2(c)(ii) | 5 | manual | Review EnterChoices call, matching count, name and age outputs. Hair-colour choices may use textual or numeric menus; no exact menu representation is imposed. |
| 2(d)(i) | 1 | evidence | Review yes, blue then black using the labelled classroom dataset. |
| 2(d)(ii) | 1 | evidence | Review no and green using the labelled classroom dataset. |
| 3(a) | 5 | manual | Teacher checks the source structure required by this subpart. |
| 3(b)(i) | 4 | auto | follow-data-pointers (public) |
| 3(b)(ii) | 3 | auto | follow-free-pointers (public) |
| 3(b)(iii) | 2 | auto | initial-headings-and-lists (public) |
| 3(b)(iv) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(c)(i) | 8 | auto | append-to-tail (public), fill-and-reject (hidden) |
| 3(c)(ii) | 2 | auto | updated-list-output (public) |
| 3(c)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |

Supplied source checksums: {"ms": {"sha256": "5f9883f60b082e00161cad09932cd40b662efd1e50b36b8d9e0b614c2be963ad", "pages": 41}, "qp": {"sha256": "6cfd2588e1d52a7f8c83d70783bfc4c435bd862abfd6a25afd9384155db9ea7d", "pages": 12}}

## 9618 Paper 4 · May/June 2026 · Paper 43

Cases: 23. Marks:75. Synthetic attachment: Characters.txt.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 1(b) | 4 | auto | lower-case-inputs (public), preserve-punctuation (hidden) |
| 1(c) | 2 | auto | one-line-output (public) |
| 1(d)(i) | 1 | auto | first-original-inputs (public) |
| 1(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 1(e) | 5 | auto | case-insensitive-word-count (public), word-absent (hidden) |
| 1(f)(i) | 5 | auto | bubble-by-length (public), sorted-and-equal-length (hidden) |
| 1(f)(ii) | 1 | auto | count-then-sort (public) |
| 1(f)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a)(i) | 4 | manual | Teacher checks the source structure required by this subpart. |
| 2(a)(ii) | 3 | auto | character-getters (public), character-different-values (hidden) |
| 2(b) | 7 | auto | read-classroom-characters (public), characters-read-error (hidden) |
| 2(c) | 3 | auto | character-output-format (public), no-matching-characters (hidden) |
| 2(d)(i) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(e)(i) | 8 | manual | Review two criteria for different characteristics, conjunction of both criteria, new matching array, matching count and OutputCharacters call. The original leaves the choice menu and input representation open. |
| 2(e)(ii) | 1 | evidence | Review black plus can-fly criteria against the labelled classroom dataset. The reference accepts Colour=Black then Fly=Yes; other clear interfaces are valid. |
| 3(a) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 3(b) | 7 | auto | insert-parent-pointers (public), one-hundred-nodes-and-overflow (hidden) |
| 3(c) | 2 | auto | first-ten-rows (public) |
| 3(d)(i) | 3 | auto | original-insertion-main (public) |
| 3(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(e)(i) | 7 | auto | in-order-example (public), unbalanced-traversal (hidden), single-node-traversal (hidden) |
| 3(e)(ii) | 1 | auto | original-in-order-main (public) |
| 3(e)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |

Supplied source checksums: {"ms": {"sha256": "784a49401da04d8d9b525ff965b89c550eda555fb18e49f8153115f8fa197cb6", "pages": 46}, "qp": {"sha256": "e3d51e17833dfb74e5e21f5b661339fb180ce0c10e70fcf6c6b5220b7c23c2f9", "pages": 16}}

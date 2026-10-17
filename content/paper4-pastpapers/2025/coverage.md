# 2025 Paper 4 authoring coverage

All six packages preserve the supplied question-paper subparts and 75-mark totals. English statements retain required interfaces, outputs and evidence tasks. JSON files are teacher-only import packages containing references and hidden cases. No source, package, fixture or asset was imported from the adjacent prototype.

`python3 content/paper4-pastpapers/2025/authoring.py` regenerates the six manifests. `source-data.json` snapshots the supplied original text attachments and extracted question requirements; `inputs/s25_41-base.json` snapshots the existing reviewed example. Reference sources remain editable in `refs/` for the other five papers.

## Current validation

Authoring validation parses every reference and teacher driver as Python syntax, verifies stage identifiers, auto/manual/evidence case allocation, 75 marks, three questions, case limits and package byte limits. It does **not** execute references, candidate programs or drivers on the host/API/web. Real isolated-executor reference and wrong-answer validation is performed centrally and must be reported separately.

## Marking and testing caveats

- Automatic behavior checks support, but do not award, the original subpart marks. Teachers must review recursion, insertion/bubble/binary algorithms, avoidance of prohibited built-ins, OOP inheritance/privacy, comments, required function calls and local/global scope as stated in each subpart.
- Manual stages preserve marks for structural requirements, random-number generation, and input-menu choices where the original prescribes no exact menu/prompt spelling. Evidence stages retain the original screenshot/run requirements through teacher review of saved code/run records; the Word template is not imported.
- Function drivers AST-load safe declarations and definitions wherever located without running the student main. Drivers reset mutable global test fixtures explicitly. No particular main guard is required. Unexpected exceptions become FAIL.
- Public cases show representative behavior. Hidden cases cover capacity/empty boundaries, FIFO/LIFO ordering, collisions, absent search values, duplicates in sortable arrays, singleton/extreme values, coordinate independence and final compression runs. Expected values are reasoned independently in the authoring data; no reference is called to generate expected answers.
- Hash tables preserve collision insertion order. Bird constructor tests accept either sensible parameter order because the original describes parameter values without prescribing positional order. Bird selection menus remain manually reviewed.
- The s25_42 stack files evaluate top-to-bottom in pop order, left-to-right: StackData gives 131; SecondStack gives 320. The PDF diagram was visually checked. The w25_43 row/column board diagram was also visually checked.
- File tests compare numeric lines/CSV fields and tolerate an optional final newline. The original s25_41 function tests now AST-load definitions, and no missing-file handler or pointer-reset convention is added to that paper. Required text attachments are copied exactly, including original line endings. No original student text source is synthetic. Tree.txt is collected as a generated output; s25_41 retains all six color outputs and their original empty initial files.

## 9618 Paper 4 · May/June 2025 · Paper 41

Cases: 22. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) Queue state | 2 | manual | Teacher checks the global array and the three initialised state variables. |
| 1(b) Enqueue and full boundary | 6 | auto | queue-25 (public), queue-first-and-full (hidden) |
| 1(c) Enqueue output | 3 | auto | queue-success-lines (public) |
| 1(d) Dequeue and wraparound | 6 | auto | queue-wrap (public), queue-empty (hidden) |
| 1(e)(i) Dequeue output | 2 | auto | queue-two-returns (public) |
| 1(e)(ii) Test evidence | 1 | evidence | Teacher reviews the saved run output. No screenshot upload is required. |
| ReadData: filename prompt and raw lines | 7 | auto | read-short-and-long-files (public) |
| SplitData: six colour arrays | 6 | auto | partition-six-colours (public) |
| StoreData: append and file errors | 5 | auto | append-and-handle-error (public) |
| Store all six colour arrays | 2 | auto | six-file-calls (hidden) |
| Main program | 3 | auto | original-supplied-data (public), short-file-run (hidden) |
| Run and file evidence | 2 | evidence | Teacher reviews the run record and the generated Red.txt content. Evidence marks do not block automatic AC. |
| 3(a)(i) Node and constructor | 4 | auto | node-initial-state (public) |
| 3(a)(ii) Get methods | 3 | auto | node-getters (public) |
| 3(a)(iii) Set methods | 3 | auto | node-setters (public) |
| 3(b) Five nodes in the main program | 2 | manual | Teacher checks that the main program creates Node objects containing 10, 20, 5, 15 and 7. |
| 3(c)(i) Tree and constructor | 2 | auto | tree-initial-root (public) |
| 3(c)(ii) GetRootNode | 1 | auto | tree-get-root (public) |
| 3(c)(iii) Insert a Node | 6 | auto | tree-links (public), tree-equal-right (hidden) |
| 3(d) Recursive OutputInOrder | 5 | auto | tree-inorder (public), tree-inorder-duplicate (hidden) |
| 3(e)(i) Build and output the tree | 3 | auto | tree-main (public) |
| 3(e)(ii) Test evidence | 1 | evidence | Teacher reviews the saved run output. No screenshot upload is required. |

Source checksums: {"qp": {"sha256": "bb3f54d2e359b707caafdd90be899cadac2bcb19889b6478fb8631a6921c5c68", "pages": 12}, "sf": {"sha256": "ebf10562b3585cec3cdcb8557fc13c78a25535aa7ea06121848ffdb81644a481"}, "ms": {"sha256": "6736744388fcec3c311d8d428197c2f7646c018cfe65404c7e08ff8546f47498", "pages": 43}}

## 9618 Paper 4 · May/June 2025 · Paper 42

Cases: 28. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 1(b) | 4 | auto | push-first-full (public), push-does-not-overwrite (hidden) |
| 1(c) | 4 | auto | pop-lifo-empty (public), pop-refill (hidden) |
| 1(d) | 6 | auto | read-file (public), read-overflow (hidden), read-exception (hidden) |
| 1(e) | 7 | auto | diagram-left-to-right (public), all-operators (hidden), division-noninteger (hidden) |
| 1(f)(i) | 2 | auto | stack-source (public), second-source (hidden) |
| 1(f)(ii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(b)(i) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 2(b)(ii) | 2 | auto | initialise (public) |
| 2(c) | 2 | auto | modulo-200 (public), large-key (hidden) |
| 2(d) | 6 | auto | collisions-next-spare (public), collision-index-199 (hidden) |
| 2(e) | 5 | auto | read-all-records (public), small-file (hidden) |
| 2(f)(i) | 2 | auto | print-only-used-spare (public) |
| 2(f)(ii) | 1 | auto | main-spare-keys (public) |
| 2(f)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(a)(i) | 4 | manual | Check Animal attributes, constructor parameters and Python declaration comments. |
| 3(a)(ii) | 3 | auto | animal-description (public), animal-different (hidden) |
| 3(b)(i) | 4 | manual | Check inheritance, parent constructor, new attributes and ChangeNumberWords. Behavioral updates are exercised in (b)(ii). |
| 3(b)(ii) | 2 | auto | parrot-add-words (public), parrot-negative-update (hidden) |
| 3(c)(i) | 4 | manual | Check Wolf inheritance, parent constructor and additive SetTerritorySize method. Updates are exercised in (c)(ii). |
| 3(c)(ii) | 2 | auto | wolf-add-territory (public), wolf-positive-update (hidden) |
| 3(d)(i) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 3(d)(ii) | 3 | auto | three-animals (public) |
| 3(d)(iii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |

Source checksums: {"qp": {"sha256": "bf1d0c138dd661eb307a1774053728b080548cdc9e817ed3d26a42d0f0d19f84", "pages": 12}, "sf": {"sha256": "fc395c3ecd93d24048d06230e7e4ee3f8d2fa0f53b2e2cd12bc2df2afa0afb7e"}, "ms": {"sha256": "25658284fa546f9c00abce84c55a1978bdac1c2c995da6f1110ba1a8172b86e0", "pages": 45}}

## 9618 Paper 4 · May/June 2025 · Paper 43

Cases: 23. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 1(b) | 6 | auto | enqueue-first-full (public), no-overwrite (hidden) |
| 1(c) | 5 | auto | dequeue-order-empty (public), dequeue-all-50 (hidden) |
| 1(d) | 6 | auto | queue-source (public), queue-overflow (hidden), queue-read-error (hidden) |
| 1(e)(i) | 5 | auto | original-file-total (public), different-file-total (hidden) |
| 1(e)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 2(b) | 5 | auto | sort-original (public), sort-duplicates-nonnegative (hidden), sort-already-ordered (hidden) |
| 2(c) | 2 | auto | array-one-line (public) |
| 2(d)(i) | 2 | auto | unsorted-then-sorted (public) |
| 2(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(e) | 6 | auto | paper-searches (public), search-other-fourteen (hidden) |
| 2(f)(i) | 2 | manual | Review four calls for 0, 345, 67 and 2, and appropriate found-index/not-found messages. |
| 2(f)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(a)(i) | 4 | manual | Teacher checks the source structure required by this subpart. |
| 3(a)(ii) | 3 | auto | node-getters (public) |
| 3(a)(iii) | 2 | auto | node-links (public) |
| 3(b)(i) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 3(b)(ii) | 4 | auto | head-insertion (public) |
| 3(b)(iii) | 3 | auto | traverse-empty-and-values (public) |
| 3(b)(iv) | 6 | auto | remove-middle-head-tail (public), only-first-duplicate (hidden) |
| 3(c)(i) | 3 | auto | paper-linked-list (public) |
| 3(c)(ii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |

Source checksums: {"qp": {"sha256": "21f1a713008edb1e4cd06242c942b02426deb9755e0c100b30774357f117f81e", "pages": 12}, "sf": {"sha256": "82b70a662ef520676114fb74f0bedd68497853e77ed3b37feef7a4331d0ce9ae"}, "ms": {"sha256": "f73823e54cd08b45d4533cc46c07b6ba8c6ffb26d9abd01ee0beae6b0839eba9", "pages": 45}}

## 9618 Paper 4 · October/November 2025 · Paper 41

Cases: 22. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 1(b) | 4 | auto | push-to-capacity (public), push-reuse (hidden) |
| 1(c) | 4 | auto | pop-lifo-sentinel (public) |
| 1(d) | 4 | manual | Review generation of at most 40 integers in 0..1000 inclusive, stopping after the first failed Push and outputting Stack full. Randomness has no mandated seed or library API. |
| 1(e) | 4 | auto | extrema-range-boundaries (public), extrema-single-item (hidden), extrema-all-positive (hidden) |
| 1(f)(i) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 1(f)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a)(i) | 4 | manual | Review private attributes, constructor and declaration comments. |
| 2(a)(ii) | 3 | auto | train-getters (public), train-different-values (hidden) |
| 2(b) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(c)(i) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 2(c)(ii) | 4 | auto | capacity-two (public), capacity-one (hidden) |
| 2(c)(iii) | 6 | auto | empty-station (public), station-description (public), full-keeps-first-train (hidden) |
| 2(d)(i) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(d)(ii) | 4 | auto | paper-stations (public) |
| 2(d)(iii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 3(b) | 2 | manual | Check independent 100x10 rows and empty/null record initialisation by InitialiseHashTable. |
| 3(c) | 2 | auto | hash-mod-100 (public) |
| 3(d) | 4 | auto | collision-buckets (public), tenth-collision (hidden) |
| 3(e) | 5 | auto | read-original-data (public), read-other-file (hidden) |
| 3(f) | 5 | auto | lookup-hit-and-miss (public), lookup-tenth-slot (hidden) |
| 3(g)(i) | 3 | auto | five-original-keys (public) |
| 3(g)(ii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |

Source checksums: {"sf": {"sha256": "822a48f31970cf3df6d484e98ab0b2b0cd915777412c73a51acc7bad5d2a6119"}, "qp": {"sha256": "9f116bcca315c075d1012b37e4eadb909b485853898b08ad32c21cecdac4145b", "pages": 12}, "ms": {"sha256": "1357b41babe7024a603d8c42a4b7298e42dc21baf100b168c22409b696bb3526", "pages": 36}}

## 9618 Paper 4 · October/November 2025 · Paper 42

Cases: 20. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a)(i) | 4 | manual | Check four private attributes, constructor parameters, 500.0 initial coordinates and declaration comments. |
| 1(a)(ii) | 2 | auto | species-name (public) |
| 1(a)(iii) | 3 | auto | initial-position (public) |
| 1(a)(iv) | 5 | auto | north-and-south (public), west-and-east (hidden), zero-and-maximum (hidden) |
| 1(b) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 1(c)(i) | 8 | manual | Review initial species/position outputs, choice of either bird, direction and minute inputs repeated until valid, Move call and meaningful updated-position output. The paper specifies no exact selection menu or prompt text. |
| 1(c)(ii) | 3 | evidence | Review four separate runs: Cockatiel N 60, Macaw S 30, Cockatiel W 30, Macaw E 60. |
| 2(a) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 2(b) | 3 | auto | print-array (public) |
| 2(c) | 5 | auto | bubble-reverse (public), bubble-short-and-duplicates (hidden) |
| 2(d)(i) | 3 | auto | random-main-output (public) |
| 2(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(e) | 6 | auto | recursive-binary-boundaries (public), empty-range-and-restricted-bounds (hidden) |
| 2(f)(i) | 3 | auto | random-smallest (public), random-largest (hidden), random-absent (hidden) |
| 2(f)(ii) | 2 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(a) | 3 | manual | Teacher checks the source structure required by this subpart. |
| 3(b) | 7 | auto | tree-parent-pointers (public), full-tree-boundary (hidden) |
| 3(c) | 4 | auto | original-tree-file (public) |
| 3(d) | 5 | auto | write-all-50-rows (public), write-error-handled (hidden) |
| 3(e)(i) | 1 | auto | main-writes-tree (public) |
| 3(e)(ii) | 1 | evidence | Review Tree.txt evidence showing all lines and the filename. |

Source checksums: {"sf": {"sha256": "f30a6947ae34b3078131036387e8c34ee4e15700183a3d15988f88f4827ead21"}, "qp": {"sha256": "42bae8891b7d9269f16fbf6630828b760ac1c585230e99040c88019d95f60a66", "pages": 12}, "ms": {"sha256": "5bfdaabc0844334ff8b1109a3347e1b26b7ba632e43f2de31b6afec2f148d2ab", "pages": 38}}

## 9618 Paper 4 · October/November 2025 · Paper 43

Cases: 29. Marks: 75.

| Original subpart | Marks | Mode | Cases / coverage |
| --- | ---: | --- | --- |
| 1(a)(i) | 5 | manual | Teacher checks the source structure required by this subpart. |
| 1(a)(ii) | 3 | auto | object-getters (public), empty-object (hidden) |
| 1(a)(iii) | 3 | manual | Check Object1..Object5 identifiers and original code/value pairs. |
| 1(b)(i) | 4 | manual | Teacher checks the source structure required by this subpart. |
| 1(b)(ii) | 2 | auto | empty-board-corners (public) |
| 1(b)(iii) | 2 | auto | set-row-column-independence (public), replace-and-boundaries (hidden) |
| 1(b)(iv) | 3 | auto | display-example-grid (public), display-empty-grid (hidden) |
| 1(c)(i) | 3 | auto | initial-five-objects (public) |
| 1(c)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 1(d)(i) | 4 | auto | specified-invalid-then-hit (public), valid-miss (hidden), upper-corner-hit (hidden) |
| 1(d)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 2(a) | 2 | manual | Teacher checks the source structure required by this subpart. |
| 2(b) | 5 | auto | enqueue-first-and-full (public) |
| 2(c) | 3 | auto | dequeue-fifo-string-sentinel (public), all-100-dequeue (hidden) |
| 2(d) | 5 | auto | read-source-bits (public), read-max-length (hidden) |
| 2(e) | 6 | auto | compression-example (public), single-run-nine (hidden), single-zero (hidden), alternating-bits (hidden) |
| 2(f)(i) | 2 | auto | original-compression (public), changed-bits (hidden) |
| 2(f)(ii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(a)(i) | 6 | auto | recursive-original (public), recursive-empty-and-all (hidden) |
| 3(a)(ii) | 3 | auto | original-count (public) |
| 3(a)(iii) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |
| 3(b)(i) | 1 | manual | Teacher checks the source structure required by this subpart. |
| 3(b)(ii) | 6 | auto | split-original (public), split-different-statements (hidden), split-preserves-spaces (hidden) |
| 3(b)(iii) | 2 | auto | four-output-lines (public) |
| 3(b)(iv) | 1 | evidence | Teacher reviews saved execution and original requested evidence. |

Source checksums: {"sf": {"sha256": "83cca7ac371e7b135ed0ce6bd1992128436e8088af724986aa769746fdfc4656"}, "qp": {"sha256": "58c20a3d8f887d80293640868f86470f1d5a10f0e5ce42da4f05a54464c79d2d", "pages": 16}, "ms": {"sha256": "18afbd54b5996ee5e98d1e77f8389950beda55f31df73043e9360658e8ef87c8", "pages": 39}}

# 2024 Cambridge 9618 Paper 4 classroom package coverage

The six manifests preserve the original Q1–Q3 subparts and exactly 75 marks per paper. They are classroom adaptations of the user-supplied question papers, marking schemes and candidate text files. Teacher reference programs are editable and self-contained. No deployment, seeding, account changes or publication is part of this content build.

## Reproduction and source fidelity

Run `python3 authoring.py` in this directory to regenerate all six JSON manifests from `sources.json`. `common.py` contains the manifest, AST-loader and integration-case helpers. The builder parses the Python references and drivers for syntax but never executes them. `sources.json` preserves the original text-file contents, PDF/ZIP SHA-256 inventory as provenance; the original PDFs are not needed to rebuild the manifests.

For both sessions, the extracted question-paper bodies from page 2 onward are identical between variants 41 and 43 after whitespace and variant-header normalisation. Every candidate text file is also byte-for-byte identical between those paired variants. Their manifests retain their separate variant identities and provenance. Variant 42 is separately authored.

Input files are under each relevant question’s `initialFiles`; none of these papers requires writing a candidate output file, so `outputFiles` is empty. No PDF, evidence.doc or invented dataset is included as a student text asset.

## Stage maps

Each row is one original subpart, with its original mark value. `auto` checks observable functionality and does not award structural marks automatically. Teachers still review the specified algorithm, encapsulation, inheritance, declarations and program flow. `manual` handles source requirements and flexible output wording; `evidence` represents the original screenshots using saved run output.

### 9618 Paper 4 · May/June 2024 · Paper 41

File: `9618_s24_41.json`. Total: 75 marks; 21 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) Array state | 1 | manual | 0 |
| 1(b) Validated Initialise | 5 | auto | 3 |
| 1(c)(i) Initial main output | 2 | manual | 0 |
| 1(c)(ii) Invalid quantity evidence | 2 | evidence | 0 |
| 1(d)(i) BubbleSort | 4 | auto | 2 |
| 1(d)(ii) Sorted main output | 1 | manual | 0 |
| 1(d)(iii) Sort evidence | 1 | evidence | 0 |
| 1(e)(i) Iterative BinarySearch | 6 | auto | 2 |
| 1(e)(ii) Main search | 3 | manual | 0 |
| 1(e)(iii) Two search runs | 2 | evidence | 0 |
| 2(a)(i) Tree constructor and privacy | 4 | manual | 0 |
| 2(a)(ii) Tree getters | 3 | auto | 3 |
| 2(b) ReadData | 7 | auto | 2 |
| 2(c) PrintTrees messages | 4 | auto | 2 |
| 2(d)(i) First tree main output | 2 | manual | 0 |
| 2(d)(ii) Evidence | 1 | evidence | 0 |
| 2(e)(i) Filter matching trees | 6 | manual | 0 |
| 2(e)(ii) Growth years | 2 | manual | 0 |
| 2(e)(iii) Required selection run | 2 | evidence | 0 |
| 3(a) Initial queue | 1 | manual | 0 |
| 3(b) Enqueue | 4 | auto | 3 |
| 3(c) Dequeue | 3 | auto | 2 |
| 3(d)(i) Check digit and StoreItems | 6 | auto | 2 |
| 3(d)(ii) Main dequeue | 1 | manual | 0 |
| 3(d)(iii) Evidence | 2 | evidence | 0 |

Input files: `Trees.txt` (9 lines).

### 9618 Paper 4 · May/June 2024 · Paper 42

File: `9618_s24_42.json`. Total: 75 marks; 21 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) ReadWords and answer count | 6 | auto | 3 |
| 1(b) Difficulty selection | 4 | manual | 0 |
| 1(c)(i) Play and remove correct answers | 6 | auto | 2 |
| 1(c)(ii) Percentage and missed answers | 3 | manual | 0 |
| 1(d)(i) ReadWords calls Play | 1 | manual | 0 |
| 1(d)(ii) Easy evidence | 1 | evidence | 0 |
| 1(d)(iii) Hard evidence | 1 | evidence | 0 |
| 2(a)(i) Node constructor | 4 | manual | 0 |
| 2(a)(ii) Node getters | 3 | auto | 3 |
| 2(a)(iii) Node setters | 3 | auto | 2 |
| 2(b)(i) TreeClass constructor | 4 | manual | 0 |
| 2(b)(ii) InsertNode and tree links | 6 | auto | 2 |
| 2(b)(iii) OutputTree | 4 | auto | 2 |
| 2(c)(i) TheTree instance | 1 | manual | 0 |
| 2(c)(ii) Seven insertions | 4 | manual | 0 |
| 2(c)(iii) Evidence | 1 | evidence | 0 |
| 3(a) Original local data | 1 | manual | 0 |
| 3(b)(i) RecursiveInsertion | 4 | auto | 3 |
| 3(b)(ii) Recursive main output | 2 | manual | 0 |
| 3(b)(iii) Evidence | 1 | evidence | 0 |
| 3(c)(i) IterativeInsertion | 4 | auto | 2 |
| 3(c)(ii) Iterative main output | 1 | manual | 0 |
| 3(c)(iii) Evidence | 1 | evidence | 0 |
| 3(d)(i) Recursive BinarySearch | 6 | auto | 2 |
| 3(d)(ii) Search main output | 2 | manual | 0 |
| 3(d)(iii) Evidence | 1 | evidence | 0 |

Input files: `Easy.txt` (15 lines), `Hard.txt` (98 lines), `Medium.txt` (45 lines).

### 9618 Paper 4 · May/June 2024 · Paper 43

File: `9618_s24_43.json`. Total: 75 marks; 21 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) Array state | 1 | manual | 0 |
| 1(b) Validated Initialise | 5 | auto | 3 |
| 1(c)(i) Initial main output | 2 | manual | 0 |
| 1(c)(ii) Invalid quantity evidence | 2 | evidence | 0 |
| 1(d)(i) BubbleSort | 4 | auto | 2 |
| 1(d)(ii) Sorted main output | 1 | manual | 0 |
| 1(d)(iii) Sort evidence | 1 | evidence | 0 |
| 1(e)(i) Iterative BinarySearch | 6 | auto | 2 |
| 1(e)(ii) Main search | 3 | manual | 0 |
| 1(e)(iii) Two search runs | 2 | evidence | 0 |
| 2(a)(i) Tree constructor and privacy | 4 | manual | 0 |
| 2(a)(ii) Tree getters | 3 | auto | 3 |
| 2(b) ReadData | 7 | auto | 2 |
| 2(c) PrintTrees messages | 4 | auto | 2 |
| 2(d)(i) First tree main output | 2 | manual | 0 |
| 2(d)(ii) Evidence | 1 | evidence | 0 |
| 2(e)(i) Filter matching trees | 6 | manual | 0 |
| 2(e)(ii) Growth years | 2 | manual | 0 |
| 2(e)(iii) Required selection run | 2 | evidence | 0 |
| 3(a) Initial queue | 1 | manual | 0 |
| 3(b) Enqueue | 4 | auto | 3 |
| 3(c) Dequeue | 3 | auto | 2 |
| 3(d)(i) Check digit and StoreItems | 6 | auto | 2 |
| 3(d)(ii) Main dequeue | 1 | manual | 0 |
| 3(d)(iii) Evidence | 2 | evidence | 0 |

Input files: `Trees.txt` (9 lines).

### 9618 Paper 4 · October/November 2024 · Paper 41

File: `9618_w24_41.json`. Total: 75 marks; 24 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) ReadData | 6 | auto | 3 |
| 1(b)(i) FormatArray | 2 | auto | 2 |
| 1(b)(ii) Unsorted main output | 3 | manual | 0 |
| 1(b)(iii) Evidence | 1 | evidence | 0 |
| 1(c) Character comparison | 4 | auto | 2 |
| 1(d)(i) Bubble | 3 | auto | 2 |
| 1(d)(ii) Sorted main output | 2 | manual | 0 |
| 1(d)(iii) Evidence | 1 | evidence | 0 |
| 2(a)(i) Horse constructor/privacy | 4 | manual | 0 |
| 2(a)(ii) Horse getters | 3 | auto | 3 |
| 2(b)(i) Beauty and Jet objects | 5 | manual | 0 |
| 2(b)(ii) Evidence | 1 | evidence | 0 |
| 2(c)(i) Fence constructor and getters | 4 | auto | 2 |
| 2(c)(ii) Four validated fences | 5 | manual | 0 |
| 2(d) Success calculation | 5 | auto | 2 |
| 2(e)(i) Eight individual chances | 3 | manual | 0 |
| 2(e)(ii) Averages and winner | 2 | manual | 0 |
| 2(e)(iii) Evidence | 2 | evidence | 0 |
| 3(a) Linked/free list initialisation | 2 | manual | 0 |
| 3(b) Five front insertions | 6 | auto | 3 |
| 3(c)(i) Follow occupied links | 2 | auto | 2 |
| 3(c)(ii) Insert/output main | 1 | manual | 0 |
| 3(c)(iii) Evidence | 1 | evidence | 0 |
| 3(d)(i) Remove and recycle first match | 5 | auto | 3 |
| 3(d)(ii) After main output | 1 | manual | 0 |
| 3(d)(iii) Two removal runs | 1 | evidence | 0 |

Input files: `Data.txt` (45 lines).

### 9618 Paper 4 · October/November 2024 · Paper 42

File: `9618_w24_42.json`. Total: 75 marks; 19 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) EventItem constructor/privacy | 4 | manual | 0 |
| 1(a)(ii) Event getters | 3 | auto | 3 |
| 1(b)(i) Group declaration | 1 | manual | 0 |
| 1(b)(ii) Five event objects | 3 | manual | 0 |
| 1(c) Character constructor/getter/privacy | 4 | manual | 0 |
| 1(d) CalculateScore | 4 | auto | 2 |
| 1(e)(i) Tarz and Geni objects | 2 | manual | 0 |
| 1(e)(ii) Event and group winners | 7 | manual | 0 |
| 1(e)(iii) Evidence | 1 | evidence | 0 |
| 2(a) Queue record fields | 3 | manual | 0 |
| 2(b) TheQueue initialisation | 3 | manual | 0 |
| 2(c) Enqueue | 5 | auto | 3 |
| 2(d) ReturnAllData | 3 | auto | 2 |
| 2(e)(i) Validated ten inputs | 5 | manual | 0 |
| 2(e)(ii) Input evidence | 2 | evidence | 0 |
| 2(f) Dequeue | 4 | auto | 2 |
| 2(g)(i) Two dequeues and remaining values | 3 | manual | 0 |
| 2(g)(ii) Evidence | 1 | evidence | 0 |
| 3(a) Local string array | 2 | manual | 0 |
| 3(b) ReadData and exception handling | 5 | auto | 3 |
| 3(c) OutputHighScores | 2 | auto | 2 |
| 3(d) SortScores two numeric keys | 4 | auto | 2 |
| 3(e)(i) Before/After main output | 2 | manual | 0 |
| 3(e)(ii) Evidence | 2 | evidence | 0 |

Input files: `HighScoreTable.txt` (21 lines).

### 9618 Paper 4 · October/November 2024 · Paper 43

File: `9618_w24_43.json`. Total: 75 marks; 24 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) ReadData | 6 | auto | 3 |
| 1(b)(i) FormatArray | 2 | auto | 2 |
| 1(b)(ii) Unsorted main output | 3 | manual | 0 |
| 1(b)(iii) Evidence | 1 | evidence | 0 |
| 1(c) Character comparison | 4 | auto | 2 |
| 1(d)(i) Bubble | 3 | auto | 2 |
| 1(d)(ii) Sorted main output | 2 | manual | 0 |
| 1(d)(iii) Evidence | 1 | evidence | 0 |
| 2(a)(i) Horse constructor/privacy | 4 | manual | 0 |
| 2(a)(ii) Horse getters | 3 | auto | 3 |
| 2(b)(i) Beauty and Jet objects | 5 | manual | 0 |
| 2(b)(ii) Evidence | 1 | evidence | 0 |
| 2(c)(i) Fence constructor and getters | 4 | auto | 2 |
| 2(c)(ii) Four validated fences | 5 | manual | 0 |
| 2(d) Success calculation | 5 | auto | 2 |
| 2(e)(i) Eight individual chances | 3 | manual | 0 |
| 2(e)(ii) Averages and winner | 2 | manual | 0 |
| 2(e)(iii) Evidence | 2 | evidence | 0 |
| 3(a) Linked/free list initialisation | 2 | manual | 0 |
| 3(b) Five front insertions | 6 | auto | 3 |
| 3(c)(i) Follow occupied links | 2 | auto | 2 |
| 3(c)(ii) Insert/output main | 1 | manual | 0 |
| 3(c)(iii) Evidence | 1 | evidence | 0 |
| 3(d)(i) Remove and recycle first match | 5 | auto | 3 |
| 3(d)(ii) After main output | 1 | manual | 0 |
| 3(d)(iii) Two removal runs | 1 | evidence | 0 |

Input files: `Data.txt` (45 lines).

## Test design and compatibility

- Every automatic stage has a public example and a hidden boundary or changed-data case. All stages stay within 12 cases and every paper stays within 50 cases.
- Drivers load imports, definitions and safe global declarations using AST. They do not invoke the candidate’s main program for interface cases. Supplemental cases separately run the entire program with the original inputs, capture prompts and observe the required outputs. Numeric main observations match the required result sequence or multiset while tolerating additional prompt text and displayed rounding; interface-result comparisons remain exact. No `__main__` guard is required from students.
- Interface failures produce a fixed failure sentinel rather than a teacher-driver traceback. The sentinel never matches an expected result.
- Whole-program cases compare actual observed output (numeric values, original literal messages or the required result words), not a constant success marker. Manual stages retain responsibility for source structure and appropriate output wording.
- Employee constructors accept both table-order arguments and the employee-number-first ordering shown in the original marking scheme. SaleData accepts either `ID` or the scheme’s `SaleID` field and normal record constructor styles. Date-bearing Character tests accept common date objects and string forms. IterativeInsertion accepts an explicit item count or a count derived from the array.
- Linear queues are tested for their stated non-circular capacity; circular sales queues are tested for wraparound and reuse. Stacks cover LIFO, full/empty limits and rollback when one paired stack is empty. Search/sort cases cover occupied prefixes, absent values, duplicates where allowed and numeric rather than lexicographic ordering.

## Source-specific notes

- May/June 41/43: the check digit is floor(weighted sum / 10), with 10 represented by X; it is not the more usual modulo/complement algorithm. The original ten inputs yield six valid records and four invalid records. ChooseTree’s final instruction has the source typo ChooseTrees; the package accepts the stated ChooseTree interface. The growth example permits fractional years; the original scheme also accepts rounded 3/4 years for the 3.75-year Blue Conifer result.
- May/June 42: NumberWords follows the question prose as the answer count, excluding the main word; the published Python example sometimes stores the complete array length and subtracts one at use sites. Teachers should judge the observed answer count and percentage consistently. Play’s first-array-element storage is not constrained by the tests. IterativeInsertion’s item-count parameter is accepted in the marking-scheme style or derived internally. Binary-tree output is physical insertion order, not in-order traversal.
- October/November 41/43: CompareStrings cases obey the source assumption that a differing character occurs before either word ends; no equal-string or prefix requirement has been invented. Horse.Success checks height before risk. Linked-list removal removes only the first matching occupied node and returns it to the free chain; it does not require clearing the old data value.
- October/November 42: the queue field spellings Headpointer/HeadPointer and Tailpointer/TailPointer are both supported by the adapter; global-record and explicit-record function styles and Python tuple returns are accepted. Dequeue must not erase backing-array data. High scores remain strings but their two sort keys are compared numerically.

## Validation record

The parent task’s parser and isolated judge are the authoritative runtime validation path. Reports are stored in `.campus-local/paper4-pastpapers-validation/<paper-key>.json` with the exact manifest SHA-256 and run time. Run `node scripts/validate-paper4-pastpapers.mjs --year=2024` from the repository root to repeat all reference and blank-answer-control checks. Successful reports require all three questions AC and no automatically accepted blank-answer stage. The builder’s AST checks are separate from those runtime checks; no candidate or reference program is run on the host, API or web process.

## Final fairness audit

Hidden cases retain the original array capacities, known file lengths and record shapes. Smaller occupancies remain only where the abstract stack, queue or tree interface explicitly permits them. Empty/full conditions and invalid inputs are tested only where the original operation defines their handling. Constructor order, record field spelling, date representation and optional array-count styles are adapted where the original permits them. Prompt-bearing API checks inspect state after capturing prompts, and supplemental main checks allow separate printed prompts, without requiring `input(prompt)` or a main guard.

- May/June 41/43: DataStored retains capacity 20 and changed Trees input retains all nine CSV rows.
- May/June 42: word-game cases use the supplied Easy/Hard datasets and their complete answer arrays; insertion/search arrays retain seven items.
- October/November 41/43: FormatArray and Bubble use 45 strings; the near-full linked-list case contains 19 valid occupied nodes and one free node before insertion.
- October/November 42: HighScores remains seven-by-three for reading, output and sorting; all skill, risk and difficulty tests stay in the stated ranges.

The final audit also runs valid fixed-size implementations and separately printed prompts through all 24 distinct question sets (41/43 share the verified task/data). Reproduce this additional 175-case check from the repository root with `node content/paper4-pastpapers/2023/check-fairness.mjs`. It sends source variants only to the existing isolated judge and stores current-hash results in `.campus-local/paper4-pastpapers-validation/fairness-style-probes-2023-2024.json`. These style probes supplement, rather than replace, the per-manifest reference and blank-control reports.

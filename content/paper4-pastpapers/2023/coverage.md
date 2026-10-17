# 2023 Cambridge 9618 Paper 4 classroom package coverage

The six manifests preserve the original Q1–Q3 subparts and exactly 75 marks per paper. They are classroom adaptations of the user-supplied question papers, marking schemes and candidate text files. Teacher reference programs are editable and self-contained. No deployment, seeding, account changes or publication is part of this content build.

## Reproduction and source fidelity

Run `python3 authoring.py` in this directory to regenerate all six JSON manifests from `sources.json`. `common.py` contains the manifest, AST-loader and integration-case helpers. The builder parses the Python references and drivers for syntax but never executes them. `sources.json` preserves the original text-file contents, PDF/ZIP SHA-256 inventory as provenance; the original PDFs are not needed to rebuild the manifests.

For both sessions, the extracted question-paper bodies from page 2 onward are identical between variants 41 and 43 after whitespace and variant-header normalisation. Every candidate text file is also byte-for-byte identical between those paired variants. Their manifests retain their separate variant identities and provenance. Variant 42 is separately authored.

Input files are under each relevant question’s `initialFiles`; none of these papers requires writing a candidate output file, so `outputFiles` is empty. No PDF, evidence.doc or invented dataset is included as a student text asset.

## Stage maps

Each row is one original subpart, with its original mark value. `auto` checks observable functionality and does not award structural marks automatically. Teachers still review the specified algorithm, encapsulation, inheritance, declarations and program flow. `manual` handles source requirements and flexible output wording; `evidence` represents the original screenshots using saved run output.

### 9618 Paper 4 · May/June 2023 · Paper 41

File: `9618_s23_41.json`. Total: 75 marks; 24 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) Local array | 1 | manual | 0 |
| 1(a)(ii) Read 25 integers | 4 | manual | 0 |
| 1(b)(i) PrintArray | 3 | auto | 3 |
| 1(b)(ii) Print main array | 1 | manual | 0 |
| 1(b)(iii) Initial run | 1 | evidence | 0 |
| 1(c) LinearSearch | 3 | auto | 2 |
| 1(d)(i) Validated search main program | 4 | manual | 0 |
| 1(d)(ii) Search 12 evidence | 1 | evidence | 0 |
| 2(a)(i) Vehicle constructor and privacy | 5 | manual | 0 |
| 2(a)(ii) Vehicle getters | 3 | auto | 3 |
| 2(a)(iii) Vehicle setters | 3 | auto | 2 |
| 2(a)(iv) Vehicle speed update | 3 | auto | 2 |
| 2(b)(i) Helicopter constructor and inheritance | 5 | manual | 0 |
| 2(b)(ii) Helicopter speed update | 4 | auto | 2 |
| 2(c) Output procedure | 3 | manual | 0 |
| 2(d)(i) Required main program | 5 | manual | 0 |
| 2(d)(ii) Run evidence | 1 | evidence | 0 |
| 3(a) Stack initialisation | 3 | manual | 0 |
| 3(b)(i) PushAnimal | 3 | auto | 3 |
| 3(b)(ii) PopAnimal | 3 | auto | 2 |
| 3(b)(iii) Read animal file and exception handling | 5 | manual | 0 |
| 3(b)(iv) Colour stack functions | 2 | auto | 2 |
| 3(b)(v) Read colour file and exception handling | 2 | manual | 0 |
| 3(c) Output and rollback | 5 | auto | 3 |
| 3(d)(i) Read and output four items | 1 | manual | 0 |
| 3(d)(ii) Run evidence | 1 | evidence | 0 |

Input files: `Data.txt` (25 lines), `AnimalData.txt` (8 lines), `ColourData.txt` (10 lines).

### 9618 Paper 4 · May/June 2023 · Paper 42

File: `9618_s23_42.json`. Total: 75 marks; 20 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a) Array declaration | 2 | manual | 0 |
| 1(b) Original animal data | 2 | manual | 0 |
| 1(c) Descending first-character bubble sort | 6 | auto | 3 |
| 1(d)(i) Main sort and output | 3 | manual | 0 |
| 1(d)(ii) Evidence | 1 | evidence | 0 |
| 2(a) SaleData record | 2 | manual | 0 |
| 2(b) Circular queue state | 4 | manual | 0 |
| 2(c) Enqueue | 6 | auto | 3 |
| 2(d) Dequeue | 6 | auto | 3 |
| 2(e) Input and enqueue messages | 5 | manual | 0 |
| 2(f)(i) Original record sequence | 4 | manual | 0 |
| 2(f)(ii) Evidence | 1 | evidence | 0 |
| 3(a)(i) Employee constructor | 5 | manual | 0 |
| 3(a)(ii) Employee number getter | 2 | auto | 3 |
| 3(a)(iii) SetPay | 3 | auto | 2 |
| 3(a)(iv) Annual total | 2 | auto | 2 |
| 3(b)(i) Manager constructor | 4 | manual | 0 |
| 3(b)(ii) Manager bonus | 3 | auto | 2 |
| 3(c) Read and instantiate eight employees | 7 | manual | 0 |
| 3(d) Read hours and match employee | 4 | auto | 2 |
| 3(e)(i) Main totals | 2 | manual | 0 |
| 3(e)(ii) Evidence | 1 | evidence | 0 |

Input files: `Employees.txt` (28 lines), `HoursWeek1.txt` (16 lines).

### 9618 Paper 4 · May/June 2023 · Paper 43

File: `9618_s23_43.json`. Total: 75 marks; 24 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) Local array | 1 | manual | 0 |
| 1(a)(ii) Read 25 integers | 4 | manual | 0 |
| 1(b)(i) PrintArray | 3 | auto | 3 |
| 1(b)(ii) Print main array | 1 | manual | 0 |
| 1(b)(iii) Initial run | 1 | evidence | 0 |
| 1(c) LinearSearch | 3 | auto | 2 |
| 1(d)(i) Validated search main program | 4 | manual | 0 |
| 1(d)(ii) Search 12 evidence | 1 | evidence | 0 |
| 2(a)(i) Vehicle constructor and privacy | 5 | manual | 0 |
| 2(a)(ii) Vehicle getters | 3 | auto | 3 |
| 2(a)(iii) Vehicle setters | 3 | auto | 2 |
| 2(a)(iv) Vehicle speed update | 3 | auto | 2 |
| 2(b)(i) Helicopter constructor and inheritance | 5 | manual | 0 |
| 2(b)(ii) Helicopter speed update | 4 | auto | 2 |
| 2(c) Output procedure | 3 | manual | 0 |
| 2(d)(i) Required main program | 5 | manual | 0 |
| 2(d)(ii) Run evidence | 1 | evidence | 0 |
| 3(a) Stack initialisation | 3 | manual | 0 |
| 3(b)(i) PushAnimal | 3 | auto | 3 |
| 3(b)(ii) PopAnimal | 3 | auto | 2 |
| 3(b)(iii) Read animal file and exception handling | 5 | manual | 0 |
| 3(b)(iv) Colour stack functions | 2 | auto | 2 |
| 3(b)(v) Read colour file and exception handling | 2 | manual | 0 |
| 3(c) Output and rollback | 5 | auto | 3 |
| 3(d)(i) Read and output four items | 1 | manual | 0 |
| 3(d)(ii) Run evidence | 1 | evidence | 0 |

Input files: `Data.txt` (25 lines), `AnimalData.txt` (8 lines), `ColourData.txt` (10 lines).

### 9618 Paper 4 · October/November 2023 · Paper 41

File: `9618_w23_41.json`. Total: 75 marks; 25 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) Iterative vowel count | 5 | auto | 3 |
| 1(a)(ii) House main call | 2 | manual | 0 |
| 1(a)(iii) Evidence | 1 | evidence | 0 |
| 1(b)(i) Recursive vowel count | 6 | auto | 2 |
| 1(b)(ii) Imagine main call | 1 | manual | 0 |
| 1(b)(iii) Evidence | 1 | evidence | 0 |
| 2(a)(i) Queue declarations | 2 | manual | 0 |
| 2(a)(ii) Enqueue | 4 | auto | 3 |
| 2(a)(iii) Dequeue | 4 | auto | 2 |
| 2(b) ReadData | 6 | auto | 2 |
| 2(c)(i) RecordData | 2 | manual | 0 |
| 2(c)(ii) Records state | 2 | manual | 0 |
| 2(c)(iii) TotalData | 5 | auto | 2 |
| 2(d) OutputRecords | 1 | auto | 2 |
| 2(e)(i) Main processing loop | 2 | manual | 0 |
| 2(e)(ii) Evidence | 1 | evidence | 0 |
| 3(a)(i) Character constructor | 4 | manual | 0 |
| 3(a)(ii) Get coordinates | 3 | auto | 3 |
| 3(a)(iii) Add and clamp coordinates | 4 | auto | 2 |
| 3(a)(iv) Move Character | 4 | auto | 2 |
| 3(b) Jack instance | 2 | manual | 0 |
| 3(c)(i) Bike inheritance | 3 | manual | 0 |
| 3(c)(ii) Move BikeCharacter | 2 | auto | 2 |
| 3(d) Karla instance | 1 | manual | 0 |
| 3(e)(i) Validated selection main program | 5 | manual | 0 |
| 3(e)(ii) Two runs | 2 | evidence | 0 |

Input files: `QueueData.txt` (23 lines).

### 9618 Paper 4 · October/November 2023 · Paper 42

File: `9618_w23_42.json`. Total: 75 marks; 21 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) Arrays | 2 | manual | 0 |
| 1(a)(ii) Pointers | 1 | manual | 0 |
| 1(b)(i) PushData routing and capacity | 6 | auto | 3 |
| 1(b)(ii) ReadData and exception handler | 6 | auto | 2 |
| 1(c) Pop functions | 5 | auto | 2 |
| 1(d)(i) Five successful letters | 6 | manual | 0 |
| 1(d)(ii) Evidence | 1 | evidence | 0 |
| 2(a)(i) IterativeCalculate | 5 | auto | 3 |
| 2(a)(ii) Call with 10 | 2 | manual | 0 |
| 2(a)(iii) Evidence | 1 | evidence | 0 |
| 2(b)(i) RecursiveValue | 7 | auto | 2 |
| 2(b)(ii) Call with 50,50 | 1 | manual | 0 |
| 2(b)(iii) Evidence | 1 | evidence | 0 |
| 3(a)(i) Character constructor | 5 | manual | 0 |
| 3(a)(ii) Get methods | 3 | auto | 3 |
| 3(a)(iii) Set intelligence | 2 | auto | 2 |
| 3(a)(iv) Learn 10 percent | 1 | auto | 2 |
| 3(a)(v) Fixed 2023 age | 2 | manual | 0 |
| 3(b)(i) Royal object | 2 | manual | 0 |
| 3(b)(ii) Royal learning output | 3 | manual | 0 |
| 3(b)(iii) Evidence | 1 | evidence | 0 |
| 3(c)(i) Magic constructor | 5 | manual | 0 |
| 3(c)(ii) Element learning | 3 | auto | 2 |
| 3(d)(i) Light object | 2 | manual | 0 |
| 3(d)(ii) Light learning output | 1 | manual | 0 |
| 3(d)(iii) Evidence | 1 | evidence | 0 |

Input files: `StackData.txt` (100 lines).

### 9618 Paper 4 · October/November 2023 · Paper 43

File: `9618_w23_43.json`. Total: 75 marks; 25 cases; three full-program integration cases (one for each question).

| Original subpart / requirement | Marks | Mode | Cases |
| --- | ---: | --- | ---: |
| 1(a)(i) Iterative vowel count | 5 | auto | 3 |
| 1(a)(ii) House main call | 2 | manual | 0 |
| 1(a)(iii) Evidence | 1 | evidence | 0 |
| 1(b)(i) Recursive vowel count | 6 | auto | 2 |
| 1(b)(ii) Imagine main call | 1 | manual | 0 |
| 1(b)(iii) Evidence | 1 | evidence | 0 |
| 2(a)(i) Queue declarations | 2 | manual | 0 |
| 2(a)(ii) Enqueue | 4 | auto | 3 |
| 2(a)(iii) Dequeue | 4 | auto | 2 |
| 2(b) ReadData | 6 | auto | 2 |
| 2(c)(i) RecordData | 2 | manual | 0 |
| 2(c)(ii) Records state | 2 | manual | 0 |
| 2(c)(iii) TotalData | 5 | auto | 2 |
| 2(d) OutputRecords | 1 | auto | 2 |
| 2(e)(i) Main processing loop | 2 | manual | 0 |
| 2(e)(ii) Evidence | 1 | evidence | 0 |
| 3(a)(i) Character constructor | 4 | manual | 0 |
| 3(a)(ii) Get coordinates | 3 | auto | 3 |
| 3(a)(iii) Add and clamp coordinates | 4 | auto | 2 |
| 3(a)(iv) Move Character | 4 | auto | 2 |
| 3(b) Jack instance | 2 | manual | 0 |
| 3(c)(i) Bike inheritance | 3 | manual | 0 |
| 3(c)(ii) Move BikeCharacter | 2 | auto | 2 |
| 3(d) Karla instance | 1 | manual | 0 |
| 3(e)(i) Validated selection main program | 5 | manual | 0 |
| 3(e)(ii) Two runs | 2 | evidence | 0 |

Input files: `QueueData.txt` (23 lines).

## Test design and compatibility

- Every automatic stage has a public example and a hidden boundary or changed-data case. All stages stay within 12 cases and every paper stays within 50 cases.
- Drivers load imports, definitions and safe global declarations using AST. They do not invoke the candidate’s main program for interface cases. Supplemental cases separately run the entire program with the original inputs, capture prompts and observe the required outputs. Numeric main observations match the required result sequence or multiset while tolerating additional prompt text and displayed rounding; interface-result comparisons remain exact. No `__main__` guard is required from students.
- Interface failures produce a fixed failure sentinel rather than a teacher-driver traceback. The sentinel never matches an expected result.
- Whole-program cases compare actual observed output (numeric values, original literal messages or the required result words), not a constant success marker. Manual stages retain responsibility for source structure and appropriate output wording.
- Employee constructors accept both table-order arguments and the employee-number-first ordering shown in the original marking scheme. SaleData accepts either `ID` or the scheme’s `SaleID` field and normal record constructor styles. Date-bearing Character tests accept common date objects and string forms. IterativeInsertion accepts an explicit item count or a count derived from the array.
- Linear queues are tested for their stated non-circular capacity; circular sales queues are tested for wraparound and reuse. Stacks cover LIFO, full/empty limits and rollback when one paired stack is empty. Search/sort cases cover occupied prefixes, absent values, duplicates where allowed and numeric rather than lexicographic ordering.

## Source-specific notes

- May/June 41/43: Q1 reads the original 25 values and reports four occurrences of 12. Q2 caps both speed and height and uses the updated speed for horizontal displacement. Q3 restores an animal/colour if the other stack is empty; ReadData exception handling is reviewed in source.
- May/June 42: descending animals use only the first character, preserving equal-initial order through adjacent swaps. Sales output uses physical circular-array order after the second LLP insertion. Weekly pay uses week 1 at array index 0 and replaces a week’s previous value; employee-file parsing preserves numbers with leading zeroes.
- October/November 41/43: vowel matching counts lower-case vowels only. Record totals preserve first-seen ID order. Position setters add deltas and clamp to 0..10000; BikeCharacter moves by 20.
- October/November 42: stack choices count only successfully returned letters. RecursiveValue honours both arguments, including the zero base case. Character ages intentionally use the paper’s fixed year 2023, not the current year; date representation and age calculations are manually reviewed.

## Validation record

The parent task’s parser and isolated judge are the authoritative runtime validation path. Reports are stored in `.campus-local/paper4-pastpapers-validation/<paper-key>.json` with the exact manifest SHA-256 and run time. Run `node scripts/validate-paper4-pastpapers.mjs --year=2023` from the repository root to repeat all reference and blank-answer-control checks. Successful reports require all three questions AC and no automatically accepted blank-answer stage. The builder’s AST checks are separate from those runtime checks; no candidate or reference program is run on the host, API or web process.

## Final fairness audit

Hidden cases retain the original array capacities, known file lengths and record shapes. Smaller occupancies remain only where the abstract stack, queue or tree interface explicitly permits them. Empty/full conditions and invalid inputs are tested only where the original operation defines their handling. Constructor order, record field spelling, date representation and optional array-count styles are adapted where the original permits them. Prompt-bearing API checks inspect state after capturing prompts, and supplemental main checks allow separate printed prompts, without requiring `input(prompt)` or a main guard.

- May/June 41/43: PrintArray and LinearSearch receive 25 integers; search values stay in 0..100.
- May/June 42: Animals has 10 names; sales quantities are positive; EnterHours uses eight employee objects and eight employee/hour pairs.
- October/November 41/43: changed QueueData input retains 23 game-ID lines.
- October/November 42: changed StackData input retains 100 lower-case letters.

The final audit also runs valid fixed-size implementations and separately printed prompts through all 24 distinct question sets (41/43 share the verified task/data). Reproduce this additional 175-case check from the repository root with `node content/paper4-pastpapers/2023/check-fairness.mjs`. It sends source variants only to the existing isolated judge and stores current-hash results in `.campus-local/paper4-pastpapers-validation/fairness-style-probes-2023-2024.json`. These style probes supplement, rather than replace, the per-manifest reference and blank-control reports.

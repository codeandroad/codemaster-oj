// Generates a fully self-contained JSON manifest and an equivalent ZIP.
// Classroom adaptation of the user-supplied 9618/41 paper; preserve original subparts and marks.
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOriginalQ2 } from './q2-original.mjs';
import { q3Original } from './q3-original.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const source = async name => readFile(join(dir, name), 'utf8');
const [q1, q2, q3, q2Original] = await Promise.all([
  source('Q1-reference.py'), source('Q2-reference.py'), source('Q3-reference.py'), buildOriginalQ2(),
]);
// The original question does not require a __main__ guard. Function tests
// load declarations and definitions without running a candidate's top-level
// main program, which would otherwise fill the queue before the checks begin.
const importQ1Candidate = `import ast, types\nwith open('/w/main.py', encoding='utf-8') as source_file:\n    source_tree = ast.parse(source_file.read(), filename='/w/main.py')\nfirst_definition = next((index for index, node in enumerate(source_tree.body) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))), len(source_tree.body))\nprelude = [node for node in source_tree.body[:first_definition] if isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.AugAssign, ast.For))]\ndefinitions = [node for node in source_tree.body[first_definition:] if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]\ncandidate = types.ModuleType('candidate')\ncandidate.__file__ = '/w/main.py'\nexec(compile(ast.fix_missing_locations(ast.Module(body=prelude + definitions, type_ignores=[])), '/w/main.py', 'exec'), candidate.__dict__)\n`;
// Candidate code may be unfinished. A failed API check should yield a wrong
// answer, not a traceback from the teacher's test driver or a runtime error.
const guardedDriver = (body, candidateImport = importQ1Candidate) => `try:\n${(candidateImport + body).trimEnd().split('\n').map(line => `    ${line}`).join('\n')}\nexcept Exception:\n    print('__CHECK_FAILED__')\n`;
const q1MainDriver = includeDequeue => guardedDriver(`import contextlib, io, re, runpy\noutput = io.StringIO()\nwith contextlib.redirect_stdout(output):\n    runpy.run_path('/w/main.py', run_name='__main__')\nlines = [line.strip() for line in output.getvalue().splitlines() if line.strip()]\nmain_ok = len(lines) >= 25 and all(re.fullmatch(rf'{number}\\s+{"Successful" if number <= 20 else "Unsuccessful"}', lines[number - 1]) for number in range(1, 26))\nif ${includeDequeue ? 'True' : 'False'}:\n    main_ok = main_ok and len(lines) == 27 and lines[25:] == ['1', '2']\nprint('PASS' if main_ok else 'FAIL')\n`, '');
const manifest = {
  format: 'codemaster-paper4', version: 1,
  paper: {
    title: '9618 Paper 4 Practice · May/June 2025 · Paper 41',
    description: '[local-paper4-english-v4] Classroom adaptation of the user-supplied 9618/41/M/J/25 programming tasks and subpart marks; not an official Cambridge marking service.',
  },
  questions: [
    {
      key: 'Q1', title: 'A twenty-place circular queue',
      statement: [
        'A program stores positive integers in a circular queue. Complete the following parts in one program.',
        '',
        '## 1(a) Initialise the queue',
        '',
        '- Declare a global 1D array `Queue` with 20 integers. Initialise every position to `-1`.',
        '- Initialise global `HeadPointer` and `TailPointer` to `-1`, and `NumberItems` to `0`.',
        '',
        '## 1(b) Write `Enqueue(InputData)`',
        '',
        '- The function takes an integer parameter. If the queue is full, return `False`.',
        '- Otherwise, store the value in the next position of the circular queue, update the appropriate pointers and `NumberItems`, and return `True`.',
        '',
        '## 1(c) Add the first part of the main program',
        '',
        '- Call `Enqueue()` with each integer from `1` to `25`, in ascending order.',
        '- Output the integer and `Successful` if it was stored, or the integer and `Unsuccessful` if it was not. For example: `5 Successful` or `23 Unsuccessful`.',
        '',
        '## 1(d) Write `Dequeue()`',
        '',
        '- Return `-1` if the queue is empty.',
        '- Otherwise, return the next item, update the appropriate pointers and decrement `NumberItems`. The pointers must wrap around the array.',
        '',
        '## 1(e) Finish and test the main program',
        '',
        '- **(i)** Call `Dequeue()` twice and output each returned value.',
        '- **(ii)** Run the finished program. This practice system saves the run output for teacher review; you do not need to upload a screenshot.',
      ].join('\n'),
      starterCode: `Queue = [-1] * 20\nHeadPointer = -1\nTailPointer = -1\nNumberItems = 0\n\ndef Enqueue(InputData):\n    pass\n\ndef Dequeue():\n    pass\n\n# Write the main program here.\n`,
      initialFiles: {}, outputFiles: [],
      stages: [
        { id: 'Q1_setup', title: '1(a) Queue state', description: 'Teacher checks the global array and the three initialised state variables.', maxMarks: 2, judgeMode: 'manual' },
        { id: 'Q1_enqueue', title: '1(b) Enqueue and full boundary', description: 'Functional tests call Enqueue and inspect the state after 25 insert attempts.', maxMarks: 6, judgeMode: 'auto' },
        { id: 'Q1_main', title: '1(c) Enqueue output', description: 'Run the complete program and check the first 25 Successful/Unsuccessful lines.', maxMarks: 3, judgeMode: 'auto' },
        { id: 'Q1_dequeue', title: '1(d) Dequeue and wraparound', description: 'Functional tests remove values, reuse slots and empty the queue.', maxMarks: 6, judgeMode: 'auto' },
        { id: 'Q1_main_dequeue', title: '1(e)(i) Dequeue output', description: 'Run the complete program and check the two Dequeue return values after the 25 lines.', maxMarks: 2, judgeMode: 'auto' },
        { id: 'Q1_evidence', title: '1(e)(ii) Test evidence', description: 'Teacher reviews the saved run output. No screenshot upload is required.', maxMarks: 1, judgeMode: 'evidence' },
      ],
    },
    q2Original.question,
    q3Original.question,
  ],
  runnerCases: {
    Q1_enqueue: [
      { id: 'queue-25', public: true, driverCode: guardedDriver(`results = [candidate.Enqueue(n) for n in range(1, 26)]\naccepted = sum(result is True for result in results)\nprint(accepted, len(results) - accepted)\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems, candidate.Queue.count(-1))\n`, importQ1Candidate), expectedStdout: '20 5\n0 19 20 0\n' },
      { id: 'queue-first-and-full', public: false, driverCode: guardedDriver(`print(candidate.Enqueue(42), candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\nfor n in range(2, 21): candidate.Enqueue(n)\nprint(candidate.Enqueue(43), candidate.NumberItems, candidate.TailPointer)\n`, importQ1Candidate), expectedStdout: 'True 0 0 1\nFalse 20 19\n' },
    ],
    Q1_main: [{ id: 'queue-success-lines', public: true, driverCode: q1MainDriver(false), expectedStdout: 'PASS\n' }],
    Q1_dequeue: [
      { id: 'queue-wrap', public: true, driverCode: guardedDriver(`for n in range(1, 21): candidate.Enqueue(n)\nprint(candidate.Dequeue(), candidate.Dequeue())\nprint(candidate.Enqueue(21), candidate.Enqueue(22))\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\nprint(candidate.Dequeue(), candidate.Dequeue())\n`, importQ1Candidate), expectedStdout: '1 2\nTrue True\n2 1 20\n3 4\n' },
      { id: 'queue-empty', public: false, driverCode: guardedDriver(`print(candidate.Dequeue())\ncandidate.Enqueue(9)\nprint(candidate.Dequeue(), candidate.Dequeue())\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\n`, importQ1Candidate), expectedStdout: '-1\n9 -1\n-1 -1 0\n' },
    ],
    Q1_main_dequeue: [{ id: 'queue-two-returns', public: true, driverCode: q1MainDriver(true), expectedStdout: 'PASS\n' }],
    ...q2Original.runnerCases,
    ...q3Original.runnerCases,
  },
  referenceSolutions: { Q1: q1, Q2: q2, Q3: q3 },
};

const json = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(join(dir, 'paper4-english-practice.json'), json);
const zipManifest = structuredClone(manifest);
zipManifest.referenceSolutions = Object.fromEntries(['Q1', 'Q2', 'Q3'].map(key => [key, { file: `assets/${key}-reference.py` }]));
zipManifest.questions[1].initialFiles['TheData.txt'] = { file: 'assets/TheData.txt' };
await mkdir(join(dir, 'assets'), { recursive: true });
await Promise.all([
  writeFile(join(dir, 'assets/Q1-reference.py'), q1),
  writeFile(join(dir, 'assets/Q2-reference.py'), q2),
  writeFile(join(dir, 'assets/Q3-reference.py'), q3),
  writeFile(join(dir, 'assets/TheData.txt'), q2Original.question.initialFiles['TheData.txt']),
  writeFile(join(dir, 'manifest.json'), JSON.stringify(zipManifest, null, 2) + '\n'),
]);
await unlink(join(dir, 'paper4-english-practice.zip')).catch(error => { if (error.code !== 'ENOENT') throw error; });
const zipped = spawnSync('zip', ['-X', '-q', 'paper4-english-practice.zip', 'manifest.json',
  'assets/Q1-reference.py', 'assets/Q2-reference.py', 'assets/Q3-reference.py', 'assets/TheData.txt'], { cwd: dir });
if (zipped.status !== 0) throw new Error('Could not build Paper 4 sample ZIP (zip command required).');
console.log(`Built original Paper 4 sample (${Buffer.byteLength(json)} bytes).`);

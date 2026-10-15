// Generates a fully self-contained JSON manifest and an equivalent ZIP.
// The exercise wording, data and reference programs here are original.
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const source = async name => readFile(join(dir, name), 'utf8');
const [q1, q2, q3] = await Promise.all(['Q1-reference.py', 'Q2-reference.py', 'Q3-reference.py'].map(source));
const colors = ['Red', 'Green', 'Blue', 'Orange', 'Yellow', 'Pink'];
const rows = Array.from({ length: 72 }, (_, i) => ({ value: i + 1, color: colors[i % colors.length] }));
const data = items => items.map(item => `${item.value},${item.color.toLowerCase()}`).join('\n') + '\n';
const outputs = items => Object.fromEntries(colors.map(color => [
  `${color}.txt`, items.filter(item => item.color.toLowerCase() === color.toLowerCase()).map(item => `${item.value}\n`).join(''),
]));
const importCandidate = `import importlib.util\nspec = importlib.util.spec_from_file_location('candidate', '/w/main.py')\ncandidate = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(candidate)\n`;
// Candidate code may be unfinished. A failed API check should yield a wrong
// answer, not a traceback from the teacher's test driver or a runtime error.
const guardedDriver = body => `try:\n${(importCandidate + body).trimEnd().split('\n').map(line => `    ${line}`).join('\n')}\nexcept Exception:\n    print('__CHECK_FAILED__')\n`;
const manifest = {
  format: 'codemaster-paper4', version: 1,
  paper: {
    title: 'Paper 4 Programming Practice · Original English Sample',
    description: '[local-paper4-english-v2] Three original programming tasks inspired by common Paper 4 skills. This is not a Cambridge paper or marking scheme.',
  },
  questions: [
    {
      key: 'Q1', title: 'A twenty-place circular queue',
      statement: `Create a fixed array of 20 slots for positive integers. At the start, every slot contains -1 and HeadPointer, TailPointer and NumberItems are -1, -1 and 0. Implement Enqueue(value) and Dequeue() so the pointers wrap around correctly. Enqueue returns False when full or when the value is not positive; Dequeue returns -1 when empty. In the main program, try to add 1 to 25, remove two values and print the accepted and rejected counts and the removed values. Keep your final source and a run record for teacher review.`,
      starterCode: `Capacity = 20\nQueue = [-1] * Capacity\nHeadPointer = -1\nTailPointer = -1\nNumberItems = 0\n\ndef Enqueue(value):\n    pass\n\ndef Dequeue():\n    pass\n\nif __name__ == '__main__':\n    pass\n`,
      initialFiles: {}, outputFiles: [],
      stages: [
        { id: 'Q1_setup', title: 'Queue state and source structure', description: 'Teacher checks the array, initial values and named state variables.', maxMarks: 4, judgeMode: 'manual' },
        { id: 'Q1_enqueue', title: 'Enqueue and full boundary', description: 'Functional tests call Enqueue and inspect the state after 25 insert attempts.', maxMarks: 6, judgeMode: 'auto' },
        { id: 'Q1_dequeue', title: 'Dequeue and wraparound', description: 'Functional tests remove values, reuse slots and empty the queue.', maxMarks: 6, judgeMode: 'auto' },
        { id: 'Q1_main', title: 'Main program run', description: 'Run the final program and compare the printed summary.', maxMarks: 4, judgeMode: 'auto' },
      ],
    },
    {
      key: 'Q2', title: 'Separate records into six colour files',
      statement: `The supplied TheData.txt has 72 rows. Each row is an integer followed by a comma and one of red, green, blue, orange, yellow or pink. Implement ReadData, SplitData and StoreData. The final program must maintain six files named Red.txt, Green.txt, Blue.txt, Orange.txt, Yellow.txt and Pink.txt. Append matching integers in their original order, one per line, preserving any lines already in those files. Skip malformed rows and print the number of valid records processed. Each test run begins in an independent file workspace, so prior test runs cannot affect one another. Retain your code and file evidence for teacher review.`,
      starterCode: `from pathlib import Path\n\nCOLOURS = ('Red', 'Green', 'Blue', 'Orange', 'Yellow', 'Pink')\n\ndef ReadData(filename='TheData.txt'):\n    pass\n\ndef SplitData(records):\n    pass\n\ndef StoreData(groups):\n    pass\n\nif __name__ == '__main__':\n    pass\n`,
      initialFiles: { 'TheData.txt': data(rows) }, outputFiles: colors.map(color => `${color}.txt`),
      stages: [
        { id: 'Q2_structure', title: 'Named routines and file handling', description: 'Teacher reviews the ReadData, SplitData and StoreData decomposition and file-handling choices.', maxMarks: 5, judgeMode: 'manual' },
        { id: 'Q2_files', title: 'Complete 72-record run', description: 'All six output files and the processed count are checked against the supplied data.', maxMarks: 10, judgeMode: 'auto' },
        { id: 'Q2_edge', title: 'Append, sparse colours and malformed rows', description: 'Tests check that existing file lines are retained and malformed rows do not stop processing.', maxMarks: 6, judgeMode: 'auto' },
        { id: 'Q2_evidence', title: 'Code and output evidence', description: 'Teacher checks that the final source and generated files are retained.', maxMarks: 4, judgeMode: 'evidence' },
      ],
    },
    {
      key: 'Q3', title: 'Build and traverse a binary search tree',
      statement: `Implement a Node class containing an integer value and left/right child references, and a Tree class with insert and inorder methods. Smaller values go left; equal or larger values go right. The inorder method returns a list produced by recursive traversal. The main program reads space-separated integers and prints the inorder values on one line. Keep your implementation and test evidence for teacher review.`,
      starterCode: `import sys\n\nclass Node:\n    pass\n\nclass Tree:\n    pass\n\nif __name__ == '__main__':\n    pass\n`,
      initialFiles: {}, outputFiles: [],
      stages: [
        { id: 'Q3_structure', title: 'Class design and recursive method', description: 'Teacher reviews the Node/Tree source, recursion and clarity.', maxMarks: 6, judgeMode: 'manual' },
        { id: 'Q3_insert', title: 'Insertion and duplicate direction', description: 'Isolated drivers import the candidate module and inspect tree links.', maxMarks: 10, judgeMode: 'auto' },
        { id: 'Q3_traversal', title: 'Recursive inorder traversal', description: 'Isolated drivers call inorder with varied trees; the main program is also run.', maxMarks: 10, judgeMode: 'auto' },
        { id: 'Q3_evidence', title: 'Code and run evidence', description: 'Teacher checks the submitted source and retained test run.', maxMarks: 4, judgeMode: 'evidence' },
      ],
    },
  ],
  runnerCases: {
    Q1_enqueue: [
      { id: 'queue-25', public: true, driverCode: guardedDriver(`results = [candidate.Enqueue(n) for n in range(1, 26)]\naccepted = sum(result is True for result in results)\nprint(accepted, len(results) - accepted)\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems, candidate.Queue.count(-1))\n`), expectedStdout: '20 5\n0 19 20 0\n' },
      { id: 'queue-invalid', public: false, driverCode: guardedDriver(`print(candidate.Enqueue(0), candidate.Enqueue(-3), candidate.NumberItems)\nprint(candidate.Enqueue(7), candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\n`), expectedStdout: 'False False 0\nTrue 0 0 1\n' },
    ],
    Q1_dequeue: [
      { id: 'queue-wrap', public: true, driverCode: guardedDriver(`for n in range(1, 21): candidate.Enqueue(n)\nprint(candidate.Dequeue(), candidate.Dequeue())\nprint(candidate.Enqueue(21), candidate.Enqueue(22))\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\nprint(candidate.Dequeue(), candidate.Dequeue())\n`), expectedStdout: '1 2\nTrue True\n2 1 20\n3 4\n' },
      { id: 'queue-empty', public: false, driverCode: guardedDriver(`print(candidate.Dequeue())\ncandidate.Enqueue(9)\nprint(candidate.Dequeue(), candidate.Dequeue())\nprint(candidate.HeadPointer, candidate.TailPointer, candidate.NumberItems)\n`), expectedStdout: '-1\n9 -1\n-1 -1 0\n' },
    ],
    Q1_main: [{ id: 'queue-summary', public: true, expectedStdout: 'Accepted: 20\nRejected: 5\nRemoved: 1, 2\n' }],
    Q2_files: [
      { id: 'all-six-72', public: true, expectedStdout: 'Processed: 72\n', expectedFiles: outputs(rows) },
      { id: 'all-six-reversed', public: false, inputFiles: { 'TheData.txt': data([...rows].reverse()) }, expectedStdout: 'Processed: 72\n', expectedFiles: outputs([...rows].reverse()) },
    ],
    Q2_edge: [
      { id: 'sparse-input', public: true, inputFiles: { 'TheData.txt': '9,pink\n7,red\n3,pink\n' }, expectedStdout: 'Processed: 3\n', expectedFiles: outputs([{ value: 9, color: 'Pink' }, { value: 7, color: 'Red' }, { value: 3, color: 'Pink' }]) },
      { id: 'append-and-skip', public: false,
        inputFiles: { 'TheData.txt': '7,red\nbad-row\n8,pink\n4,unknown\n', 'Red.txt': '100\n' },
        expectedStdout: 'Processed: 2\n', expectedFiles: { ...outputs([{ value: 7, color: 'Red' }, { value: 8, color: 'Pink' }]), 'Red.txt': '100\n7\n' } },
    ],
    Q3_insert: [
      { id: 'tree-links', public: true, driverCode: guardedDriver(`tree = candidate.Tree()\nfor value in (10, 5, 15, 3, 7): tree.insert(value)\nprint(tree.root.value, tree.root.left.value, tree.root.right.value)\nprint(tree.root.left.left.value, tree.root.left.right.value)\n`), expectedStdout: '10 5 15\n3 7\n' },
      { id: 'tree-duplicate', public: false, driverCode: guardedDriver(`tree = candidate.Tree()\nfor value in (8, 8, 6, 9): tree.insert(value)\nprint(tree.root.value, tree.root.right.value, tree.root.left.value, tree.root.right.right.value)\n`), expectedStdout: '8 8 6 9\n' },
    ],
    Q3_traversal: [
      { id: 'tree-main', public: true, stdin: '8 3 10 1 6\n', expectedStdout: '1 3 6 8 10\n' },
      { id: 'tree-api', public: false, driverCode: guardedDriver(`tree = candidate.Tree()\nfor value in (4, 2, 7, 2, 9, 1): tree.insert(value)\nprint(' '.join(map(str, tree.inorder())))\n`), expectedStdout: '1 2 2 4 7 9\n' },
    ],
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
  writeFile(join(dir, 'assets/TheData.txt'), data(rows)),
  writeFile(join(dir, 'manifest.json'), JSON.stringify(zipManifest, null, 2) + '\n'),
]);
await unlink(join(dir, 'paper4-english-practice.zip')).catch(error => { if (error.code !== 'ENOENT') throw error; });
const zipped = spawnSync('zip', ['-X', '-q', 'paper4-english-practice.zip', 'manifest.json',
  'assets/Q1-reference.py', 'assets/Q2-reference.py', 'assets/Q3-reference.py', 'assets/TheData.txt'], { cwd: dir });
if (zipped.status !== 0) throw new Error('Could not build Paper 4 sample ZIP (zip command required).');
console.log(`Built original Paper 4 sample (${Buffer.byteLength(json)} bytes).`);

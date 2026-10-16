// Question 2 from the user-supplied 9618/41 May/June 2025 paper.
// The supplied candidate data is preserved record for record, with line
// endings normalized for this repository.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const colours = ['Red', 'Green', 'Blue', 'Orange', 'Yellow', 'Pink'];
const outputNames = colours.map(colour => `${colour}.txt`);

function expectedFiles(rows, starting = {}) {
  const files = Object.fromEntries(outputNames.map(name => [name, starting[name] ?? '']));
  for (const row of rows) {
    const [number, colour] = row.split(',', 2);
    const name = `${colour.trim().charAt(0).toUpperCase()}${colour.trim().slice(1).toLowerCase()}.txt`;
    if (!Object.hasOwn(files, name)) throw new Error(`Unexpected colour in Q2 source data: ${colour}`);
    files[name] += `${number.trim()}\n`;
  }
  return files;
}

// Importing a candidate can execute its unguarded main program. Give that
// program its expected filename, hide its own prompt, and restore every output
// file before testing an individual function. This does not demand a __main__
// guard, nor does it expose teacher diagnostics to the student.
const loadCandidate = `import contextlib
import importlib.util
import io
import sys
from pathlib import Path

output_names = (${outputNames.map(name => JSON.stringify(name)).join(', ')},)
original_outputs = {name: Path(name).read_bytes() for name in output_names if Path(name).exists()}
old_stdin = sys.stdin
try:
    sys.stdin = io.StringIO('TheData.txt\\n')
    with contextlib.redirect_stdout(io.StringIO()):
        spec = importlib.util.spec_from_file_location('candidate', '/w/main.py')
        candidate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(candidate)
finally:
    sys.stdin = old_stdin
    for name, content in original_outputs.items():
        Path(name).write_bytes(content)
`;

const driver = body => `try:\n${(loadCandidate + body).trimEnd().split('\n').map(line => `    ${line}`).join('\n')}\nexcept Exception:\n    print('__CHECK_FAILED__')\n`;

export async function buildOriginalQ2() {
  const theData = await readFile(join(directory, 'assets/q2-original/TheData.txt'), 'utf8');
  const originalRows = theData.split(/\r?\n/).filter(Boolean);
  if (originalRows.length !== 72 || originalRows[0] !== '10,red') {
    throw new Error('The original Q2 source file is missing or has changed.');
  }
  const question = {
    key: 'Q2',
    title: 'Separate data into six colour files',
    statement: [
      'A program reads records from a text file and separates the numbers into files by colour. The supplied `TheData.txt` has 72 lines. Each line contains an integer and a colour separated by a comma; its first line is `10,red`. The possible colours are **red, green, blue, orange, yellow and pink**. Six matching output files are supplied empty.',
      '',
      '## 2(a) Write `ReadData()`',
      '',
      '- Prompt the user for a filename and open that file for reading. Display a clear error message if it cannot be opened.',
      '- Read each line into a 1D array and return the populated array. Do **not** assume the file always has 72 lines.',
      '',
      '## 2(b) Write `SplitData(DataArray)`',
      '',
      '- The parameter is a 1D array of strings. Create one 1D array for each of the six colours.',
      '- Split each string into its integer and colour, then store the integer in the matching colour array. For example, `10,red` places `10` in the red array.',
      '',
      '## 2(c) Write `StoreData(DataToStore, FileName)`',
      '',
      '- Open the named text file and **append** every item from `DataToStore` on a new line.',
      '- Use exception handling when opening the file or writing data.',
      '',
      '## 2(d) Store the six colour arrays',
      '',
      '- Amend `SplitData()` to call `StoreData()` six times, pairing each array with its file: `Blue.txt`, `Green.txt`, `Orange.txt`, `Pink.txt`, `Red.txt` and `Yellow.txt`.',
      '',
      '## 2(e) Complete and test the main program',
      '',
      '- **(i)** Call `ReadData()`, then pass its returned array to `SplitData()`.',
      '- **(ii)** Run the program and enter `TheData.txt` when prompted. This practice system saves the run output and generated `Red.txt` for teacher review; you do not need to upload screenshots.',
    ].join('\n'),
    starterCode: `def ReadData():\n    pass\n\ndef StoreData(DataToStore, FileName):\n    pass\n\ndef SplitData(DataArray):\n    pass\n\nDataFromFile = ReadData()\nSplitData(DataFromFile)\n`,
    initialFiles: { 'TheData.txt': theData, ...Object.fromEntries(outputNames.map(name => [name, ''])) },
    outputFiles: outputNames,
    stages: [
      { id: 'Q2_a', title: 'ReadData: filename prompt and raw lines', description: 'Prompt for a filename; read an unknown number of lines into a 1D array and return it. Report file opening errors.', maxMarks: 7, judgeMode: 'auto' },
      { id: 'Q2_b', title: 'SplitData: six colour arrays', description: 'Accept DataArray, split each raw line and place its integer in the matching colour array.', maxMarks: 6, judgeMode: 'auto' },
      { id: 'Q2_c', title: 'StoreData: append and file errors', description: 'Accept DataToStore and FileName, append items line by line and handle opening or writing errors.', maxMarks: 5, judgeMode: 'auto' },
      { id: 'Q2_d', title: 'Store all six colour arrays', description: 'Within SplitData, call StoreData once for each colour array with its matching filename.', maxMarks: 2, judgeMode: 'auto' },
      { id: 'Q2_e1', title: 'Main program', description: 'Call ReadData(), then pass its result to SplitData(). Run with TheData.txt.', maxMarks: 3, judgeMode: 'auto' },
      { id: 'Q2_e2', title: 'Run and file evidence', description: 'Teacher reviews the run record and the generated Red.txt content. Evidence marks do not block automatic AC.', maxMarks: 2, judgeMode: 'evidence' },
    ],
  };
  const runnerCases = {
    Q2_a: [
      { id: 'read-short-and-long-files', public: true,
        inputFiles: {
          'ShortData.txt': '10,red\n22,blue\n7,pink\n',
          'LongData.txt': Array.from({ length: 80 }, (_, index) => `${index + 1},red`).join('\n') + '\n',
        },
        driverCode: driver(`def read_file(name):
    previous_stdin = sys.stdin
    prompt = io.StringIO()
    try:
        sys.stdin = io.StringIO(name + '\\n')
        with contextlib.redirect_stdout(prompt), contextlib.redirect_stderr(prompt):
            data = candidate.ReadData()
    finally:
        sys.stdin = previous_stdin
    return data, prompt.getvalue()

short, short_prompt = read_file('ShortData.txt')
long, long_prompt = read_file('LongData.txt')
_, missing_prompt = read_file('MissingData.txt')
assert isinstance(short, (list, tuple)) and isinstance(long, (list, tuple))
assert [str(item).rstrip('\\r\\n') for item in short] == ['10,red', '22,blue', '7,pink']
assert len(long) == 80 and str(long[0]).rstrip('\\r\\n') == '1,red'
assert str(long[-1]).rstrip('\\r\\n') == '80,red'
assert short_prompt.strip() and long_prompt.strip()
assert missing_prompt.strip() and missing_prompt.strip() != short_prompt.strip()
print('OK')\n`), expectedStdout: 'OK\n' },
    ],
    Q2_b: [
      { id: 'partition-six-colours', public: true,
        driverCode: driver(`calls = []
candidate.StoreData = lambda items, name: calls.append((name, [str(item) for item in items]))
candidate.SplitData(['10,red', '20,green', '30,blue', '40,orange', '50,yellow', '60,pink', '7,red'])
assert len(calls) == 6
actual = dict(calls)
assert len(actual) == 6
assert actual == {
    'Red.txt': ['10', '7'], 'Green.txt': ['20'], 'Blue.txt': ['30'],
    'Orange.txt': ['40'], 'Yellow.txt': ['50'], 'Pink.txt': ['60'],
}
print('OK')\n`), expectedStdout: 'OK\n' },
    ],
    Q2_c: [
      { id: 'append-and-handle-error', public: true,
        inputFiles: { 'Red.txt': '100\n' },
        driverCode: driver(`candidate.StoreData(['7', '9'], 'Red.txt')
assert Path('Red.txt').read_text(encoding='utf-8') == '100\\n7\\n9\\n'
error_output = io.StringIO()
with contextlib.redirect_stdout(error_output), contextlib.redirect_stderr(error_output):
    candidate.StoreData(['1'], 'missing-directory/output.txt')
assert error_output.getvalue().strip()
print('OK')\n`), expectedStdout: 'OK\n' },
    ],
    Q2_d: [
      { id: 'six-file-calls', public: false,
        inputFiles: { 'Red.txt': '100\n' },
        driverCode: driver(`candidate.SplitData(['7,red', '8,blue', '9,pink'])
expected = {'Red.txt': '100\\n7\\n', 'Blue.txt': '8\\n', 'Pink.txt': '9\\n'}
for name in output_names:
    assert Path(name).read_text(encoding='utf-8') == expected.get(name, '')
print('OK')\n`), expectedStdout: 'OK\n' },
    ],
    Q2_e1: [
      { id: 'original-supplied-data', public: true, stdin: 'TheData.txt\n', expectedFiles: expectedFiles(originalRows) },
      { id: 'short-file-run', public: false, stdin: 'TheData.txt\n', inputFiles: { 'TheData.txt': '7,red\n8,blue\n3,red\n' }, expectedFiles: expectedFiles(['7,red', '8,blue', '3,red']) },
    ],
  };
  return { question, runnerCases };
}

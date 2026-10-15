// Paper 4 programs run only through the already-probed go-judge executor.
// Each case gets a fresh /w. Expected answers and hidden test diagnostics
// remain in the worker and are never copied into a student's sandbox.
import { performance } from 'node:perf_hooks';
import { InfrastructureError, compareOutput, resultVerdict } from './judge.mjs';

const SOURCE_BYTES = 256 * 1024;
const FILE_BYTES = 64 * 1024;
const TOTAL_INPUT_BYTES = 512 * 1024;
const STDIN_BYTES = 64 * 1024;
const STDOUT_BYTES = 64 * 1024;
const STDERR_BYTES = 16 * 1024;
const MAX_FILES = 16;
const MAX_CASES = 50;
const DRIVER_BYTES = 16 * 1024;
const CASE_CPU_NS = 2_000_000_000;
const CASE_WALL_NS = 5_000_000_000;
const JOB_CPU_NS = 30_000_000_000;
const JOB_WALL_MS = 60_000;
const VERSION = { time_limit_ms: 2000, memory_limit_mb: 128 };
const PREFLIGHT = String.raw`import ast, sys
try:
    source = open('/w/main.py', encoding='utf-8').read()
    compile(ast.parse(source, filename='main.py'), 'main.py', 'exec')
except SyntaxError as exc:
    print('SyntaxError at line %s: %s' % (exc.lineno, exc.msg))
    sys.exit(65)
`;
// /w contains go-judge's copied-in files but is not writable as a directory
// by the unprivileged student UID. Paper 4 requires genuine file creation,
// deletion and append, so run the student's program from a fresh writable
// tmpfs directory. This wrapper and the child are both inside the same
// no-network, cgroup-limited sandbox; no expected answer is present here.
const FILE_WORKSPACE = String.raw`import json, os, shutil, stat, subprocess, sys
work = '/tmp/paper4'
os.mkdir(work)
inputs = json.loads(sys.argv[1])
outputs = json.loads(sys.argv[2])
program = sys.argv[3]
for name in inputs:
    shutil.copyfile('/w/' + name, work + '/' + name)
completed = subprocess.run([sys.executable, '-I', '-S', program], cwd=work)
for name in outputs:
    path = work + '/' + name
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                data = b''
            else:
                data = os.read(fd, 65537)
        finally:
            os.close(fd)
    except (FileNotFoundError, IsADirectoryError, OSError):
        data = b''
    with open('/w/' + name, 'wb') as target:
        target.write(data)
sys.exit(completed.returncode)
`;

function byteLength(value) { return Buffer.byteLength(value, 'utf8'); }
function boundedText(value, max, description) {
  if (typeof value !== 'string' || byteLength(value) > max) throw new InfrastructureError(`Invalid Paper 4 ${description}.`);
  return value;
}

export function validatePaper4Filename(name) {
  // Deliberately restrict this first text-file runner to simple basenames.
  // No slash, backslash, dot path segment, symlink or executable can enter
  // the sandbox through a published paper manifest.
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,75}\.(?:txt|csv|dat)$/i.test(name) ||
      name.includes('..') || /^(?:main\.py|stdout|stderr|result)$/i.test(name)) {
    throw new InfrastructureError('Unsafe Paper 4 text filename.');
  }
  return name;
}

function fileMap(value, description) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InfrastructureError(`Invalid Paper 4 ${description}.`);
  const entries = Object.entries(value);
  if (entries.length > MAX_FILES) throw new InfrastructureError('Too many Paper 4 files.');
  const result = Object.create(null);
  let aggregate = 0;
  for (const [name, content] of entries) {
    validatePaper4Filename(name);
    boundedText(content, FILE_BYTES, 'file content');
    aggregate += byteLength(content);
    if (aggregate > TOTAL_INPUT_BYTES) throw new InfrastructureError('Paper 4 file manifest exceeds limit.');
    result[name] = content;
  }
  return result;
}

function validateCases(runnerCases) {
  const cases = runnerCases === undefined || runnerCases === null || runnerCases.length === 0
    ? [{ id: 'practice-run', stdin: '', inputFiles: {}, public: true }]
    : runnerCases;
  if (!Array.isArray(cases) || cases.length > MAX_CASES) throw new InfrastructureError('Invalid Paper 4 case count.');
  return cases.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new InfrastructureError('Invalid Paper 4 case.');
    const id = boundedText(entry.id ?? `case-${index + 1}`, 80, 'case ID');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id)) throw new InfrastructureError('Invalid Paper 4 case ID.');
    const stdin = boundedText(entry.stdin ?? '', STDIN_BYTES, 'standard input');
    const inputFiles = fileMap(entry.inputFiles, 'case input files');
    const expectedFiles = fileMap(entry.expectedFiles, 'expected files');
    const expectedStdout = entry.expectedStdout === undefined ? undefined : boundedText(entry.expectedStdout, STDOUT_BYTES, 'expected output');
    const stageId = entry.stageId === undefined ? null : boundedText(entry.stageId, 40, 'stage ID');
    if (stageId !== null && !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(stageId))
      throw new InfrastructureError('Invalid Paper 4 stage ID.');
    const driverCode = entry.driverCode === undefined ? undefined : boundedText(entry.driverCode, DRIVER_BYTES, 'driver code');
    if (stageId !== null && expectedStdout === undefined && !Object.keys(expectedFiles).length)
      throw new InfrastructureError('An automatically judged Paper 4 case needs an expected result.');
    return { id, stageId, stdin, inputFiles, expectedFiles, expectedStdout, driverCode, public: entry.public === true };
  });
}

function clipped(text, max) {
  if (typeof text !== 'string') return '';
  const bytes = Buffer.from(text);
  return bytes.length <= max ? text : bytes.subarray(0, max).toString('utf8');
}

function normalizeText(value) { return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'); }

function classifyRawResult(raw, outputNames) {
  if (!raw || typeof raw !== 'object' || typeof raw.status !== 'string' || !Number.isInteger(raw.exitStatus) ||
      !Number.isFinite(raw.time) || raw.time < 0 || !Number.isFinite(raw.runTime) || raw.runTime < 0 ||
      !Number.isFinite(raw.memory) || raw.memory < 0) throw new InfrastructureError('Invalid Paper 4 executor result.');
  const errors = raw.fileError ?? [];
  if (!Array.isArray(errors) || errors.length > MAX_FILES + 2) throw new InfrastructureError('Invalid Paper 4 executor file errors.');
  for (const error of errors) {
    if (!error || typeof error.name !== 'string' || typeof error.type !== 'string') throw new InfrastructureError('Invalid Paper 4 file error.');
    const file = error.name.endsWith('?') ? error.name.slice(0, -1) : error.name;
    if (!outputNames.includes(file) && !['stdout', 'stderr'].includes(file)) throw new InfrastructureError('Executor reported an unexpected file.');
    if (!['CopyOutOpen', 'CopyOutNotRegularFile', 'CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(error.type)) {
      throw new InfrastructureError('Paper 4 sandbox file setup failed.');
    }
  }
  const files = raw.files ?? {};
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new InfrastructureError('Invalid Paper 4 executor files.');
  for (const [name, content] of Object.entries(files)) {
    const file = name.endsWith('?') ? name.slice(0, -1) : name;
    if (!['stdout', 'stderr', ...outputNames].includes(file) || typeof content !== 'string') {
      throw new InfrastructureError('Paper 4 executor returned an unsafe file.');
    }
    const limit = file === 'stderr' ? STDERR_BYTES : file === 'stdout' ? STDOUT_BYTES : FILE_BYTES;
    // The executor can replace each invalid UTF-8 input byte with U+FFFD;
    // its UTF-8 representation is three bytes. Preserve that bounded output
    // as a review hint instead of misreporting a sandbox infrastructure fault.
    const maximum = content.includes('\uFFFD') ? 3 * (limit + 1) : limit + 1;
    if (byteLength(content) > maximum) {
      throw new InfrastructureError('Paper 4 executor returned an unsafe file.');
    }
  }
  if (raw.status === 'Internal Error') throw new InfrastructureError('Paper 4 sandbox reported an internal error.');
  if (raw.status === 'File Error' && !errors.length) throw new InfrastructureError('Paper 4 sandbox file error had no cause.');
  if (raw.status === 'Accepted' && (typeof files.stdout !== 'string' || typeof files.stderr !== 'string')) {
    throw new InfrastructureError('Paper 4 sandbox omitted output.');
  }
  if (raw.status === 'File Error') {
    if (errors.some(error => ['CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(error.type))) return { verdict: 'OLE', files, errors };
    if (errors.every(error => ['CopyOutOpen', 'CopyOutNotRegularFile'].includes(error.type))) {
      return { verdict: raw.exitStatus === 0 ? 'Executed' : 'RE', files, errors };
    }
  }
  const verdict = resultVerdict(raw);
  return { verdict: verdict === 'OK' ? 'Executed' : verdict, files, errors };
}

function caseChecks(testCase, files) {
  const checks = [];
  if (testCase.expectedStdout !== undefined) {
    checks.push({ kind: 'stdout', name: '标准输出', passed: compareOutput(files.stdout ?? '', testCase.expectedStdout, 'tokens') });
  }
  for (const [name, expected] of Object.entries(testCase.expectedFiles)) {
    const actual = files[name] ?? files[`${name}?`];
    checks.push({ kind: 'file', name, passed: actual !== undefined && normalizeText(actual) === normalizeText(expected) });
  }
  return checks;
}

function commandForCase(judge, sourceCode, initialFiles, outputFiles, testCase, remainingCpu, remainingWall) {
  const seeded = { ...initialFiles, ...testCase.inputFiles };
  const outputNames = [...new Set([...outputFiles, ...Object.keys(testCase.expectedFiles)])];
  if (outputNames.length > MAX_FILES) throw new InfrastructureError('Too many Paper 4 output files.');
  for (const name of outputNames) if (!Object.hasOwn(seeded, name)) seeded[name] = '';
  fileMap(seeded, 'merged sandbox files');
  const command = judge.command({ code: sourceCode, input: testCase.stdin, version: VERSION, language: 'python' });
  command.args = [judge.python, '-I', '-S', '-c', FILE_WORKSPACE,
    JSON.stringify(Object.keys(seeded)), JSON.stringify(outputNames), testCase.driverCode === undefined ? '/w/main.py' : '/w/driver.py'];
  command.copyIn = { ...command.copyIn, ...Object.fromEntries(Object.entries(seeded).map(([name, content]) => [name, { content }])) };
  if (testCase.driverCode !== undefined) command.copyIn['driver.py'] = { content: testCase.driverCode };
  command.files[1].max = STDOUT_BYTES;
  command.files[2].max = STDERR_BYTES;
  // go-judge's '?' suffix makes a missing student output a check failure,
  // rather than an infrastructure error. No directory is copied out.
  command.copyOut = ['stdout', 'stderr', ...outputNames.map(name => `${name}?`)];
  command.copyOutMax = FILE_BYTES;
  command.copyOutTruncate = false;
  command.cpuLimit = Math.min(CASE_CPU_NS, remainingCpu);
  command.clockLimit = Math.min(CASE_WALL_NS, remainingWall);
  return { command, outputNames };
}

export async function runPaper4Snapshot({ sourceCode, question, runnerCases }, judge, { signal } = {}) {
  boundedText(sourceCode, SOURCE_BYTES, 'source code');
  if (!question || typeof question !== 'object') throw new InfrastructureError('Paper 4 question is missing.');
  const initialFiles = fileMap(question.initialFiles, 'initial files');
  const outputFiles = question.outputFiles ?? [];
  if (!Array.isArray(outputFiles) || outputFiles.length > MAX_FILES ||
      outputFiles.some(name => { try { validatePaper4Filename(name); return false; } catch { return true; } })) {
    throw new InfrastructureError('Invalid Paper 4 output file list.');
  }
  const cases = validateCases(runnerCases);
  const environmentVersion = judge.runtimeVersion ?? judge.environmentVersion ?? 'unavailable';
  const started = performance.now();
  const wallSignal = AbortSignal.timeout(JOB_WALL_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, wallSignal]) : wallSignal;
  let spentCpu = 0;
  const remaining = () => ({ cpu: JOB_CPU_NS - spentCpu, wall: Math.floor((JOB_WALL_MS - (performance.now() - started)) * 1_000_000) });
  const preflight = judge.command({ code: sourceCode, script: PREFLIGHT, version: VERSION, language: 'python' });
  const preflightResult = await judge.execute(preflight, combinedSignal);
  spentCpu += preflightResult.time;
  if (preflightResult.status !== 'Accepted') {
    if (preflightResult.status === 'Nonzero Exit Status' && preflightResult.exitStatus === 65) {
      return { status: 'CE', publicOutput: '', publicMessage: clipped(preflightResult.files?.stdout, 2048) || '代码语法错误。',
        privateResults: [], environmentVersion };
    }
    const verdict = resultVerdict(preflightResult);
    if (['TLE', 'MLE', 'OLE'].includes(verdict)) {
      return { status: verdict, publicOutput: '', publicMessage: '运行超过资源限制。', privateResults: [], environmentVersion };
    }
    throw new InfrastructureError('Paper 4 syntax preflight failed.');
  }
  const privateResults = [];
  let publicOutput = '';
  let firstPublic = true;
  for (const testCase of cases) {
    if (signal?.aborted) throw new InfrastructureError('Paper 4 worker lease was lost.');
    const left = remaining();
    if (wallSignal.aborted || left.cpu <= 0 || left.wall <= 0) {
      privateResults.push({ stageId: testCase.stageId, caseId: testCase.id, public: testCase.public, status: 'TLE', checks: [] });
      continue;
    }
    const { command, outputNames } = commandForCase(judge, sourceCode, initialFiles, outputFiles, testCase, left.cpu, left.wall);
    let raw;
    try {
      const result = await judge.request('/run', { cmd: [command] }, {
        signal: combinedSignal, responseLimit: 8 * 1024 * 1024,
        timeoutMs: Math.ceil(command.clockLimit / 1_000_000) + 5000,
      });
      if (!Array.isArray(result) || result.length !== 1) throw new InfrastructureError('Invalid Paper 4 executor response.');
      raw = result[0];
    } catch (error) {
      if (!signal?.aborted && wallSignal.aborted) {
        privateResults.push({ stageId: testCase.stageId, caseId: testCase.id, public: testCase.public, status: 'TLE', checks: [] });
        continue;
      }
      throw error;
    }
    const { verdict, files } = classifyRawResult(raw, outputNames);
    spentCpu += raw.time;
    const checks = verdict === 'Executed' ? caseChecks(testCase, files) : [];
    const status = verdict === 'Executed' && checks.length
      ? (checks.every(check => check.passed) ? (testCase.stageId ? 'AC' : 'Executed') : (testCase.stageId ? 'WA' : 'NeedsReview'))
      : verdict;
    if (testCase.public) {
      const generatedFiles = Object.fromEntries(outputNames.flatMap(name => {
        const content = files[name] ?? files[`${name}?`];
        return content === undefined ? [] : [[name, content]];
      }));
      privateResults.push({ stageId: testCase.stageId, caseId: testCase.id, public: true, status,
        stdout: clipped(files.stdout, STDOUT_BYTES), stderr: clipped(files.stderr, STDERR_BYTES), generatedFiles, checks });
      if (firstPublic) { publicOutput = clipped(files.stdout, STDOUT_BYTES); firstPublic = false; }
    } else {
      // Hidden data is deliberately not persisted with the student's public
      // output. Teacher-only checks can be reviewed without input leakage.
      privateResults.push({ stageId: testCase.stageId, caseId: testCase.id, public: false, status,
        checks: checks.map(check => ({ kind: check.kind, passed: check.passed })) });
    }
  }
  const stageCases = privateResults.filter(entry => entry.stageId !== null);
  const failed = privateResults.find(entry => !['AC', 'Executed', 'NeedsReview'].includes(entry.status));
  const overall = failed?.status ?? (stageCases.length && stageCases.every(entry => entry.status === 'AC') ? 'AC' : 'Executed');
  return { status: overall, publicOutput,
    publicMessage: overall === 'AC' ? '自动测试全部通过；课程评分仍需教师审核人工阶段。'
      : ['Executed', 'NeedsReview'].includes(overall) ? '运行完成；自动检查仅供参考，不计入正式成绩。'
        : '运行未通过，请检查测试反馈或资源限制。',
    privateResults, environmentVersion };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { GoJudge, InfrastructureError } from '../judge.mjs';
import { runPaper4Snapshot, validatePaper4Filename } from '../paper4-runner.mjs';

const colors = ['Blue.txt', 'Green.txt', 'Orange.txt', 'Pink.txt', 'Red.txt', 'Yellow.txt'];
const question = { key: 'Q2', initialFiles: { 'TheData.txt': '1,Blue\n2,Red\n', ...Object.fromEntries(colors.map(name => [name, ''])) }, outputFiles: colors };
const raw = (files = {}, changes = {}) => ({ status: 'Accepted', exitStatus: 0, time: 1_000_000,
  runTime: 2_000_000, memory: 8192, files: { stdout: '', stderr: '', ...files }, ...changes });
function executor(results) {
  const calls = [];
  const judge = new GoJudge({ url: 'http://private-executor', token: 'secret-token', environmentVersion: 'runtime-test',
    fetchImpl: async (url, options) => {
      calls.push({ url, command: JSON.parse(options.body).cmd[0] });
      const next = results.shift();
      return new Response(JSON.stringify([next]), { status: 200 });
    } });
  return { judge, calls };
}

test('Paper 4 files run in fresh bounded sandboxes and only public generated files are returned', async () => {
  const { judge, calls } = executor([raw(),
    raw({ stdout: 'done\n', ...Object.fromEntries(colors.map(name => [name, name === 'Blue.txt' ? '1\n' : ''])) }),
    raw({ stdout: 'hidden answer', ...Object.fromEntries(colors.map(name => [name, name === 'Red.txt' ? '2\n' : ''])) })]);
  const result = await runPaper4Snapshot({ sourceCode: 'print("done")', question,
    runnerCases: [
      { id: 'sample', public: true, stdin: '', expectedFiles: { 'Blue.txt': '1\n' } },
      { id: 'hidden', public: false, stdin: '', inputFiles: { 'TheData.txt': '2,Red\n' }, expectedFiles: { 'Red.txt': '2\n' } },
    ] }, judge);
  assert.equal(result.status, 'Executed');
  assert.equal(result.score, undefined);
  assert.equal(result.publicOutput, 'done\n');
  assert.equal(result.privateResults[0].generatedFiles['Blue.txt'], '1\n');
  assert.deepEqual(result.privateResults[1].checks, [{ kind: 'file', passed: true }]);
  assert.equal(result.privateResults[1].stdout, undefined);
  assert.equal(result.privateResults[1].generatedFiles, undefined);
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    assert.equal(call.command.copyIn['Blue.txt'].content, '');
    assert.equal(call.command.copyIn['Red.txt'].content, '');
    assert.deepEqual(call.command.copyOut, ['stdout', 'stderr', ...colors.map(name => `${name}?`)]);
    assert.equal(call.command.copyOutMax, 64 * 1024);
    assert.equal(call.command.memoryLimit, 128 * 1024 * 1024);
  }
  assert.equal(calls[1].command.copyIn['TheData.txt'].content, '1,Blue\n2,Red\n');
  assert.equal(calls[2].command.copyIn['TheData.txt'].content, '2,Red\n');
  assert.equal(JSON.stringify(calls).includes('hidden answer'), false);
});

test('a removed output file becomes a review hint, while syntax errors remain separate', async () => {
  const missing = executor([raw(), raw({ stdout: 'ok' }, { status: 'File Error',
    fileError: [{ name: 'Blue.txt', type: 'CopyOutOpen' }] })]);
  const result = await runPaper4Snapshot({ sourceCode: 'print("ok")', question,
    runnerCases: [{ id: 'sample', public: true, expectedFiles: { 'Blue.txt': '1\n' } }] }, missing.judge);
  assert.equal(result.status, 'Executed');
  assert.equal(result.privateResults[0].status, 'NeedsReview');
  assert.equal(result.privateResults[0].checks[0].passed, false);
  const syntax = executor([raw({ stdout: 'SyntaxError at line 2' }, { status: 'Nonzero Exit Status', exitStatus: 65 })]);
  const syntaxResult = await runPaper4Snapshot({ sourceCode: 'print(', question,
    runnerCases: [{ id: 'sample', public: true, expectedStdout: 'ok' }] }, syntax.judge);
  assert.equal(syntaxResult.status, 'CE');
  assert.equal(syntax.calls.length, 1);
  assert.equal(syntaxResult.privateResults.length, 0);
});

test('a paper without configured checks still runs one public practice case and collects files', async () => {
  const emptyColors = Object.fromEntries(colors.map(name => [name, '']));
  const { judge, calls } = executor([raw(), raw({ stdout: 'ran\n', ...emptyColors, 'Blue.txt': '7\n' })]);
  const result = await runPaper4Snapshot({ sourceCode: 'print("ran")', question, runnerCases: [] }, judge);
  assert.equal(result.status, 'Executed');
  assert.equal(result.publicOutput, 'ran\n');
  assert.deepEqual(result.privateResults[0].checks, []);
  assert.equal(result.privateResults[0].generatedFiles['Blue.txt'], '7\n');
  assert.equal(calls.length, 2);
});

test('unsafe names, excessive files and executor errors fail closed before scoring', async () => {
  for (const name of ['../secret.txt', '/etc/passwd', 'dir/file.txt', '.env', 'main.py', 'a..b.txt', 'x?.txt', 'file.exe']) {
    assert.throws(() => validatePaper4Filename(name), InfrastructureError);
  }
  assert.equal(validatePaper4Filename('A.txt'), 'A.txt');
  const unsafe = executor([]);
  await assert.rejects(runPaper4Snapshot({ sourceCode: 'pass', question: { initialFiles: { '../secret.txt': 'x' } },
    runnerCases: [{ id: 'sample', public: true, expectedStdout: '' }] }, unsafe.judge), InfrastructureError);
  assert.equal(unsafe.calls.length, 0);
  const broken = executor([raw(), raw({}, { status: 'Internal Error' })]);
  await assert.rejects(runPaper4Snapshot({ sourceCode: 'pass', question,
    runnerCases: [{ id: 'sample', public: true, expectedStdout: '' }] }, broken.judge), InfrastructureError);
});

test('real go-judge: a student can delete and recreate files without carrying append data between cases',
  { skip: !(process.env.GO_JUDGE_TEST_URL && process.env.GO_JUDGE_TEST_TOKEN), timeout: 90000 }, async () => {
    const judge = new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN,
      environmentVersion: 'paper4-test' });
    await judge.ready();
    const code = `from pathlib import Path\nPath('Blue.txt').unlink()\nfor line in Path('TheData.txt').read_text().splitlines():\n    number, color = line.split(',')\n    with open(color + '.txt', 'a') as target:\n        target.write(number + '\\n')\nprint('done')\n`;
    const actual = await runPaper4Snapshot({ sourceCode: code, question, runnerCases: [
      { id: 'sample', public: true, expectedFiles: { 'Blue.txt': '1\n', 'Red.txt': '2\n' } },
      { id: 'hidden', public: false, inputFiles: { 'TheData.txt': '3,Red\n' },
        expectedFiles: { 'Blue.txt': '', 'Red.txt': '3\n' } },
    ] }, judge);
    assert.equal(actual.status, 'Executed');
    assert.deepEqual(actual.privateResults.map(entry => entry.status), ['Executed', 'Executed']);
    assert.equal(actual.privateResults[0].generatedFiles['Blue.txt'], '1\n');
    assert.equal(actual.privateResults[1].generatedFiles, undefined);
  });

import test from 'node:test';
import assert from 'node:assert/strict';
import { GoJudge, InfrastructureError, compareOutput, jsonEqual, resultVerdict, validateTask, JOB_CPU_BUDGET_NS, JOB_WALL_BUDGET_MS, createJudgingBudget } from '../judge.mjs';
import { JAVASCRIPT_MEMORY_FLOOR_MB, languageLimitsFor } from '../src/languages.mjs';

const version = { mode: 'stdio', comparator: 'tokens', time_limit_ms: 1000, memory_limit_mb: 64 };
const task = (changes = {}) => ({ kind: 'submit', version, code: 'print(input())',
  tests: [{ id: 'private-1', input: 'hidden input', expected: 'hidden answer', weight: 100 }], ...changes });
function accepted(stdout = '', changes = {}) {
  return { status: 'Accepted', exitStatus: 0, time: 1000000, memory: 8192, runTime: 2000000, files: { stdout, stderr: '' }, ...changes };
}
function executor(results) {
  const calls = [];
  const judge = new GoJudge({ url: 'http://private-executor:5050', token: 'secret-executor-token', environmentVersion: 'sha256:runtime',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: options.body && JSON.parse(options.body) });
      if (options.method === 'DELETE') return new Response('{}', { status: 200 });
      const next = results.shift();
      return new Response(JSON.stringify(next), { status: 200 });
    } });
  return { judge, calls };
}

test('comparators retain exact formatting, token semantics, and strict JSON types', () => {
  assert.equal(compareOutput('a\r\nb\r', 'a\nb\n', 'exact'), true);
  assert.equal(compareOutput('a\n', 'a', 'exact'), false);
  assert.equal(compareOutput(' 1\n 2 ', '1 2', 'tokens'), true);
  assert.equal(compareOutput('true', '1', 'json'), false);
  assert.equal(compareOutput('{"x": [1,true]}', '{"x": [1,1]}', 'json'), false);
  assert.equal(jsonEqual({ b: true, a: [1] }, { a: [1], b: true }), true);
  assert.equal(jsonEqual([1], { 0: 1 }), false);
});

test('JavaScript memory floor is disclosed and applied to preflight and cases only', () => {
  const lowMemory = { ...version, memory_limit_mb: 32 };
  const judge = new GoJudge({ url: 'http://private-executor', token: 'secret', environmentVersion: 'image' });
  assert.equal(JAVASCRIPT_MEMORY_FLOOR_MB, 128);
  assert.deepEqual(languageLimitsFor(lowMemory), {
    python: { effectiveMemoryMb: 32 }, cpp: { effectiveMemoryMb: 32 },
    javascript: { effectiveMemoryMb: 128, runtimeMemoryFloorMb: 128 },
  });
  for (const preflight of [true, false]) {
    assert.equal(judge.command({ language: 'javascript', code: 'console.log(1)', version: lowMemory, preflight }).memoryLimit, 128 * 1024 * 1024);
  }
  assert.equal(judge.command({ language: 'python', code: 'print(1)', version: lowMemory }).memoryLimit, 32 * 1024 * 1024);
  assert.equal(judge.command({ language: 'cpp', compiledFileId: 'cachedbinary123', version: lowMemory }).memoryLimit, 32 * 1024 * 1024);
  assert.equal(judge.command({ language: 'javascript', code: 'console.log(1)', version: { ...version, memory_limit_mb: 256 } }).memoryLimit, 256 * 1024 * 1024);
});

test('reject invalid formal weights, malformed function input, and oversized stored source', () => {
  assert.throws(() => validateTask(task({ tests: [{ input: '', expected: '', weight: 99 }] })), InfrastructureError);
  assert.throws(() => validateTask(task({ tests: [{ input: '', expected: '', weight: -100 }] })), InfrastructureError);
  assert.throws(() => validateTask(task({ code: 'x'.repeat(256 * 1024 + 1) })), InfrastructureError);
  assert.throws(() => validateTask(task({ version: { ...version, mode: 'function', function_name: 'solve' }, tests: [{ input: '{}', expected: '1', weight: 100 }] })), InfrastructureError);
  validateTask(task({ version: { ...version, mode: 'function', function_name: 'solve' }, tests: [{ input: '{"args":[1],"kwargs":{"b":2}}', expected: '3', weight: 100 }] }));
});

test('formal answers never enter sandbox and hidden logs never become public feedback', async () => {
  const { judge, calls } = executor([[accepted()], [accepted('hidden answer')]]);
  const result = await judge.judge(task());
  assert.equal(result.status, 'AC'); assert.equal(result.score, 100);
  assert.equal(result.publicOutput, ''); assert.equal(result.publicMessage.includes('hidden'), false);
  for (const call of calls) {
    assert.equal(call.options.headers.Authorization, 'Bearer secret-executor-token');
    assert.equal(JSON.stringify(call.body).includes('hidden answer'), false);
    const cmd = call.body.cmd[0];
    assert.equal(cmd.files[1].pipe, true); assert.equal(cmd.procLimit, 8);
    assert.equal(cmd.clockLimit, 5000000000); assert.equal(cmd.memoryLimit, 64 * 1024 * 1024);
    assert.deepEqual(Object.keys(cmd.copyIn), ['main.py']);
    assert.equal(cmd.args[0], '/usr/local/bin/python3');
    assert.equal(cmd.copyOutCached, undefined);
  }
});

test('custom execution without expected output has no AC and no score', async () => {
  const { judge } = executor([[accepted()], [accepted('42\n')]]);
  const result = await judge.judge(task({ kind: 'custom', tests: [{ input: 'public' }] }));
  assert.equal(result.status, 'Executed'); assert.equal(result.score, null); assert.equal(result.passed, null);
  assert.match(result.publicOutput, /42/);
});

test('WA continues for partial credit; fatal verdict stops later tests and retains planned total', async () => {
  const { judge, calls } = executor([[accepted()], [accepted('ok')], [accepted('wrong')],
    [accepted('secret traceback', { status: 'Nonzero Exit Status', exitStatus: 1 })]]);
  const result = await judge.judge(task({ tests: [{ input: '', expected: 'ok', weight: 25 }, { input: '', expected: 'right', weight: 25 }, { input: '', expected: '', weight: 25 }, { input: '', expected: '', weight: 25 }] }));
  assert.equal(result.status, 'RE'); assert.equal(result.score, 25); assert.equal(result.passed, 1); assert.equal(result.total, 4);
  assert.equal(calls.length, 4); assert.deepEqual(result.privateResults.map((result) => result.status), ['AC', 'WA', 'RE', 'NotRun']);
  assert.equal(result.publicOutput, ''); assert.equal(result.publicMessage.includes('secret'), false);
});

test('fixed aggregate CPU budget clips the final sandbox limit and preserves earned weights', async () => {
  assert.equal(JOB_CPU_BUDGET_NS, 30_000_000_000);
  const { judge, calls } = executor([[accepted()], ...Array.from({ length: 6 }, () => [accepted('ok', { time: 5_000_000_000, runTime: 5_000_000_000 })])]);
  const result = await judge.judge(task({ version: { ...version, time_limit_ms: 5000 }, tests: Array.from({ length: 10 }, () => ({ input: '', expected: 'ok', weight: 10 })) }));
  assert.equal(result.status, 'TLE'); assert.equal(result.score, 50); assert.equal(result.passed, 5); assert.equal(result.total, 10);
  assert.equal(calls.length, 7); assert.equal(calls.at(-1).body.cmd[0].cpuLimit, 4_999_000_000);
  assert.deepEqual(result.privateResults.map((result) => result.status), ['AC', 'AC', 'AC', 'AC', 'AC', 'TLE', 'NotRun', 'NotRun', 'NotRun', 'NotRun']);
});

test('fixed aggregate wall budget stops a job with low CPU and bounded individual sleeps', async () => {
  assert.equal(JOB_WALL_BUDGET_MS, 60_000);
  const { judge, calls } = executor([[accepted()], ...Array.from({ length: 6 }, () => [accepted('ok', { time: 100_000_000, runTime: 10_000_000_000 })])]);
  const result = await judge.judge(task({ version: { ...version, time_limit_ms: 5000 }, tests: Array.from({ length: 10 }, () => ({ input: '', expected: 'ok', weight: 10 })) }));
  assert.equal(result.status, 'TLE'); assert.equal(result.score, 50); assert.equal(result.passed, 5); assert.equal(result.total, 10);
  assert.equal(calls.length, 7); assert.equal(calls.at(-1).body.cmd[0].clockLimit, 9_998_000_000);
  assert.equal(result.privateResults.at(-1).status, 'NotRun'); assert.equal(result.publicOutput, '');
});

test('reference formal cases and samples share one job budget', async () => {
  const { judge, calls } = executor([[accepted()], ...Array.from({ length: 6 }, () => [accepted('ok', { time: 4_900_000_000, runTime: 4_900_000_000 })]), [accepted()], [accepted('ok', { time: 1_000_000_000 })]]);
  const budget = createJudgingBudget();
  const formal = await judge.judge(task({ kind: 'validation', version: { ...version, time_limit_ms: 5000 }, tests: [20, 20, 20, 20, 10, 10].map((weight) => ({ input: '', expected: 'ok', weight })) }), { budget });
  assert.equal(formal.status, 'AC');
  const samples = await judge.judge(task({ kind: 'samples', version: { ...version, time_limit_ms: 5000 }, tests: [{ input: '', expected: 'ok' }] }), { budget });
  assert.equal(samples.status, 'TLE'); assert.equal(samples.score, 0);
  assert.equal(calls.at(-1).body.cmd[0].cpuLimit, 598_000_000);
});

test('function return comparison distinguishes bool/integer and uses dedicated bounded pipe', async () => {
  const { judge, calls } = executor([[accepted()], [accepted('debug', { files: { stdout: 'debug', stderr: '', result: '{"status":"OK","value":true}' } })]]);
  const result = await judge.judge(task({ version: { ...version, mode: 'function', function_name: 'solve' }, code: 'def solve(x): return True',
    tests: [{ input: '[1]', expected: '1', weight: 100 }] }));
  assert.equal(result.status, 'WA'); assert.equal(result.score, 0);
  const cmd = calls[1].body.cmd[0];
  assert.equal(cmd.files[3].name, 'result'); assert.equal(cmd.files[3].pipe, true);
  assert.equal(cmd.files[0].content, '[1]');
  assert.deepEqual(Object.keys(cmd.copyIn), ['main.py']);
});

test('function mutation is WA and a missing signature is CE', async () => {
  for (const protocol of [{ status: 'WA', reason: 'input_mutation' }, { status: 'CE' }]) {
    const { judge } = executor([[accepted()], [accepted('', { files: { stdout: '', stderr: '', result: JSON.stringify(protocol) },
      ...(protocol.status === 'CE' ? { status: 'Nonzero Exit Status', exitStatus: 65 } : {}) })]]);
    const result = await judge.judge(task({ version: { ...version, mode: 'function', function_name: 'solve' }, code: 'def solve(x): pass',
      tests: [{ input: '[[]]', expected: 'null', weight: 100 }] }));
    assert.equal(result.status, protocol.status);
  }
});

test('syntax CE produces zero without executing a test; setup failures fail closed', async () => {
  const { judge, calls } = executor([[accepted('SyntaxError at line 1', { status: 'Nonzero Exit Status', exitStatus: 65 })]]);
  const result = await judge.judge(task());
  assert.equal(result.status, 'CE'); assert.equal(result.score, 0); assert.equal(calls.length, 1);
  const bad = executor([[accepted('', { status: 'Nonzero Exit Status', exitStatus: 127 })]]);
  await assert.rejects(bad.judge.judge(task()), InfrastructureError);
});

test('executor unknown/internal status, missing output and excess response are infrastructure errors', async () => {
  for (const response of [accepted('', { status: 'New Unrecognized Status' }), accepted('', { status: 'Internal Error' }), accepted('', { files: {} })]) {
    const { judge } = executor([[response]]);
    await assert.rejects(judge.judge(task()), InfrastructureError);
  }
  const judge = new GoJudge({ url: 'http://private-executor', token: 'secret', environmentVersion: 'image',
    fetchImpl: async () => new Response('x'.repeat(1024)) });
  await assert.rejects(judge.request('/version', undefined, { responseLimit: 128 }), InfrastructureError);
  assert.throws(() => resultVerdict(accepted('', { exitStatus: 1 })), InfrastructureError);
});

test('invalid UTF-8 overflow is OLE rather than an infrastructure retry', async () => {
  const { judge } = executor([[accepted()], [accepted('', { status: 'Output Limit Exceeded', exitStatus: 0,
    files: { stdout: '\uFFFD'.repeat(1024 * 1024 + 1), stderr: '' }, fileError: [{ name: 'stdout', type: 'CollectSizeExceeded' }] })]]);
  const result = await judge.judge(task());
  assert.equal(result.status, 'OLE'); assert.equal(result.score, 0); assert.equal(result.publicOutput, '');
});

test('startup refuses a missing config, weak cgroups or a root/shared-network runtime', async () => {
  assert.throws(() => new GoJudge({ url: 'http://executor', token: '', environmentVersion: 'image' }), InfrastructureError);
  const config = { runnerConfig: { cgroupType: 2, cgroupControllers: ['cpu', 'memory', 'pids'] } };
  const versionResponse = { os: 'linux', fixSymlinkEscape: true, buildVersion: 'v1.13.2' };
  const unsafe = executor([versionResponse, { runnerConfig: { cgroupType: 0 } }]);
  await assert.rejects(unsafe.judge.ready(), InfrastructureError);
  const root = executor([versionResponse, config, [accepted(JSON.stringify({ python: [3, 12, 1], uid: 0, interfaces: ['lo'], reachable: false }))]]);
  await assert.rejects(root.judge.ready(), InfrastructureError);
  const network = executor([versionResponse, config, [accepted(JSON.stringify({ python: [3, 12, 1], uid: 10000, interfaces: ['lo', 'eth0'], reachable: false }))]]);
  await assert.rejects(network.judge.ready(), InfrastructureError);
  const safe = executor([versionResponse, config, [accepted(JSON.stringify({ python: [3, 12, 1], uid: 10000, interfaces: ['lo'], reachable: false }))],
    [accepted('', { fileIds: { main: 'cachedbinary123' } })], [accepted('19.1.7 14 202302')],
    [accepted(JSON.stringify({ node: '22.16.0', uid: 10000, interfaces: ['lo'] }))]]);
  assert.match(await safe.judge.ready(), /v1\.13\.2\/python-3\.12\.1/);
  assert.match(safe.judge.runtimeVersion, /clang-19\.1\.7-libstdc\+\+14-c\+\+23\/node-22\.16\.0/);
  assert.equal(safe.calls.filter(call => call.options.method === 'DELETE').length, 1);
});

test('C++ compiles inside sandbox, runs cached binary without hidden answers and releases the file', async () => {
  const { judge, calls } = executor([[accepted('', { fileIds: { main: 'cachedbinary123' } })], [accepted('7\n')]]);
  const result = await judge.judge(task({ language: 'cpp', code: '#include <iostream>\nint main(){std::cout<<7;}' ,
    tests: [{ input: 'private input', expected: '7', weight: 100 }] }));
  assert.equal(result.status, 'AC');
  assert.deepEqual(calls[0].body.cmd[0].args.slice(0, 3), ['/usr/bin/clang++-19', '-std=c++23', '-stdlib=libstdc++']);
  assert.deepEqual(calls[0].body.cmd[0].copyOutCached, ['main']);
  assert.equal(calls[1].body.cmd[0].copyIn.main.fileId, 'cachedbinary123');
  assert.equal(calls[1].body.cmd[0].files[0].content, 'private input');
  assert.equal(JSON.stringify(calls.slice(0, 2)).includes('"expected":"7"'), false);
  assert.equal(calls[2].options.method, 'DELETE');
});

test('C++ compile diagnostics are CE before private cases and JS keeps syntax/runtime separate', async () => {
  const broken = executor([[accepted('', { status: 'Nonzero Exit Status', exitStatus: 1, files: { stdout: '', stderr: 'bad syntax' } })]]);
  const cpp = await broken.judge.judge(task({ language: 'cpp', code: 'not cpp' }));
  assert.equal(cpp.status, 'CE'); assert.match(cpp.publicMessage, /bad syntax/);
  assert.equal(broken.calls.length, 1);
  const js = executor([[accepted('', { status: 'Nonzero Exit Status', exitStatus: 1, files: { stdout: '', stderr: 'SyntaxError' } })]]);
  assert.equal((await js.judge.judge(task({ language: 'javascript', code: 'function {' }))).status, 'CE');
  assert.deepEqual(js.calls[0].body.cmd[0].args.slice(0, 2), ['/usr/local/bin/node', '--check']);
});

test('JavaScript syntax-check resource exhaustion is a code verdict, not an infrastructure retry', async () => {
  const exhausted = executor([[accepted('', { status: 'Memory Limit Exceeded', exitStatus: 0 })]]);
  const result = await exhausted.judge.judge(task({ language: 'javascript', version: { ...version, memory_limit_mb: 32 }, code: 'function solve(){}' }));
  assert.equal(result.status, 'CE'); assert.equal(result.score, 0);
  assert.equal(exhausted.calls[0].body.cmd[0].memoryLimit, 128 * 1024 * 1024);
  assert.equal(exhausted.calls.length, 1);
});

test('both new language function modes use bounded fd3 return protocol', async () => {
  const cpp = executor([[accepted('', { fileIds: { main: 'cachedbinary123' } })],
    [accepted('', { files: { stdout: '', stderr: '', result: '{"status":"OK","value":true}' } })]]);
  const c = await cpp.judge.judge(task({ language: 'cpp', version: { ...version, mode: 'function', function_name: 'solve', comparator: 'json' },
    code: 'json solve(json& args, json& kwargs){ return true; }', tests: [{ input: '[1]', expected: '1', weight: 100 }] }));
  assert.equal(c.status, 'WA'); assert.equal(cpp.calls[1].body.cmd[0].files[3].name, 'result');
  assert.match(cpp.calls[0].body.cmd[0].copyIn['main.cpp'].content, /json \(\*fn\)\(json&, json&\) = &solve/);
  const js = executor([[accepted()], [accepted('', { files: { stdout: '', stderr: '', result: '{"status":"WA","reason":"input_mutation"}' } })]]);
  const j = await js.judge.judge(task({ language: 'javascript', version: { ...version, mode: 'function', function_name: 'solve', comparator: 'json' },
    code: 'function solve(a){a.push(1);return 1}', tests: [{ input: '[[]]', expected: '1', weight: 100 }] }));
  assert.equal(j.status, 'WA'); assert.match(js.calls[1].body.cmd[0].args[2], /input_mutation/);
});

test('deep or oversized function result protocol is a student RE, not an infrastructure retry', async () => {
  const nested = '['.repeat(66) + '0' + ']'.repeat(66);
  const { judge } = executor([[accepted()], [accepted('', { files: { stdout: '', stderr: '', result: `{"status":"OK","value":${nested}}` } })]]);
  const result = await judge.judge(task({ version: { ...version, mode: 'function', function_name: 'solve', comparator: 'json' },
    code: 'def solve(): return 0', tests: [{ input: '[]', expected: '0', weight: 100 }] }));
  assert.equal(result.status, 'RE');
  assert.equal(result.score, 0);
});

test('the executor transport timeout covers C++ compile allowance without lengthening readiness GETs', async () => {
  const judge = new GoJudge({ url: 'http://private-executor', token: 'secret', environmentVersion: 'image' });
  let timeout;
  judge.request = async (_path, _body, options) => { timeout = options.timeoutMs; return [accepted('', { fileIds: { main: 'cachedbinary123' } })]; };
  await judge.execute(judge.command({ language: 'cpp', code: 'int main(){}', version }));
  assert.equal(timeout, 35000);
  assert.equal(judge.requestTimeoutMs, 15000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GoJudge } from '../judge.mjs';

// Opt in against the actual hardened Linux service; no host Python or mocked
// sandbox ever passes these integration/security checks.
const enabled = Boolean(process.env.GO_JUDGE_TEST_URL && process.env.GO_JUDGE_TEST_TOKEN);
const version = { mode: 'stdio', comparator: 'tokens', time_limit_ms: 500, memory_limit_mb: 64 };
const functionVersion = { ...version, mode: 'function', function_name: 'solve', comparator: 'json' };
const judge = enabled ? new GoJudge({ url: process.env.GO_JUDGE_TEST_URL, token: process.env.GO_JUDGE_TEST_TOKEN,
  environmentVersion: process.env.JUDGE_ENVIRONMENT_VERSION ?? 'integration-runtime' }) : null;
const make = (code, tests = [{ input: '', expected: '', weight: 100 }], changes = {}) => ({ code, tests, kind: 'submit', version, ...changes });

test('real sandbox: pinned NumPy stdio/function, immutable vendor, no site initialization', { skip: !enabled, timeout: 30000 }, async () => {
  const scientificVersion = { ...version, time_limit_ms: 2000, memory_limit_mb: 128 };
  const code = 'import numpy as np\nprint(np.__version__)\nprint(int(np.linalg.det([[2,0],[0,3]]).round()))';
  assert.equal((await judge.judge(make(code, [{ input: '', expected: '2.2.6 6', weight: 100 }], { version: scientificVersion }))).status, 'AC');
  const solve = 'import numpy as np\ndef solve(a): return np.array(a,dtype=np.int64).T.tolist()';
  assert.equal((await judge.judge(make(solve, [{ input: '[[[1,2],[3,4]]]', expected: '[[1,3],[2,4]]', weight: 100 }],
    { version: { ...scientificVersion, mode: 'function', function_name: 'solve', comparator: 'json' } }))).status, 'AC');
  const isolation = "import os,sys\nassert sys.flags.isolated and sys.flags.no_site\nassert '/w' not in sys.path and '' not in sys.path\nassert os.environ['OPENBLAS_NUM_THREADS']=='1'\ntry:\n open('/usr/local/lib/campus-python/numpy/__init__.py','a').write('x')\nexcept OSError:\n print('readonly')\nelse:\n print('WRITABLE')";
  assert.equal((await judge.judge(make(isolation, [{ input: '', expected: 'readonly', weight: 100 }], { version: scientificVersion }))).status, 'AC');
});

test('real sandbox: Python 3.12, cgroup v2, non-root, isolated network', { skip: !enabled }, async () => {
  assert.match(await judge.ready(), /python-3\.12\./);
});

test('real sandbox: stdio accepted, wrong answer, syntax/runtime errors and custom execution', { skip: !enabled }, async () => {
  assert.equal((await judge.judge(make('a,b=map(int,input().split()); print(a+b)', [{ input: '3 4', expected: '7', weight: 100 }]))).status, 'AC');
  assert.equal((await judge.judge(make('print(1)', [{ input: '', expected: '2', weight: 100 }]))).status, 'WA');
  assert.equal((await judge.judge(make('def nope(:'))).status, 'CE');
  assert.equal((await judge.judge(make('raise RuntimeError("private")'))).status, 'RE');
  const result = await judge.judge(make('print(42)', [{ input: '' }], { kind: 'custom' }));
  assert.equal(result.status, 'Executed'); assert.equal(result.score, null); assert.match(result.publicOutput, /42/);
});

test('real sandbox: function return, signature, bool/integer, exception and input mutation', { skip: !enabled }, async () => {
  const run = (code, input, expected) => judge.judge(make(code, [{ input, expected, weight: 100 }], { version: functionVersion }));
  assert.equal((await run('def solve(a,b):\n print("debug")\n return a+b', '[3,4]', '7')).status, 'AC');
  assert.equal((await run('def solve(x): return True', '[1]', '1')).status, 'WA');
  assert.equal((await run('def other(x): return x', '[1]', '1')).status, 'CE');
  assert.equal((await run('def solve(a,b): return a+b', '[1]', '1')).status, 'CE');
  assert.equal((await run('def solve(a):\n a.append(1)\n return 1', '[[]]', '1')).status, 'WA');
  const failure = await run('def solve(a): raise Exception(str(a))', '["hidden secret"]', 'null');
  assert.equal(failure.status, 'RE'); assert.equal(failure.publicOutput, ''); assert.equal(failure.publicMessage.includes('secret'), false);
});

test('real sandbox: CPU, wall-clock, memory and both output pipes are bounded', { skip: !enabled, timeout: 30000 }, async () => {
  assert.equal((await judge.judge(make('while True: pass'))).status, 'TLE');
  assert.equal((await judge.judge(make('import time; time.sleep(15)'))).status, 'TLE');
  const memory = await judge.judge(make('x = bytearray(256*1024*1024)'));
  assert.equal(memory.status, 'MLE');
  assert.equal((await judge.judge(make('while True: print("x"*8192)'))).status, 'OLE');
  assert.equal((await judge.judge(make('import sys\nwhile True: sys.stderr.write("x"*8192)'))).status, 'OLE');
  assert.equal((await judge.judge(make('import sys; sys.stdout.buffer.write(bytes([255])*1100000)'))).status, 'OLE');
});

test('real sandbox: files are independent; privileged host paths are absent; process spawning is restricted', { skip: !enabled }, async () => {
  const run = (code, expected) => judge.judge(make(code, [{ input: '', expected, weight: 100 }]));
  assert.equal((await run('open("/w/persist", "w").write("x"); print("written")', 'written')).status, 'AC');
  assert.equal((await run('import os; print(os.path.exists("/w/persist"), os.path.exists("/app"), os.getuid()==0)', 'False False False')).status, 'AC');
  const fork = await judge.judge(make('import os, time\nfor _ in range(20):\n if os.fork()==0: time.sleep(15)\nprint("unexpected")'));
  assert.ok(['RE', 'TLE'].includes(fork.status));
});

test('real sandbox: C++23 Clang19/GCC14 stdio, samples, compile error and no leaked binary', { skip: !enabled, timeout: 90000 }, async () => {
  await judge.ready();
  const before = await judge.request('/file');
  const code = '#include <iostream>\nint main(){ long long a,b; std::cin>>a>>b; std::cout<<(a+b); }';
  const input = [{ input: '3 4', expected: '7', weight: 100 }];
  assert.equal((await judge.judge(make(code, input, { language: 'cpp' }))).status, 'AC');
  const samples = await judge.judge(make(code, [{ input: '8 5', expected: '13' }], { language: 'cpp', kind: 'samples' }));
  assert.equal(samples.status, 'AC'); assert.match(samples.publicOutput, /13/);
  const ce = await judge.judge(make('int main( {', input, { language: 'cpp' }));
  assert.equal(ce.status, 'CE'); assert.equal(ce.score, 0);
  const after = await judge.request('/file');
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
});

test('real sandbox: JavaScript stdio and both language JSON-function contracts', { skip: !enabled, timeout: 90000 }, async () => {
  const jsCode = "const fs=require('node:fs');const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b)";
  assert.equal((await judge.judge(make(jsCode, [{ input: '3 4', expected: '7', weight: 100 }], { language: 'javascript' }))).status, 'AC');
  assert.equal((await judge.judge(make('function {', [{ input: '', expected: '', weight: 100 }], { language: 'javascript' }))).status, 'CE');
  const cppCode = 'json solve(json& args,json& kwargs){ return args.at(0).get<int>()+args.at(1).get<int>(); }';
  const tests = [{ input: '[3,4]', expected: '7', weight: 100 }];
  const functionMode = { ...functionVersion, time_limit_ms: 2000, memory_limit_mb: 128 };
  assert.equal((await judge.judge(make(cppCode, tests, { language: 'cpp', version: functionMode }))).status, 'AC');
  assert.equal((await judge.judge(make('json wrong(json& args,json& kwargs){return 7;}', tests, { language: 'cpp', version: functionMode }))).status, 'CE');
  assert.equal((await judge.judge(make('json solve(json& args,json& kwargs){args.push_back(1);return 7;}', tests, { language: 'cpp', version: functionMode }))).status, 'WA');
  assert.equal((await judge.judge(make('function solve(a,b){return a+b}', tests, { language: 'javascript', version: functionMode }))).status, 'AC');
  assert.equal((await judge.judge(make('function solve(a,b){a.push(1);return 7}', [{ input: '[[],4]', expected: '7', weight: 100 }], { language: 'javascript', version: functionMode }))).status, 'WA');
  assert.equal((await judge.judge(make('function solve(){return NaN}', [{ input: '[]', expected: 'null', weight: 100 }], { language: 'javascript', version: functionMode }))).status, 'RE');
  assert.equal((await judge.judge(make('json solve(json& args,json& kwargs){return std::numeric_limits<double>::quiet_NaN();}',
    [{ input: '[]', expected: 'null', weight: 100 }], { language: 'cpp', version: functionMode }))).status, 'RE');
});

test('real sandbox: 32 MiB authored JavaScript has a disclosed 128 MiB effective bound', { skip: !enabled, timeout: 30000 }, async () => {
  const lowMemory = { ...functionVersion, memory_limit_mb: 32, time_limit_ms: 2000 };
  const solved = await judge.judge(make('function solve(x){return x+1}',
    [{ input: '[41]', expected: '42', weight: 100 }], { language: 'javascript', version: lowMemory }));
  assert.equal(solved.status, 'AC');
  const exceeded = await judge.judge(make('const blocks=[]; while(true) blocks.push(Buffer.alloc(1024*1024, 1));',
    [{ input: '', expected: '', weight: 100 }], { language: 'javascript', version: { ...version, memory_limit_mb: 32, time_limit_ms: 2000 } }));
  assert.equal(exceeded.status, 'MLE');
  assert.equal(exceeded.score, 0);
});

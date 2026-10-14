// This module never starts a host process. All Python, including syntax checking,
// runs inside the configured go-judge service. The expected answer is ONLY used
// by this process, never copied into the student's sandbox.
import { performance } from 'node:perf_hooks';
import { parseFunctionInput, parseJsonValue, validateJsonValue } from './src/function-input.mjs';
import { LANGUAGES, effectiveMemoryMb } from './src/languages.mjs';

export class InfrastructureError extends Error {
  constructor(message, options) { super(message, options); this.name = 'InfrastructureError'; }
}

const SOURCE_LIMIT = 256 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;
const DISPLAY_LIMIT = 64 * 1024;
const PRIVATE_LOG_LIMIT = 8192;
const CPP_COMPILE_CPU_NS = 15_000_000_000;
const CPP_COMPILE_WALL_NS = 30_000_000_000;
const CPP_COMPILE_MEMORY = 768 * 1024 * 1024;
// Fixed classroom capacity limits, including syntax checking. A testcase also
// retains its stricter own limit; these aggregate limits cannot be disabled.
export const JOB_CPU_BUDGET_NS = 30_000_000_000;
export const JOB_WALL_BUDGET_MS = 60_000;
const FAILURE_ORDER = ['CE', 'RE', 'TLE', 'MLE', 'OLE', 'WA'];
const FATAL_VERDICTS = new Set(['CE', 'RE', 'TLE', 'MLE', 'OLE']);
const MESSAGES = {
  AC: '全部测试通过。', WA: '部分测试未通过。', CE: '代码语法、函数名称或参数签名不符合题目要求。',
  RE: '程序运行异常。', TLE: '运行超过时间限制。', MLE: '运行超过内存限制。', OLE: '输出超过限制。',
  Executed: '运行完成；自定义输入没有标准答案，不作正确性判定。', 'System Error': '评测服务暂不可用，请等待重试。',
};

class JudgingBudget {
  constructor() {
    this.startedAt = performance.now();
    this.wallSignal = AbortSignal.timeout(JOB_WALL_BUDGET_MS);
    this.cpuNs = 0;
    this.wallNs = 0;
  }
}
// Reference validation executes formal cases and samples in two calls. They
// must share one budget for the whole leased job rather than get two limits.
export function createJudgingBudget() { return new JudgingBudget(); }

const PREFLIGHT = String.raw`import ast, json, sys
source = open('/w/main.py', encoding='utf-8').read()
try:
    tree = ast.parse(source, filename='main.py')
    compile(tree, 'main.py', 'exec')
    name = sys.argv[1]
    if name and not any(isinstance(node, ast.FunctionDef) and node.name == name for node in tree.body):
        print('Required top-level function is missing.')
        sys.exit(65)
except SyntaxError as error:
    print('SyntaxError at line %s: %s' % (error.lineno, error.msg))
    sys.exit(65)
`;

// fd 3 contains the JSON return protocol. Debug prints go to fd 1 and are bounded
// by a pipe collector, so print does not become a return value. Like any function
// wrapper this is a calling convention, not a security boundary; Linux isolation
// is provided by go-judge and the answer remains outside that boundary.
const FUNCTION_HARNESS = String.raw`import ast, copy, inspect, json, os, sys
_write = os.write
_encode = json.dumps
_deepcopy = copy.deepcopy
_loads = json.loads
_signature = inspect.signature
_source = open('/w/main.py', encoding='utf-8').read()
_function_name = sys.argv[1]
_payload = _loads(sys.stdin.read())
_args = _payload if isinstance(_payload, list) else _payload['args']
_kwargs = {} if isinstance(_payload, list) else _payload.get('kwargs', {})
_before = _deepcopy([_args, _kwargs])
def _emit(value):
    data = _encode(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    while data:
        n = _write(3, data)
        data = data[n:]
_scope = {'__name__': '__student__', '__file__': 'main.py'}
try:
    exec(compile(_source, 'main.py', 'exec'), _scope)
    _fn = _scope.get(_function_name)
    if not callable(_fn):
        _emit({'status': 'CE'})
        sys.exit(65)
    try:
        _signature(_fn).bind(*_args, **_kwargs)
    except (TypeError, ValueError):
        _emit({'status': 'CE'})
        sys.exit(65)
    _value = _fn(*_args, **_kwargs)
    # Use serialized JSON to distinguish bool from numbers and compare the
    # complete parameter tree. Never pass an expected answer to this script.
    _before_json = _encode(_before, sort_keys=True, allow_nan=False)
    _after_json = _encode([_args, _kwargs], sort_keys=True, allow_nan=False)
    if _before_json != _after_json:
        _emit({'status': 'WA', 'reason': 'input_mutation'})
    else:
        _emit({'status': 'OK', 'value': _value})
except (SystemExit, KeyboardInterrupt):
    raise
except BaseException:
    # Exception text could contain hidden arguments. Do not send it as feedback.
    _emit({'status': 'RE'})
    sys.exit(70)
`;

// Fixed function calling conventions. These wrappers are copied into isolated
// go-judge sandboxes with the student's source; expected answers stay in the
// worker and are compared only after the executor has returned.
const JS_FUNCTION_HARNESS = String.raw`const fs = require('node:fs');
const equal = require('node:util').isDeepStrictEqual;
const source = fs.readFileSync('/w/main.js', 'utf8');
const name = process.argv[1];
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const args = Array.isArray(payload) ? payload : payload.args;
const kwargs = Array.isArray(payload) ? {} : (payload.kwargs || {});
const before = structuredClone([args, kwargs]);
const emit = (value) => fs.writeSync(3, JSON.stringify(value));
let fn;
try {
  fn = new Function('require', 'console', source + '\nreturn typeof ' + name + ' === "function" ? ' + name + ' : undefined;')(require, console);
  if (typeof fn !== 'function') { emit({status: 'CE'}); process.exit(65); }
  const value = fn(...args, ...(Object.keys(kwargs).length ? [kwargs] : []));
  if (value && typeof value.then === 'function') throw new Error('Async returns are unsupported.');
  if (!equal([args, kwargs], before)) emit({status: 'WA', reason: 'input_mutation'});
  else {
    const encoded = JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'number' && !Number.isFinite(entry) ||
          entry === undefined || typeof entry === 'function' ||
          typeof entry === 'symbol' || typeof entry === 'bigint') throw new Error('Invalid JSON return.');
      return entry;
    });
    if (encoded === undefined) throw new Error('Return value is not JSON.');
    emit({status: 'OK', value: JSON.parse(encoded)});
  }
} catch (error) {
  if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') process.exit(70);
  emit({status: 'RE'}); process.exit(70);
}
`;

function cppFunctionSource(code, name) {
  // The exact signature is intentionally explicit. Arbitrary C++ parameter
  // types cannot be inferred safely from free-text problem metadata.
  return `#include <nlohmann/json.hpp>\n#include <unistd.h>\n#include <cmath>\n#include <iostream>\n#include <stdexcept>\n#include <string>\nusing nlohmann::json;\n${code}\n\nbool campus_valid_json(const json& value, int depth, int& nodes) {\n  if (depth > 64 || ++nodes > 50000) return false;\n  if (value.is_number_float() && !std::isfinite(value.get<double>())) return false;\n  if (value.is_array() || value.is_object())\n    for (const auto& child : value) if (!campus_valid_json(child, depth + 1, nodes)) return false;\n  return true;\n}\n\nint main() {\n  try {\n    json payload; std::cin >> payload;\n    json args = payload.is_array() ? payload : payload.at("args");\n    json kwargs = payload.is_array() ? json::object() : payload.value("kwargs", json::object());\n    const json beforeArgs = args, beforeKwargs = kwargs;\n    json (*fn)(json&, json&) = &${name};\n    json value = fn(args, kwargs);\n    int nodes = 0;\n    if (!campus_valid_json(value, 0, nodes)) throw std::runtime_error("Invalid JSON return");\n    json protocol = (args != beforeArgs || kwargs != beforeKwargs)\n      ? json{{"status", "WA"}, {"reason", "input_mutation"}}\n      : json{{"status", "OK"}, {"value", value}};\n    const std::string result = protocol.dump();\n    if (::write(3, result.data(), result.size()) < 0) return 70;\n    return 0;\n  } catch (...) {\n    const std::string result = R"({"status":"RE"})";\n    ::write(3, result.data(), result.size());\n    return 70;\n  }\n}\n`;
}

const RUNTIME_PROBE = String.raw`import json, os, socket, sys
interfaces = [line.split(':')[0].strip() for line in open('/proc/self/net/dev').read().splitlines()[2:]]
reachable = False
for address in [('127.0.0.1', 5050), ('1.1.1.1', 443)]:
    sock = None
    try:
        sock = socket.socket()
        sock.settimeout(0.2)
        sock.connect(address)
        reachable = True
    except OSError:
        pass
    finally:
        if sock is not None:
            sock.close()
print(json.dumps({'python': list(sys.version_info[:3]), 'uid': os.getuid(), 'interfaces': interfaces, 'reachable': reachable}))
`;

function bytes(value) { return Buffer.byteLength(value, 'utf8'); }
function capped(value, limit) { return Buffer.from(value ?? '', 'utf8').subarray(0, limit).toString('utf8'); }

export function jsonEqual(actual, expected) {
  if (actual === null || expected === null) return actual === expected;
  if (typeof actual !== typeof expected) return false;
  if (typeof actual !== 'object') return actual === expected;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(actual), otherKeys = Object.keys(expected);
  if (keys.length !== otherKeys.length) return false;
  return keys.every((key) => Object.hasOwn(expected, key) && jsonEqual(actual[key], expected[key]));
}

export function compareOutput(actual, expected, comparator = 'tokens') {
  if (comparator === 'json') {
    try { return jsonEqual(parseJsonValue(actual), parseJsonValue(expected)); } catch { return false; }
  }
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  if (comparator === 'exact') return normalize(actual) === normalize(expected);
  if (comparator !== 'tokens') throw new InfrastructureError('Unsupported comparator.');
  const tokens = (text) => text.trim() === '' ? [] : text.trim().split(/\s+/u);
  return jsonEqual(tokens(actual), tokens(expected));
}

function validInput(input, mode) {
  if (typeof input !== 'string' || bytes(input) > SOURCE_LIMIT) throw new InfrastructureError('Invalid stored testcase input.');
  if (mode !== 'function') return;
  try { parseFunctionInput(input); }
  catch { throw new InfrastructureError('Invalid stored function JSON input.'); }
}

export function validateTask(task) {
  if (!task || !task.version || !['submit', 'correction', 'samples', 'custom', 'validation'].includes(task.kind)) throw new InfrastructureError('Invalid task.');
  const version = task.version;
  if (!LANGUAGES.includes(task.language ?? 'python')) throw new InfrastructureError('Unsupported stored language.');
  if (!['stdio', 'function'].includes(version.mode) || typeof task.code !== 'string' || bytes(task.code) > SOURCE_LIMIT) throw new InfrastructureError('Invalid task code or mode.');
  if (version.mode === 'function' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(version.function_name ?? '')) throw new InfrastructureError('Invalid function name.');
  if (!Number.isInteger(version.time_limit_ms) || version.time_limit_ms < 100 || version.time_limit_ms > 5000 ||
      !Number.isInteger(version.memory_limit_mb) || version.memory_limit_mb < 32 || version.memory_limit_mb > 256) throw new InfrastructureError('Invalid resource limits.');
  if (!['tokens', 'exact', 'json'].includes(version.comparator)) throw new InfrastructureError('Invalid comparator.');
  if (!Array.isArray(task.tests) || !task.tests.length || task.tests.length > 200) throw new InfrastructureError('Task must contain 1–200 testcases.');
  let units = 0;
  for (const test of task.tests) {
    validInput(test.input, version.mode);
    if (task.kind !== 'custom') {
      if (typeof test.expected !== 'string' || bytes(test.expected) > OUTPUT_LIMIT) throw new InfrastructureError('Invalid stored expected output.');
      if (version.mode === 'function' || version.comparator === 'json') {
        try { parseJsonValue(test.expected); } catch { throw new InfrastructureError('Invalid stored JSON answer.'); }
      }
    }
    if (['submit', 'correction', 'validation'].includes(task.kind)) {
      const weight = Number(test.weight), scaled = Math.round(weight * 10000);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100 || Math.abs(scaled / 10000 - weight) > 1e-9) throw new InfrastructureError('Invalid testcase weight.');
      units += scaled;
    }
  }
  if (['submit', 'correction', 'validation'].includes(task.kind) && units !== 1000000) throw new InfrastructureError('Formal testcase weights must total 100.');
}

async function readJsonBounded(response, limit) {
  if (!response.body) throw new InfrastructureError('Empty executor response.');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new InfrastructureError('Executor response exceeds limit.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError('Invalid executor response.', { cause: error });
  } finally { reader.releaseLock(); }
}

export class GoJudge {
  constructor({ url = process.env.GO_JUDGE_URL, token = process.env.GO_JUDGE_TOKEN,
    python = '/usr/local/bin/python3', environmentVersion = process.env.JUDGE_ENVIRONMENT_VERSION,
    fetchImpl = fetch, requestTimeoutMs = 15000 } = {}) {
    if (!url || !token || !environmentVersion) throw new InfrastructureError('GO_JUDGE_URL, GO_JUDGE_TOKEN and JUDGE_ENVIRONMENT_VERSION are required.');
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new InfrastructureError('Invalid executor URL.');
    if (typeof python !== 'string' || !python.startsWith('/')) throw new InfrastructureError('Python path must be absolute.');
    this.url = parsed.href.replace(/\/$/, ''); this.token = token; this.python = python;
    this.environmentVersion = environmentVersion; this.fetch = fetchImpl; this.requestTimeoutMs = requestTimeoutMs;
  }

  async request(path, body, { signal, responseLimit = 20 * OUTPUT_LIMIT, timeoutMs = this.requestTimeoutMs } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetch(`${this.url}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) { await response.body?.cancel(); throw new InfrastructureError(`Executor returned HTTP ${response.status}.`); }
      return await readJsonBounded(response, responseLimit);
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      throw new InfrastructureError('Executor request unavailable or timed out.', { cause: error });
    }
  }

  async deleteFile(fileId) {
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(fileId)) throw new InfrastructureError('Invalid cached binary ID.');
    const response = await this.fetch(`${this.url}/file/${encodeURIComponent(fileId)}`, {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(this.requestTimeoutMs),
      headers: { Authorization: `Bearer ${this.token}` },
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw new InfrastructureError('Executor cached binary cleanup failed.');
  }

  command({ code, input = '', script, functionName = '', version, resultPipe = false,
    language = 'python', compiledFileId = null, preflight = false }) {
    const output = OUTPUT_LIMIT;
    const common = {
      env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'HOME=/w', 'TMPDIR=/tmp', 'PYTHONHASHSEED=0'],
      files: [{ content: input }, { name: 'stdout', max: output, pipe: true }, { name: 'stderr', max: output, pipe: true },
        ...(resultPipe ? [{ name: 'result', max: output, pipe: true }] : [])],
      cpuLimit: version.time_limit_ms * 1000000,
      clockLimit: Math.max(5000, version.time_limit_ms * 2 + 1000) * 1000000,
      memoryLimit: effectiveMemoryMb(language, version.memory_limit_mb) * 1024 * 1024,
      stackLimit: 32 * 1024 * 1024, procLimit: 8,
      copyOut: ['stdout', 'stderr', ...(resultPipe ? ['result'] : [])],
      copyOutMax: output, copyOutTruncate: false,
    };
    if (language === 'cpp' && code !== undefined) return {
      ...common, args: ['/usr/bin/clang++-19', '-std=c++23', '-stdlib=libstdc++', '-O2', '-pipe', '-o', '/w/main', '/w/main.cpp'],
      cpuLimit: CPP_COMPILE_CPU_NS, clockLimit: CPP_COMPILE_WALL_NS, memoryLimit: CPP_COMPILE_MEMORY,
      stackLimit: 64 * 1024 * 1024, procLimit: 32,
      copyIn: { 'main.cpp': { content: functionName ? cppFunctionSource(code, functionName) : code } },
      copyOutCached: ['main'], copyOutMax: 8 * 1024 * 1024,
    };
    if (language === 'cpp') return {
      ...common, args: ['/w/main'], copyIn: { main: { fileId: compiledFileId } },
    };
    if (language === 'javascript') return {
      ...common,
      args: ['/usr/local/bin/node', ...(preflight ? ['--check', '/w/main.js'] : script ? ['-e', script, functionName] : ['/w/main.js'])],
      copyIn: { 'main.js': { content: code } },
    };
    return {
      ...common, args: [this.python, '-I', '-S', ...(script ? ['-c', script, functionName] : ['/w/main.py'])],
      copyIn: code === undefined ? {} : { 'main.py': { content: code } },
    };
  }

  async execute(command, signal) {
    // A compiler may legitimately use its 30s sandbox wall allowance. The
    // transport timeout must outlive that allowance; judge() still applies
    // the stricter shared 60s task signal across compile and all cases.
    const timeoutMs = Math.min(JOB_WALL_BUDGET_MS + 5000,
      Math.max(this.requestTimeoutMs, Math.ceil(command.clockLimit / 1_000_000) + 5000));
    const results = await this.request('/run', { cmd: [command] }, { signal, timeoutMs });
    if (!Array.isArray(results) || results.length !== 1 || !results[0] || typeof results[0].status !== 'string') throw new InfrastructureError('Unexpected executor result.');
    const result = results[0];
    if (!Number.isInteger(result.exitStatus) || !Number.isFinite(result.time) || result.time < 0 ||
        !Number.isFinite(result.memory) || result.memory < 0 || !Number.isFinite(result.runTime) || result.runTime < 0) throw new InfrastructureError('Invalid executor metrics.');
    for (const name of command.copyOut) {
      if (result.status === 'Accepted' && typeof result.files?.[name] !== 'string') throw new InfrastructureError('Executor omitted required output.');
      if (typeof result.files?.[name] === 'string' && bytes(result.files[name]) > OUTPUT_LIMIT) {
        // go-judge retains one raw sentinel byte when a collector overflows.
        // JSON also replaces each invalid UTF-8 byte with U+FFFD, which can
        // expand the returned text to three times its bounded raw size.
        const text = result.files[name];
        const expanded = text.includes('\uFFFD');
        const maximum = expanded ? 3 * (OUTPUT_LIMIT + 1) : OUTPUT_LIMIT + 1;
        if (bytes(text) > maximum || (!hasOutputOverflow(result) && !expanded)) throw new InfrastructureError('Executor ignored output limit.');
        if (hasOutputOverflow(result)) result.files[name] = capped(text, OUTPUT_LIMIT);
      }
    }
    if (result.status === 'Internal Error') throw new InfrastructureError('Executor reported an internal error.');
    if (result.status === 'File Error' && !result.fileError?.some((error) => ['CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(error.type))) throw new InfrastructureError('Executor file setup failed.');
    return result;
  }

  async ready(signal) {
    const version = await this.request('/version', undefined, { signal, responseLimit: 64 * 1024 });
    const config = await this.request('/config', undefined, { signal, responseLimit: 256 * 1024 });
    if (version.os !== 'linux' || version.fixSymlinkEscape !== true || config.runnerConfig?.cgroupType !== 2 ||
        !['cpu', 'memory', 'pids'].every((controller) => config.runnerConfig.cgroupControllers?.includes(controller))) {
      throw new InfrastructureError('Linux cgroup v2 with cpu, memory, pids and fixed symlink isolation is required.');
    }
    const probe = await this.execute(this.command({ script: RUNTIME_PROBE, version: { time_limit_ms: 1000, memory_limit_mb: 64 } }), signal);
    let runtime;
    try { runtime = JSON.parse(probe.files.stdout); } catch { throw new InfrastructureError('Executor runtime probe failed.'); }
    if (probe.status !== 'Accepted' || runtime.python?.[0] !== 3 || runtime.python?.[1] !== 12 || !Number.isInteger(runtime.uid) || runtime.uid === 0 ||
        runtime.reachable !== false || !Array.isArray(runtime.interfaces) || runtime.interfaces.some((name) => name !== 'lo')) throw new InfrastructureError('Python 3.12, non-root execution and an isolated network namespace are required.');
    const cppProbeCode = '#include <version>\n#include <iostream>\nstatic_assert(__clang_major__ == 19);\nstatic_assert(_GLIBCXX_RELEASE == 14);\nstatic_assert(__cplusplus >= 202302L);\nint main(){std::cout << __clang_major__ << "." << __clang_minor__ << "." << __clang_patchlevel__ << " " << _GLIBCXX_RELEASE << " " << __cplusplus;}';
    const toolchainVersion = { time_limit_ms: 5000, memory_limit_mb: 256 };
    const compiled = await this.execute(this.command({ language: 'cpp', code: cppProbeCode, version: toolchainVersion }), signal);
    const probeFileId = compiled.fileIds?.main;
    if (compiled.status !== 'Accepted' || typeof probeFileId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(probeFileId)) throw new InfrastructureError('Clang 19 / GCC 14 libstdc++ / C++23 toolchain probe failed.');
    let cpp;
    try { cpp = await this.execute(this.command({ language: 'cpp', compiledFileId: probeFileId, version: toolchainVersion }), signal); }
    finally { await this.deleteFile(probeFileId).catch(() => {}); }
    const cppVersion = /^19\.\d+\.\d+ 14 202302\d*$/.exec(cpp.files?.stdout ?? '');
    if (cpp.status !== 'Accepted' || !cppVersion) throw new InfrastructureError('C++23 compiler or GCC 14 libstdc++ unavailable in sandbox.');
    // The seccomp profile deliberately rejects the ioctl used by
    // os.networkInterfaces(); read the namespace's proc view instead.
    const jsScript = 'const fs=require("node:fs");const interfaces=fs.readFileSync("/proc/self/net/dev","utf8").split("\\n").slice(2).filter(Boolean).map(line=>line.split(":")[0].trim());console.log(JSON.stringify({node:process.versions.node,uid:process.getuid(),interfaces}))';
    const js = await this.execute(this.command({ language: 'javascript', code: '', script: jsScript,
      version: { time_limit_ms: 1000, memory_limit_mb: 128 } }), signal);
    let node;
    try { node = JSON.parse(js.files?.stdout); } catch { throw new InfrastructureError('Node.js runtime probe failed.'); }
    if (js.status !== 'Accepted' || !/^22\./.test(node.node ?? '') || node.uid !== runtime.uid ||
        !Array.isArray(node.interfaces) || node.interfaces.some((name) => name !== 'lo')) throw new InfrastructureError('Node.js 22 is unavailable or not isolated.');
    this.runtimeVersion = `${version.buildVersion}/python-${runtime.python.join('.')}/clang-${cppVersion[0].split(' ')[0]}-libstdc++14-c++23/node-${node.node}/${this.environmentVersion}`;
    return this.runtimeVersion;
  }

  async judge(task, { signal, budget = createJudgingBudget() } = {}) {
    validateTask(task);
    if (!(budget instanceof JudgingBudget)) throw new InfrastructureError('Invalid job budget.');
    const { code, version } = task;
    const language = task.language ?? 'python';
    const startedAt = budget.startedAt;
    const wallBudgetSignal = budget.wallSignal;
    const executionSignal = signal ? AbortSignal.any([signal, wallBudgetSignal]) : wallBudgetSignal;
    const remaining = () => ({ cpu: Math.floor(JOB_CPU_BUDGET_NS - budget.cpuNs),
      wall: Math.floor((JOB_WALL_BUDGET_MS - Math.max(budget.wallNs / 1000000, performance.now() - startedAt)) * 1000000) });
    const budgetFailure = () => ({ status: 'TLE', score: task.kind === 'custom' ? null : 0, passed: task.kind === 'custom' ? null : 0,
      total: task.tests.length, publicOutput: '', publicMessage: MESSAGES.TLE, environmentVersion: this.runtimeVersion ?? this.environmentVersion,
      privateResults: task.tests.map((test, index) => ({ testId: test.id ?? null, position: index + 1, status: 'NotRun', reason: 'TaskBudgetExceeded' })) });
    let binaryFileId = null;
    try {
    if (signal?.aborted) throw new InfrastructureError('Judging lease was lost.');
    const initial = remaining();
    if (wallBudgetSignal.aborted || initial.cpu <= 0 || initial.wall <= 0) return budgetFailure();
    const preflightCommand = this.command({ code, language,
      script: language === 'python' ? PREFLIGHT : undefined,
      preflight: language === 'javascript',
      functionName: version.mode === 'function' ? version.function_name : '', version });
    const limitedPreflight = initial.cpu < preflightCommand.cpuLimit || initial.wall < preflightCommand.clockLimit;
    preflightCommand.cpuLimit = Math.min(preflightCommand.cpuLimit, initial.cpu);
    preflightCommand.clockLimit = Math.min(preflightCommand.clockLimit, initial.wall);
    let preflight;
    try { preflight = await this.execute(preflightCommand, executionSignal); }
    catch (error) {
      if (!signal?.aborted && wallBudgetSignal.aborted) return budgetFailure();
      throw error;
    }
    budget.cpuNs += preflight.time; budget.wallNs += preflight.runTime;
    if (language === 'cpp') binaryFileId = preflight.fileIds?.main ?? null;
    if (preflight.status !== 'Accepted') {
      if (preflight.status === 'Nonzero Exit Status' && (language !== 'python' || preflight.exitStatus === 65) ||
          language === 'cpp' && ['Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded', 'File Error'].includes(preflight.status) && !limitedPreflight ||
          language === 'javascript' && ['Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded'].includes(preflight.status) && !limitedPreflight) {
        return { status: 'CE', score: task.kind === 'custom' ? null : 0, passed: 0, total: task.tests.length, publicOutput: '',
          publicMessage: `${MESSAGES.CE}\n${capped(preflight.files?.stderr || preflight.files?.stdout, 2048)}`, privateResults: [], environmentVersion: this.runtimeVersion ?? this.environmentVersion };
      }
      if (limitedPreflight && preflight.status === 'Time Limit Exceeded') return budgetFailure();
      // The preflight does not execute the source. A resource/exec error here is
      // an infrastructure failure, not a student runtime verdict.
      throw new InfrastructureError('Sandbox syntax checking failed.');
    }
    if (language === 'cpp' && (typeof binaryFileId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(binaryFileId))) throw new InfrastructureError('Compiler omitted a bounded executable.');
    const privateResults = [];
    const notRun = (start, reason) => {
      for (let index = start; index < task.tests.length; index++) privateResults.push({ testId: task.tests[index].id ?? null, position: index + 1, status: 'NotRun', reason });
    };
    let passed = 0, earnedUnits = 0; const failures = new Set(); const publicChunks = [];
    for (let i = 0; i < task.tests.length; i++) {
      if (signal?.aborted) throw new InfrastructureError('Judging lease was lost.');
      const { cpu: remainingCpuNs, wall: remainingWallNs } = remaining();
      if (wallBudgetSignal.aborted || remainingCpuNs <= 0 || remainingWallNs <= 0) {
        failures.add('TLE'); notRun(i, 'TaskBudgetExceeded'); break;
      }
      const test = task.tests[i];
      const command = this.command({ code: language === 'cpp' ? undefined : code, input: test.input, version, language,
        compiledFileId: binaryFileId,
        script: version.mode === 'function' ? language === 'python' ? FUNCTION_HARNESS : language === 'javascript' ? JS_FUNCTION_HARNESS : undefined : undefined,
        functionName: version.function_name, resultPipe: version.mode === 'function' });
      command.cpuLimit = Math.min(command.cpuLimit, remainingCpuNs);
      command.clockLimit = Math.min(command.clockLimit, remainingWallNs);
      let result;
      try { result = await this.execute(command, executionSignal); }
      catch (error) {
        if (!signal?.aborted && wallBudgetSignal.aborted) { failures.add('TLE'); notRun(i, 'TaskWallBudgetExceeded'); break; }
        throw error;
      }
      budget.cpuNs += result.time; budget.wallNs += result.runTime;
      let verdict = resultVerdict(result);
      let returned;
      if (version.mode === 'function' && (verdict === 'OK' || (result.status === 'Nonzero Exit Status' && [65, 70].includes(result.exitStatus)))) {
        let protocol;
        try {
          protocol = JSON.parse(result.files?.result);
          if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol) ||
              Object.keys(protocol).some(key => !['status', 'value', 'reason'].includes(key)) ||
              typeof protocol.status !== 'string' ||
              Object.hasOwn(protocol, 'value') && validateJsonValue(protocol.value) === undefined) throw new Error('Invalid return protocol.');
        } catch { protocol = null; verdict = 'RE'; }
        if (protocol) {
          if (protocol.status === 'OK' && Object.hasOwn(protocol, 'value') && result.status === 'Accepted') { returned = protocol.value; verdict = 'OK'; }
          else if (['CE', 'RE', 'WA'].includes(protocol.status)) verdict = protocol.status;
          else verdict = 'RE';
        }
      }
      if (verdict === 'OK') {
        if (task.kind === 'custom') verdict = 'Executed';
        else {
          const matches = version.mode === 'function' ? jsonEqual(returned, parseJsonValue(test.expected)) : compareOutput(result.files.stdout, test.expected, version.comparator);
          verdict = matches ? 'AC' : 'WA';
        }
      }
      const budgetExceeded = budget.cpuNs > JOB_CPU_BUDGET_NS || budget.wallNs > JOB_WALL_BUDGET_MS * 1000000 || performance.now() - startedAt > JOB_WALL_BUDGET_MS;
      if (budgetExceeded && !FATAL_VERDICTS.has(verdict)) verdict = 'TLE';
      if (verdict === 'AC') { passed++; earnedUnits += Math.round(Number(test.weight ?? (100 / task.tests.length)) * 10000); }
      if (!['AC', 'Executed'].includes(verdict)) failures.add(verdict);
      privateResults.push({ testId: test.id ?? null, position: i + 1, status: verdict,
        cpuMs: Math.ceil(result.time / 1000000), wallMs: Math.ceil(result.runTime / 1000000), memoryBytes: result.memory,
        stdout: capped(result.files?.stdout, PRIVATE_LOG_LIMIT), stderr: capped(result.files?.stderr, PRIVATE_LOG_LIMIT),
        ...(version.mode === 'function' ? { returned: capped(JSON.stringify(returned ?? null), PRIVATE_LOG_LIMIT) } : {}) });
      if (['custom', 'samples'].includes(task.kind)) {
        // Only these job kinds contain public input. Formal tests never feed
        // stdout/stderr, function values, or exception text into student output.
        const value = version.mode === 'function' && returned !== undefined ? JSON.stringify(returned) : result.files?.stdout ?? '';
        publicChunks.push(`测试 ${i + 1} · ${verdict}\n${capped(value, DISPLAY_LIMIT)}`);
      }
      if (FATAL_VERDICTS.has(verdict)) { notRun(i + 1, budgetExceeded ? 'TaskBudgetExceeded' : 'FatalVerdict'); break; }
    }
    const status = FAILURE_ORDER.find((verdict) => failures.has(verdict)) ?? (task.kind === 'custom' ? 'Executed' : 'AC');
    const score = task.kind === 'custom' ? null : status === 'AC' ? 100 : Math.min(99.9999, earnedUnits / 10000);
    return { status, score, passed: task.kind === 'custom' ? null : passed, total: task.tests.length,
      publicOutput: capped(publicChunks.join('\n\n'), DISPLAY_LIMIT), publicMessage: MESSAGES[status],
      privateResults, environmentVersion: this.runtimeVersion ?? this.environmentVersion };
    } finally {
      // go-judge's prepared binary lives outside per-test sandboxes. Dispose
      // after the entire task, including failures and interrupted leases.
      if (binaryFileId) await this.deleteFile(binaryFileId).catch(() => {});
    }
  }
}

export function resultVerdict(result) {
  if (hasOutputOverflow(result)) return 'OLE';
  if (result.status === 'Accepted') {
    if (result.exitStatus !== 0) throw new InfrastructureError('Inconsistent Accepted executor status.');
    return 'OK';
  }
  const map = { 'Memory Limit Exceeded': 'MLE', 'Time Limit Exceeded': 'TLE', 'Output Limit Exceeded': 'OLE',
    'Nonzero Exit Status': 'RE', Signalled: 'RE', 'Dangerous Syscall': 'RE' };
  if (result.status === 'File Error' && result.fileError?.some((error) => ['CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(error.type))) return 'OLE';
  if (!map[result.status]) throw new InfrastructureError('Unknown executor status.');
  return map[result.status];
}

function hasOutputOverflow(result) {
  return result.fileError?.some((error) => ['CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(error.type)) === true;
}

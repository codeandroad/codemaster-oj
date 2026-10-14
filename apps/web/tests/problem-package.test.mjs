import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateRawSync, gzipSync } from "node:zlib";

// The application resolves extensionless TypeScript imports through Next; Node's test loader resolves those same files.
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith("./") &&
      !/\.[a-z]+$/i.test(specifier) &&
      context.parentURL?.includes("/components/teacher/")
    )
      return next(new URL(specifier + ".ts", context.parentURL).href, context);
    return next(specifier, context);
  },
});
const { readProblemImport, readZipEntries } =
  await import("../src/components/teacher/problem-package.ts");
const { equalCaseWeights } =
  await import("../src/components/teacher/case-weights.ts");

function zip(items, { method = 0 } = {}) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name),
      data = Buffer.from(item.data ?? ""),
      compressed = method === 8 ? deflateRawSync(data) : data,
      gzip = gzipSync(data),
      crc = gzip.readUInt32LE(gzip.length - 8),
      flags = item.flags ?? 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE((3 << 8) | 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function file(bytes, name = "1.zip") {
  return new File([bytes], name, { type: "application/zip" });
}
function dataBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
const sampleMD =
  "# A + B\n\n读取至 EOF，0 0 不是终止条件。\n\n## 样例输入\n```\n1 2\n0 0\n```\n\n## 样例输出\n```\n3\n0\n```\n";
const reference =
  "import sys\nfor line in sys.stdin:\n a,b=map(int,line.split())\n print(a+b)\n";

test("prototype 1.zip: optional config/pid, Markdown sample, 103 input lines remain exactly one formal case", async () => {
  const input =
      Array.from({ length: 103 }, (_, i) => `${i} ${i + 1}`).join("\n") + "\n",
    output =
      Array.from({ length: 103 }, (_, i) => String(2 * i + 1)).join("\n") +
      "\n";
  const result = await readProblemImport(
    file(
      zip([
        { name: "problem.md", data: sampleMD },
        { name: "tests/1.in", data: input },
        { name: "tests/1.out", data: output },
      ]),
    ),
  );
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.title, "A + B");
  assert.equal(row.mode, "stdio");
  assert.deepEqual(
    row.samples.map((s) => [s.input, s.expected]),
    [["1 2\n0 0", "3\n0"]],
  );
  assert.equal(row.tests.length, 1);
  assert.equal(row.tests[0].input, input);
  assert.equal(row.tests[0].expected, output);
  assert.equal(row.tests[0].weight, 100);
  assert.equal(row.referenceCode, "");
  assert.match(row._importWarnings.join(" "), /参考解/);
  assert.equal("id" in row, false);
  assert.equal("pid" in row, false);
  assert.match(row.source, /1.zip/);
});
test("root problem.md without a heading gets nonempty archive fallback even with optional empty title", async () => {
  const { rows } = await readProblemImport(
    file(
      zip([
        { name: "problem.md", data: "请输入并输出答案。" },
        { name: "config.json", data: '{"title":" "}' },
      ]),
      "no-heading.zip",
    ),
  );
  assert.equal(rows[0].title, "no-heading");
});
test("stored and deflate packages separate sample files from formal cases and safely read Python code", async () => {
  for (const method of [0, 8]) {
    const { rows } = await readProblemImport(
      file(
        zip(
          [
            { name: "lesson/problem.md", data: sampleMD },
            { name: "lesson/samples/sample1.in", data: "2 3\n" },
            { name: "lesson/samples/sample1.out", data: "5\n" },
            { name: "lesson/testdata/1.in", data: "" },
            { name: "lesson/testdata/1.out", data: "" },
            { name: "lesson/reference.py", data: reference },
            { name: "lesson/starter.py", data: "# student template\n" },
          ],
          { method },
        ),
      ),
    );
    assert.equal(rows[0].samples.length, 1);
    assert.equal(rows[0].samples[0].input, "2 3\n");
    assert.equal(rows[0].tests.length, 1);
    assert.equal(rows[0].tests[0].input, "");
    assert.equal(rows[0].referenceCode, reference);
    assert.equal(rows[0].starterCode, "# student template\n");
    assert.deepEqual(rows[0]._importWarnings, []);
  }
});
test("ZIP import retains C++ reference language and separate C++/JavaScript starter templates", async () => {
  const cppReference = "#include <iostream>\nint main(){std::cout << 42;}\n";
  const cppStarter = "#include <iostream>\nint main(){}\n";
  const jsStarter = "const fs = require('node:fs');\n";
  const { rows } = await readProblemImport(file(zip([
    { name: "problem.md", data: sampleMD },
    { name: "tests/1.in", data: "" },
    { name: "tests/1.out", data: "42\n" },
    { name: "config.json", data: JSON.stringify({ referenceLanguage: "cpp", starterCodes: { cpp: "starter.cpp", javascript: "starter.js" } }) },
    { name: "reference.cpp", data: cppReference },
    { name: "starter.cpp", data: cppStarter },
    { name: "starter.js", data: jsStarter },
  ])));
  assert.equal(rows[0].referenceLanguage, "cpp");
  assert.equal(rows[0].referenceCode, cppReference);
  assert.deepEqual(rows[0].starterCodes, { cpp: cppStarter, javascript: jsStarter });
});
test("explicit YAML config resolves package/config-directory paths, limits and source owner without importing IDs/history", async () => {
  const config =
    "title: 配置题名\ntime: 1s\nmemory: 128MiB\nowner: historical-owner\npid: external-123\naccepted: 500\ntags: [Lists, Lists]\nsamples:\n  - input: samples/1.in\n    output: samples/1.out\ntests:\n  - input: 1.in\n    output: 1.out\nreference: solution.py\n";
  const { rows } = await readProblemImport(
    file(
      zip([
        { name: "problem.md", data: "# 原题名\n中文题面" },
        { name: "samples/1.in", data: "3 4\n" },
        { name: "samples/1.out", data: "7\n" },
        { name: "testdata/config.yaml", data: config },
        { name: "testdata/1.in", data: "0 0\n" },
        { name: "testdata/1.out", data: "0\n" },
        { name: "solution.py", data: reference },
      ]),
    ),
  );
  const row = rows[0];
  assert.equal(row.title, "配置题名");
  assert.equal(row.timeLimitMs, 1000);
  assert.equal(row.memoryLimitMb, 128);
  assert.deepEqual(row.tags, ["Lists"]);
  assert.equal(row.tests.length, 1);
  assert.equal(row.referenceCode, reference);
  assert.match(row.source, /historical-owner/);
  assert.equal("pid" in row, false);
  assert.equal("accepted" in row, false);
  assert.equal("owner" in row, false);
});
test("nested multiple standard packages are independent and JSON-only ZIP support remains intact", async () => {
  const { rows } = await readProblemImport(
    file(
      zip([
        { name: "a/problem.md", data: "# First" },
        { name: "b/problem.md", data: "# Second" },
        { name: "a/config.json", data: '{"title":"From config"}' },
        { name: "b/tests/1.in", data: "0" },
        { name: "b/tests/1.out", data: "0" },
      ]),
    ),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "From config");
  assert.equal(rows[0].tests.length, 0);
  assert.equal(rows[1].tests.length, 1);
  const json = await readProblemImport(
    file(
      zip([
        {
          name: "problem.json",
          data: '{"title":"JSON remains","mode":"stdio"}',
        },
      ]),
    ),
  );
  assert.equal(json.rows.length, 1);
  assert.equal(json.rows[0].title, "JSON remains");
});
test("input/output-labelled fences override heading context and empty Markdown sample input remains valid", async () => {
  const statement =
    "# Title\n## 样例输入\n```input1\n\n```\n```output1\n0\n```";
  const { rows } = await readProblemImport(
    file(zip([{ name: "problem.md", data: statement }])),
  );
  assert.equal(rows[0].samples.length, 1);
  assert.equal(rows[0].samples[0].input, "");
  assert.equal(rows[0].samples[0].expected, "0");
});
test("orphan files are explicitly reported and never fabricated as empty expected-output cases", async () => {
  const { rows } = await readProblemImport(
    file(
      zip([
        { name: "problem.md", data: sampleMD },
        { name: "tests/missing.in", data: "1 2" },
        { name: "tests/orphan.out", data: "3" },
      ]),
    ),
  );
  assert.equal(rows[0].tests.length, 0);
  assert.match(rows[0]._importWarnings.join(" "), /缺少配对输出/);
  assert.match(rows[0]._importWarnings.join(" "), /缺少配对输入/);
});
test("explicit JSON function config preserves empty stdin values and function metadata", async () => {
  const { rows } = await readProblemImport(
    file(
      zip([
        { name: "problem.md", data: "# Function" },
        {
          name: "config.json",
          data: JSON.stringify({
            mode: "function",
            functionName: "solve",
            referenceCode: "def solve(): return 1",
            samples: [{ input: "[]", expected: "1" }],
            tests: [{ input: "[]", expected: "1" }],
            parameters: [],
            hints: ["Hint"],
            hintPolicy: "afterAC",
          }),
        },
      ]),
    ),
  );
  assert.equal(rows[0].functionName, "solve");
  assert.equal(rows[0].referenceCode, "def solve(): return 1");
  assert.equal(rows[0].tests[0].expected, "1");
});
for (const name of [
  "../problem.md",
  "bad\\problem.md",
  "/problem.md",
  "C:/problem.md",
  "a/./problem.md",
])
  test("rejects unsafe archive path " + JSON.stringify(name), async () => {
    await assert.rejects(
      readProblemImport(file(zip([{ name, data: "# Bad" }]))),
      /不安全/,
    );
  });
test("rejects duplicate/case-colliding paths and symlinks", async () => {
  await assert.rejects(
    readProblemImport(
      file(
        zip([
          { name: "problem.md", data: "# 1" },
          { name: "PROBLEM.MD", data: "# 2" },
        ]),
      ),
    ),
    /重复/,
  );
  await assert.rejects(
    readProblemImport(
      file(
        zip([
          { name: "problem.md", data: "# 1" },
          { name: "reference.py", data: "other.py", mode: 0o120777 },
        ]),
      ),
    ),
    /符号链接/,
  );
});
test("rejects invalid CRC, inconsistent local names, encryption and truncated directories", async () => {
  const corrupt = zip([{ name: "problem.md", data: "# Title" }]);
  corrupt[30 + "problem.md".length] ^= 1;
  await assert.rejects(readZipEntries(dataBuffer(corrupt)), /CRC/);
  const mismatch = zip([{ name: "problem.md", data: "# Title" }]);
  mismatch[30] = 65;
  await assert.rejects(readZipEntries(dataBuffer(mismatch)), /不一致/);
  await assert.rejects(
    readProblemImport(
      file(zip([{ name: "problem.md", data: "# Title", flags: 0x801 }])),
    ),
    /加密/,
  );
  const truncated = zip([{ name: "problem.md", data: "# Title" }]).subarray(
    0,
    -3,
  );
  await assert.rejects(readZipEntries(dataBuffer(truncated)), /目录无效/);
});
test("rejects forged expansion sizes, excessive file counts and invalid UTF-8 text before import", async () => {
  const oversized = zip(
    [{ name: "problem.md", data: Buffer.alloc(2 * 1024 * 1024 + 1, 65) }],
    { method: 8 },
  );
  await assert.rejects(readProblemImport(file(oversized)), /超过限制|压缩比/);
  const many = zip(
    Array.from({ length: 513 }, (_, i) => ({ name: `${i}.txt`, data: "" })),
  );
  await assert.rejects(readProblemImport(file(many)), /512/);
  await assert.rejects(
    readProblemImport(
      file(zip([{ name: "problem.md", data: Buffer.from([0xff]) }])),
    ),
    /UTF-8/,
  );
});
test("rejects unsafe explicit config file references, executable YAML tags, cycles and duplicate YAML keys", async () => {
  for (const config of [
    "samples:\n - inputFile: ../outside\n   outputFile: out\n",
    "title: !!js/function function() {}\n",
    "loop: &loop [*loop]\n",
    "title: one\ntitle: two\n",
  ])
    await assert.rejects(
      readProblemImport(
        file(
          zip([
            { name: "problem.md", data: "# Title" },
            { name: "config.yaml", data: config },
          ]),
        ),
      ),
      /不安全|不支持|循环|YAML|alias/i,
    );
});
test("three enabled and one disabled formal case have exact accepted domain weights without changing activation/order", () => {
  const cases = [
      { name: "one", enabled: true },
      { name: "disabled", enabled: false },
      { name: "two" },
      { name: "three", enabled: true },
    ],
    weighted = equalCaseWeights(cases);
  assert.deepEqual(
    weighted.map((c) => c.name),
    cases.map((c) => c.name),
  );
  assert.equal(weighted[1].enabled, false);
  assert.ok(weighted[1].weight > 0);
  assert.equal(
    weighted
      .filter((c) => c.enabled !== false)
      .reduce((sum, c) => sum + Math.round(c.weight * 10000), 0),
    1_000_000,
  );
  for (const count of [1, 3, 7, 99, 100]) {
    const result = equalCaseWeights(
      Array.from({ length: count }, () => ({ enabled: true })),
    );
    assert.ok(
      result.every(
        (c) =>
          c.weight > 0 &&
          Math.abs(c.weight * 10000 - Math.round(c.weight * 10000)) < 0.00001,
      ),
    );
    assert.ok(
      Math.abs(result.reduce((sum, c) => sum + c.weight, 0) - 100) < 0.00001,
    );
  }
});

test('Python practice envelope imports all twenty exercises with solutions and tests', async()=>{
 const {pythonPractice}=await import('../../../packages/domain/src/python-practice.mjs');
 const pack={format:'codemaster-python-practice',version:1,problems:pythonPractice};
 const parsed=await readProblemImport(new File([JSON.stringify(pack)],'python-practice-pack.json'));
 assert.equal(parsed.rows.length,20);
 assert.equal(parsed.rows[0].referenceCode,pack.problems[0].referenceCode);
 assert.equal(parsed.rows[0].tests.length,5);
 await assert.rejects(readProblemImport(new File([JSON.stringify({...pack,version:2})],'bad.json')),/版本/);
});

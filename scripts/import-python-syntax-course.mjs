// Import the reviewed Python syntax course into the retained local installation.
// This command creates drafts and runs real judge validation. It never publishes
// a course or problem, approves school visibility, or changes existing content.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLearningMarkdown } from "../apps/web/src/components/teacher/learning-document.ts";
import { validateLearningDocument } from "../packages/domain/src/learning-document.mjs";

function runReference(code, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("python3", ["-I", "-c", code], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill("SIGKILL"); });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(Error(`Reference solution exited with ${code}.`));
      else resolvePromise(stdout);
    });
    child.stdin.end(input);
  });
}
const root = fileURLToPath(new URL("../", import.meta.url));
const contentDir = resolve(root, "content/python-syntax-oj");
const statePath = resolve(root, ".campus-local/python-syntax-oj-import.json");
const origin = process.env.CAMPUS_LOCAL_ORIGIN ?? "http://127.0.0.1:3000";
const base = new URL(origin);
if (!["127.0.0.1", "localhost"].includes(base.hostname) || base.protocol !== "http:")
  throw Error("This importer only accepts a local HTTP installation.");
const mode = process.argv[2] ?? "--check";
if (!["--check", "--import"].includes(mode)) throw Error("Use --check or --import.");

const courseMarkdown = await readFile(resolve(contentDir, "course.md"), "utf8");
const problemSource = await readFile(resolve(contentDir, "problems.json"), "utf8");
const doc = validateLearningDocument(parseLearningMarkdown(courseMarkdown));
const problems = JSON.parse(problemSource);
assert.equal(doc.chapters.length, 20, "Expected 20 lessons from the supplied HTML course.");
assert.ok(Array.isArray(problems) && problems.length === 22, "Expected 19 exercises and 3 capstones.");
assert.ok(Buffer.byteLength(problemSource) <= 2 * 1024 * 1024, "Problem pack exceeds the UI import limit.");
const names = new Set();
for (const [index, problem] of problems.entries()) {
  assert.equal(problem.mode, "stdio", `Problem ${index + 1} must use standard input/output.`);
  assert.equal(problem.referenceLanguage ?? "python", "python");
  assert.ok(typeof problem.title === "string" && problem.title.trim() && !names.has(problem.title), "Duplicate/empty title.");
  names.add(problem.title);
  assert.ok(Number.isInteger(problem.chapterNumber) && problem.chapterNumber >= 1 && problem.chapterNumber <= 20,
    `Invalid chapterNumber for ${problem.title}.`);
  assert.ok(doc.chapters[problem.chapterNumber - 1].title.startsWith(String(problem.chapterNumber).padStart(2, "0")),
    `Course chapter order does not match ${problem.title}.`);
  assert.ok(problem.statement?.trim() && problem.referenceCode?.trim(), `Incomplete statement/reference: ${problem.title}.`);
  assert.ok(Array.isArray(problem.samples) && problem.samples.length >= 2, `Add two visible samples: ${problem.title}.`);
  assert.ok(Array.isArray(problem.tests) && problem.tests.length >= 5, `Add at least five formal cases: ${problem.title}.`);
  assert.equal(problem.tests.filter(test => test.enabled !== false).reduce((sum, test) => sum + test.weight, 0), 100,
    `Formal case weights must total 100: ${problem.title}.`);
  for (const [caseIndex, test] of [...problem.samples, ...problem.tests].entries()) {
    assert.equal(typeof test.input, "string");
    assert.equal(typeof test.expected, "string");
    const stdout = await runReference(problem.referenceCode, test.input);
    const normalize = value => problem.comparator === "exact" ? value : value.trim().split(/\s+/).join(" ");
    assert.equal(normalize(stdout), normalize(test.expected),
      `${problem.title}, case ${caseIndex + 1}: reference output differs from expected output.`);
  }
}
console.log(`Checked ${doc.chapters.length} lessons, ${problems.length} problems and all ${problems.reduce((n,p)=>n+p.samples.length+p.tests.length,0)} reference cases.`);
if (mode === "--check") process.exit(0);

const hash = createHash("sha256").update(courseMarkdown).update("\0").update(problemSource).digest("hex");
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (state && state.schema !== 1)
  throw Error("Local import state uses an unsupported schema; review it before importing.");
const sourceChanged = Boolean(state && state.hash !== hash);
state ??= { schema: 1, hash, idempotencyKey: randomUUID(), courseId: null, problems: [], groupId: null };
async function save() {
  await mkdir(resolve(root, ".campus-local"), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, statePath);
}
await save();
const credentials = JSON.parse(await readFile(resolve(root, ".campus-local/test-accounts.json"), "utf8"));
let cookie = "", csrfToken = "";
async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${method} ${path}: HTTP ${response.status}${result.error?.code ? ` (${result.error.code})` : ""}`);
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  if (result.csrfToken) csrfToken = result.csrfToken;
  return result;
}
await request("auth/login", { username: credentials.accounts.teacher.username, password: credentials.accounts.teacher.password });
if (sourceChanged) {
  // An earlier local import may have finished before a content correction.
  // Reuse its problem identities, but never overwrite a teacher's later edits
  // or silently change the pinned versions of already-linked chapters.
  if (!state.courseId || state.problems.length !== problems.length)
    throw Error("The changed package cannot be reconciled with an incomplete local import state.");
  const liveCourse = await request(`learning-paths/${state.courseId}`);
  if (liveCourse.published || liveCourse.chapters.length !== doc.chapters.length ||
      liveCourse.chapters.some((chapter, index) => chapter.title !== doc.chapters[index].title ||
        chapter.content !== doc.chapters[index].content || chapter.problems.length))
    throw Error("The course has changed or already has pinned exercises; review revisions manually.");
  const fields = ["title", "mode", "statement", "objective", "inputDescription", "outputDescription",
    "difficulty", "referenceLanguage", "referenceCode", "starterCode", "timeLimitMs",
    "memoryLimitMb", "comparator", "tags", "source"];
  const exercise = value => ({
    ...Object.fromEntries(fields.map(field => [field, value[field]])),
    samples: value.samples.map(item => ({ name: item.name, input: item.input,
      expected: item.expected, enabled: item.enabled })),
    tests: value.tests.map(item => ({ name: item.name, input: item.input,
      expected: item.expected, weight: item.weight, enabled: item.enabled })),
  });
  for (const [index, imported] of state.problems.entries()) {
    const wanted = problems[index];
    if (imported.chapterNumber !== wanted.chapterNumber)
      throw Error(`Chapter mapping changed for exercise ${index + 1}; review manually.`);
    const current = await request(`problems/${imported.id}?versionId=${imported.versionId}`);
    if (!current.canEdit || current.published || current.bankVisibility !== "school")
      throw Error(`Exercise ${index + 1} is no longer an editable school-bank draft.`);
    if (JSON.stringify(exercise(current)) === JSON.stringify(exercise(wanted))) continue;
    const latest = await request(`problems/${imported.id}`);
    if (latest.versionId !== imported.versionId) {
      if (JSON.stringify(exercise(latest)) !== JSON.stringify(exercise(wanted)))
        throw Error(`Exercise ${index + 1} was edited outside this import; review manually.`);
      imported.versionId = latest.versionId;
    } else {
      const updated = await request(`problems/${imported.id}/versions`,
        { ...wanted, saveDraft: true });
      imported.versionId = updated.versionId;
    }
    await save();
  }
  state.hash = hash;
  await save();
}
if (!state.courseId) {
  // Reconcile an interrupted course import by exact title and lesson count.
  const candidates = (await request("learning-paths")).items.filter(item => item.title === doc.title && !item.published);
  for (const candidate of candidates) {
    const detail = await request(`learning-paths/${candidate.id}`);
    if (detail.chapters.length === doc.chapters.length && detail.chapters.every((chapter, index) =>
      chapter.title === doc.chapters[index].title && chapter.content === doc.chapters[index].content)) {
      state.courseId = candidate.id;
      break;
    }
  }
  if (!state.courseId) state.courseId = (await request("learning-paths/import", {
    format: "codemaster-learning-path", version: 1, ...doc,
  })).id;
  await save();
}
if (!state.problems.length) {
  const receipt = await request("problems/import", {
    idempotencyKey: state.idempotencyKey,
    filename: "python-syntax-oj/problems.json",
    rows: problems.map(({ chapterNumber, chapterTitle, ...problem }) => ({ ...problem, saveDraft: true })),
  });
  if (receipt.summary.failed) throw Error(`Imported ${receipt.summary.created} problems, ${receipt.summary.failed} failed. Check the private import receipt.`);
  state.problems = receipt.items.map((item, index) => ({
    chapterNumber: problems[index].chapterNumber,
    id: item.problem.id,
    versionId: item.problem.versionId,
  }));
  await save();
}
if (!state.groupId) {
  const existing = (await request("problem-groups")).items.find(group =>
    group.name === doc.title && group.bankId === "00000000-0000-4000-8000-000000000001" &&
    state.problems.every(problem => group.problemIds.includes(problem.id)));
  state.groupId = existing?.id ?? (await request("problem-groups", {
    name: doc.title, problemIds: state.problems.map(problem => problem.id),
  })).id;
  await save();
}
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const latest = await Promise.all(state.problems.map(problem => request(`problems/${problem.id}?versionId=${problem.versionId}`)));
  const pending = latest.filter(problem => ["Waiting", "Judging"].includes(problem.validationStatus));
  if (!pending.length) {
    const failed = latest.filter(problem => problem.validationStatus !== "AC");
    if (failed.length) throw Error(`${failed.length} reference solutions failed isolated judge validation; review the local problem drafts.`);
    const chapters = (await request(`learning-paths/${state.courseId}`)).chapters;
    for (const [index, chapter] of chapters.entries()) {
      const wanted = state.problems.filter(problem => problem.chapterNumber === index + 1).map(problem => problem.id);
      const current = chapter.problems.map(problem => problem.problemId);
      if (JSON.stringify(current) !== JSON.stringify(wanted))
        await request(`chapters/${chapter.id}`, { problemIds: wanted }, "PATCH");
    }
    const actualCourse = await request(`learning-paths/${state.courseId}`);
    assert.equal(actualCourse.published, false);
    assert.equal(actualCourse.chapters.length, 20);
    assert.ok(actualCourse.chapters.every((chapter, index) => chapter.title === doc.chapters[index].title &&
      chapter.content === doc.chapters[index].content &&
      JSON.stringify(chapter.problems.map(problem => problem.problemId)) ===
      JSON.stringify(state.problems.filter(problem => problem.chapterNumber === index + 1).map(problem => problem.id)) &&
      !chapter.checkpointAnswer));
    const studentLogin = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: credentials.accounts.student.username, password: credentials.accounts.student.password }),
    });
    assert.equal(studentLogin.status, 200, "Student demo login failed.");
    const studentCookie = studentLogin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(studentCookie);
    const studentCourse = await fetch(`${origin}/api/v1/learning-paths/${state.courseId}`, {
      headers: { Origin: origin, Cookie: studentCookie },
    });
    assert.equal(studentCourse.status, 404, "Draft course is unexpectedly visible to students.");
    const studentProblem = await fetch(`${origin}/api/v1/problems/${state.problems[0].id}`, {
      headers: { Origin: origin, Cookie: studentCookie },
    });
    assert.ok([403, 404].includes(studentProblem.status), "Draft problem is unexpectedly visible to students.");
    console.log(`Imported course ${state.courseId}, ${state.problems.length} validated and chapter-linked problem drafts, group ${state.groupId}.`);
    console.log("Teacher read-back and student draft-denial checks passed; no student visibility or leaderboard effect.");
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
throw Error("Judge validation did not finish in 180 seconds; rerun --import to resume safely.");

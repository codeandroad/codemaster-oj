// Populate only the disposable local campus_demo installation. All classroom
// data and judging go through the real API and worker; no verdict is fabricated.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPool } from "../packages/domain/src/db.mjs";
import { bootstrap } from "../packages/domain/src/bootstrap.mjs";

const databaseUrl = process.env.CAMPUS_DEMO_DATABASE_URL;
if (!databaseUrl) throw new Error("CAMPUS_DEMO_DATABASE_URL is required.");
const database = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/campus_demo"
) {
  throw new Error("Demo seeding requires the local disposable database named campus_demo.");
}
const base = process.env.CAMPUS_DEMO_API ?? "http://127.0.0.1:3001";
const origin = process.env.CAMPUS_DEMO_ORIGIN ?? "http://127.0.0.1:3000";
for (const endpoint of [base, origin]) {
  if (!["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname))
    throw new Error("Demo endpoints must be local.");
}
const output = process.env.CAMPUS_DEMO_OUTPUT ?? "/private/tmp/campus-demo-credentials.json";
const pool = createPool(databaseUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let state;
try {
  state = JSON.parse(await readFile(output, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (state && (state.schema !== 1 || state.database !== "campus_demo" || state.base !== base)) {
  throw new Error("Existing credential file belongs to a different demo installation.");
}
state ??= {
  schema: 1,
  database: "campus_demo",
  base,
  origin,
  createdAt: new Date().toISOString(),
  complete: false,
  accounts: Object.fromEntries(
    ["admin", "teacher", "student"].map((role) => [
      role,
      {
        username: `demo.${role}`,
        password: `Demo${role[0].toUpperCase()}${role.slice(1)}-${randomBytes(6).toString("hex")}!`,
        name: { admin: "演示管理员", teacher: "陈老师（演示）", student: "林同学（演示）" }[role],
        number: { admin: "DEMO-ADMIN", teacher: "DEMO-T001", student: "DEMO-S001" }[role],
      },
    ]),
  ),
  fixtures: {},
};
async function persist() {
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, output);
}
await persist();

function client() {
  let cookie = "",
    csrfToken = "";
  return async function request(path, body, expectedStatus = 200) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    // Keep credentials, source code and hidden test data out of diagnostics.
    assert.equal(
      response.status,
      expectedStatus,
      `${path}: HTTP ${response.status}${data.error?.code ? ` (${data.error.code})` : ""}`,
    );
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    if (data.csrfToken) csrfToken = data.csrfToken;
    return data;
  };
}
async function waitFor(request, path, field = "status") {
  const deadline = Date.now() + 120000;
  do {
    const result = await request(path);
    if (!["Waiting", "Judging"].includes(result[field])) return result;
    await sleep(300);
  } while (Date.now() < deadline);
  throw new Error(`Real judge did not finish ${path} within 120 seconds.`);
}
async function keep(key, create) {
  if (!state.fixtures[key]) {
    state.fixtures[key] = await create();
    await persist();
  }
  return state.fixtures[key];
}

try {
  // The owner URL is used only to check this disposable installation and run
  // the one-time administrator bootstrap. Other identities use invitation.
  const existingAdmin = (
    await pool.query("SELECT id FROM accounts WHERE username=$1 AND binding_released_at IS NULL", [
      state.accounts.admin.username,
    ])
  ).rows[0];
  if (
    !existingAdmin &&
    (await pool.query("SELECT count(*)::int AS count FROM accounts")).rows[0].count === 0
  ) {
    // A deliberately replaced demo volume can reuse the initial passwords.
    // Forget IDs from the old database only when the new database is empty.
    state.fixtures = {};
    state.complete = false;
    delete state.completedAt;
    for (const account of Object.values(state.accounts)) {
      delete account.person;
      delete account.activationCode;
    }
    await persist();
  }
  if (state.complete) {
    // A normal restart must also work after the user changes a password.
    // Check non-secret database identities and retained fixtures, without
    // logging in with an initial password or modifying any account.
    for (const [role, account] of Object.entries(state.accounts)) {
      const person = (
        await pool.query(
          "SELECT i.id,i.kind,i.number,i.name FROM accounts a JOIN identities i ON i.id=a.identity_id WHERE a.username=$1",
          [account.username],
        )
      ).rows[0];
      assert.ok(person, `Missing demo ${role} identity; existing accounts will not be reset.`);
      assert.equal(person.kind, role, `Unexpected demo ${role} identity.`);
      account.person = person;
    }
    const retained = (
      await pool.query(
        `SELECT EXISTS(SELECT 1 FROM classes WHERE id=$1) AS class,
        EXISTS(SELECT 1 FROM assignments WHERE id=$2) AS assignment,
        EXISTS(SELECT 1 FROM learning_paths WHERE id=$3) AS learning,
        EXISTS(SELECT 1 FROM timed_practices WHERE id=$4) AS timed,
        EXISTS(SELECT 1 FROM problem_versions WHERE id=$5) AS addition,
        EXISTS(SELECT 1 FROM problem_versions WHERE id=$6) AS rows,
        EXISTS(SELECT 1 FROM assignments WHERE id=$7) AS history`,
        [
          state.fixtures.class.id,
          state.fixtures.assignment.id,
          state.fixtures.learningPath.id,
          state.fixtures.timedPractice.id,
          state.fixtures.addition.versionId,
          state.fixtures.rowSums.versionId,
          state.fixtures.historyAssignment.id,
        ],
      )
    ).rows[0];
    assert.ok(
      Object.values(retained).every(Boolean),
      "Demo classroom data is incomplete; existing user data will not be reset.",
    );
    await persist();
    console.log(
      "Existing local demo is ready; accounts and classroom data retained. Password changes are preserved; the credential file contains initial passwords.",
    );
    console.log(`Credential file: ${output}`);
  } else {
    if (!existingAdmin)
      await bootstrap(pool, { ...state.accounts.admin, username: state.accounts.admin.username });
    const admin = client(),
      teacher = client(),
      student = client();
    await admin("auth/login", state.accounts.admin);
    for (const [role, request] of [
      ["teacher", teacher],
      ["student", student],
    ]) {
      const account = state.accounts[role];
      const exists = (
        await pool.query(
          "SELECT id FROM accounts WHERE username=$1 AND binding_released_at IS NULL",
          [account.username],
        )
      ).rowCount;
      if (!exists) {
        if (!account.person) {
          const existingPerson = (
            await pool.query(
              "SELECT id FROM identities WHERE kind=$1 AND number=$2 AND archived_at IS NULL",
              [role, account.number],
            )
          ).rows[0];
          const invitation = existingPerson
            ? await admin(`people/${existingPerson.id}/activation`, {})
            : await admin(
                "people",
                { kind: role, number: account.number, name: account.name },
                201,
              );
          account.person = invitation.person;
          account.activationCode = invitation.activationCode;
          await persist();
        }
        await request(
          "auth/register",
          {
            kind: role,
            number: account.number,
            name: account.name,
            activationCode: account.activationCode,
            username: account.username,
            password: account.password,
          },
          201,
        );
        delete account.activationCode;
        await persist();
      } else await request("auth/login", account);
    }
    const cls = await keep("class", () =>
      admin(
        "classes",
        {
          name: "ACSL 编程体验班",
          studentIds: [state.accounts.student.person.id],
          teacherIds: [state.accounts.teacher.person.id],
        },
        201,
      ),
    );
    const definitions = {
      addition: {
        title: "A + B：第一份程序",
        mode: "stdio",
        comparator: "tokens",
        statement:
          "读取两个整数 a 和 b，输出它们的和。\n\n输入格式\n一行包含两个整数 a 和 b，以空格分隔。\n\n输出格式\n输出一个整数 a + b。\n\n数据范围\n-1,000,000 ≤ a, b ≤ 1,000,000。\n\n提示\n使用 input() 读取一行，split() 拆分，并用 int() 转为整数。",
        starterCode: "a, b = map(int, input().split())\n# 在这里输出 a 与 b 的和\n",
        referenceCode: "a, b = map(int, input().split())\nprint(a + b)\n",
        samples: [
          { input: "1 2\n", expected: "3\n" },
          { input: "-3 8\n", expected: "5\n" },
        ],
        tests: [
          { input: "1 2\n", expected: "3\n", weight: 25 },
          { input: "0 0\n", expected: "0\n", weight: 25 },
          { input: "-7 4\n", expected: "-3\n", weight: 25 },
          { input: "1000000 -1000000\n", expected: "0\n", weight: 25 },
        ],
      },
      rowSums: {
        title: "Row Sums：二维列表与边界条件",
        mode: "function",
        functionName: "row_sums",
        statement:
          "实现函数 row_sums(grid)，返回每一行数字的和。\n\n参数\ngrid 是二维整数列表，每一行可以为空，grid 本身也可以为空。\n\n返回值\n返回一个列表，其长度等于 grid 的行数；每个元素是对应行的总和。空行的总和为 0。\n\n要求\n返回结果，不要打印；不要修改传入的 grid。\n\n自定义测试\n输入必须使用 JSON 参数数组，例如 [[[1, 2], [3, 4]]]。",
        starterCode: "def row_sums(grid):\n    # 返回每一行的数字总和\n    return []\n",
        referenceCode: "def row_sums(grid):\n    return [sum(row) for row in grid]\n",
        samples: [{ input: "[[[1,2,3],[4,5,6]]]", expected: "[6,15]" }],
        tests: [
          { input: "[[[1,2,3],[4,5,6]]]", expected: "[6,15]", weight: 25 },
          { input: "[[[]]]", expected: "[0]", weight: 25 },
          { input: "[[]]", expected: "[]", weight: 25 },
          { input: "[[[-2,2],[5,-1]]]", expected: "[0,4]", weight: 25 },
        ],
      },
    };
    for (const [key, definition] of Object.entries(definitions)) {
      const problem = await keep(key, () =>
        teacher(
          "problems",
          {
            ...definition,
            timeLimitMs: 1000,
            memoryLimitMb: 128,
            tags: ["Python", "入门", "体验题"],
            source: "本地原创演示题，供校内功能体验",
          },
          201,
        ),
      );
      const validation = await waitFor(teacher, `problems/${problem.id}`, "validationStatus");
      assert.equal(validation.validationStatus, "AC", `${key} reference must pass the real judge.`);
      if (!validation.published)
        await teacher(`problems/${problem.id}/publish`, { versionId: problem.versionId });
    }
    const problems = ["addition", "rowSums"].map((key) => ({
      problemId: state.fixtures[key].id,
      versionId: state.fixtures[key].versionId,
      points: 50,
    }));
    const dueAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await keep("assignment", () =>
      teacher(
        "assignments",
        { title: "第 1 课作业：输入输出与二维列表", classId: cls.id, dueAt, problems },
        201,
      ),
    );
    const path = await keep("learningPath", () =>
      teacher(
        "learning-paths",
        {
          title: "Python 入门与 ACSL 编程准备",
          description: "先练输入输出，再练二维列表；每章都可跳转到真实判题题目。",
          category: "ACSL",
        },
        201,
      ),
    );
    await keep("additionChapter", () =>
      teacher(
        `learning-paths/${path.id}/chapters`,
        {
          title: "第 1 章：读入、计算与输出",
          content:
            "input() 读取一行文本。split() 按空白分隔文本，int() 将数字文本转换成整数。用 print() 输出答案。\n先尝试公开样例，再正式提交。公开样例通过后，也要考虑负数与零。",
          problemIds: [state.fixtures.addition.id],
        },
        201,
      ),
    );
    await keep("rowsChapter", () =>
      teacher(
        `learning-paths/${path.id}/chapters`,
        {
          title: "第 2 章：列表、循环与边界条件",
          content:
            "二维列表可以逐行遍历。sum(row) 计算一行的总和，sum([]) 等于 0。\n函数题使用 return 返回答案，不需要读取 input()，也不要用 print() 替代返回值。空列表和空行是不同的边界情况。",
          problemIds: [state.fixtures.rowSums.id],
        },
        201,
      ),
    );
    if (!state.fixtures.pathPublished) {
      await teacher(`learning-paths/${path.id}/publish`, {});
      state.fixtures.pathPublished = true;
      await persist();
    }
    const timed = await keep("timedPractice", () =>
      teacher(
        "timed-practices",
        {
          title: "ACSL 体验训练：30 分钟",
          classId: cls.id,
          startsAt: new Date(Date.now() - 60000).toISOString(),
          endsAt: dueAt,
          durationMinutes: 30,
          showVerdict: false,
          problems,
        },
        201,
      ),
    );
    if (!state.fixtures.timedPublished) {
      await teacher(`timed-practices/${timed.id}/publish`, {});
      state.fixtures.timedPublished = true;
      await persist();
    }

    // This separate assignment gives the teacher a real report and lets the
    // student inspect corrections without consuming the fresh classroom task.
    const history = await keep("historyAssignment", () =>
      teacher(
        "assignments",
        {
          title: "示例订正报告：别遗漏空行",
          classId: cls.id,
          dueAt,
          problems: [{ problemId: state.fixtures.rowSums.id, points: 100 }],
        },
        201,
      ),
    );
    async function demonstrationSubmission(key, kind, code, extra = {}) {
      const receipt = await keep(key, () =>
        student(
          "submissions",
          {
            problemId: state.fixtures.rowSums.id,
            versionId: state.fixtures.rowSums.versionId,
            assignmentId: history.id,
            kind,
            code,
            idempotencyKey: randomUUID(),
            ...extra,
          },
          201,
        ),
      );
      return waitFor(student, `submissions/${receipt.id}`);
    }
    const wrong = await demonstrationSubmission(
      "wrongSubmission",
      "submit",
      "def row_sums(grid):\n    return [sum(row) for row in grid if row]\n",
    );
    assert.equal(wrong.status, "WA");
    assert.equal(wrong.score, 75);
    const corrected = await demonstrationSubmission(
      "correction",
      "correction",
      definitions.rowSums.referenceCode,
      { originalSubmissionId: wrong.id },
    );
    assert.equal(corrected.status, "AC");
    assert.equal(corrected.score, 100);
    if (!state.fixtures.feedback) {
      await teacher(
        "review-notebook",
        {
          submissionId: wrong.id,
          note: "你已经处理了普通行，但过滤掉了空行。每一行都应对应一个返回值，空行也要返回 0。订正成功不会自动改动原作业成绩，需要重新正式提交。",
        },
        201,
      );
      state.fixtures.feedback = true;
      await persist();
    }
    assert.equal((await teacher(`assignments/${history.id}`)).grades[0].score, 75);
    const fresh = await student(`assignments/${state.fixtures.assignment.id}`);
    assert.ok(fresh.grades[0].problems.every((problem) => problem.status === "NotSubmitted"));
    await student(`learning-paths/${path.id}`);
    const readyTimed = await student(`timed-practices/${timed.id}`);
    assert.equal(readyTimed.attempt, null);
    state.complete = true;
    state.completedAt = new Date().toISOString();
    await persist();
    console.log(
      "Local demo ready: administrator, teacher and student; two genuinely validated Python problems; fresh assignment; published lessons; unopened 30-minute training; real WA 75 / correction AC 100 report.",
    );
    console.log(`Credential file: ${output}`);
  }
} finally {
  await pool.end();
}

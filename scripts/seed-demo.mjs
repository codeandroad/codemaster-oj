// Populate only the disposable local campus_demo installation. All classroom
// data and judging go through the real API and worker; no verdict is fabricated.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const output = fileURLToPath(new URL("../.campus-local/test-accounts.json", import.meta.url));
if (process.env.CAMPUS_DEMO_OUTPUT && resolve(process.env.CAMPUS_DEMO_OUTPUT) !== output)
  throw new Error("Demo credentials must stay in the ignored local test-accounts file.");
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
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await chmod(dirname(output), 0o700);
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, output);
}
await persist();

function client() {
  let cookie = "",
    csrfToken = "";
  return async function request(path, body, expectedStatus, method) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
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
      expectedStatus == null ? response.ok : response.status === expectedStatus,
      true,
      `${path}: HTTP ${response.status}${data.error?.code ? ` (${data.error.code})` : ""}`,
    );
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    if (data.csrfToken) csrfToken = data.csrfToken;
    return data;
  };
}
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

async function requestId(key) {
  state.requestIds ??= {};
  if (!state.requestIds[key]) {
    state.requestIds[key] = randomUUID();
    await persist();
  }
  return state.requestIds[key];
}

const slug = process.env.CAMPUS_DEMO_SCHOOL_SLUG ?? "tianxing-chuangshiji";
try {
  const {rows:[school]} = await pool.query("SELECT id FROM schools WHERE slug=$1",[slug]);
  assert.ok(school, "The configured demo school must exist.");
  const path = route => `schools/${school.id}/${route}`;
  const admin = client(), teacher = client(), student = client(), peer = client();
  async function member(account) {
    return (await pool.query(`SELECT i.id,i.kind,i.name,i.number,a.username FROM school_identities i
      JOIN accounts a ON a.id=i.account_id WHERE i.school_id=$1 AND a.username=$2`,[school.id,account.username])).rows[0];
  }
  async function provision() {
    if (!await member(state.accounts.admin)) await bootstrap(pool,{...state.accounts.admin, schoolSlug:slug});
    await admin("auth/login",state.accounts.admin);
    state.accounts.peer ??= {username:"demo.student2",name:"周同学（演示）",number:"DEMO-S002",password:randomBytes(20).toString("base64url")+"aA1!"};
    await persist();
    for (const role of ["teacher","student","peer"]) {
      const account=state.accounts[role],kind=role==="peer"?"student":role;
      if (!await member(account)) {
        const {rows:[old]}=await pool.query("SELECT id FROM school_identities WHERE school_id=$1 AND number=$2 AND kind=$3",[school.id,account.number,kind]);
        const person=old??await admin(path("identities"),{kind,name:account.name,number:account.number});
        const {activationCode}=await admin(path(`identities/${person.id}/activation-code`),{});
        await client()("auth/register",{...account,kind,schoolSlug:slug,activationCode});
      }
      account.person=await member(account);
      await persist();
    }
    await teacher("auth/login",state.accounts.teacher);
    await student("auth/login",state.accounts.student);
    await peer("auth/login",state.accounts.peer);
    const f=state.fixtures;
    async function keep(key,create) {
      if(!f[key]) { f[key]=await create(); await persist(); }
      return f[key];
    }
    async function judged(request,id) {
      const deadline=Date.now()+120000;
      do {
        const job=await request(path("judge-jobs/"+id));
        if(!["queued","leased"].includes(job.state))return job;
        await sleep(300);
      }while(Date.now()<deadline);
      throw new Error("Demo judge did not finish within two minutes.");
    }
    const cls=await keep("class",()=>teacher(path("classes"),{name:"Python 编程训练班",type:"training"}));
    for(const role of ["student","peer"]) await admin(path(`classes/${cls.id}/roster`),{identityId:state.accounts[role].person.id});
    const bank=await keep("bank",async()=>teacher(path("problem-banks"),{name:"Python",requestId:await requestId("bank")}));
    for(const [key,definition] of Object.entries(definitions)) {
      const problem=await keep(key,async()=>teacher(path("problems"),{...definition,bankId:bank.id,requestId:await requestId(key)}));
      let latest=await teacher(path("problems/"+problem.id));
      if(!latest.published) {
        const job=await teacher(path(`problems/${problem.id}/validate`),{expectedRevision:latest.revision,requestId:await requestId(key+"-validation")});
        assert.equal((await judged(teacher,job.id)).status,"AC");
        await admin(path(`problems/${problem.id}/publish`),{expectedRevision:latest.revision});
        latest=await teacher(path("problems/"+problem.id));
      }
      f[key]={id:problem.id,versionId:latest.versionId};await persist();
    }
    const problems=[f.addition,f.rowSums].map(p=>({problemId:p.id,versionId:p.versionId,points:50}));
    const chapters=[];
    for(const [i,key] of ["addition","rowSums"].entries())chapters.push({id:await requestId(key+"-chapter"),title:definitions[key].title,body:definitions[key].statement,problems:[problems[i]]});
    const course=await keep("learningPath",async()=>teacher(path("courses"),{requestId:await requestId("course"),title:"Python 入门与 ACSL 编程准备",chapters}));
    if(!(await teacher(path("courses/"+course.id))).published)await teacher(path(`courses/${course.id}/publish`),{expectedRevision:course.revision});
    f.additionChapter={id:chapters[0].id};f.rowsChapter={id:chapters[1].id};
    for (const [key,title] of [["assignment","第 1 课作业：输入输出与二维列表"],["historyAssignment","示例订正报告：别遗漏空行"],["timedPractice","ACSL 体验训练：30 分钟"]]) {
      const timed=key==="timedPractice";
      const start=new Date(state.createdAt);
      const activity=await keep(key,async()=>teacher(path("activities"),{kind:timed?"timed":"assignment",title,classIds:[cls.id],problems,
        startsAt:timed?start.toISOString():null,endsAt:new Date(+start+7*86400000).toISOString(),durationMinutes:timed?30:null,requestId:await requestId(key+"-activity")}));
      if((await teacher(path("activities/"+activity.id))).state==="Draft")await teacher(path(`activities/${activity.id}/publish`),{expectedRevision:activity.revision});
    }
    const accepted=await keep("peerSubmission",async()=>{
      const job=await peer(path(`problems/${f.addition.id}/submissions`),{kind:"submit",code:definitions.addition.referenceCode,requestId:await requestId("peer-submit")});
      assert.equal((await judged(peer,job.id)).status,"AC");
      return job.id;
    });
    assert.ok(accepted);
    state.complete=true;state.completedAt=new Date().toISOString();await persist();
  }
  if (!state.complete) await provision();
  console.log("Local demo school is ready. Existing accounts and learning records are preserved.");
} finally {
  await pool.end();
}

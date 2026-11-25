import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, request } from 'playwright-core';

const runtimeCase = 'formal-runtime-error-and-source-location';
const wrongAnswerCase = 'formal-wrong-answer-output-comparison';

const referenceCode = 'def solve(data):\n    return sorted(set(data), reverse=True)[1] if len(set(data)) > 1 else None';
const tests = [
  {input:'[[8,4,8,2]]', expected:'4', weight:50},
  {input:'[[5,5,5]]', expected:'null', weight:50},
];

async function session(origin, username, password) {
  const client = await request.newContext({baseURL:origin, extraHTTPHeaders:{Origin:origin}});
  try {
    const response = await client.post('/api/v1/auth/login', {data:{username,password}});
    assert.equal(response.status(), 200, 'Sign in to the release-check fixture');
    const {csrfToken} = await response.json();
    assert.ok(csrfToken);
    return {
      client,
      async api(path, {data, status = 200} = {}) {
        const response = await client.fetch('/api/v1' + path, {
          method:data ? 'POST' : 'GET', data, headers:{'X-CSRF-Token':csrfToken},
        });
        const result = await response.json();
        assert.equal(response.status(), status, `${path}: ${result.error?.code ?? ''}`);
        return result;
      },
    };
  } catch (error) {
    await client.dispose();
    throw error;
  }
}

async function publishExercise(origin, fixture) {
  const admin = await session(origin, fixture.admin, fixture.password);
  try {
    const teacher = await session(origin, fixture.teacher, fixture.password);
    try {
      const school = `/schools/${fixture.schoolId}`;
      const bank = await teacher.api(school+'/problem-banks', {status:201, data:{name:'Release check', requestId:randomUUID()}});
      const problem = await teacher.api(school+'/problems', {status:201, data:{
        bankId:bank.id, requestId:randomUUID(), title:'Second distinct reading', statement:'Return the second largest distinct value.',
        mode:'function', functionName:'solve', referenceCode, starterCode:'def solve(data):\n    pass',
        samples:[{input:'[[9,2]]', expected:'2'}], tests,
      }});
      const problemPath = school+'/problems/'+problem.id;
      const validation = await teacher.api(problemPath+'/validate', {status:202, data:{expectedRevision:1, requestId:randomUUID()}});
      const deadline = Date.now() + 45000;
      for (;;) {
        const result = await teacher.api(school+'/judge-jobs/'+validation.id);
        if (['completed','failed'].includes(result.state)) {
          assert.equal(result.status, 'AC', 'The real worker must validate the reference solution');
          break;
        }
        assert.ok(Date.now() < deadline, 'Timed out waiting for the real worker to validate the fixture');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      const published = await admin.api(problemPath+'/publish', {data:{expectedRevision:1}});
      const problemVersion = {problemId:problem.id, versionId:published.versionId};
      await admin.api(problemPath+'/public-request', {data:{versionId:published.versionId}});
      await admin.api('/platform/problem-publications', {data:{schoolId:fixture.schoolId, ...problemVersion}});
      const chapterId = randomUUID();
      const course = await teacher.api(school+'/courses', {status:201, data:{
        title:'Formal submission feedback', description:'Release check', accessScope:'school', classIds:[], requestId:randomUUID(),
        requiredLanguage:'python', chapters:[{id:chapterId,title:'Second distinct reading',body:'Practice',problems:[problemVersion]}],
      }});
      const edition = await teacher.api(school+'/courses/'+course.id+'/publish', {data:{expectedRevision:course.revision}});
      const listing = await admin.api('/platform/course-publications', {status:201, data:{
        schoolId:fixture.schoolId, courseId:course.id, revision:edition.revision,
      }});
      return {problemId:problem.id, publicCourseId:listing.id, publicChapterId:chapterId};
    } finally {
      await teacher.client.dispose();
    }
  } finally {
    await admin.client.dispose();
  }
}

export function browserBinary() {
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
}

export async function checkFormalSubmissions(origin, fixture) {
  const browser = await chromium.launch({executablePath:browserBinary()});
  try {
    const target = await publishExercise(origin, fixture);
    const context = await browser.newContext({baseURL:origin, viewport:{width:1440,height:1000}});
    const login = await context.request.post('/api/v1/auth/login', {
      headers:{Origin:origin}, data:{username:fixture.learner,password:fixture.password},
    });
    assert.equal(login.status(), 200, 'Sign in as the learner');
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto('/practice/problems?'+new URLSearchParams(target));
    const editor = page.getByRole('textbox', {name:'Python 3 code editor'});
    const panel = page.getByRole('region', {name:'Run result'});
    const submissionRoute = `/api/v1/practice/problems/${target.problemId}/submissions`;
    async function submit(code, verdict) {
      await editor.fill(code);
      const accepted = page.waitForResponse(response =>
        new URL(response.url()).pathname === submissionRoute && response.request().method() === 'POST');
      await page.getByRole('button', {name:'Submit', exact:true}).click();
      const response = await accepted;
      assert.equal(response.status(), 202, 'Formal submission must be accepted by the live API');
      const {kind,courseId,chapterId} = response.request().postDataJSON();
      assert.deepEqual([kind,courseId,chapterId], ['submit',target.publicCourseId,target.publicChapterId]);
      await panel.getByRole('heading', {name:verdict, exact:true}).waitFor();
    }

    await submit('def solve(data):\n    values = set(data)\n    values.remove(max(values))\n    return max(values)', 'Runtime Error');
    const crash = panel.getByRole('tabpanel');
    await panel.getByRole('tab', {name:'Case 2: Runtime Error', selected:true}).waitFor();
    await crash.getByText('ValueError: max() iterable argument is empty', {exact:false}).waitFor();
    await crash.getByRole('button', {name:'main.py:4', exact:true}).click();
    await page.waitForFunction(field => document.activeElement === field &&
      field.value.slice(0, field.selectionStart).split('\n').length === 4, await editor.elementHandle());
    console.log('PASS formal runtime exception and editor navigation to main.py:4');

    await submit('def solve(data):\n    return 0', 'Wrong Answer');
    await panel.getByRole('tab', {name:'Case 1: Wrong Answer', selected:true}).waitFor();
    const comparison = panel.getByRole('tabpanel');
    const actual = comparison.getByRole('heading', {name:'Output / return value', exact:true});
    const expected = comparison.getByRole('heading', {name:'Expected', exact:true});
    await actual.waitFor();
    await expected.waitFor();
    assert.equal(await actual.locator('..').locator('pre').innerText(), '0');
    assert.equal(await expected.locator('..').locator('pre').innerText(), '4');
    await comparison.locator('mark[data-tone="actual"]').filter({hasText:/^0$/}).waitFor();
    await comparison.locator('mark[data-tone="expected"]').filter({hasText:/^4$/}).waitFor();
    console.log('PASS formal wrong-answer comparison and highlighting');
    return [runtimeCase, wrongAnswerCase];
  } finally {
    await browser.close();
  }
}

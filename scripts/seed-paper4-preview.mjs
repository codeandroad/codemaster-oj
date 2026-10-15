// A short, original Paper 4-style sample for the isolated local preview.
// It uses generated demo credentials from the ignored file; it does not store
// or publish any Cambridge paper, mark scheme, or candidate materials.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = JSON.parse(await readFile(new URL('../.campus-local/test-accounts.json', import.meta.url), 'utf8'));
const origin = state.base;
const parsed = new URL(origin);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '3002') {
  throw new Error('Paper 4 sample may only be seeded into the isolated port 3002 preview.');
}
const teacher = state.accounts?.teacher;
const classId = state.fixtures?.class?.id;
if (!teacher?.username || !teacher?.password || !classId) throw new Error('Run the local demo seed before the Paper 4 sample seed.');

let cookie = '', csrf = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  if (result.csrfToken) csrf = result.csrfToken;
  if (!response.ok) throw new Error(`Paper 4 preview seed failed at ${method} ${path}: HTTP ${response.status} ${result.error?.code ?? ''}`);
  return result;
}
await request('auth/login', 'POST', { username: teacher.username, password: teacher.password });

const marker = '[local-paper4-preview]';
const existing = (await request('paper4/papers')).items.find(item => item.description?.startsWith(marker));
if (existing) {
  if (existing.status === 'draft') await request(`paper4/papers/${existing.id}/publish`, 'POST', {});
  console.log(`Paper 4 sample ready: ${origin}/teacher/paper4/${existing.id}`);
  process.exit(0);
}

const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const endsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const paper = await request('paper4/papers', 'POST', {
  title: 'Paper 4 编程实践 · 本地验收样卷',
  description: `${marker} 三道原创建模练习，结构参考 Paper 4：按阶段留存代码，运行结果仅供教师评分参考。此样卷非 Cambridge 原题。`,
  classId, startsAt, endsAt,
  questions: [
    {
      key: 'Q1', title: '环形队列',
      statement: '实现容量为 10 的字符串环形队列。每行命令为 ENQUEUE 值 或 DEQUEUE；出队时输出该值，空队列输出 EMPTY。请保留初始化、入队和出队各阶段的代码快照。',
      starterCode: '# Q1: circular queue\nimport sys\n\nfor command in sys.stdin:\n    pass\n',
      initialFiles: {}, outputFiles: [],
      stages: [
        { id: 'Q1a', title: '初始化', description: '定义队列及前后指针。', maxMarks: 2 },
        { id: 'Q1b', title: '入队', description: '处理容量上限与指针回绕。', maxMarks: 6 },
        { id: 'Q1c', title: '队列状态', description: '正确判断空与满。', maxMarks: 3 },
        { id: 'Q1d', title: '出队', description: '移除并返回队首元素。', maxMarks: 6 },
        { id: 'Q1e1', title: '主程序测试', description: '读取命令并调用队列操作。', maxMarks: 2 },
        { id: 'Q1e2', title: '运行证据', description: '保存最终代码和可核查运行记录。', maxMarks: 1 },
      ],
    },
    {
      key: 'Q2', title: '按颜色整理文本文件',
      statement: '读取 TheData.txt。每行是“整数,颜色”，将整数按颜色分别写入 Red.txt、Blue.txt 等输出文件，每行一个整数；标准输出写处理的记录数。请确保重复运行从原始数据开始，不累加上次结果。',
      starterCode: '# Q2: classify rows from TheData.txt\nfrom pathlib import Path\n\n',
      initialFiles: { 'TheData.txt': '10,Red\n20,Blue\n30,Green\n40,Red\n' },
      outputFiles: ['Red.txt', 'Blue.txt', 'Green.txt', 'Yellow.txt', 'Orange.txt', 'Pink.txt'],
      stages: [
        { id: 'Q2a', title: '读取数据', description: '解析文本中的记录。', maxMarks: 7 },
        { id: 'Q2b', title: '分类', description: '根据颜色分流整数。', maxMarks: 6 },
        { id: 'Q2c', title: '写出文件', description: '生成对应颜色的文本文件。', maxMarks: 5 },
        { id: 'Q2d', title: '异常处理', description: '处理无效行或未知颜色。', maxMarks: 2 },
        { id: 'Q2e1', title: '主流程', description: '组合读取、分类和写出。', maxMarks: 3 },
        { id: 'Q2e2', title: '运行证据', description: '核对输出文件和最终代码。', maxMarks: 2 },
      ],
    },
    {
      key: 'Q3', title: '二叉搜索树',
      statement: '实现结点类和二叉搜索树。标准输入为以空格分隔的整数；插入全部数值后进行中序遍历，并以空格分隔输出。重复值插入右子树。',
      starterCode: '# Q3: binary search tree\nimport sys\n\nclass Node:\n    pass\n\nclass Tree:\n    pass\n',
      initialFiles: {}, outputFiles: [],
      stages: [
        { id: 'Q3a1', title: '结点构造器', description: '保存值和左右引用。', maxMarks: 4 },
        { id: 'Q3a2', title: '访问方法', description: '实现必要的读写方法。', maxMarks: 3 },
        { id: 'Q3a3', title: '树构造器', description: '初始化根结点状态。', maxMarks: 3 },
        { id: 'Q3b', title: '比较方向', description: '按大小决定左右分支。', maxMarks: 2 },
        { id: 'Q3c1', title: '插入入口', description: '创建并插入结点。', maxMarks: 2 },
        { id: 'Q3c2', title: '重复值', description: '将重复值插入右侧。', maxMarks: 1 },
        { id: 'Q3c3', title: '递归插入', description: '定位合适位置。', maxMarks: 6 },
        { id: 'Q3d', title: '中序遍历', description: '输出升序序列。', maxMarks: 5 },
        { id: 'Q3e1', title: '主程序', description: '解析输入并调用树。', maxMarks: 3 },
        { id: 'Q3e2', title: '运行证据', description: '保存最终程序与运行记录。', maxMarks: 1 },
      ],
    },
  ],
  runnerCases: {
    Q1: [
      { id: 'queue-public', stdin: 'ENQUEUE alpha\nENQUEUE beta\nDEQUEUE\nDEQUEUE\n', expectedStdout: 'alpha\nbeta\n', public: true },
      { id: 'queue-hidden', stdin: 'DEQUEUE\nENQUEUE x\nDEQUEUE\n', expectedStdout: 'EMPTY\nx\n', public: false },
    ],
    Q2: [
      { id: 'files-public', inputFiles: { 'TheData.txt': '10,Red\n20,Blue\n30,Red\n' }, expectedStdout: '3\n', expectedFiles: { 'Red.txt': '10\n30\n', 'Blue.txt': '20\n' }, public: true },
      { id: 'files-hidden', inputFiles: { 'TheData.txt': '7,Pink\n8,Orange\n' }, expectedStdout: '2\n', expectedFiles: { 'Pink.txt': '7\n', 'Orange.txt': '8\n' }, public: false },
    ],
    Q3: [
      { id: 'tree-public', stdin: '8 3 10 1 6\n', expectedStdout: '1 3 6 8 10\n', public: true },
      { id: 'tree-hidden', stdin: '4 4 2 5\n', expectedStdout: '2 4 4 5\n', public: false },
    ],
  },
});
await request(`paper4/papers/${paper.id}/publish`, 'POST', {});
console.log(`Paper 4 sample ready: ${origin}/teacher/paper4/${paper.id}`);

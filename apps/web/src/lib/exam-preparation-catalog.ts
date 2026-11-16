export type ExamText = readonly [zh: string, en: string];
export type ExamCategory = 'academic' | 'admissions' | 'competitions' | 'languages';
export type ExamProgram = 'alevel' | 'igcse' | 'ap';
export type ExamBoard = 'cambridge' | 'edexcel' | 'lrn' | 'aqa';
export type ExamResource = 'paper1' | 'paper4' | 'acsl';

export const examCategories: {id: ExamCategory; label: ExamText; hint: ExamText}[] = [
  {id: 'academic', label: ['国际课程', 'Academic qualifications'], hint: ['A Level · IGCSE · AP', 'A Level · IGCSE · AP']},
  {id: 'admissions', label: ['升学考试', 'Admissions tests'], hint: ['SAT · GRE · GMAT', 'SAT · GRE · GMAT']},
  {id: 'competitions', label: ['学科竞赛', 'Academic competitions'], hint: ['数学 · 计算机 · 科学', 'Maths · Computing · Science']},
  {id: 'languages', label: ['语言考试', 'Language tests'], hint: ['IELTS · TOEFL', 'IELTS · TOEFL']},
];

export const examBoards: {id: ExamBoard; label: string; detail: string; igcseDetail?: string; aliases?: string}[] = [
  {id: 'cambridge', label: 'Cambridge (CIE)', detail: 'Cambridge International AS & A Level', igcseDetail: 'Cambridge IGCSE', aliases: 'CIE CAIE 剑桥'},
  {id: 'edexcel', label: 'Edexcel', detail: 'Pearson Edexcel International AS & A Level', igcseDetail: 'Pearson Edexcel International GCSE', aliases: '爱德思 爱德赛'},
  {id: 'lrn', label: 'LRN', detail: 'LRN International AS & A Level'},
  {id: 'aqa', label: 'AQA', detail: 'AQA AS & A Level'},
];

export type ExamEntry = {
  id: string;
  category: ExamCategory;
  program?: ExamProgram;
  board?: ExamBoard;
  group: ExamText;
  name: ExamText;
  detail: ExamText;
  aliases?: string;
  resources?: ExamResource[];
  subject?: 'computer-science-9618';
};

const subject = (id: string, board: ExamBoard, name: ExamText, detail: ExamText = ['', ''], program: ExamProgram = 'alevel'): ExamEntry => ({
  id, category: 'academic', program, board, group: ['科目', 'Subjects'], name, detail,
});

// This is a navigation plan, not a list of published papers or a permission grant.
// Only resource keys supplied by the current workspace become practice links.
export const examEntries: ExamEntry[] = [
  {...subject('cie-9618', 'cambridge', ['计算机科学 · 9618', 'Computer Science · 9618'], ['理论基础与编程实践', 'Theory fundamentals and practical programming']), resources: ['paper1', 'paper4'], subject: 'computer-science-9618', aliases: 'CIE CAIE Cambridge Computer Science Paper 1 Paper 4'},
  subject('cie-9709', 'cambridge', ['数学 · 9709', 'Mathematics · 9709']),
  subject('cie-9702', 'cambridge', ['物理 · 9702', 'Physics · 9702']),
  subject('cie-9701', 'cambridge', ['化学 · 9701', 'Chemistry · 9701']),
  subject('cie-9708', 'cambridge', ['经济 · 9708', 'Economics · 9708']),
  subject('cie-9700', 'cambridge', ['生物 · 9700', 'Biology · 9700']),
  {...subject('cie-0580', 'cambridge', ['数学 · 0580', 'Mathematics · 0580'], ['Core 核心课程 · Extended 扩展课程', 'Core · Extended'], 'igcse'), aliases: '核心数学 扩展数学'},
  {...subject('cie-0606', 'cambridge', ['附加数学 · 0606', 'Additional Mathematics · 0606'], ['Additional Mathematics', ''], 'igcse'), aliases: '附加数学 扩展数学 Additional Maths'},
  {...subject('edexcel-mathematics', 'edexcel', ['数学', 'Mathematics']), aliases: 'XMA01 YMA01'},
  {...subject('edexcel-further-mathematics', 'edexcel', ['进阶数学', 'Further Mathematics']), aliases: 'XFM01 YFM01'},
  {...subject('edexcel-physics', 'edexcel', ['物理', 'Physics']), aliases: 'XPH11 YPH11'},
  {...subject('edexcel-chemistry', 'edexcel', ['化学', 'Chemistry']), aliases: 'XCH11 YCH11'},
  {...subject('edexcel-economics', 'edexcel', ['经济', 'Economics']), aliases: 'XEC11 YEC11'},
  {...subject('edexcel-biology', 'edexcel', ['生物', 'Biology']), aliases: 'XBI11 YBI11'},
  subject('edexcel-computer-science', 'edexcel', ['计算机科学', 'Computer Science'], ['2026 新课程 · IAS 首考 2027 / IAL 首考 2028', 'New for 2026 · first IAS exams 2027 / IAL exams 2028']),
  subject('edexcel-4ma1', 'edexcel', ['数学 A · 4MA1', 'Mathematics A · 4MA1'], ['Foundation 基础层级 · Higher 高阶层级', 'Foundation · Higher'], 'igcse'),
  subject('edexcel-4pm1', 'edexcel', ['进阶纯数学 · 4PM1', 'Further Pure Mathematics · 4PM1'], ['Further Pure Mathematics', ''], 'igcse'),
  subject('lrn-subjects', 'lrn', ['LRN 科目资源', 'LRN subjects']),
  subject('aqa-subjects', 'aqa', ['AQA 科目资源', 'AQA subjects']),
  ...([
    ['computer-science-a', ['计算机科学 A', 'Computer Science A'], ['数学与计算机', 'Maths and computing']],
    ['computer-science-principles', ['计算机科学原理', 'Computer Science Principles'], ['数学与计算机', 'Maths and computing']],
    ['calculus-ab', ['微积分 AB', 'Calculus AB'], ['数学与计算机', 'Maths and computing']],
    ['calculus-bc', ['微积分 BC', 'Calculus BC'], ['数学与计算机', 'Maths and computing']],
    ['physics-1', ['物理 1', 'Physics 1'], ['自然科学', 'Sciences']],
    ['chemistry', ['化学', 'Chemistry'], ['自然科学', 'Sciences']],
  ] as const).map(([id, name, group]): ExamEntry => ({id: `ap-${id}`, category: 'academic', program: 'ap', group, name, detail: [`AP ${name[1]}`, `AP ${name[1]}`]})),
  {id: 'sat', category: 'admissions', group: ['本科入学', 'Undergraduate admissions'], name: ['SAT', 'SAT'], detail: ['阅读与写作 · 数学', 'Reading and Writing · Math']},
  {id: 'gre', category: 'admissions', group: ['研究生入学', 'Graduate admissions'], name: ['GRE', 'GRE'], detail: ['研究生入学考试备考', 'Graduate admissions preparation']},
  {id: 'gmat', category: 'admissions', group: ['研究生入学', 'Graduate admissions'], name: ['GMAT', 'GMAT'], detail: ['商学院研究生入学考试备考', 'Graduate business school preparation']},
  {id: 'acsl', category: 'competitions', group: ['计算机', 'Computing'], name: ['ACSL · 美国计算机科学联赛', 'ACSL · American Computer Science League'], detail: ['按组别、赛季与轮次练习', 'Practice by division, season and contest'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER', resources: ['acsl']},
  {id: 'amc-us', category: 'competitions', group: ['数学', 'Mathematics'], name: ['AMC · 美国', 'AMC · USA'], detail: ['美国数学竞赛 · AMC 8 / 10 / 12', 'American Mathematics Competitions · AMC 8 / 10 / 12'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER MAA'},
  {id: 'amc-au', category: 'competitions', group: ['数学', 'Mathematics'], name: ['AMC · 澳洲', 'AMC · Australia'], detail: ['澳大利亚数学竞赛', 'Australian Mathematics Competition'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER 澳大利亚 AMT'},
  {id: 'smc', category: 'competitions', group: ['数学', 'Mathematics'], name: ['SMC · 英国', 'SMC · UK'], detail: ['英国高级数学挑战赛', 'UKMT Senior Mathematical Challenge'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER UKMT'},
  {id: 'bpho', category: 'competitions', group: ['物理', 'Physics'], name: ['BPhO · 英国', 'BPhO · UK'], detail: ['英国物理奥林匹克', 'British Physics Olympiad'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER'},
  {id: 'ukcho', category: 'competitions', group: ['化学', 'Chemistry'], name: ['UKChO · 英国', 'UKChO · UK'], detail: ['英国化学奥林匹克', 'UK Chemistry Olympiad'], aliases: '阿思丹 阿斯丹 ASDAN ASEEDER'},
  {id: 'ielts', category: 'languages', group: ['英语', 'English'], name: ['IELTS · 雅思', 'IELTS'], detail: ['听力 · 阅读 · 写作 · 口语', 'Listening · Reading · Writing · Speaking']},
  {id: 'toefl', category: 'languages', group: ['英语', 'English'], name: ['TOEFL · 托福', 'TOEFL'], detail: ['听力 · 阅读 · 写作 · 口语', 'Listening · Reading · Writing · Speaking']},
];

export const examPrograms: {id: ExamProgram; label: string}[] = [
  {id: 'alevel', label: 'A Level'}, {id: 'igcse', label: 'IGCSE'}, {id: 'ap', label: 'AP'},
];

export function examBoardsFor(program: ExamProgram) {
  return program === 'ap' ? [] : examBoards.filter(board => program !== 'igcse' || board.igcseDetail);
}

export function examBoardDetail(board: typeof examBoards[number], program: ExamProgram) {
  return program === 'igcse' ? board.igcseDetail : board.detail;
}

export function examSelection(search: Pick<URLSearchParams, 'get'>) {
  const category = examCategories.find(item => item.id === search.get('category'))?.id ?? 'academic';
  const program = examPrograms.find(item => item.id === search.get('program'))?.id ?? 'alevel';
  const board = examBoardsFor(program).find(item => item.id === search.get('board'))?.id ?? 'cambridge';
  return {category, program, board} as const;
}

export function examDirectoryHref(base: string, selection: {category: ExamCategory; program?: string; board?: string}) {
  const [path, query] = base.split('?');
  const search = new URLSearchParams(query);
  for (const key of ['category', 'program', 'board', 'subject', 'component', 'paperId', 'attemptId']) search.delete(key);
  search.set('category', selection.category);
  if (selection.category === 'academic') {
    const resolved = examSelection(new URLSearchParams({program: selection.program ?? 'alevel', board: selection.board ?? 'cambridge'}));
    search.set('program', resolved.program);
    if (resolved.program !== 'ap') search.set('board', resolved.board);
  }
  return `${path}?${search}`;
}

export function searchExamEntries(query: string) {
  const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return examEntries.filter(entry => {
    const board = examBoards.find(item => item.id === entry.board);
    const category = examCategories.find(item => item.id === entry.category)!;
    const text = [entry.id, ...entry.name, ...entry.detail, ...entry.group, ...category.label, entry.program === 'alevel' ? 'A Level AS A-Level IAL' : entry.program === 'igcse' ? 'IGCSE International GCSE' : entry.program, board?.label, board ? examBoardDetail(board, entry.program ?? 'alevel') : undefined, board?.aliases, entry.aliases].join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}

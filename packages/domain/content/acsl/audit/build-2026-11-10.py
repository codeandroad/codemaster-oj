#!/usr/bin/env python3
"""Consolidate private fresh-review ledgers without copying account/runtime data.

Run at repository root. Inputs are ignored review evidence under .campus-local.
The output contains source provenance and review results, not raw PDF/test data.
Use --final only after every reviewer has completed and refreshed the ledger.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
BASE = ROOT / '.campus-local/acsl-audit-20261110'
OUT = ROOT / 'packages/domain/content/acsl/audit/2026-11-10.json'
DATE = '2026-11-10'
WRITTEN_CHECKS = ['English statement', 'Chinese statement', 'Every option and option ID', 'Mathematical notation and formula scope', 'Every source diagram', 'Explanation and source answer provenance', 'No solution in pre-submit fields']
PROGRAM_CHECKS = ['Complete bilingual rules and constraints', 'Every source diagram and table', 'Public examples and sample formatting', 'Input/output contract', 'No hidden tests or reference solution in student statement']


def read(name):
    p = BASE / name
    return json.loads(p.read_text()) if p.exists() else None


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def rows(value):
    return value if isinstance(value, list) else value.get('papers', []) if value else []


def flatten_findings(values):
    result = []
    for value in values or []:
        if isinstance(value, str):
            result.append({'description': value})
        else:
            finding = {}
            if value.get('finding') or value.get('issue'):
                finding['description'] = value.get('finding') or value['issue']
            if value.get('fix'):
                finding['correction'] = value['fix']
            if value.get('sourceErratum'):
                finding['sourceErratum'] = True
            if finding:
                result.append(finding)
    return result


# Explicitly classified source errata, kept separate from extraction defects.
# Review findings remain in English as recorded; this index is the concise Chinese
# changelog used in docs/acsl-source-audit.md. No grading values are rewritten here.
ERRATA = []

def err(season, division, contest, item, note, disposition='corrected-presentation'):
    ERRATA.append({'slug': f'acsl-{season}-{division}-{contest}', 'id': item,
                   'disposition': disposition, 'noteZh': note})

err('2020-2021','elementary',1,'q4','原解析把 11110₂ 对应值写成 31，已改为 30；选项键不变。')
err('2020-2021','elementary',2,'q2','原解析中间算式括号不平衡，改为等价且配对完整的算式。')
err('2022-2023','elementary',1,'q3','中文题意易被理解为十进制年份差，依据英文明确要求八进制年份差。')
err('2022-2023','elementary',1,'q4','原解析把 15 连写成 10615，已明确更正。')
err('2023-2024','elementary',1,'q3','原除基取余的最后一步误写 7÷8，改为 1÷8。')
err('2023-2024','elementary',2,'q3','原解析开头两个运算符顺序错误，按原题运算次序更正。')
err('2023-2024','elementary',2,'q5','原解析中间项误写 +4，改为 +2。')
err('2023-2024','elementary',3,'q1','原解析枚举包含不属于定义域的 20，移除该项，原计数不变。')
err('2024-2025','elementary',1,'q2','原解析把八进制结果标成十六进制，恢复正确进制下标。')
err('2024-2025','elementary',2,'q4','原解析把中间除法运算符误写成减法，已更正。')
err('2025-2026','elementary',2,'q6','原前缀化简步骤混入一个多余的 1，已移除并标注。')
err('2025-2026','elementary',3,'q1','原解析列举字母 C 与题意矛盾，应为 E；答案选项键 C 保持不变。')
err('2025-2026','elementary',4,'q2','原解析只写未命名终点，按原题补全为 Kochab。')
err('2025-2026','elementary',4,'q6','官方解析的三组边列表均有错误，按三幅原题图逐边更正，答案键不变。')

err('2021-2022','junior',3,'q1','原解析将两个取反变量的必要值误写为 0；应为取反值 1、原变量 0。')
err('2021-2022','junior',3,'programming','Fibonacci Pascal 中文上界包含 1,000,000，而英文为严格小于；中文按英文严格上界修正。')
err('2022-2023','junior',2,'programming','Binary Counting 中文输出说明易被理解为结果字符串的前缀，按英文改为依次查找后最后找到的整数。')
err('2022-2023','junior',3,'q4','原 FIFO 解析在没有操作的地方重复 MNTOCE 状态，移除重复项。')
err('2022-2023','junior',4,'programming','原主图目标为 (1,4)，样例 1 与原卷第 7 页图为 (1,3)。经用户确认，现已把中英文主图统一为 (1,3)；官方样例、测试与输出不变。','resolved-source-discrepancy')
err('2023-2024','junior',1,'q4','原递推解析的 f(3) 中误写 +4，结果却按 +2 计算；保留正确的 +2 推导。')
err('2023-2024','junior',1,'programming','Tiles 中文把“能够放置图块的最上方一行”误译成返回第 1 行，按英文规则与示例修正。')
err('2023-2024','junior',3,'programming','原样例 5 的第 5、9 张抽牌均为 61，与唯一性声明矛盾。现已保留原数据并加入双语勘误，明确按输入顺序处理两次抽牌、不去重或拒绝样例。','resolved-source-discrepancy')
err('2023-2024','junior',4,'q4','原图顶部是 OR 门，官方推导误写成 AB；改用 A+B 推导，最终答案不变。')
err('2024-2025','junior',1,'q1','原进制展开把 5×8 误算成 80，改为 40。')
err('2024-2025','junior',1,'q4','原解析末尾夹入无关且错误的 =ff(19)=15，保留正确的函数复合推导。')
err('2024-2025','junior',3,'programming','Manhattan Distance 重复英文页与中文图末行首数误为 25，主英文原图及序列规则为 26；保留 26。')
err('2024-2025','junior',4,'*','官方解答页眉误写 2022–2023；题目正文对应 2024–2025。','source-metadata-note')
err('2025-2026','junior',1,'programming','Creature Capture 原中英文示例把水平与垂直的 3、5 解释互换，按坐标计算修正文案，位置与输出不变。')
err('2025-2026','junior',4,'q3','官方德摩根中间推导遗漏 B 的反相，补回该反相，最终 AB 不变。')

err('2020-2021','intermediate',3,'q1','原解析令 B=0 后把 BC 写成 C，改为 0。')
err('2020-2021','intermediate',4,'q1','原邻接矩阵三次方左上角误写 3，独立重算应为 2；题目所求答案不变。')
err('2021-2022','intermediate',4,'q4','官方德摩根中间步骤无效，改为正确门级推导，最终 ABC 及计数不变。')
err('2022-2023','intermediate',3,'q5','原正则解析将 charleston 的分组归属解释错误，按原表达式更正。')
err('2023-2024','intermediate',2,'q4','原解析等式右侧误写 00111，改为 10111，通配模式不变。')
err('2023-2024','intermediate',3,'programming','RackO 官方表格在抽到 44、19 前的牌架状态有误；修正过程表，原样例及评分数据不变。')
err('2024-2025','intermediate',2,'q3','官方 AND 中间值误写 00011，应为 00001；后续 XOR 改为 01100，最终答案不变。')
err('2024-2025','intermediate',2,'programming','Uno Duo 中文替代 R4X 牌堆示例漏掉 B1X 与 B2T 之间的 B1T；按英文与转移规则补回。')
err('2024-2025','intermediate',3,'q3','官方二叉搜索树把 E 放在 N 左侧，实际应在 B 右侧；重绘解析树，答案不变。')
err('2025-2026','intermediate',2,'q2','官方前缀转换中间变量误写 x，应为 z。')
err('2025-2026','intermediate',3,'q6','官方正则解析把 clarinet 的失败位置归于 r，应为被排除的 a。')

err('2020-2021','senior',1,'q1','原八进制转换解析有笔误，675₁₀ 应为 1243₈，原计数不变。')
err('2020-2021','senior',3,'q5','原解析开头字母列表 E 有误，依据题中列表恢复正确项目与逐项说明。')
err('2020-2021','senior',4,'*','提供的资料没有官方笔试解析；五题使用明确标注的内部独立推导，不能宣称官方解答。','missing-official-solution')
err('2021-2022','senior',1,'q3','原递推解析 f(2) 把减 2 误写为减 1，已在提交后解析标明更正。')
err('2023-2024','senior',3,'q4','原有限状态机解析字符串中的 c 有笔误，只更正解析，原题字符串与答案不变。')
err('2023-2024','senior',3,'q5','原解把 relish/mustard 的失败归于末尾 h/t，但两字母属于末尾字符类；实际内部 s 无法被前面各段消费，判定与总数不变。')
err('2024-2025','senior',2,'q1','原前缀题解析多出原题没有的 + 运算符，移除并仅在提交后说明。')
err('2025-2026','senior',3,'programming','Kings in Corners 官方过程表把实际 4H 误写为 JH，仅修正公开示例过程，测试不变。')

err('2021-2022','senior',1,'q4','原递推解析中间将 f(4,4)+2 误写为 +1，改回 +2；最终值不变。')
err('2022-2023','senior',4,'q3','原解析中间漏掉 XOR 整体反相线，后续展开无效；改用正确的逐门推导，最终答案不变。')
err('2025-2026','senior',2,'programming','原卷同页保留旧规则和修订段落；修订明确 1123 不属于四个连续数字，正式题面采用原卷修订版。','adopted-source-revision')
err('2023-2024','intermediate',1,'*','已解决的工具兼容问题，并非原卷内容缺失：此前 PDFium/Poppler 漏显中文；后续使用 macOS PDFKit/Quartz 完整渲染第3、4页，逐题核对五题中文正文、公式、代码和选项，均与系统题面一致。','source-rendering-resolved')
err('2024-2025','intermediate',3,'q4','原解析把列出的栈顺序误称从顶到底，改为从底到顶。')
err('2024-2025','intermediate',3,'q6','原选项 C 漏掉候选 b，官方解析答案列与标准正则语义包含 b。经用户确认，现已把中英文 C 选项改为 b,c,d,e,f，答案 ID 仍为 C，并更新交卷后解析；历史已保存成绩不重新计算。','resolved-source-discrepancy')
err('2025-2026','intermediate',2,'q3','原解算式漏右括号，补全括号并保持运算顺序。')
err('2025-2026','intermediate',4,'q5','原解对程序乘法性质的概括过宽，补充适用范围，所求程序与结果不变。')

# Follow-up resolutions are user-authorized content corrections, not claims that
# the original PDF has been amended. Source file hashes stay unchanged.
RESOLUTIONS = {
    ('acsl-2022-2023-junior-4', 'programming'): {
        'method': 'Adopted source PDF page 7 diagram and official sample 1; moved localized target circle/crosshairs from14 to13.',
        'sourceFactsPreserved': 'Original PDF pages1/4 still show14; source PDF bytes unchanged.',
        'gradingPolicy': 'Official samples, tests and scoring configuration unchanged.',
        'evidence': '.campus-local/acsl-errata-fix-20261110/junior-content-report.json',
    },
    ('acsl-2023-2024-junior-3', 'programming'): {
        'method': 'Preserved both61 draws and added bilingual sample5 erratum requiring ordered processing without deduplication or rejection.',
        'sourceFactsPreserved': 'Original PDF uniqueness statement and repeated61 sample are both preserved and explicitly distinguished.',
        'gradingPolicy': 'Official samples, tests and scoring configuration unchanged.',
        'evidence': '.campus-local/acsl-errata-fix-20261110/junior-content-report.json',
    },
    ('acsl-2024-2025-intermediate-3', 'q6'): {
        'method': 'Corrected option C text to b,c,d,e,f in both languages and corrected post-grade explanation.',
        'sourceFactsPreserved': 'Original PDF option C omitted b; official solution answer-column and independent full-string matching include b.',
        'gradingPolicy': 'Correct option ID remains C. Preserve saved historical answers and scores; no retroactive regrading.',
        'evidence': '.campus-local/acsl-errata-fix-20261110/intermediate-regex-validation.json',
    },
}
for entry in ERRATA:
    resolution = RESOLUTIONS.get((entry['slug'], entry['id']))
    if resolution:
        entry.update(status='resolved', resolvedAt='2026-11-10', authorization='explicit-user-approval', resolution=resolution)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--final', action='store_true')
    args = parser.parse_args()
    inputs = {
        'elementary': read('elementary.json'),
        'junior': read('junior.json'),
        'intermediate': read('intermediate.json') or read('intermediate/index.json'),
        'senior': read('senior.json'),
        'intermediate-program': read('intermediate-program.json'),
        'intermediate-program-late': read('intermediate-program-late.json'),
    }
    lookup = {k: {p['slug']: p for p in rows(v)} for k, v in inputs.items()}
    records = []
    pending = []
    hashes = {}
    def source_ref(source, role, pages, scope='question-pages'):
        relative = source['path']
        if not relative.startswith('resource/acsl-problems/'):
            raise ValueError(f'Unexpected source path: {relative}')
        actual = hashes.setdefault(relative, sha((ROOT / relative).read_bytes()))
        if actual != source['sha256']:
            raise ValueError(f'Source hash mismatch: {relative}')
        return {'role': role, 'sourceId': source.get('id'), 'path': relative,
                'sha256': actual, 'pages': sorted(set(pages)), 'pageScope': scope}
    for path in sorted((ROOT / 'packages/domain/content/acsl/editions').glob('*/*/contest-*/paper.json')):
        paper = json.loads(path.read_text())
        slug = paper['slug']
        division = paper['division'].lower()
        review = lookup[division].get(slug, {})
        qreviews = {q['id']: q for q in review.get('questions', [])}
        sources = {s['id']: s for s in paper['sources']}
        for question in paper['questions']:
            qr = qreviews.get(question['id'], {})
            complete = qr.get('status') in ['reviewed', 'verified', 'corrected', 'compared-no-change']
            refs = []
            if division == 'intermediate' and qr.get('sources'):
                for role, elements in qr['sources'].items():
                    for element in elements:
                        matching = next((s for s in sources.values() if s['path'] == element['path']), None)
                        if matching is None:
                            raise ValueError(f'Unknown source in {slug}/{question["id"]}')
                        refs.append(source_ref(matching, role, [element['page']]))
            else:
                src = question['source']
                for role in ['statement', 'solution']:
                    sid = src.get(f'{role}Source')
                    if sid:
                        refs.append(source_ref(sources[sid], role, src.get(f'{role}Pages', [])))
            item = {
                'slug': slug, 'id': question['id'], 'kind': 'written',
                'division': paper['division'], 'season': paper['season'], 'round': paper['round'],
                'reviewStatus': 'reviewed' if complete else 'pending',
                'contentPath': str(path.relative_to(ROOT)), 'contentPointer': f'/questions/{paper["questions"].index(question)}',
                'contentSha256': sha(canonical(question)), 'sourceReferences': refs,
                'answerProvenance': question['source'].get('answerProvenance', 'official'),
                'checked': qr.get('checked', WRITTEN_CHECKS if complete else []),
                'findings': flatten_findings(qr.get('findings', [])),
                'uncertainty': qr.get('remainingUncertainty', qr.get('uncertainty', [])),
                'sourceErrata': [e for e in ERRATA if e['slug'] == slug and e['id'] in [question['id'], '*']],
            }
            if qr.get('followupVerification'):
                item['followupVerification'] = {
                    key: value for key, value in qr['followupVerification'].items()
                    if key in ['reviewedAt', 'status', 'previousLimitation', 'report', 'evidence', 'finding', 'formalChanged']
                }
            if qr.get('resolvedSourceDiscrepancies'):
                item['resolvedSourceDiscrepancies'] = qr['resolvedSourceDiscrepancies']
                item['followupEvidence'] = qr.get('followupEvidence', [])
            if not complete:
                pending.append(f'{slug}/{question["id"]}')
            records.append(item)
        if not paper.get('programming'):
            continue
        program = paper['programming']
        if division == 'intermediate':
            pr = lookup['intermediate-program-late'].get(slug) or lookup['intermediate-program'].get(slug, {})
        else:
            pr = review.get('programming', {})
        complete = pr.get('status') in ['reviewed', 'verified', 'corrected', 'compared-no-change']
        refs = []
        pages_map = pr.get('sourcePages') or {}
        if not pages_map:
            for source in pr.get('sources', []):
                pages_map[source['id']] = source.get('pagesVisuallyReviewed') or list(range(1, source['pages'] + 1))
        source_ids = program['source'].get('sourceIds') or [sid for sid, source in sources.items() if source['path'] == program['source'].get('path')]
        if not pages_map:
            for source in review.get('sourcePagesVisuallyReviewed', []):
                if source['id'] in source_ids:
                    pages_map[source['id']] = source['pages']
        if not pages_map:
            for sid in source_ids:
                pages_map[sid] = list(range(1, sources[sid]['pages'] + 1))
        for sid, pages in pages_map.items():
            refs.append(source_ref(sources[sid], 'programming-source', pages, 'complete-source-reviewed'))
        findings = flatten_findings(pr.get('findings', []))
        item = {
            'slug': slug, 'id': 'programming', 'problemId': program['id'], 'kind': 'programming',
            'division': paper['division'], 'season': paper['season'], 'round': paper['round'],
            'reviewStatus': 'reviewed' if complete else 'pending',
            'contentPath': str(path.relative_to(ROOT)), 'contentPointer': '/programming',
            'contentSha256': sha(canonical(program)), 'sourceReferences': refs,
            'checked': pr.get('checked', pr.get('checks', PROGRAM_CHECKS if complete else [])),
            'findings': findings,
            'observations': pr.get('observations', []),
            'uncertainty': pr.get('uncertainty', []),
            'sourceErrata': [e for e in ERRATA if e['slug'] == slug and e['id'] == 'programming'],
        }
        if pr.get('resolvedSourceDiscrepancies'):
            item['resolvedSourceDiscrepancies'] = pr['resolvedSourceDiscrepancies']
            item['followupEvidence'] = pr.get('followupEvidence', [])
        if not complete:
            pending.append(f'{slug}/programming')
        records.append(item)
    for record in records:
        assert record['sourceReferences'], (record['slug'], record['id'])
        for reference in record['sourceReferences']:
            assert reference['pages'] and all(isinstance(page, int) and page >= 1 for page in reference['pages'])
    records.sort(key=lambda r: (r['season'], ['Elementary','Junior','Intermediate','Senior'].index(r['division']), r['round'], r['id']))
    assert len(records) == 577, len(records)
    assert len({(r['slug'], r['id']) for r in records}) == 577
    assert sum(r['kind'] == 'written' for r in records) == 506
    assert sum(r['kind'] == 'programming' for r in records) == 71
    reviewer_complete = bool(read('intermediate.json')) and not pending
    if args.final and not reviewer_complete:
        raise SystemExit(f'Cannot finalize: intermediate final ledger missing or {len(pending)} records pending.')
    status = 'completed' if args.final and reviewer_complete else 'in-progress'
    result = {
        'schemaVersion': 1, 'auditDate': DATE, 'status': status,
        'scope': {'papers': 95, 'writtenQuestions': 506, 'programmingProblems': 71,
                  'excluded': ['Existing Junior 2025–2026 Contest 3 sample', 'Historical topic worksheets']},
        'method': 'Fresh original PDF visual/text comparisons by each division reviewer; this file consolidates their item-level findings and independently verifies current source/content hashes.',
        'access': 'Server-side repository audit only; must not be exposed by student catalog/detail/explanation endpoints.',
        'contentHashEncoding': 'SHA-256 of UTF-8 JSON, recursively sorted object keys, compact separators, unescaped Unicode, no trailing newline; scope is the object at contentPointer.',
        'completion': {'reviewed': len(records) - len(pending), 'pending': pending, 'finalReviewerLedgerReceived': reviewer_complete},
        'sourceErrata': ERRATA,
        'records': records,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'path': str(OUT.relative_to(ROOT)), 'status': status, 'records': len(records), 'reviewed': len(records)-len(pending), 'sourceFilesVerified': len(hashes)}, ensure_ascii=False))

if __name__ == '__main__':
    main()

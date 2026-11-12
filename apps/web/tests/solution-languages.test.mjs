import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { selectSolution, solutionsForLanguage, referenceSolutionDraft, sameSolutionDraft, solutionDraftBytes, solutionDraftError } from '../src/components/scholarship/solution-model.ts';
import { appendHistoricalSolution } from '../src/components/scholarship/solution-history-model.ts';
import { readAssistanceDraft } from '../../../packages/domain/src/problem-solution-bundles.mjs';

const articles = [undefined, 'python', 'cpp', 'javascript', 'cpp'].map((programmingLanguage, index) => ({
 id: randomUUID(), title: `Approach ${index}`, body: `Explanation ${index}`, programmingLanguage,
}));

test('student language selection prioritizes matching code and includes general explanations', () => {
 assert.deepEqual(solutionsForLanguage(articles, 'cpp'), [articles[0], articles[2], articles[4]]);
 assert.equal(selectSolution(articles, 'cpp').id, articles[2].id);
 assert.equal(selectSolution(articles, 'cpp', articles[4].id).id, articles[4].id);
 assert.equal(selectSolution(articles, 'python', articles[4].id).id, articles[1].id);
 assert.deepEqual(solutionsForLanguage(articles, 'general'), [articles[0]]);
 assert.deepEqual(solutionsForLanguage(articles, 'all'), articles);
});

test('missing translations never silently substitute a different programming language', () => {
 assert.equal(selectSolution([articles[1]], 'cpp'), undefined);
 assert.equal(selectSolution([articles[1], articles[0]], 'cpp').id, articles[0].id);
 assert.equal(selectSolution([articles[0]], 'javascript').id, articles[0].id, 'legacy untagged solutions remain readable');
 assert.equal(selectSolution([], 'python'), undefined);
});

test('language-only author edits are dirty and original/historical imports preserve language', () => {
 const draft = {body: articles[1].body, solutions: [articles[1]]};
 const changed = {...draft, solutions: [{...articles[1], programmingLanguage: 'cpp'}]};
 assert.equal(sameSolutionDraft(draft, changed), false);
 assert.equal(sameSolutionDraft(draft, structuredClone(draft)), true);
 assert.deepEqual(referenceSolutionDraft({body:'Reference',programmingLanguage:'javascript'}, 'Original').solutions,
  [{title:'Original',body:'Reference',programmingLanguage:'javascript'}]);
 const historical = appendHistoricalSolution(draft, articles[2], 'Old').draft.solutions[1];
 assert.equal(historical.programmingLanguage, 'cpp');
 assert.equal(historical.id, undefined);
 assert.equal(appendHistoricalSolution(draft, {...articles[1], programmingLanguage:'javascript'}, 'Old').draft.solutions.length, 2);
 assert.equal(appendHistoricalSolution(draft, articles[1], 'Old').error, 'duplicate');
});

test('client size limit counts language metadata exactly like the server', () => {
 const draft = {body: articles[1].body, solutions: [articles[1], ...articles.slice(2), articles[0]]};
 const saved = readAssistanceDraft(draft, {subjectKey:'problem:'+randomUUID(),kind:'FULL_SOLUTION'});
 assert.equal(solutionDraftBytes(draft), Buffer.byteLength(JSON.stringify(saved)));
 assert.equal(solutionDraftError(draft), null);
 assert.equal(solutionDraftError({body:'',solutions:[{title:'Python',body:'',programmingLanguage:'python'}]}), 'required');
});

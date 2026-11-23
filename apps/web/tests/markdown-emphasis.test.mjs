import test from 'node:test';
import assert from 'node:assert/strict';
import { contentBlocks, inlineTokens } from '../src/components/content-parser.ts';

function tree(source) {
  const simplify = tokens => tokens.map(token => [
    token.kind,
    token.children ? simplify(token.children) : token.text,
  ]);
  return simplify(inlineTokens(source));
}

test('asterisks and underscores render Chinese and Latin emphasis', () => {
  for (const source of ['*xxx*', '_xxx_', '*斜体文字*', '_斜体文字_']) {
    assert.equal(inlineTokens(source)[0].kind, 'emphasis');
    assert.equal(inlineTokens(source)[0].text, source.slice(1, -1));
  }
  assert.deepEqual(tree('*one* and *two*'), [
    ['emphasis', [['text', 'one']]], ['text', ' and '], ['emphasis', [['text', 'two']]],
  ]);
});

test('emphasis supports inline code, formulas and nested strong content', () => {
  assert.deepEqual(tree('*`xxx`*'), [['emphasis', [['code', 'xxx']]]]);
  assert.deepEqual(tree('*$a_i$*'), [['emphasis', [['math', 'a_i']]]]);
  assert.deepEqual(tree('*a **b** c*'), [['emphasis', [
    ['text', 'a '], ['strong', [['text', 'b']]], ['text', ' c'],
  ]]]);
  assert.deepEqual(tree('**a *b* c**'), [['strong', [
    ['text', 'a '], ['emphasis', [['text', 'b']]], ['text', ' c'],
  ]]]);
  for (const source of ['***both***', '___both___']) {
    assert.deepEqual(tree(source), [['emphasis', [['strong', [['text', 'both']]]]]]);
  }
});

test('code, formulas, escapes and intraword underscores retain their literal meaning', () => {
  assert.deepEqual(tree('`*literal* _literal_`'), [['code', '*literal* _literal_']]);
  assert.deepEqual(tree('$a_i * b_j$'), [['math', 'a_i * b_j']]);
  assert.deepEqual(tree(String.raw`\*literal\* \_literal\_`), [['text', '*literal* _literal_']]);
  assert.deepEqual(tree('😀_xxx_'), [['text', '😀'], ['emphasis', [['text', 'xxx']]]]);
  assert.deepEqual(tree('_xxx_😀'), [['emphasis', [['text', 'xxx']]], ['text', '😀']]);
  assert.deepEqual(tree('snake_case_name a__b__c'), [['text', 'snake_case_name a__b__c']]);
  assert.deepEqual(tree(String.raw`*a \* b*`), [['emphasis', [['text', 'a * b']]]]);
  assert.deepEqual(tree('*a `*` b*'), [['emphasis', [['text', 'a '], ['code', '*'], ['text', ' b']]]]);
  assert.deepEqual(tree('**a `$**$` b**'), [['strong', [['text', 'a '], ['code', '$**$'], ['text', ' b']]]]);
  assert.deepEqual(tree('*a $x*y$ b*'), [['emphasis', [['text', 'a '], ['math', 'x*y'], ['text', ' b']]]]);
  assert.deepEqual(contentBlocks('```text\n*literal*\n```'), [{kind: 'code', text: '*literal*', language: 'text'}]);
});

test('unmatched delimiters and whitespace remain readable text', () => {
  for (const source of ['*unclosed', 'unclosed_', '* spaced *', '_ spaced _', '2 * 3', '**']) {
    assert.deepEqual(tree(source), [['text', source]]);
  }
  assert.deepEqual(tree('*<img src=x onerror=alert(1)>*'), [['emphasis', [['text', '<img src=x onerror=alert(1)>']]]]);
});

test('headings, lists and tables use the same emphasis parser', () => {
  const blocks = contentBlocks('# *Heading*\n\n- *List*\n\n| *Header* |\n| --- |\n| *`Cell`* |');
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'list', 'table']);
  for (const text of [blocks[0].text, blocks[1].items[0], blocks[2].headers[0], blocks[2].rows[0][0]]) {
    assert.equal(inlineTokens(text)[0].kind, 'emphasis');
  }
});

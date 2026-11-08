import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyProblemStatement } from '../src/problem-statement-display.mjs';

test('the legacy problem presentation removes only exact generated Python import Notes', () => {
 const source='Independent CodeMaster exercise; curriculum reference: https://www.hackerrank.com/challenges/python-example/problem';
 const statement='## Task\n\nPrint the result.';
 const notes='\n\n## Notes\n\nThis is an independently authored CodeMaster exercise corresponding to a curriculum topic, not a reproduction of the linked HackerRank challenge. Method suggestions are learning guidance; grading checks observable results. Python 3.12 ';
 for(const runtime of ['and its standard library is available.','with NumPy 2.2.6 is available.']){
  const original=statement+notes+runtime;
  const imported=Object.freeze({source,statement:original});
  assert.equal(legacyProblemStatement(imported),statement);
  assert.equal(imported.statement,original);
  assert.equal(legacyProblemStatement({statement:original}),original);
  const followedByInstructions=original+'\n\n## Output\n\nPrint one integer.';
  assert.equal(legacyProblemStatement({source,statement:followedByInstructions}),followedByInstructions);
 }
 const authored=statement+'\n\n## Notes\n\nInput may contain consecutive spaces.';
 assert.equal(legacyProblemStatement({source,statement:authored}),authored);
});

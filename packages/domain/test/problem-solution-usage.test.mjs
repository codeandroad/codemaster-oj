import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendSolutionVersion } from '../src/problem-solution-usage.mjs';

const version=(versionId,usage={},latest=false)=>({versionId,latest,usage:{courseCount:0,assignmentCount:0,timedCount:0,schoolPractice:false,...usage}});
test('solution recommendation never arbitrarily chooses between distinct course or activity uses',()=>{
 assert.deepEqual(recommendSolutionVersion([version('one',{courseCount:1}),version('two',{courseCount:1})]),{recommendedVersionId:null,selectionRequired:true});
 assert.deepEqual(recommendSolutionVersion([version('one',{assignmentCount:1}),version('two',{timedCount:1})]),{recommendedVersionId:null,selectionRequired:true});
 assert.deepEqual(recommendSolutionVersion([version('one',{courseCount:1}),version('two',{schoolPractice:true,assignmentCount:1})]),{recommendedVersionId:'one',selectionRequired:false});
 assert.deepEqual(recommendSolutionVersion([version('one'),version('two',{},true)]),{recommendedVersionId:'two',selectionRequired:false});
 assert.deepEqual(recommendSolutionVersion([]),{recommendedVersionId:null,selectionRequired:false});
});

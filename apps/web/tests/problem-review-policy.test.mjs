import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewVersionActions} from '../src/components/admin/problem-review-policy.ts';

const version=(overrides={})=>({
  isCurrent:true,
  publishedAt:'2026-10-01T00:00:00.000Z',
  schoolVisibleAt:null,
  bankVisibility:'school',
  validationStatus:'AC',
  rankReviewStatus:'pending',
  ...overrides,
});

test('legacy public current version has review actions, never a simultaneous withdrawal action',()=>{
  const actions=reviewVersionActions(version({schoolVisibleAt:'2026-10-01T00:00:00.000Z'}));
  assert.deepEqual(actions,{canApprove:true,canReject:true,canWithdraw:false});
});

test('approved current and public historical versions can be withdrawn only',()=>{
  assert.deepEqual(reviewVersionActions(version({rankReviewStatus:'approved',schoolVisibleAt:'2026-10-01T00:00:00.000Z'})),
    {canApprove:false,canReject:false,canWithdraw:true});
  assert.deepEqual(reviewVersionActions(version({isCurrent:false,schoolVisibleAt:'2026-10-01T00:00:00.000Z'})),
    {canApprove:false,canReject:false,canWithdraw:true});
});

test('an unvalidated pending version cannot be approved',()=>{
  assert.deepEqual(reviewVersionActions(version({validationStatus:'WA'})),
    {canApprove:false,canReject:true,canWithdraw:false});
});

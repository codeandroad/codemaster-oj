import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  applyTimeoutAction,
  computePots,
  evaluateHand,
  forceFoldSeat,
  getLegalActions,
  projectHandForViewer,
  startHand,
} from '../src/poker-engine.mjs';
import { computeBuyInAllowance } from '../src/poker.mjs';
import { decideBotAction, preflopStrength, postflopStrength } from '../src/poker-bot.mjs';

test('evaluateHand ranks all standard poker hand categories accurately', () => {
  const royal = evaluateHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d']);
  const straightFlush = evaluateHand(['9h', '8h', '7h', '6h', '5h', 'Kc', 'Kd']);
  const wheelSf = evaluateHand(['Ah', '2h', '3h', '4h', '5h', 'Kc', 'Qd']);
  const quads = evaluateHand(['Ac', 'Ad', 'Ah', 'As', '2c', '3d', '4h']);
  const fullHouse = evaluateHand(['Kc', 'Kd', 'Kh', '2s', '2c', 'Ah', 'Qd']);
  const flush = evaluateHand(['As', 'Js', '8s', '4s', '2s', 'Kc', 'Kd']);
  const straight = evaluateHand(['9c', '8d', '7h', '6s', '5c', '2d', 'Ah']);
  const wheel = evaluateHand(['Ac', '2d', '3h', '4s', '5c', 'Kd', 'Qh']);
  const trips = evaluateHand(['Qc', 'Qd', 'Qh', 'As', '9c', '2d', '3h']);
  const twoPair = evaluateHand(['Ac', 'Ad', 'Kc', 'Kd', 'Qh', '2s', '3c']);
  const pair = evaluateHand(['Jc', 'Jd', 'Ah', 'Ks', '9c', '2d', '3h']);
  const highCard = evaluateHand(['Ac', 'Kd', 'Jh', '9s', '7c', '2d', '3h']);

  assert.equal(royal.labelEn, 'Royal Flush');
  assert.equal(royal.labelZh, '皇家同花顺');
  assert.equal(wheel.labelEn, 'Straight');
  assert.equal(wheel.ranks[0], 5);

  const ordered = [royal, straightFlush, wheelSf, quads, fullHouse, flush, straight, wheel, trips, twoPair, pair, highCard];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(ordered[i].score > ordered[i + 1].score, `${ordered[i].labelEn} should beat ${ordered[i + 1].labelEn}`);
  }
});

test('computePots splits main and side pots accurately including folded dead money', () => {
  const pots = computePots([
    { seatIndex: 0, totalBet: 100, folded: false },
    { seatIndex: 1, totalBet: 300, folded: false },
    { seatIndex: 2, totalBet: 300, folded: false },
    { seatIndex: 3, totalBet: 50, folded: true },
  ]);
  assert.deepEqual(pots, [
    { amountCents: 350, eligibleSeats: [0, 1, 2] }, // 50 + 100*3
    { amountCents: 400, eligibleSeats: [1, 2] },    // 200*2
  ]);
});

test('heads-up blinds, action order, all-in runout, and split pot odd-chip rule', () => {
  // Deck is popped from the end.
  // Players: seat 0 (dealer/SB), seat 1 (BB).
  // Deal order: seat 0 gets 2, seat 1 gets 2; then board 5 cards.
  // Board: As Ks Qs Js Ts (Royal Flush on board -> guaranteed tie!)
  const board = ['Ts', 'Js', 'Qs', 'Ks', 'As']; // popped in reverse -> As, Ks, Qs, Js, Ts
  const deck = [
    ...board,
    '2d', '3c', // seat 1 hole
    '4d', '5c', // seat 0 hole
  ];
  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000001',
    handNumber: 1,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'Alice', avatar: 'a', stackCents: 101 },
      { seatIndex: 1, accountId: 'a1', identityId: 'i1', displayName: 'Bob', avatar: 'b', stackCents: 100 },
    ],
    previousDealerSeat: null,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
    deck,
  });

  // Heads-up: dealer = SB = seat 0, BB = seat 1, preflop SB acts first.
  assert.equal(state.dealerSeat, 0);
  assert.equal(state.sbSeat, 0);
  assert.equal(state.bbSeat, 1);
  assert.equal(state.actingSeat, 0);

  // Privacy check: seat 0 only sees own cards, not seat 1's.
  const view0 = projectHandForViewer(state, 'a0');
  assert.equal(view0.players[0].holeCards.length, 2);
  assert.equal(view0.players[1].holeCards, null);

  // Seat 0 raises all-in to 101, seat 1 calls all-in for 100.
  // Total pot = 200 main pot + 1 uncalled returned to seat 0.
  applyAction(state, { seatIndex: 0, action: 'all_in', nowMs: 2000 });
  assert.equal(state.actingSeat, 1);
  applyAction(state, { seatIndex: 1, action: 'call', nowMs: 3000 });

  assert.equal(state.finished, true);
  assert.equal(state.street, 'showdown');
  assert.equal(state.communityCards.length, 5);
  // Split main pot of 200 -> 100 each, plus 1 uncalled back to seat 0 -> seat 0 has 101, seat 1 has 100.
  assert.equal(state.players[0].stackCents, 101);
  assert.equal(state.players[1].stackCents, 100);
});

test('three-way side pot gives main pot to short-stack winner and side pot to second-best hand', () => {
  // Seat 0 (50 cents): AA (wins main pot)
  // Seat 1 (200 cents): KK (wins side pot vs Seat 2)
  // Seat 2 (200 cents): QQ (loses both)
  // Board: 2c 7d 9h 4s 8c (no flush, no straight)
  const deck = [
    '8c', '4s', '9h', '7d', '2c',
    'Qc', 'Qd', // seat 2
    'Kc', 'Kd', // seat 1
    'Ac', 'Ad', // seat 0
  ];
  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000002',
    handNumber: 2,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'P0', avatar: 'a', stackCents: 50 },
      { seatIndex: 1, accountId: 'a1', identityId: 'i1', displayName: 'P1', avatar: 'b', stackCents: 200 },
      { seatIndex: 2, accountId: 'a2', identityId: 'i2', displayName: 'P2', avatar: 'c', stackCents: 200 },
    ],
    previousDealerSeat: null,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
    deck,
  });

  // 3-way: dealer=0, SB=1, BB=2, UTG=0 acts first.
  assert.equal(state.actingSeat, 0);
  applyAction(state, { seatIndex: 0, action: 'all_in', nowMs: 2000 }); // 50
  applyAction(state, { seatIndex: 1, action: 'all_in', nowMs: 3000 }); // 200
  applyAction(state, { seatIndex: 2, action: 'call', nowMs: 4000 });   // 200

  assert.equal(state.finished, true);
  // Main pot = 50*3 = 150 -> Seat 0 (AA)
  // Side pot = 150*2 = 300 -> Seat 1 (KK)
  assert.equal(state.players[0].stackCents, 150);
  assert.equal(state.players[1].stackCents, 300);
  assert.equal(state.players[2].stackCents, 0);
});

test('short all-in raise does not reopen betting for players who already acted', () => {
  const deck = [
    '8c', '4s', '9h', '7d', '2c',
    'Qc', 'Qd',
    'Kc', 'Kd',
    'Ac', 'Ad',
  ];
  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000003',
    handNumber: 3,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'P0', avatar: 'a', stackCents: 500 },
      { seatIndex: 1, accountId: 'a1', identityId: 'i1', displayName: 'P1', avatar: 'b', stackCents: 500 },
      { seatIndex: 2, accountId: 'a2', identityId: 'i2', displayName: 'P2', avatar: 'c', stackCents: 70 },
    ],
    previousDealerSeat: null,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
    deck,
  });

  // UTG (seat 0) raises to 60 (raise delta = 40 -> minRaise = 40).
  applyAction(state, { seatIndex: 0, action: 'raise', amountCents: 60, nowMs: 2000 });
  // SB (seat 1) calls 60.
  applyAction(state, { seatIndex: 1, action: 'call', nowMs: 3000 });
  // BB (seat 2) goes all-in to 70 (raise delta = 10 < minRaise 40!).
  applyAction(state, { seatIndex: 2, action: 'all_in', nowMs: 4000 });

  // Seat 0 already acted at 60 -> can call 10 or fold, CANNOT raise!
  const legal0 = getLegalActions(state, 0);
  assert.equal(legal0.canCall, true);
  assert.equal(legal0.callAmountCents, 10);
  assert.equal(legal0.canRaise, false);
});

test('timeout auto-checks when possible and auto-folds when facing a bet', () => {
  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000004',
    handNumber: 4,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'P0', avatar: 'a', stackCents: 400 },
      { seatIndex: 1, accountId: 'a1', identityId: 'i1', displayName: 'P1', avatar: 'b', stackCents: 400 },
    ],
    previousDealerSeat: null,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
  });

  // SB faces 10 to call -> timeout folds!
  const res = applyTimeoutAction(state, 30000);
  assert.equal(res.action, 'fold');
  assert.equal(state.finished, true);
  assert.equal(state.players[0].stackCents, 390);
  assert.equal(state.players[1].stackCents, 410);
});

test('forceFoldSeat preserves chip conservation when a player leaves mid-hand', () => {
  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000005',
    handNumber: 5,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'P0', avatar: 'a', stackCents: 400 },
      { seatIndex: 1, accountId: 'a1', identityId: 'i1', displayName: 'P1', avatar: 'b', stackCents: 400 },
      { seatIndex: 2, accountId: 'a2', identityId: 'i2', displayName: 'P2', avatar: 'c', stackCents: 400 },
    ],
    previousDealerSeat: null,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
  });

  // Seat 2 (BB, not acting yet) leaves immediately.
  forceFoldSeat(state, 2, 2000);
  assert.equal(state.players[2].folded, true);
  assert.equal(state.finished, false);
  // Seat 0 folds -> Seat 1 wins pot (10 + 20 = 30).
  applyAction(state, { seatIndex: 0, action: 'fold', nowMs: 3000 });
  assert.equal(state.finished, true);
  assert.equal(state.players[0].stackCents, 400);
  assert.equal(state.players[1].stackCents, 420);
  assert.equal(state.players[2].stackCents, 380);
});

test('computeBuyInAllowance requires 32 ACs for initial unlock and grants 3 buy-ins per batch thereafter', () => {
  const settings = {
    initialUnlockAcProblems: 32,
    acPerBuyinBatch: 5,
    buyinsPerBatch: 3,
  };

  // Below 32 ACs: locked, 0 buy-ins
  const below = computeBuyInAllowance(31, 0, settings);
  assert.equal(below.acUnlocked, false);
  assert.equal(below.missingForInitialUnlock, 1);
  assert.equal(below.totalUnlockedBuyIns, 0);
  assert.equal(below.remainingBuyIns, 0);

  // Exactly 32 ACs: unlocked with initial 3 buy-ins, next batch at 37
  const at32 = computeBuyInAllowance(32, 0, settings);
  assert.equal(at32.acUnlocked, true);
  assert.equal(at32.totalUnlockedBuyIns, 3);
  assert.equal(at32.remainingBuyIns, 3);
  assert.equal(at32.nextBatchAtAc, 37);
  assert.equal(at32.missingForNextBatch, 5);

  // Used all 3 buy-ins at 36 ACs -> 0 remaining, 1 more AC needed
  const at36 = computeBuyInAllowance(36, 3, settings);
  assert.equal(at36.totalUnlockedBuyIns, 3);
  assert.equal(at36.remainingBuyIns, 0);
  assert.equal(at36.missingForNextBatch, 1);

  // Hit 37 ACs -> total 6 buy-ins, 3 remaining
  const at37 = computeBuyInAllowance(37, 3, settings);
  assert.equal(at37.totalUnlockedBuyIns, 6);
  assert.equal(at37.remainingBuyIns, 3);
  assert.equal(at37.nextBatchAtAc, 42);
});

test('AI bot strategy scores hands sensibly and always returns legal actions', () => {
  assert.ok(preflopStrength(['As', 'Ah']) > preflopStrength(['As', 'Ks']));
  assert.ok(preflopStrength(['As', 'Ks']) > preflopStrength(['7c', '2d']));
  assert.ok(postflopStrength(['As', 'Ks'], ['Qs', 'Js', 'Ts']) > postflopStrength(['7c', '2d'], ['Qs', 'Js', '9h']));

  const state = startHand({
    handId: '00000000-0000-4000-8000-000000000099',
    handNumber: 9,
    players: [
      { seatIndex: 0, accountId: 'a0', identityId: 'i0', displayName: 'Human', avatar: 'a', stackCents: 1000 },
      { seatIndex: 1, accountId: null, identityId: null, isBot: true, botStyle: 'balanced', displayName: 'Sora (AI)', avatar: 'b', stackCents: 1000 },
    ],
    previousDealerSeat: 0,
    smallBlindCents: 10,
    bigBlindCents: 20,
    nowMs: 1000,
  });

  // Bot is seat 1 (dealer/SB in heads-up when previousDealerSeat was 0) -> acts first preflop
  assert.equal(state.actingSeat, 1);
  const decision = decideBotAction(state, 1, 'balanced');
  assert.ok(['fold', 'check', 'call', 'bet', 'raise', 'all_in'].includes(decision.action));
  applyAction(state, { seatIndex: 1, action: decision.action, amountCents: decision.amountCents ?? null, nowMs: 2000 });
});

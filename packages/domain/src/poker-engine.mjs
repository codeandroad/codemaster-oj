import { randomInt } from 'node:crypto';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

const HAND_CATEGORY_LABELS = [
  { en: 'High Card', zh: '高牌' },
  { en: 'One Pair', zh: '一对' },
  { en: 'Two Pair', zh: '两对' },
  { en: 'Three of a Kind', zh: '三条' },
  { en: 'Straight', zh: '顺子' },
  { en: 'Flush', zh: '同花' },
  { en: 'Full House', zh: '葫芦' },
  { en: 'Four of a Kind', zh: '四条' },
  { en: 'Straight Flush', zh: '同花顺' },
];

export function createDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) deck.push(`${r}${s}`);
  }
  return deck;
}

export function shuffleDeck(rand = randomInt) {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function packScore(category, ranks) {
  let score = category;
  for (let i = 0; i < 5; i++) {
    score = score * 15 + (ranks[i] ?? 0);
  }
  return score;
}

function evaluateFiveCards(cards) {
  const parsed = cards.map(card => ({
    card,
    rank: RANK_VALUE[card[0]],
    suit: card[1],
  }));
  const isFlush = parsed.every(c => c.suit === parsed[0].suit);
  const rankCounts = new Map();
  for (const c of parsed) rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);

  const uniqueRanks = [...rankCounts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      straightHigh = 5;
    }
  }

  if (isFlush && straightHigh > 0) {
    const isRoyal = straightHigh === 14;
    return {
      category: 8,
      ranks: [straightHigh, 0, 0, 0, 0],
      score: packScore(8, [straightHigh, 0, 0, 0, 0]),
      bestCards: cards,
      labelEn: isRoyal ? 'Royal Flush' : HAND_CATEGORY_LABELS[8].en,
      labelZh: isRoyal ? '皇家同花顺' : HAND_CATEGORY_LABELS[8].zh,
    };
  }

  const groups = [...rankCounts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const counts = groups.map(g => g[1]);
  const orderedRanks = [];
  for (const [rank, count] of groups) {
    for (let i = 0; i < count; i++) orderedRanks.push(rank);
  }

  let category = 0;
  let scoreRanks = orderedRanks;
  if (counts[0] === 4) {
    category = 7;
    scoreRanks = [groups[0][0], groups[1][0], 0, 0, 0];
  } else if (counts[0] === 3 && counts[1] === 2) {
    category = 6;
    scoreRanks = [groups[0][0], groups[1][0], 0, 0, 0];
  } else if (isFlush) {
    category = 5;
    scoreRanks = uniqueRanks;
  } else if (straightHigh > 0) {
    category = 4;
    scoreRanks = [straightHigh, 0, 0, 0, 0];
  } else if (counts[0] === 3) {
    category = 3;
    scoreRanks = [groups[0][0], groups[1][0], groups[2][0], 0, 0];
  } else if (counts[0] === 2 && counts[1] === 2) {
    category = 2;
    scoreRanks = [groups[0][0], groups[1][0], groups[2][0], 0, 0];
  } else if (counts[0] === 2) {
    category = 1;
    scoreRanks = [groups[0][0], groups[1][0], groups[2][0], groups[3][0], 0];
  }

  return {
    category,
    ranks: scoreRanks,
    score: packScore(category, scoreRanks),
    bestCards: cards,
    labelEn: HAND_CATEGORY_LABELS[category].en,
    labelZh: HAND_CATEGORY_LABELS[category].zh,
  };
}

export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
    throw new Error('evaluateHand requires 5 to 7 cards.');
  }
  if (cards.length === 5) return evaluateFiveCards(cards);
  let best = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const candidate = evaluateFiveCards([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || candidate.score > best.score) best = candidate;
          }
        }
      }
    }
  }
  return best;
}

export function computePots(players) {
  const levels = [...new Set(players.filter(p => p.totalBet > 0).map(p => p.totalBet))].sort((a, b) => a - b);
  const rawPots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      if (p.totalBet > prev) amount += Math.min(p.totalBet, level) - prev;
    }
    const eligibleSeats = players
      .filter(p => !p.folded && p.totalBet >= level)
      .map(p => p.seatIndex)
      .sort((a, b) => a - b);
    if (amount > 0 && eligibleSeats.length > 0) {
      const key = eligibleSeats.join(',');
      const last = rawPots[rawPots.length - 1];
      if (last && last.eligibleSeats.join(',') === key) {
        last.amountCents += amount;
      } else {
        rawPots.push({ amountCents: amount, eligibleSeats });
      }
    }
    prev = level;
  }
  return rawPots;
}

function clockwiseOrder(seats, afterSeat) {
  const sorted = [...seats].sort((a, b) => a - b);
  const after = sorted.filter(s => s > afterSeat);
  const before = sorted.filter(s => s <= afterSeat);
  return [...after, ...before];
}

function nextActiveSeat(players, afterSeat, predicate) {
  const seats = clockwiseOrder(players.map(p => p.seatIndex), afterSeat);
  for (const seat of seats) {
    const p = players.find(item => item.seatIndex === seat);
    if (p && predicate(p)) return seat;
  }
  return null;
}

function formatScholarship(cents) {
  return (cents / 100).toFixed(2);
}

function pushLog(state, entry) {
  state.actionLog.push({
    ...entry,
    street: state.street,
    at: new Date(state.lastEventAtMs).toISOString(),
  });
  if (state.actionLog.length > 80) state.actionLog.splice(0, state.actionLog.length - 80);
}

function assertChipConservation(state) {
  const totalStacks = state.players.reduce((sum, p) => sum + p.stackCents, 0);
  const totalInPot = state.finished ? 0 : state.players.reduce((sum, p) => sum + p.totalBet, 0);
  if (totalStacks + totalInPot !== state.initialTotalChips) {
    throw new Error(`Poker chip conservation violated: ${totalStacks} + ${totalInPot} !== ${state.initialTotalChips}`);
  }
}

function settleFoldWin(state) {
  const winner = state.players.find(p => !p.folded);
  const totalPot = state.players.reduce((sum, p) => sum + p.totalBet, 0);
  winner.stackCents += totalPot;
  state.finished = true;
  state.street = 'showdown';
  state.actingSeat = null;
  state.turnDeadlineAt = null;
  state.showdownResult = {
    reason: 'fold',
    totalPotCents: totalPot,
    pots: [{ amountCents: totalPot, eligibleSeats: [winner.seatIndex], winnerSeats: [winner.seatIndex] }],
    awards: [{
      seatIndex: winner.seatIndex,
      accountId: winner.accountId,
      displayName: winner.displayName,
      amountCents: totalPot,
      handLabelEn: null,
      handLabelZh: null,
    }],
    revealedHands: [],
  };
  pushLog(state, {
    type: 'win',
    seatIndex: winner.seatIndex,
    displayName: winner.displayName,
    amountCents: totalPot,
    textZh: `${winner.displayName} 赢得底池 ${formatScholarship(totalPot)}`,
    textEn: `${winner.displayName} wins pot ${formatScholarship(totalPot)}`,
  });
  assertChipConservation(state);
}

function settleShowdown(state) {
  while (state.communityCards.length < 5) {
    state.communityCards.push(state.deck.pop());
  }
  state.street = 'showdown';
  state.actingSeat = null;
  state.turnDeadlineAt = null;

  const contenders = state.players.filter(p => !p.folded);
  const evaluations = new Map();
  for (const p of contenders) {
    evaluations.set(p.seatIndex, evaluateHand([...p.holeCards, ...state.communityCards]));
  }

  const pots = computePots(state.players);
  const awardBySeat = new Map();
  const potResults = [];
  const seatClockFromDealer = clockwiseOrder(state.players.map(p => p.seatIndex), state.dealerSeat);

  for (const pot of pots) {
    let bestScore = -1;
    let winners = [];
    for (const seat of pot.eligibleSeats) {
      const ev = evaluations.get(seat);
      if (!ev) continue;
      if (ev.score > bestScore) {
        bestScore = ev.score;
        winners = [seat];
      } else if (ev.score === bestScore) {
        winners.push(seat);
      }
    }
    const orderedWinners = seatClockFromDealer.filter(s => winners.includes(s));
    const share = Math.floor(pot.amountCents / orderedWinners.length);
    let remainder = pot.amountCents % orderedWinners.length;
    for (const seat of orderedWinners) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      const gain = share + extra;
      awardBySeat.set(seat, (awardBySeat.get(seat) ?? 0) + gain);
      const player = state.players.find(p => p.seatIndex === seat);
      player.stackCents += gain;
    }
    potResults.push({
      amountCents: pot.amountCents,
      eligibleSeats: pot.eligibleSeats,
      winnerSeats: orderedWinners,
    });
  }

  const totalPot = state.players.reduce((sum, p) => sum + p.totalBet, 0);
  const awards = [...awardBySeat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([seatIndex, amountCents]) => {
      const player = state.players.find(p => p.seatIndex === seatIndex);
      const ev = evaluations.get(seatIndex);
      return {
        seatIndex,
        accountId: player.accountId,
        displayName: player.displayName,
        amountCents,
        handLabelEn: ev?.labelEn ?? null,
        handLabelZh: ev?.labelZh ?? null,
      };
    });

  const revealedHands = contenders.map(p => {
    const ev = evaluations.get(p.seatIndex);
    return {
      seatIndex: p.seatIndex,
      accountId: p.accountId,
      displayName: p.displayName,
      holeCards: [...p.holeCards],
      bestCards: ev.bestCards,
      category: ev.category,
      labelEn: ev.labelEn,
      labelZh: ev.labelZh,
    };
  });

  state.finished = true;
  state.showdownResult = {
    reason: 'showdown',
    totalPotCents: totalPot,
    pots: potResults,
    awards,
    revealedHands,
  };
  for (const award of awards) {
    pushLog(state, {
      type: 'win',
      seatIndex: award.seatIndex,
      displayName: award.displayName,
      amountCents: award.amountCents,
      textZh: `${award.displayName} 以「${award.handLabelZh}」赢得 ${formatScholarship(award.amountCents)}`,
      textEn: `${award.displayName} wins ${formatScholarship(award.amountCents)} (${award.handLabelEn})`,
    });
  }
  assertChipConservation(state);
}

function isStreetComplete(state) {
  const active = state.players.filter(p => !p.folded);
  if (active.length <= 1) return true;
  const canAct = active.filter(p => !p.allIn);
  if (canAct.length === 0) return true;
  if (canAct.length === 1) {
    return canAct[0].streetBet === state.currentBet;
  }
  return canAct.every(p => p.hasActed && p.streetBet === state.currentBet);
}

function advanceStreetOrShowdown(state, nowMs) {
  const active = state.players.filter(p => !p.folded);
  if (active.length <= 1) {
    settleFoldWin(state);
    return;
  }

  const canAct = active.filter(p => !p.allIn);
  if (canAct.length <= 1) {
    settleShowdown(state);
    return;
  }

  if (state.street === 'river') {
    settleShowdown(state);
    return;
  }

  const nextStreet = state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : 'river';
  const cardsToDeal = nextStreet === 'flop' ? 3 : 1;
  for (let i = 0; i < cardsToDeal; i++) state.communityCards.push(state.deck.pop());

  state.street = nextStreet;
  state.currentBet = 0;
  state.minRaise = state.bigBlindCents;
  for (const p of state.players) {
    p.streetBet = 0;
    p.hasActed = false;
    p.canRaise = true;
    if (!p.folded && !p.allIn) p.lastAction = null;
  }

  const firstActor = nextActiveSeat(state.players, state.dealerSeat, p => !p.folded && !p.allIn);
  state.actingSeat = firstActor;
  state.turnDeadlineAt = firstActor === null
    ? null
    : new Date(nowMs + state.turnTimeoutSeconds * 1000).toISOString();

  pushLog(state, {
    type: 'street',
    cards: state.communityCards.slice(-cardsToDeal),
    textZh: nextStreet === 'flop' ? `翻牌：${state.communityCards.join(' ')}`
      : nextStreet === 'turn' ? `转牌：${state.communityCards[3]}`
      : `河牌：${state.communityCards[4]}`,
    textEn: nextStreet === 'flop' ? `Flop: ${state.communityCards.join(' ')}`
      : nextStreet === 'turn' ? `Turn: ${state.communityCards[3]}`
      : `River: ${state.communityCards[4]}`,
  });
}

export function startHand({
  handId,
  handNumber,
  players: rawPlayers,
  previousDealerSeat = null,
  smallBlindCents,
  bigBlindCents,
  turnTimeoutSeconds = 25,
  nowMs = Date.now(),
  deck: providedDeck = null,
}) {
  const sorted = [...rawPlayers]
    .filter(p => p.stackCents > 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (sorted.length < 2) {
    throw new Error('At least 2 funded players are required to start a hand.');
  }

  const deck = providedDeck ? [...providedDeck] : shuffleDeck();
  const seatIndices = sorted.map(p => p.seatIndex);
  const dealerSeat = previousDealerSeat === null
    ? seatIndices[0]
    : clockwiseOrder(seatIndices, previousDealerSeat)[0];

  const isHeadsUp = sorted.length === 2;
  const sbSeat = isHeadsUp ? dealerSeat : clockwiseOrder(seatIndices, dealerSeat)[0];
  const bbSeat = clockwiseOrder(seatIndices, sbSeat)[0];

  const players = sorted.map(p => ({
    seatIndex: p.seatIndex,
    accountId: p.accountId,
    identityId: p.identityId,
    displayName: p.displayName,
    avatar: p.avatar,
    initialStackCents: p.stackCents,
    stackCents: p.stackCents,
    holeCards: [deck.pop(), deck.pop()],
    streetBet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    canRaise: true,
    lastAction: null,
  }));

  const initialTotalChips = players.reduce((sum, p) => sum + p.stackCents, 0);

  const postBlind = (seatIndex, blindAmount, label) => {
    const p = players.find(item => item.seatIndex === seatIndex);
    const posted = Math.min(p.stackCents, blindAmount);
    p.stackCents -= posted;
    p.streetBet += posted;
    p.totalBet += posted;
    if (p.stackCents === 0) p.allIn = true;
    p.lastAction = `${label} ${formatScholarship(posted)}`;
    return posted;
  };

  const sbPosted = postBlind(sbSeat, smallBlindCents, 'SB');
  const bbPosted = postBlind(bbSeat, bigBlindCents, 'BB');

  const state = {
    handId,
    handNumber,
    smallBlindCents,
    bigBlindCents,
    turnTimeoutSeconds,
    dealerSeat,
    sbSeat,
    bbSeat,
    street: 'preflop',
    deck,
    communityCards: [],
    players,
    initialTotalChips,
    currentBet: Math.max(sbPosted, bbPosted),
    minRaise: bigBlindCents,
    actingSeat: null,
    turnDeadlineAt: null,
    finished: false,
    showdownResult: null,
    lastEventAtMs: nowMs,
    actionLog: [],
  };

  const sbPlayer = players.find(p => p.seatIndex === sbSeat);
  const bbPlayer = players.find(p => p.seatIndex === bbSeat);
  pushLog(state, {
    type: 'blinds',
    textZh: `第 #${handNumber} 局开始 · ${sbPlayer.displayName} 小盲 ${formatScholarship(sbPosted)}，${bbPlayer.displayName} 大盲 ${formatScholarship(bbPosted)}`,
    textEn: `Hand #${handNumber} · ${sbPlayer.displayName} posts SB ${formatScholarship(sbPosted)}, ${bbPlayer.displayName} posts BB ${formatScholarship(bbPosted)}`,
  });

  if (isStreetComplete(state)) {
    advanceStreetOrShowdown(state, nowMs);
  } else {
    const firstActor = isHeadsUp
      ? (sbPlayer.allIn ? bbSeat : sbSeat)
      : nextActiveSeat(players, bbSeat, p => !p.folded && !p.allIn);
    state.actingSeat = firstActor;
    state.turnDeadlineAt = firstActor === null
      ? null
      : new Date(nowMs + turnTimeoutSeconds * 1000).toISOString();
  }

  assertChipConservation(state);
  return state;
}

export function getLegalActions(state, seatIndex) {
  if (!state || state.finished || state.actingSeat !== seatIndex) return null;
  const player = state.players.find(p => p.seatIndex === seatIndex);
  if (!player || player.folded || player.allIn) return null;

  const toCall = Math.max(0, state.currentBet - player.streetBet);
  const maxTotalBet = player.streetBet + player.stackCents;
  const potCents = state.players.reduce((sum, p) => sum + p.totalBet, 0);

  const canCheck = toCall === 0;
  const canCall = toCall > 0;
  const callAmountCents = Math.min(toCall, player.stackCents);
  const canBetOrRaise = player.canRaise && maxTotalBet > state.currentBet;
  const minFullTarget = state.currentBet === 0
    ? state.bigBlindCents
    : state.currentBet + state.minRaise;
  const minBetOrRaiseToCents = canBetOrRaise ? Math.min(maxTotalBet, minFullTarget) : null;

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmountCents,
    canBet: state.currentBet === 0 && canBetOrRaise,
    canRaise: state.currentBet > 0 && canBetOrRaise,
    minBetOrRaiseToCents,
    maxBetOrRaiseToCents: canBetOrRaise ? maxTotalBet : null,
    currentBetCents: state.currentBet,
    playerStreetBetCents: player.streetBet,
    playerStackCents: player.stackCents,
    potCents,
  };
}

export function applyAction(state, { seatIndex, action, amountCents = null, nowMs = Date.now(), isTimeout = false }) {
  if (!state || state.finished) {
    const err = new Error('Hand is already finished.');
    err.code = 'HAND_FINISHED';
    throw err;
  }
  if (state.actingSeat !== seatIndex) {
    const err = new Error('It is not your turn to act.');
    err.code = 'NOT_YOUR_TURN';
    throw err;
  }
  const player = state.players.find(p => p.seatIndex === seatIndex);
  if (!player || player.folded || player.allIn) {
    const err = new Error('Player cannot act in this hand.');
    err.code = 'CANNOT_ACT';
    throw err;
  }

  const legal = getLegalActions(state, seatIndex);
  state.lastEventAtMs = nowMs;
  const suffixZh = isTimeout ? '（超时自动）' : '';
  const suffixEn = isTimeout ? ' (timeout)' : '';

  if (action === 'fold') {
    player.folded = true;
    player.hasActed = true;
    player.lastAction = isTimeout ? '超时弃牌' : '弃牌';
    pushLog(state, {
      type: 'action',
      action: 'fold',
      seatIndex,
      displayName: player.displayName,
      textZh: `${player.displayName} 弃牌${suffixZh}`,
      textEn: `${player.displayName} folds${suffixEn}`,
    });
  } else if (action === 'check') {
    if (!legal.canCheck) {
      const err = new Error('Cannot check when facing a bet.');
      err.code = 'INVALID_ACTION';
      throw err;
    }
    player.hasActed = true;
    player.lastAction = isTimeout ? '超时过牌' : '过牌';
    pushLog(state, {
      type: 'action',
      action: 'check',
      seatIndex,
      displayName: player.displayName,
      textZh: `${player.displayName} 过牌${suffixZh}`,
      textEn: `${player.displayName} checks${suffixEn}`,
    });
  } else if (action === 'call') {
    if (!legal.canCall) {
      const err = new Error('Nothing to call.');
      err.code = 'INVALID_ACTION';
      throw err;
    }
    const added = legal.callAmountCents;
    player.stackCents -= added;
    player.streetBet += added;
    player.totalBet += added;
    player.hasActed = true;
    if (player.stackCents === 0) player.allIn = true;
    player.lastAction = player.allIn ? `全下 ${formatScholarship(player.streetBet)}` : `跟注 ${formatScholarship(added)}`;
    pushLog(state, {
      type: 'action',
      action: player.allIn ? 'all_in' : 'call',
      seatIndex,
      displayName: player.displayName,
      amountCents: added,
      textZh: player.allIn
        ? `${player.displayName} 全下跟注 ${formatScholarship(added)}`
        : `${player.displayName} 跟注 ${formatScholarship(added)}`,
      textEn: player.allIn
        ? `${player.displayName} calls all-in ${formatScholarship(added)}`
        : `${player.displayName} calls ${formatScholarship(added)}`,
    });
  } else if (action === 'bet' || action === 'raise' || action === 'all_in') {
    const maxTotal = player.streetBet + player.stackCents;
    let targetTotal = action === 'all_in' ? maxTotal : Math.trunc(Number(amountCents));
    if (!Number.isInteger(targetTotal) || targetTotal <= player.streetBet || targetTotal > maxTotal) {
      const err = new Error('Invalid bet/raise amount.');
      err.code = 'INVALID_ACTION';
      throw err;
    }

    // All-in for <= currentBet is effectively a call.
    if (action === 'all_in' && targetTotal <= state.currentBet) {
      const added = player.stackCents;
      player.stackCents = 0;
      player.streetBet += added;
      player.totalBet += added;
      player.hasActed = true;
      player.allIn = true;
      player.lastAction = `全下 ${formatScholarship(player.streetBet)}`;
      pushLog(state, {
        type: 'action',
        action: 'all_in',
        seatIndex,
        displayName: player.displayName,
        amountCents: added,
        textZh: `${player.displayName} 全下 ${formatScholarship(player.streetBet)}`,
        textEn: `${player.displayName} is all-in for ${formatScholarship(player.streetBet)}`,
      });
    } else {
      if (!legal.canBet && !legal.canRaise) {
        const err = new Error('Raising is not allowed on this turn.');
        err.code = 'INVALID_ACTION';
        throw err;
      }
      if (targetTotal < legal.minBetOrRaiseToCents && targetTotal !== maxTotal) {
        const err = new Error(`Minimum bet/raise is ${formatScholarship(legal.minBetOrRaiseToCents)}.`);
        err.code = 'INVALID_ACTION';
        throw err;
      }
      const isOpeningBet = state.currentBet === 0;
      const raiseDelta = targetTotal - state.currentBet;
      const isFullRaise = isOpeningBet
        ? targetTotal >= state.bigBlindCents
        : raiseDelta >= state.minRaise;
      const added = targetTotal - player.streetBet;

      player.stackCents -= added;
      player.streetBet = targetTotal;
      player.totalBet += added;
      player.hasActed = true;
      if (player.stackCents === 0) player.allIn = true;

      state.currentBet = targetTotal;
      if (isFullRaise) {
        state.minRaise = Math.max(state.bigBlindCents, raiseDelta);
        for (const other of state.players) {
          if (other.seatIndex !== seatIndex && !other.folded && !other.allIn) {
            other.hasActed = false;
            other.canRaise = true;
          }
        }
      } else {
        // Short all-in raise: players who already acted can call/fold, not re-open betting.
        for (const other of state.players) {
          if (other.seatIndex !== seatIndex && !other.folded && !other.allIn) {
            if (other.hasActed) other.canRaise = false;
            other.hasActed = false;
          }
        }
      }

      const verbZh = player.allIn ? '全下' : isOpeningBet ? '下注' : '加注到';
      const verbEn = player.allIn ? 'goes all-in to' : isOpeningBet ? 'bets' : 'raises to';
      player.lastAction = `${verbZh} ${formatScholarship(targetTotal)}`;
      pushLog(state, {
        type: 'action',
        action: player.allIn ? 'all_in' : isOpeningBet ? 'bet' : 'raise',
        seatIndex,
        displayName: player.displayName,
        amountCents: targetTotal,
        textZh: `${player.displayName} ${verbZh} ${formatScholarship(targetTotal)}`,
        textEn: `${player.displayName} ${verbEn} ${formatScholarship(targetTotal)}`,
      });
    }
  } else {
    const err = new Error('Unknown poker action.');
    err.code = 'INVALID_ACTION';
    throw err;
  }

  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length <= 1) {
    settleFoldWin(state);
    return state;
  }

  if (isStreetComplete(state)) {
    advanceStreetOrShowdown(state, nowMs);
  } else {
    const nextSeat = nextActiveSeat(state.players, seatIndex, p => !p.folded && !p.allIn && (!p.hasActed || p.streetBet < state.currentBet));
    if (nextSeat === null) {
      advanceStreetOrShowdown(state, nowMs);
    } else {
      state.actingSeat = nextSeat;
      state.turnDeadlineAt = new Date(nowMs + state.turnTimeoutSeconds * 1000).toISOString();
    }
  }

  assertChipConservation(state);
  return state;
}

export function applyTimeoutAction(state, nowMs = Date.now()) {
  if (!state || state.finished || state.actingSeat === null) return null;
  const legal = getLegalActions(state, state.actingSeat);
  if (!legal) return null;
  const seatIndex = state.actingSeat;
  const action = legal.canCheck ? 'check' : 'fold';
  applyAction(state, { seatIndex, action, nowMs, isTimeout: true });
  return { seatIndex, action };
}

export function forceFoldSeat(state, seatIndex, nowMs = Date.now()) {
  if (!state || state.finished) return state;
  const player = state.players.find(p => p.seatIndex === seatIndex);
  if (!player || player.folded) return state;
  if (state.actingSeat === seatIndex) {
    return applyAction(state, { seatIndex, action: 'fold', nowMs });
  }
  state.lastEventAtMs = nowMs;
  player.folded = true;
  player.hasActed = true;
  player.lastAction = '离桌弃牌';
  pushLog(state, {
    type: 'action',
    action: 'fold',
    seatIndex,
    displayName: player.displayName,
    textZh: `${player.displayName} 离桌弃牌`,
    textEn: `${player.displayName} leaves and folds`,
  });
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length <= 1) {
    settleFoldWin(state);
  } else if (isStreetComplete(state)) {
    advanceStreetOrShowdown(state, nowMs);
  }
  assertChipConservation(state);
  return state;
}

export function sanitizeHandSummary(state) {
  return {
    handId: state.handId,
    handNumber: state.handNumber,
    smallBlindCents: state.smallBlindCents,
    bigBlindCents: state.bigBlindCents,
    dealerSeat: state.dealerSeat,
    communityCards: [...state.communityCards],
    potCents: state.players.reduce((sum, p) => sum + p.totalBet, 0),
    showdownResult: state.showdownResult,
    participants: state.players.map(p => ({
      seatIndex: p.seatIndex,
      accountId: p.accountId,
      displayName: p.displayName,
      contributedCents: p.totalBet,
      stackBeforeCents: p.initialStackCents,
      stackAfterCents: p.stackCents,
      netCents: p.stackCents - p.initialStackCents,
      folded: p.folded,
    })),
    actionLog: state.actionLog.slice(-40),
  };
}

export function projectHandForViewer(state, viewerAccountId) {
  if (!state) return null;
  const viewerPlayer = state.players.find(p => p.accountId === viewerAccountId) ?? null;
  const revealedSet = new Set(
    state.finished && state.showdownResult?.reason === 'showdown'
      ? state.showdownResult.revealedHands.map(r => r.seatIndex)
      : []
  );

  const potCents = state.players.reduce((sum, p) => sum + p.totalBet, 0);
  const pots = computePots(state.players);
  const myEvaluation = viewerPlayer && !viewerPlayer.folded && state.communityCards.length >= 3
    ? evaluateHand([...viewerPlayer.holeCards, ...state.communityCards])
    : null;

  return {
    handId: state.handId,
    handNumber: state.handNumber,
    street: state.street,
    dealerSeat: state.dealerSeat,
    sbSeat: state.sbSeat,
    bbSeat: state.bbSeat,
    smallBlindCents: state.smallBlindCents,
    bigBlindCents: state.bigBlindCents,
    communityCards: [...state.communityCards],
    potCents,
    pots,
    currentBetCents: state.currentBet,
    minRaiseCents: state.minRaise,
    actingSeat: state.actingSeat,
    turnDeadlineAt: state.turnDeadlineAt,
    finished: state.finished,
    showdownResult: state.showdownResult,
    actionLog: state.actionLog.slice(-30),
    myHandLabel: myEvaluation ? { en: myEvaluation.labelEn, zh: myEvaluation.labelZh } : null,
    myActions: viewerPlayer ? getLegalActions(state, viewerPlayer.seatIndex) : null,
    players: state.players.map(p => ({
      seatIndex: p.seatIndex,
      accountId: p.accountId,
      displayName: p.displayName,
      avatar: p.avatar,
      stackCents: p.stackCents,
      streetBetCents: p.streetBet,
      totalBetCents: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
      lastAction: p.lastAction,
      holeCards: p.accountId === viewerAccountId || revealedSet.has(p.seatIndex)
        ? [...p.holeCards]
        : null,
      cardCount: p.folded ? 0 : 2,
    })),
  };
}

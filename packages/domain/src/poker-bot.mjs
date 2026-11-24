import { randomInt } from 'node:crypto';
import { evaluateHand, getLegalActions } from './poker-engine.mjs';

const RANK_VAL = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export const BOT_ROSTER = [
  { botId: 'bot-elena', name: 'Elena (AI)', style: 'tight', avatar: 'bot-elena' },
  { botId: 'bot-sora', name: 'Sora (AI)', style: 'balanced', avatar: 'bot-sora' },
  { botId: 'bot-marcus', name: 'Marcus (AI)', style: 'aggressive', avatar: 'bot-marcus' },
  { botId: 'bot-lin', name: 'Lin (AI)', style: 'balanced', avatar: 'bot-lin' },
  { botId: 'bot-viktor', name: 'Viktor (AI)', style: 'loose', avatar: 'bot-viktor' },
];

const STYLE_PROFILES = {
  tight: { looseness: -0.08, aggression: 0.04, bluffRate: 0.05 },
  balanced: { looseness: 0.0, aggression: 0.0, bluffRate: 0.11 },
  loose: { looseness: 0.10, aggression: -0.02, bluffRate: 0.14 },
  aggressive: { looseness: 0.05, aggression: 0.12, bluffRate: 0.20 },
};

function randUnit(rand = randomInt) {
  return rand(0, 1000) / 1000;
}

export function preflopStrength(holeCards) {
  const r1 = RANK_VAL[holeCards[0][0]];
  const r2 = RANK_VAL[holeCards[1][0]];
  const suited = holeCards[0][1] === holeCards[1][1];
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);

  if (high === low) {
    // Pocket pairs: 22 -> 0.54, AA -> 0.98
    return Math.min(0.98, 0.50 + ((high - 2) / 12) * 0.48);
  }

  const gap = high - low;
  let score = ((high - 2) * 0.55 + (low - 2) * 0.25) / 12;
  score = 0.16 + score * 0.68;
  if (suited) score += 0.07;
  if (gap === 1) score += 0.05;
  else if (gap === 2) score += 0.025;
  else if (gap >= 5) score -= 0.05;
  if (high === 14 && low >= 10) score += 0.08;
  else if (high === 13 && low >= 10) score += 0.05;
  return Math.max(0.10, Math.min(0.92, score));
}

function drawEquityBonus(holeCards, communityCards) {
  if (communityCards.length >= 5) return 0;
  const all = [...holeCards, ...communityCards];
  const streetFactor = communityCards.length === 3 ? 1.0 : 0.65;

  // Flush draw (4 of a suit)
  const suitCounts = new Map();
  for (const c of all) suitCounts.set(c[1], (suitCounts.get(c[1]) ?? 0) + 1);
  let bonus = 0;
  for (const count of suitCounts.values()) {
    if (count === 4) {
      bonus += 0.15 * streetFactor;
      break;
    }
  }

  // Open-ended straight draw (4 consecutive unique ranks)
  const uniq = [...new Set(all.map(c => RANK_VAL[c[0]]))].sort((a, b) => a - b);
  if (uniq.includes(14)) uniq.unshift(1);
  let run = 1;
  let maxRun = 1;
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] === uniq[i - 1] + 1) {
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 1;
    }
  }
  if (maxRun === 4) bonus += 0.12 * streetFactor;
  return Math.min(0.22, bonus);
}

export function postflopStrength(holeCards, communityCards) {
  const ev = evaluateHand([...holeCards, ...communityCards]);
  const boardRanks = communityCards.map(c => RANK_VAL[c[0]]).sort((a, b) => b - a);
  const topBoard = boardRanks[0] ?? 10;

  let base;
  switch (ev.category) {
    case 8: base = 0.99; break;
    case 7: base = 0.97; break;
    case 6: base = 0.94; break;
    case 5: base = 0.89; break;
    case 4: base = 0.85; break;
    case 3: base = 0.80; break;
    case 2: base = 0.72; break;
    case 1: {
      // Distinguish top/overpair from weak bottom pair
      const pairRank = ev.ranks[0];
      if (pairRank > topBoard) base = 0.66;
      else if (pairRank === topBoard) base = 0.60;
      else if (pairRank >= 9) base = 0.49;
      else base = 0.40;
      break;
    }
    default: {
      const high = Math.max(RANK_VAL[holeCards[0][0]], RANK_VAL[holeCards[1][0]]);
      base = high >= 13 ? 0.28 : 0.19;
    }
  }

  return Math.min(0.99, base + drawEquityBonus(holeCards, communityCards));
}

function clampBet(target, legal, step) {
  const min = legal.minBetOrRaiseToCents;
  const max = legal.maxBetOrRaiseToCents;
  if (min == null || max == null) return null;
  const rounded = Math.round(target / step) * step;
  return Math.max(min, Math.min(max, rounded));
}

export function decideBotAction(state, seatIndex, style = 'balanced', rand = randomInt) {
  const legal = getLegalActions(state, seatIndex);
  if (!legal) return null;
  const player = state.players.find(p => p.seatIndex === seatIndex);
  if (!player) return null;

  const profile = STYLE_PROFILES[style] ?? STYLE_PROFILES.balanced;
  const rawStrength = state.communityCards.length < 3
    ? preflopStrength(player.holeCards)
    : postflopStrength(player.holeCards, state.communityCards);

  const noise = (randUnit(rand) - 0.5) * 0.14;
  const strength = Math.max(0.05, Math.min(0.99, rawStrength + profile.looseness * 0.5 + noise));
  const bluffRoll = randUnit(rand);
  const isBluff = bluffRoll < profile.bluffRate;
  const step = Math.max(1, state.smallBlindCents);

  // Facing no bet (can check or open bet)
  if (legal.canCheck) {
    if (legal.canBet && legal.minBetOrRaiseToCents != null) {
      const betThreshold = 0.60 - profile.aggression;
      if (strength >= betThreshold || (isBluff && state.communityCards.length >= 3 && strength >= 0.25)) {
        const potFactor = strength > 0.85 ? 0.75 : strength > 0.70 ? 0.55 : 0.45;
        const desired = state.communityCards.length < 3
          ? state.bigBlindCents * 2.5
          : Math.max(state.bigBlindCents, Math.round(legal.potCents * potFactor));
        const amountCents = clampBet(desired, legal, step);
        if (amountCents != null) {
          return { action: 'bet', amountCents };
        }
      }
    }
    return { action: 'check' };
  }

  // Facing a bet (can fold, call, or raise)
  const callAmt = legal.callAmountCents;
  const potOdds = callAmt / Math.max(1, legal.potCents + callAmt);
  const stackRatio = callAmt / Math.max(1, player.stackCents);

  // Strong hand: raise or value jam
  const raiseThreshold = 0.74 - profile.aggression;
  if (legal.canRaise && legal.minBetOrRaiseToCents != null && (strength >= raiseThreshold || (isBluff && stackRatio < 0.25 && randUnit(rand) < 0.35))) {
    // Avoid infinite re-raise wars unless holding a monster
    const bigPotAlready = state.currentBet >= state.bigBlindCents * 12;
    if (!bigPotAlready || strength >= 0.88) {
      const desired = state.communityCards.length < 3
        ? Math.round(state.currentBet * 2.4)
        : Math.round(state.currentBet + legal.potCents * (strength >= 0.88 ? 0.8 : 0.55));
      const amountCents = clampBet(desired, legal, step);
      if (amountCents != null) {
        if (amountCents >= legal.maxBetOrRaiseToCents && strength < 0.82) {
          return { action: 'call' };
        }
        return { action: 'raise', amountCents };
      }
    }
  }

  // Decide call vs fold using strength vs pot odds & stack commitment
  const requiredStrength = Math.min(0.72, potOdds * 1.18 + 0.16 - profile.looseness);
  if (strength >= requiredStrength || (callAmt <= state.bigBlindCents && strength >= 0.28)) {
    return { action: 'call' };
  }

  return { action: 'fold' };
}

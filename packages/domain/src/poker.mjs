import { randomUUID } from 'node:crypto';
import { avatarForIdentity } from './avatars.mjs';
import { transaction } from './db.mjs';
import { postScholarshipEntry } from './scholarship-ledger.mjs';
import { activeAccount } from './schools.mjs';
import { enumValue, fail, field, integer, uuid } from './security.mjs';
import {
  applyAction,
  applyTimeoutAction,
  forceFoldSeat,
  projectHandForViewer,
  sanitizeHandSummary,
  startHand,
} from './poker-engine.mjs';
import { BOT_ROSTER, decideBotAction } from './poker-bot.mjs';

const SHOWDOWN_DELAY_MS = 4500;
const BOT_ACTION_DELAY_MS = 650;
const BUSTED_CLEANUP_SECONDS = 120;

const DISPLAY_NAME_SQL = `COALESCE(
  CASE WHEN a.leaderboard_use_nickname THEN NULLIF(btrim(a.nickname),'') END,
  'Learner-'||upper(left(md5('public-practice:'||a.id::text),8))
)`;

const respond = (body, status = 200) => ({ status, body });

async function requirePlatformAdmin(db, accountId) {
  await activeAccount(db, accountId);
  const { rowCount } = await db.query(
    'SELECT account_id FROM platform_admins WHERE account_id=$1 AND revoked_at IS NULL',
    [accountId],
  );
  if (!rowCount) fail(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理员权限');
}

async function auditPlatform(db, actorId, action, detail = {}) {
  await db.query(
    `INSERT INTO platform_audit_events (actor_account_id, action, detail)
     VALUES ($1, $2, $3::jsonb)`,
    [actorId, action, JSON.stringify(detail)],
  );
}

function settingsShape(row, botRow) {
  return {
    enabled: Boolean(row.enabled),
    initialUnlockAcProblems: Number(row.initial_unlock_ac_problems),
    acPerBuyinBatch: Number(row.ac_per_buyin_batch),
    buyinsPerBatch: Number(row.buyins_per_batch),
    defaultSmallBlindCents: Number(row.default_small_blind_cents),
    defaultBigBlindCents: Number(row.default_big_blind_cents),
    minBuyInBb: Number(row.min_buy_in_bb),
    maxBuyInBb: Number(row.max_buy_in_bb),
    turnTimeoutSeconds: Number(row.turn_timeout_seconds),
    dailyBuyInLimitCents: Number(row.daily_buy_in_limit_cents),
    dailyNetLossLimitCents: Number(row.daily_net_loss_limit_cents),
    dailyNetWinLimitCents: Number(row.daily_net_win_limit_cents),
    allowBots: botRow ? Boolean(botRow.allow_bots) : true,
    maxBotsPerTable: botRow ? Number(botRow.max_bots_per_table) : 5,
    updatedAt: row.updated_at,
  };
}

export function computeBuyInAllowance(acCount, usedBuyIns, settings) {
  const initialAc = settings.initialUnlockAcProblems;
  const batchAc = settings.acPerBuyinBatch;
  const perBatch = settings.buyinsPerBatch;
  if (acCount < initialAc) {
    return {
      acUnlocked: false,
      acCount,
      initialUnlockAcProblems: initialAc,
      acPerBuyinBatch: batchAc,
      buyinsPerBatch: perBatch,
      missingForInitialUnlock: initialAc - acCount,
      totalUnlockedBuyIns: 0,
      usedBuyIns,
      remainingBuyIns: 0,
      nextBatchAtAc: initialAc,
      missingForNextBatch: initialAc - acCount,
    };
  }
  const extraBatches = Math.floor((acCount - initialAc) / batchAc);
  const totalUnlockedBuyIns = (1 + extraBatches) * perBatch;
  const remainingBuyIns = Math.max(0, totalUnlockedBuyIns - usedBuyIns);
  const nextBatchAtAc = initialAc + (extraBatches + 1) * batchAc;
  return {
    acUnlocked: true,
    acCount,
    initialUnlockAcProblems: initialAc,
    acPerBuyinBatch: batchAc,
    buyinsPerBatch: perBatch,
    missingForInitialUnlock: 0,
    totalUnlockedBuyIns,
    usedBuyIns,
    remainingBuyIns,
    nextBatchAtAc,
    missingForNextBatch: Math.max(0, nextBatchAtAc - acCount),
  };
}

async function loadSettings(db) {
  const { rows: [row] } = await db.query('SELECT * FROM poker_settings WHERE singleton');
  const { rows: [botRow] } = await db.query('SELECT * FROM poker_bot_settings WHERE singleton');
  return settingsShape(row, botRow);
}

async function todayDate(db) {
  const { rows: [row] } = await db.query(
    "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date AS d, clock_timestamp() AS now",
  );
  return { date: row.d, nowMs: new Date(row.now).getTime() };
}

async function ensurePokerWallet(db, identityId, { forUpdate = false } = {}) {
  await db.query(
    'INSERT INTO poker_wallets(identity_id) VALUES($1) ON CONFLICT DO NOTHING',
    [identityId],
  );
  const { rows: [row] } = await db.query(
    `SELECT identity_id, balance_cents, used_buy_ins FROM poker_wallets WHERE identity_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [identityId],
  );
  return {
    identityId: row.identity_id,
    balanceCents: Number(row.balance_cents),
    usedBuyIns: Number(row.used_buy_ins),
  };
}

async function loadWalletEligibility(db, identityId) {
  const { rows: [row] } = await db.query(`
    SELECT (
      i.kind IN ('student','personal')
      OR EXISTS (SELECT 1 FROM luq_initial_grants g WHERE g.identity_id=i.id)
      OR EXISTS (
        SELECT 1 FROM accounts a
        JOIN public_practice_preferences pref ON pref.account_id=a.id
        WHERE a.identity_id=i.id AND pref.scholarship_enabled
      )
    ) AS eligible,
    COALESCE((SELECT balance FROM luq_accounts WHERE identity_id=i.id), 0) AS balance
    FROM identities i WHERE i.id=$1
  `, [identityId]);
  return {
    walletEligible: Boolean(row?.eligible),
    scholarshipBalance: Number(row?.balance ?? 0),
  };
}

async function loadDailyStats(db, identityId, statDate, { forUpdate = false } = {}) {
  await db.query(
    'INSERT INTO poker_daily_stats(identity_id, stat_date) VALUES($1, $2) ON CONFLICT DO NOTHING',
    [identityId, statDate],
  );
  const { rows: [row] } = await db.query(
    `SELECT buy_in_cents, net_cents, hands_played
     FROM poker_daily_stats WHERE identity_id=$1 AND stat_date=$2${forUpdate ? ' FOR UPDATE' : ''}`,
    [identityId, statDate],
  );
  return {
    buyInCents: Number(row.buy_in_cents),
    netCents: Number(row.net_cents),
    handsPlayed: Number(row.hands_played),
  };
}

function dailyLimitsSummary(stats, settings) {
  const buyInRemainingCents = settings.dailyBuyInLimitCents > 0
    ? Math.max(0, settings.dailyBuyInLimitCents - stats.buyInCents)
    : null;
  const lossRemainingCents = settings.dailyNetLossLimitCents > 0
    ? Math.max(0, settings.dailyNetLossLimitCents + stats.netCents)
    : null;
  const winRemainingCents = settings.dailyNetWinLimitCents > 0
    ? Math.max(0, settings.dailyNetWinLimitCents - stats.netCents)
    : null;
  const hitLossLimit = settings.dailyNetLossLimitCents > 0 && stats.netCents <= -settings.dailyNetLossLimitCents;
  const hitWinLimit = settings.dailyNetWinLimitCents > 0 && stats.netCents >= settings.dailyNetWinLimitCents;
  return {
    ...stats,
    buyInRemainingCents,
    lossRemainingCents,
    winRemainingCents,
    hitLossLimit,
    hitWinLimit,
  };
}

async function loadAccountAcCount(db, accountId) {
  const { rows: [row] } = await db.query('SELECT poker_account_ac_count($1) AS count', [accountId]);
  return Number(row?.count ?? 0);
}

async function debitForBuyIn(db, { identityId, accountId, tableId, amountCents, kind, consumeAllowance = true, settings, statDate }) {
  const wallet = await ensurePokerWallet(db, identityId, { forUpdate: true });
  const eligibility = await loadWalletEligibility(db, identityId);
  if (!eligibility.walletEligible) {
    fail(409, 'POKER_WALLET_NOT_ENABLED', '请先在开放平台个人设置中开启奖学金钱包后再参与牌局');
  }

  const acCount = await loadAccountAcCount(db, accountId);
  const allowance = computeBuyInAllowance(acCount, wallet.usedBuyIns, settings);
  if (!allowance.acUnlocked) {
    fail(403, 'POKER_LOCKED', `全站去重 AC 题目需达到 ${allowance.initialUnlockAcProblems} 题方可初次解锁`);
  }
  if (consumeAllowance && allowance.remainingBuyIns <= 0) {
    fail(409, 'POKER_BUYIN_LIMIT_REACHED', `买入机会已用完，再 AC ${allowance.missingForNextBatch} 题即可解锁下 ${allowance.buyinsPerBatch} 次买入机会`);
  }

  const daily = await loadDailyStats(db, identityId, statDate, { forUpdate: true });
  const dailySummary = dailyLimitsSummary(daily, settings);
  if (dailySummary.hitLossLimit) {
    fail(409, 'POKER_DAILY_LOSS_LIMIT', '已达今日净输上限，请明日再来或继续刷题');
  }
  if (dailySummary.hitWinLimit) {
    fail(409, 'POKER_DAILY_WIN_LIMIT', '已达今日净赢上限，请明日再来');
  }
  if (settings.dailyBuyInLimitCents > 0 && daily.buyInCents + amountCents > settings.dailyBuyInLimitCents) {
    const remaining = Math.max(0, settings.dailyBuyInLimitCents - daily.buyInCents);
    fail(409, 'POKER_DAILY_BUYIN_LIMIT', `超过今日买入上限，今日剩余可买入 ${(remaining / 100).toFixed(2)} 奖学金`);
  }

  const totalAvailableCents = wallet.balanceCents + eligibility.scholarshipBalance * 100;
  if (totalAvailableCents < amountCents) {
    fail(409, 'LUQ_INSUFFICIENT_BALANCE', '平台奖学金余额不足');
  }

  let currentCents = wallet.balanceCents;
  const deficitCents = Math.max(0, amountCents - currentCents);
  const scholarshipNeeded = Math.ceil(deficitCents / 100);
  if (scholarshipNeeded > 0) {
    const txId = randomUUID();
    const luqEntry = await postScholarshipEntry(db, {
      identityId,
      delta: -scholarshipNeeded,
      kind: 'poker_buyin',
      sourceKey: `poker-deposit:${txId}`,
      actorAccountId: accountId,
      reason: kind === 'table_rebuy' ? '德州扑克补充筹码' : '德州扑克入座买入',
      metadata: { tableId, buyInCents: amountCents, scholarshipDebited: scholarshipNeeded },
    });
    const depositCents = scholarshipNeeded * 100;
    currentCents += depositCents;
    await db.query(
      `INSERT INTO poker_wallet_ledger(identity_id, account_id, delta_cents, balance_after_cents, kind, table_id, luq_ledger_id, note)
       VALUES($1, $2, $3, $4, 'scholarship_deposit', $5, $6, $7)`,
      [identityId, accountId, depositCents, currentCents, tableId, Number(luqEntry.id), `从平台钱包转入 ${scholarshipNeeded} 奖学金`],
    );
  }

  currentCents -= amountCents;
  const nextUsedBuyIns = wallet.usedBuyIns + (consumeAllowance ? 1 : 0);
  await db.query(
    `UPDATE poker_wallets SET balance_cents=$2, used_buy_ins=$3, updated_at=clock_timestamp()
     WHERE identity_id=$1`,
    [identityId, currentCents, nextUsedBuyIns],
  );
  await db.query(
    `INSERT INTO poker_wallet_ledger(identity_id, account_id, delta_cents, balance_after_cents, kind, table_id, note)
     VALUES($1, $2, $3, $4, $5, $6, $7)`,
    [
      identityId,
      accountId,
      -amountCents,
      currentCents,
      kind,
      tableId,
      `${kind === 'table_rebuy' ? '补充筹码' : '入座买入'} ${(amountCents / 100).toFixed(2)} 奖学金`,
    ],
  );
  await db.query(
    `UPDATE poker_daily_stats SET buy_in_cents=buy_in_cents+$3, updated_at=clock_timestamp()
     WHERE identity_id=$1 AND stat_date=$2`,
    [identityId, statDate, amountCents],
  );

  return { balanceCents: currentCents, usedBuyIns: nextUsedBuyIns, scholarshipDebited: scholarshipNeeded };
}

async function creditCashoutAndSettle(db, { identityId, accountId, tableId, amountCents, reason = '德州扑克离桌兑回' }) {
  const wallet = await ensurePokerWallet(db, identityId, { forUpdate: true });
  let currentCents = wallet.balanceCents;

  if (amountCents > 0) {
    currentCents += amountCents;
    await db.query(
      `INSERT INTO poker_wallet_ledger(identity_id, account_id, delta_cents, balance_after_cents, kind, table_id, note)
       VALUES($1, $2, $3, $4, 'table_cashout', $5, $6)`,
      [identityId, accountId, amountCents, currentCents, tableId, `离桌结算 ${(amountCents / 100).toFixed(2)} 奖学金`],
    );
  }

  const wholeScholarships = Math.floor(currentCents / 100);
  if (wholeScholarships > 0) {
    const eligibility = await loadWalletEligibility(db, identityId);
    if (eligibility.walletEligible) {
      const withdrawCents = wholeScholarships * 100;
      const txId = randomUUID();
      const luqEntry = await postScholarshipEntry(db, {
        identityId,
        delta: wholeScholarships,
        kind: 'poker_cashout',
        sourceKey: `poker-withdraw:${txId}`,
        actorAccountId: accountId,
        reason,
        metadata: { tableId, scholarshipCredited: wholeScholarships },
      });
      currentCents -= withdrawCents;
      await db.query(
        `INSERT INTO poker_wallet_ledger(identity_id, account_id, delta_cents, balance_after_cents, kind, table_id, luq_ledger_id, note)
         VALUES($1, $2, $3, $4, 'scholarship_withdraw', $5, $6, $7)`,
        [identityId, accountId, -withdrawCents, currentCents, tableId, Number(luqEntry.id), `自动兑回 ${wholeScholarships} 奖学金至平台钱包`],
      );
    }
  }

  await db.query(
    'UPDATE poker_wallets SET balance_cents=$2, updated_at=clock_timestamp() WHERE identity_id=$1',
    [identityId, currentCents],
  );
  return { balanceCents: currentCents, scholarshipCredited: wholeScholarships };
}

async function loadTableSeats(db, tableId) {
  const { rows } = await db.query(`
    SELECT s.table_id, s.seat_index, s.account_id, s.identity_id, s.stack_cents,
           s.leave_after_hand, s.sitting_out, s.consecutive_timeouts, s.joined_at, s.last_seen_at,
           ${DISPLAY_NAME_SQL} AS display_name, a.avatar
    FROM poker_seats s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.table_id = $1
    ORDER BY s.seat_index ASC
  `, [tableId]);
  return rows.map(r => ({
    tableId: r.table_id,
    seatIndex: Number(r.seat_index),
    accountId: r.account_id,
    identityId: r.identity_id,
    stackCents: Number(r.stack_cents),
    leaveAfterHand: Boolean(r.leave_after_hand),
    sittingOut: Boolean(r.sitting_out),
    consecutiveTimeouts: Number(r.consecutive_timeouts),
    joinedAt: r.joined_at,
    lastSeenAt: r.last_seen_at,
    displayName: r.display_name,
    avatar: avatarForIdentity(r.avatar, r.display_name),
    isBot: false,
    botStyle: null,
  }));
}

async function loadTableBotSeats(db, tableId) {
  const { rows } = await db.query(`
    SELECT table_id, seat_index, bot_id, bot_name, bot_style, avatar, stack_cents, leave_after_hand, joined_at
    FROM poker_bot_seats
    WHERE table_id = $1
    ORDER BY seat_index ASC
  `, [tableId]);
  return rows.map(r => ({
    tableId: r.table_id,
    seatIndex: Number(r.seat_index),
    accountId: null,
    identityId: null,
    botId: r.bot_id,
    displayName: r.bot_name,
    avatar: avatarForIdentity(r.avatar, r.bot_name),
    isBot: true,
    botStyle: r.bot_style,
    stackCents: Number(r.stack_cents),
    leaveAfterHand: Boolean(r.leave_after_hand),
    sittingOut: false,
    joinedAt: r.joined_at,
  }));
}

function scheduleBotPace(state, nowMs) {
  if (!state || state.finished || state.actingSeat === null) {
    if (state) state.nextBotActionAt = null;
    return;
  }
  const actor = state.players.find(p => p.seatIndex === state.actingSeat);
  state.nextBotActionAt = actor?.isBot ? new Date(nowMs + BOT_ACTION_DELAY_MS).toISOString() : null;
}

async function addBotsToTable(db, table, settings, count) {
  if (!settings.allowBots || settings.maxBotsPerTable <= 0) {
    fail(409, 'BOTS_DISABLED', '管理员当前未开启 AI 对手补位');
  }
  const humanSeats = await loadTableSeats(db, table.id);
  const botSeats = await loadTableBotSeats(db, table.id);
  const occupied = new Set([...humanSeats.map(s => s.seatIndex), ...botSeats.map(s => s.seatIndex)]);
  const usedBotIds = new Set(botSeats.map(s => s.botId));

  const maxSeats = Number(table.max_seats);
  const maxAddBySeats = Math.max(0, maxSeats - occupied.size);
  const maxAddByPolicy = Math.max(0, settings.maxBotsPerTable - botSeats.length);
  const toAdd = Math.min(count, maxAddBySeats, maxAddByPolicy);
  if (toAdd <= 0) return 0;

  const botStackCents = Math.min(settings.maxBuyInBb, 100) * Number(table.big_blind_cents);
  const freeSeats = Array.from({ length: maxSeats }, (_, i) => i).filter(i => !occupied.has(i));
  const candidates = BOT_ROSTER.filter(b => !usedBotIds.has(b.botId));

  let added = 0;
  for (let i = 0; i < toAdd && i < freeSeats.length && i < candidates.length; i++) {
    const persona = candidates[i];
    await db.query(
      `INSERT INTO poker_bot_seats(table_id, seat_index, bot_id, bot_name, bot_style, avatar, stack_cents)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [table.id, freeSeats[i], persona.botId, persona.name, persona.style, persona.avatar, botStackCents],
    );
    added++;
  }
  return added;
}

async function finalizeCompletedHand(db, table, state, settings, { date: statDate, nowMs }) {
  // Update seated stacks and daily net stats deterministically by identityId (humans only).
  const humanParticipants = state.players
    .filter(p => !p.isBot && p.identityId)
    .sort((a, b) => a.identityId.localeCompare(b.identityId));
  const botParticipants = state.players.filter(p => p.isBot);
  const dailyMap = new Map();

  for (const p of humanParticipants) {
    if (!p.cashedOutOnLeave) {
      await db.query(
        `UPDATE poker_seats SET stack_cents=$3::bigint, sitting_out=(sitting_out OR $3::bigint=0)
         WHERE table_id=$1 AND seat_index=$2 AND account_id=$4`,
        [table.id, p.seatIndex, p.stackCents, p.accountId],
      );
    }
    const netDelta = p.stackCents - p.initialStackCents;
    await db.query(
      'INSERT INTO poker_daily_stats(identity_id, stat_date) VALUES($1, $2) ON CONFLICT DO NOTHING',
      [p.identityId, statDate],
    );
    const { rows: [updated] } = await db.query(
      `UPDATE poker_daily_stats
       SET net_cents=net_cents+$3, hands_played=hands_played+1, updated_at=clock_timestamp()
       WHERE identity_id=$1 AND stat_date=$2
       RETURNING buy_in_cents, net_cents, hands_played`,
      [p.identityId, statDate, netDelta],
    );
    dailyMap.set(p.identityId, {
      buyInCents: Number(updated.buy_in_cents),
      netCents: Number(updated.net_cents),
      handsPlayed: Number(updated.hands_played),
    });
  }

  for (const b of botParticipants) {
    await db.query(
      'UPDATE poker_bot_seats SET stack_cents=$3::bigint WHERE table_id=$1 AND seat_index=$2',
      [table.id, b.seatIndex, b.stackCents],
    );
  }

  const summary = sanitizeHandSummary(state);
  summary.hasBots = botParticipants.length > 0;
  await db.query(
    `UPDATE poker_hands
     SET community_cards=$2::jsonb, pot_cents=$3, summary=$4::jsonb, ended_at=clock_timestamp()
     WHERE id=$1`,
    [state.handId, JSON.stringify(state.communityCards), summary.potCents, JSON.stringify(summary)],
  );

  // Cash out any human seat that requested leave_after_hand, disabled table/feature, or hit daily net caps.
  const seats = await loadTableSeats(db, table.id);
  const toCashout = seats
    .filter(seat => {
      if (seat.leaveAfterHand || !settings.enabled || !table.enabled) return true;
      const d = dailyMap.get(seat.identityId);
      if (d) {
        const lim = dailyLimitsSummary(d, settings);
        if (lim.hitLossLimit || lim.hitWinLimit) return true;
      }
      return false;
    })
    .sort((a, b) => a.identityId.localeCompare(b.identityId));

  for (const seat of toCashout) {
    await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [table.id, seat.seatIndex]);
    await creditCashoutAndSettle(db, {
      identityId: seat.identityId,
      accountId: seat.accountId,
      tableId: table.id,
      amountCents: seat.stackCents,
    });
  }

  // Clean up bots that should leave or if no humans remain; top up busted bots automatically.
  const remainingHumanCount = seats.length - toCashout.length;
  if (remainingHumanCount <= 0 || !settings.enabled || !table.enabled || !settings.allowBots) {
    await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1', [table.id]);
  } else {
    await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1 AND leave_after_hand=true', [table.id]);
    const reloadStack = Math.min(settings.maxBuyInBb, 100) * Number(table.big_blind_cents);
    await db.query(
      'UPDATE poker_bot_seats SET stack_cents=$2::bigint WHERE table_id=$1 AND stack_cents < $3::bigint',
      [table.id, reloadStack, Number(table.big_blind_cents)],
    );
  }

  state.nextBotActionAt = null;
  const nextHandAt = new Date(nowMs + SHOWDOWN_DELAY_MS).toISOString();
  const { rows: [saved] } = await db.query(
    `UPDATE poker_tables
     SET status='showdown', next_hand_at=$2, state=$3::jsonb, revision=revision+1, updated_at=clock_timestamp()
     WHERE id=$1 RETURNING *`,
    [table.id, nextHandAt, JSON.stringify(state)],
  );
  return saved;
}

async function advanceTableLifecycle(db, tableRow, settings, clock) {
  let table = tableRow;
  const { date: statDate, nowMs } = clock;

  // 1. Advance bot turns (paced cleanly) and enforce human turn timeouts on an active hand.
  if (table.status === 'playing' && table.state && !table.state.finished) {
    const state = structuredClone(table.state);
    let mutated = false;
    let guard = 0;
    while (!state.finished && state.actingSeat !== null && guard < 12) {
      guard++;
      const actor = state.players.find(p => p.seatIndex === state.actingSeat);
      if (!actor) break;

      if (actor.isBot) {
        if (state.nextBotActionAt && Date.parse(state.nextBotActionAt) > nowMs) {
          break;
        }
        const decision = decideBotAction(state, actor.seatIndex, actor.botStyle ?? 'balanced');
        if (!decision) break;
        applyAction(state, {
          seatIndex: actor.seatIndex,
          action: decision.action,
          amountCents: decision.amountCents ?? null,
          nowMs,
        });
        mutated = true;
        scheduleBotPace(state, nowMs);
        // Perform at most one paced bot action per lifecycle tick so the table feels rhythmic.
        break;
      }

      if (state.turnDeadlineAt && Date.parse(state.turnDeadlineAt) <= nowMs) {
        const timed = applyTimeoutAction(state, nowMs);
        if (!timed) break;
        mutated = true;
        const { rows: [seatRow] } = await db.query(
          `UPDATE poker_seats
           SET consecutive_timeouts=consecutive_timeouts+1,
               leave_after_hand=(leave_after_hand OR consecutive_timeouts+1 >= 2)
           WHERE table_id=$1 AND seat_index=$2
           RETURNING consecutive_timeouts`,
          [table.id, timed.seatIndex],
        );
        if (seatRow && seatRow.consecutive_timeouts >= 2) {
          const p = state.players.find(item => item.seatIndex === timed.seatIndex);
          if (p) p.lastAction = '连续超时将离桌';
        }
        scheduleBotPace(state, nowMs);
        continue;
      }

      break;
    }

    if (mutated) {
      if (state.finished) {
        table = await finalizeCompletedHand(db, table, state, settings, clock);
      } else {
        const { rows: [saved] } = await db.query(
          `UPDATE poker_tables SET state=$2::jsonb, revision=revision+1, updated_at=clock_timestamp()
           WHERE id=$1 RETURNING *`,
          [table.id, JSON.stringify(state)],
        );
        table = saved;
      }
    }
  }

  // 2. Transition showdown -> waiting after reveal delay, or immediately if the previous showdown has no humans left seated.
  if (table.status === 'showdown') {
    const showdownExpired = !table.next_hand_at || Date.parse(table.next_hand_at) <= nowMs;
    const prevHumanIds = new Set((table.state?.players ?? []).filter(p => !p.isBot && p.accountId).map(p => p.accountId));
    let anyPrevHumanSeated = false;
    if (!showdownExpired && prevHumanIds.size > 0) {
      const { rowCount } = await db.query(
        'SELECT 1 FROM poker_seats WHERE table_id=$1 AND account_id=ANY($2::uuid[]) LIMIT 1',
        [table.id, [...prevHumanIds]],
      );
      anyPrevHumanSeated = rowCount > 0;
    }
    if (showdownExpired || !anyPrevHumanSeated) {
      const { rows: [saved] } = await db.query(
        `UPDATE poker_tables
         SET status='waiting', current_hand_id=NULL, next_hand_at=NULL, state=NULL, revision=revision+1, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [table.id],
      );
      table = saved;
    }
  }

  // 3. In waiting state, sync default blinds, clean up leaving/ineligible seats, and auto-deal if >= 2 ready (with >= 1 human).
  if (table.status === 'waiting') {
    if (
      table.use_default_blinds &&
      (Number(table.small_blind_cents) !== settings.defaultSmallBlindCents ||
        Number(table.big_blind_cents) !== settings.defaultBigBlindCents)
    ) {
      const { rows: [saved] } = await db.query(
        `UPDATE poker_tables
         SET small_blind_cents=$2, big_blind_cents=$3, revision=revision+1, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [table.id, settings.defaultSmallBlindCents, settings.defaultBigBlindCents],
      );
      table = saved;
    }

    const seats = await loadTableSeats(db, table.id);
    const cleanup = [];
    const readyHumans = [];

    for (const seat of seats) {
      const staleBusted = seat.stackCents === 0 && (nowMs - new Date(seat.lastSeenAt).getTime()) > BUSTED_CLEANUP_SECONDS * 1000;
      const daily = await loadDailyStats(db, seat.identityId, statDate);
      const lim = dailyLimitsSummary(daily, settings);
      if (seat.leaveAfterHand || !settings.enabled || !table.enabled || lim.hitLossLimit || lim.hitWinLimit || staleBusted) {
        cleanup.push(seat);
      } else if (seat.stackCents > 0 && !seat.sittingOut) {
        readyHumans.push(seat);
      }
    }

    if (cleanup.length) {
      cleanup.sort((a, b) => a.identityId.localeCompare(b.identityId));
      for (const seat of cleanup) {
        await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [table.id, seat.seatIndex]);
        await creditCashoutAndSettle(db, {
          identityId: seat.identityId,
          accountId: seat.accountId,
          tableId: table.id,
          amountCents: seat.stackCents,
        });
      }
      const { rows: [saved] } = await db.query(
        'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
        [table.id],
      );
      table = saved;
    }

    const remainingHumansCount = seats.length - cleanup.length;
    let botSeats = await loadTableBotSeats(db, table.id);
    if (remainingHumansCount <= 0 || !settings.enabled || !table.enabled || !settings.allowBots) {
      if (botSeats.length) {
        await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1', [table.id]);
        botSeats = [];
        const { rows: [saved] } = await db.query(
          'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [table.id],
        );
        table = saved;
      }
    } else {
      const leavingBots = botSeats.filter(b => b.leaveAfterHand);
      if (leavingBots.length) {
        await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1 AND leave_after_hand=true', [table.id]);
        botSeats = botSeats.filter(b => !b.leaveAfterHand);
      }
      const reloadStack = Math.min(settings.maxBuyInBb, 100) * Number(table.big_blind_cents);
      for (const b of botSeats) {
        if (b.stackCents < Number(table.big_blind_cents)) {
          await db.query('UPDATE poker_bot_seats SET stack_cents=$3::bigint WHERE table_id=$1 AND seat_index=$2', [table.id, b.seatIndex, reloadStack]);
          b.stackCents = reloadStack;
        }
      }
    }

    const readyAll = [...readyHumans, ...botSeats.filter(b => b.stackCents > 0)];
    if (settings.enabled && table.enabled && readyHumans.length >= 1 && readyAll.length >= 2) {
      const handId = randomUUID();
      const handNumber = Number(table.hand_number) + 1;
      const state = startHand({
        handId,
        handNumber,
        players: readyAll.map(s => ({
          seatIndex: s.seatIndex,
          accountId: s.accountId,
          identityId: s.identityId,
          isBot: s.isBot,
          botStyle: s.botStyle,
          displayName: s.displayName,
          avatar: s.avatar,
          stackCents: s.stackCents,
        })),
        previousDealerSeat: table.dealer_seat === null ? null : Number(table.dealer_seat),
        smallBlindCents: Number(table.small_blind_cents),
        bigBlindCents: Number(table.big_blind_cents),
        turnTimeoutSeconds: settings.turnTimeoutSeconds,
        nowMs,
      });
      scheduleBotPace(state, nowMs);

      await db.query(
        `INSERT INTO poker_hands(id, table_id, hand_number, small_blind_cents, big_blind_cents, dealer_seat)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [handId, table.id, handNumber, state.smallBlindCents, state.bigBlindCents, state.dealerSeat],
      );

      const { rows: [saved] } = await db.query(
        `UPDATE poker_tables
         SET status='playing', hand_number=$2, dealer_seat=$3, current_hand_id=$4,
             next_hand_at=NULL, state=$5::jsonb, revision=revision+1, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [table.id, handNumber, state.dealerSeat, handId, JSON.stringify(state)],
      );
      table = saved;

      if (state.finished) {
        table = await finalizeCompletedHand(db, table, state, settings, clock);
      }
    }
  }

  return table;
}

function tableSummaryShape(row, settings) {
  const bigBlindCents = Number(row.big_blind_cents);
  const humanCount = Number(row.seated_count ?? 0);
  const botCount = Number(row.bot_count ?? 0);
  return {
    id: row.id,
    name: row.name,
    smallBlindCents: Number(row.small_blind_cents),
    bigBlindCents,
    useDefaultBlinds: Boolean(row.use_default_blinds),
    maxSeats: Number(row.max_seats),
    enabled: Boolean(row.enabled),
    revision: Number(row.revision),
    handNumber: Number(row.hand_number),
    status: row.status,
    humanCount,
    botCount,
    seatedCount: humanCount + botCount,
    minBuyInCents: settings.minBuyInBb * bigBlindCents,
    maxBuyInCents: settings.maxBuyInBb * bigBlindCents,
  };
}

async function buildTableView(db, table, user, settings, clock) {
  const humanSeats = await loadTableSeats(db, table.id);
  const botSeats = await loadTableBotSeats(db, table.id);
  const allSeats = [...humanSeats, ...botSeats];
  const handView = projectHandForViewer(table.state, user.id);
  const handPlayerBySeat = new Map((handView?.players ?? []).map(p => [p.seatIndex, p]));

  const seatSlots = [];
  for (let i = 0; i < Number(table.max_seats); i++) {
    const seat = allSeats.find(s => s.seatIndex === i) ?? null;
    const hp = handPlayerBySeat.get(i) ?? null;
    if (!seat && !hp) {
      seatSlots.push({ seatIndex: i, occupied: false });
    } else if (!seat && hp) {
      // Player left mid-hand (already folded & cashed out); show ghost until hand finishes.
      seatSlots.push({
        seatIndex: i,
        occupied: false,
        leftMidHand: true,
        isBot: Boolean(hp.isBot),
        botStyle: hp.botStyle ?? null,
        displayName: hp.displayName,
        avatar: hp.avatar,
        folded: true,
        totalBetCents: hp.totalBetCents,
        lastAction: hp.lastAction,
      });
    } else {
      seatSlots.push({
        seatIndex: i,
        occupied: true,
        isBot: Boolean(seat.isBot),
        botStyle: seat.botStyle ?? null,
        accountId: seat.accountId,
        displayName: seat.displayName,
        avatar: seat.avatar,
        isMe: !seat.isBot && seat.accountId === user.id,
        stackCents: hp && !handView.finished ? hp.stackCents : seat.stackCents,
        sittingOut: seat.sittingOut,
        leaveAfterHand: seat.leaveAfterHand,
        inHand: Boolean(hp),
        isDealer: handView ? handView.dealerSeat === i : table.dealer_seat === i,
        isSmallBlind: handView?.sbSeat === i,
        isBigBlind: handView?.bbSeat === i,
        isActing: handView?.actingSeat === i,
        streetBetCents: hp?.streetBetCents ?? 0,
        totalBetCents: hp?.totalBetCents ?? 0,
        folded: hp?.folded ?? false,
        allIn: hp?.allIn ?? false,
        lastAction: hp?.lastAction ?? null,
        holeCards: hp?.holeCards ?? null,
        cardCount: hp?.cardCount ?? 0,
      });
    }
  }

  const wallet = await ensurePokerWallet(db, user.identityId);
  const eligibility = await loadWalletEligibility(db, user.identityId);
  const acCount = await loadAccountAcCount(db, user.id);
  const allowance = computeBuyInAllowance(acCount, wallet.usedBuyIns, settings);
  const daily = dailyLimitsSummary(await loadDailyStats(db, user.identityId, clock.date), settings);
  const mySeat = humanSeats.find(s => s.accountId === user.id) ?? null;
  const myHandPlayer = mySeat ? handPlayerBySeat.get(mySeat.seatIndex) ?? null : null;
  const bigBlindCents = Number(table.big_blind_cents);

  const { rows: recentHandsRows } = await db.query(
    `SELECT id, hand_number, small_blind_cents, big_blind_cents, community_cards, pot_cents, summary, ended_at
     FROM poker_hands
     WHERE table_id=$1 AND ended_at IS NOT NULL
     ORDER BY hand_number DESC LIMIT 10`,
    [table.id],
  );

  return {
    unchanged: false,
    serverTime: new Date(clock.nowMs).toISOString(),
    table: {
      id: table.id,
      name: table.name,
      smallBlindCents: Number(table.small_blind_cents),
      bigBlindCents,
      useDefaultBlinds: Boolean(table.use_default_blinds),
      maxSeats: Number(table.max_seats),
      enabled: Boolean(table.enabled),
      revision: Number(table.revision),
      handNumber: Number(table.hand_number),
      dealerSeat: table.dealer_seat === null ? null : Number(table.dealer_seat),
      status: table.status,
      nextHandAt: table.next_hand_at,
      minBuyInCents: settings.minBuyInBb * bigBlindCents,
      maxBuyInCents: settings.maxBuyInBb * bigBlindCents,
      turnTimeoutSeconds: settings.turnTimeoutSeconds,
      allowBots: settings.allowBots,
      maxBotsPerTable: settings.maxBotsPerTable,
      humanCount: humanSeats.length,
      botCount: botSeats.length,
    },
    seats: seatSlots,
    hand: handView,
    mySeat: mySeat
      ? {
          seatIndex: mySeat.seatIndex,
          stackCents: myHandPlayer && !handView?.finished ? myHandPlayer.stackCents : mySeat.stackCents,
          sittingOut: mySeat.sittingOut,
          leaveAfterHand: mySeat.leaveAfterHand,
          inActiveHand: Boolean(myHandPlayer && !myHandPlayer.folded && !handView?.finished),
          canRebuy:
            (!myHandPlayer || Boolean(handView?.finished) || mySeat.sittingOut) &&
            mySeat.stackCents < settings.maxBuyInBb * bigBlindCents,
        }
      : null,
    allowance,
    wallet: {
      scholarshipBalance: eligibility.scholarshipBalance,
      pokerBalanceCents: wallet.balanceCents,
      totalAvailableCents: eligibility.scholarshipBalance * 100 + wallet.balanceCents,
      walletEligible: eligibility.walletEligible,
    },
    daily,
    recentHands: recentHandsRows.map(h => ({
      id: h.id,
      handNumber: Number(h.hand_number),
      smallBlindCents: Number(h.small_blind_cents),
      bigBlindCents: Number(h.big_blind_cents),
      communityCards: h.community_cards,
      potCents: Number(h.pot_cents),
      awards: h.summary?.showdownResult?.awards ?? [],
      reason: h.summary?.showdownResult?.reason ?? null,
      endedAt: h.ended_at,
    })),
  };
}

function parseTablePayload(body, settings, { partial = false } = {}) {
  const result = {};
  if (!partial || body.name !== undefined) {
    result.name = field(body.name, '牌桌名称', { min: 1, max: 80 });
  }
  if (!partial || body.useDefaultBlinds !== undefined) {
    if (body.useDefaultBlinds !== undefined && typeof body.useDefaultBlinds !== 'boolean') {
      fail(400, 'VALIDATION', '是否跟随默认盲注设置无效');
    }
    result.useDefaultBlinds = body.useDefaultBlinds ?? false;
  }
  if (!partial || body.smallBlindCents !== undefined || body.bigBlindCents !== undefined || result.useDefaultBlinds) {
    const useDefault = result.useDefaultBlinds === true;
    const sb = useDefault
      ? settings.defaultSmallBlindCents
      : integer(Number(body.smallBlindCents), 1, 1000000, '小盲金额（分）');
    const bb = useDefault
      ? settings.defaultBigBlindCents
      : integer(Number(body.bigBlindCents), 2, 2000000, '大盲金额（分）');
    if (bb < sb * 2) fail(400, 'VALIDATION', '大盲金额至少为小盲金额的 2 倍');
    result.smallBlindCents = sb;
    result.bigBlindCents = bb;
  }
  if (!partial || body.maxSeats !== undefined) {
    result.maxSeats = integer(Number(body.maxSeats ?? 6), 2, 6, '座位数');
  }
  if (!partial || body.enabled !== undefined) {
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      fail(400, 'VALIDATION', '牌桌启用状态无效');
    }
    result.enabled = body.enabled ?? true;
  }
  return result;
}

async function handlePlatformPoker(ctx) {
  const { pool, user, route, method, body = {} } = ctx;
  if (route === '/platform/poker' && method === 'GET') {
    return transaction(pool, async db => {
      await requirePlatformAdmin(db, user.id);
      const settings = await loadSettings(db);
      const clock = await todayDate(db);
      const { rows: tables } = await db.query(`
        SELECT t.*,
          (SELECT count(*)::integer FROM poker_seats s WHERE s.table_id=t.id) AS seated_count,
          (SELECT count(*)::integer FROM poker_bot_seats b WHERE b.table_id=t.id) AS bot_count
        FROM poker_tables t
        ORDER BY t.created_at ASC, t.id ASC
      `);
      const { rows: [stats] } = await db.query(`
        SELECT
          (SELECT count(*)::integer FROM poker_seats) AS active_players,
          COALESCE((SELECT sum(hands_played)::integer FROM poker_daily_stats WHERE stat_date=$1), 0) AS today_hands,
          COALESCE((SELECT sum(buy_in_cents)::bigint FROM poker_daily_stats WHERE stat_date=$1), 0) AS today_buy_in_cents
      `, [clock.date]);
      return respond({
        settings,
        tables: tables.map(row => tableSummaryShape(row, settings)),
        stats: {
          activePlayers: Number(stats.active_players),
          todayHands: Number(stats.today_hands),
          todayBuyInCents: Number(stats.today_buy_in_cents),
        },
      });
    });
  }

  if (route === '/platform/poker/settings' && method === 'PATCH') {
    return transaction(pool, async db => {
      await requirePlatformAdmin(db, user.id);
      const current = await loadSettings(db);
      const next = {
        enabled: body.enabled === undefined ? current.enabled : typeof body.enabled === 'boolean' ? body.enabled : fail(400, 'VALIDATION', '开关状态无效'),
        initialUnlockAcProblems: body.initialUnlockAcProblems === undefined ? current.initialUnlockAcProblems : integer(Number(body.initialUnlockAcProblems), 0, 100000, '初次解锁 AC 题数'),
        acPerBuyinBatch: body.acPerBuyinBatch === undefined ? current.acPerBuyinBatch : integer(Number(body.acPerBuyinBatch), 1, 10000, '每批买入所需 AC 题数'),
        buyinsPerBatch: body.buyinsPerBatch === undefined ? current.buyinsPerBatch : integer(Number(body.buyinsPerBatch), 1, 100, '每批解锁买入次数'),
        defaultSmallBlindCents: body.defaultSmallBlindCents === undefined ? current.defaultSmallBlindCents : integer(Number(body.defaultSmallBlindCents), 1, 1000000, '默认小盲金额（分）'),
        defaultBigBlindCents: body.defaultBigBlindCents === undefined ? current.defaultBigBlindCents : integer(Number(body.defaultBigBlindCents), 2, 2000000, '默认大盲金额（分）'),
        minBuyInBb: body.minBuyInBb === undefined ? current.minBuyInBb : integer(Number(body.minBuyInBb), 10, 500, '最小买入（BB）'),
        maxBuyInBb: body.maxBuyInBb === undefined ? current.maxBuyInBb : integer(Number(body.maxBuyInBb), 20, 1000, '最大买入（BB）'),
        turnTimeoutSeconds: body.turnTimeoutSeconds === undefined ? current.turnTimeoutSeconds : integer(Number(body.turnTimeoutSeconds), 10, 120, '行动超时（秒）'),
        dailyBuyInLimitCents: body.dailyBuyInLimitCents === undefined ? current.dailyBuyInLimitCents : integer(Number(body.dailyBuyInLimitCents), 0, 100000000, '每日买入上限（分）'),
        dailyNetLossLimitCents: body.dailyNetLossLimitCents === undefined ? current.dailyNetLossLimitCents : integer(Number(body.dailyNetLossLimitCents), 0, 100000000, '每日净输上限（分）'),
        dailyNetWinLimitCents: body.dailyNetWinLimitCents === undefined ? current.dailyNetWinLimitCents : integer(Number(body.dailyNetWinLimitCents), 0, 100000000, '每日净赢上限（分）'),
        allowBots: body.allowBots === undefined ? current.allowBots : typeof body.allowBots === 'boolean' ? body.allowBots : fail(400, 'VALIDATION', 'AI 补位开关无效'),
        maxBotsPerTable: body.maxBotsPerTable === undefined ? current.maxBotsPerTable : integer(Number(body.maxBotsPerTable), 0, 5, '单桌最大 AI 数量'),
      };
      if (next.defaultBigBlindCents < next.defaultSmallBlindCents * 2) {
        fail(400, 'VALIDATION', '默认大盲金额至少为小盲金额的 2 倍');
      }
      if (next.maxBuyInBb < next.minBuyInBb) {
        fail(400, 'VALIDATION', '最大买入倍数不能小于最小买入倍数');
      }

      const { rows: [saved] } = await db.query(
        `UPDATE poker_settings
         SET enabled=$1, initial_unlock_ac_problems=$2, ac_per_buyin_batch=$3, buyins_per_batch=$4,
             default_small_blind_cents=$5, default_big_blind_cents=$6, min_buy_in_bb=$7, max_buy_in_bb=$8,
             turn_timeout_seconds=$9, daily_buy_in_limit_cents=$10, daily_net_loss_limit_cents=$11,
             daily_net_win_limit_cents=$12, updated_at=clock_timestamp(), updated_by=$13
         WHERE singleton RETURNING *`,
        [
          next.enabled,
          next.initialUnlockAcProblems,
          next.acPerBuyinBatch,
          next.buyinsPerBatch,
          next.defaultSmallBlindCents,
          next.defaultBigBlindCents,
          next.minBuyInBb,
          next.maxBuyInBb,
          next.turnTimeoutSeconds,
          next.dailyBuyInLimitCents,
          next.dailyNetLossLimitCents,
          next.dailyNetWinLimitCents,
          user.id,
        ],
      );

      // Sync waiting tables that follow default blinds immediately.
      await db.query(
        `UPDATE poker_tables
         SET small_blind_cents=$1, big_blind_cents=$2, revision=revision+1, updated_at=clock_timestamp()
         WHERE use_default_blinds=true AND status='waiting'`,
        [next.defaultSmallBlindCents, next.defaultBigBlindCents],
      );

      // If globally disabled, cash out any waiting tables immediately.
      if (!next.enabled) {
        const { rows: waitingTables } = await db.query(
          "SELECT id FROM poker_tables WHERE status='waiting' FOR UPDATE",
        );
        for (const wt of waitingTables) {
          const seats = (await loadTableSeats(db, wt.id)).sort((a, b) => a.identityId.localeCompare(b.identityId));
          for (const seat of seats) {
            await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [wt.id, seat.seatIndex]);
            await creditCashoutAndSettle(db, {
              identityId: seat.identityId,
              accountId: seat.accountId,
              tableId: wt.id,
              amountCents: seat.stackCents,
              reason: '德州扑克关闭自动兑回',
            });
          }
          if (seats.length) {
            await db.query('UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1', [wt.id]);
          }
        }
      }

      const { rows: [savedBot] } = await db.query(
        `UPDATE poker_bot_settings
         SET allow_bots=$1, max_bots_per_table=$2, updated_at=clock_timestamp(), updated_by=$3
         WHERE singleton RETURNING *`,
        [next.allowBots, next.maxBotsPerTable, user.id],
      );
      if (!next.allowBots) {
        await db.query(
          "DELETE FROM poker_bot_seats WHERE table_id IN (SELECT id FROM poker_tables WHERE status='waiting')",
        );
      }

      await auditPlatform(db, user.id, 'platform.poker.settings_update', next);
      return respond({ settings: settingsShape(saved, savedBot) });
    });
  }

  if (route === '/platform/poker/tables' && method === 'POST') {
    return transaction(pool, async db => {
      await requirePlatformAdmin(db, user.id);
      const settings = await loadSettings(db);
      const parsed = parseTablePayload(body, settings, { partial: false });
      const { rows: [created] } = await db.query(
        `INSERT INTO poker_tables(name, small_blind_cents, big_blind_cents, use_default_blinds, max_seats, enabled)
         VALUES($1, $2, $3, $4, $5, $6) RETURNING *, 0::integer AS seated_count`,
        [parsed.name, parsed.smallBlindCents, parsed.bigBlindCents, parsed.useDefaultBlinds, parsed.maxSeats, parsed.enabled],
      );
      await auditPlatform(db, user.id, 'platform.poker.table_create', { tableId: created.id, ...parsed });
      return respond({ table: tableSummaryShape(created, settings) }, 201);
    });
  }

  const tableMatch = route.match(/^\/platform\/poker\/tables\/([^/]+)$/);
  if (tableMatch && method === 'PATCH') {
    const tableId = uuid(tableMatch[1], '牌桌 ID');
    return transaction(pool, async db => {
      await requirePlatformAdmin(db, user.id);
      const settings = await loadSettings(db);
      const { rows: [existing] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!existing) fail(404, 'NOT_FOUND', '牌桌不存在');

      const mergedBody = {
        name: body.name ?? existing.name,
        useDefaultBlinds: body.useDefaultBlinds ?? existing.use_default_blinds,
        smallBlindCents: body.smallBlindCents ?? Number(existing.small_blind_cents),
        bigBlindCents: body.bigBlindCents ?? Number(existing.big_blind_cents),
        maxSeats: body.maxSeats ?? Number(existing.max_seats),
        enabled: body.enabled ?? Boolean(existing.enabled),
      };
      const parsed = parseTablePayload(mergedBody, settings, { partial: false });
      const seats = await loadTableSeats(db, tableId);
      const maxOccupiedSeat = seats.reduce((max, s) => Math.max(max, s.seatIndex), -1);
      if (parsed.maxSeats <= maxOccupiedSeat) {
        fail(409, 'SEATS_OCCUPIED', '已有玩家在更高座位号就座，无法缩小座位数');
      }

      const { rows: [updated] } = await db.query(
        `UPDATE poker_tables
         SET name=$2, small_blind_cents=$3, big_blind_cents=$4, use_default_blinds=$5,
             max_seats=$6, enabled=$7, revision=revision+1, updated_at=clock_timestamp()
         WHERE id=$1 RETURNING *`,
        [tableId, parsed.name, parsed.smallBlindCents, parsed.bigBlindCents, parsed.useDefaultBlinds, parsed.maxSeats, parsed.enabled],
      );

      // If table was disabled while waiting, cash out waiting players immediately.
      if (!parsed.enabled && updated.status === 'waiting' && seats.length) {
        const sorted = [...seats].sort((a, b) => a.identityId.localeCompare(b.identityId));
        for (const seat of sorted) {
          await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [tableId, seat.seatIndex]);
          await creditCashoutAndSettle(db, {
            identityId: seat.identityId,
            accountId: seat.accountId,
            tableId,
            amountCents: seat.stackCents,
            reason: '牌桌关闭自动兑回',
          });
        }
      }

      const { rows: [countRow] } = await db.query('SELECT count(*)::integer AS c FROM poker_seats WHERE table_id=$1', [tableId]);
      await auditPlatform(db, user.id, 'platform.poker.table_update', { tableId, ...parsed });
      return respond({ table: tableSummaryShape({ ...updated, seated_count: countRow.c }, settings) });
    });
  }

  return null;
}

export async function handlePoker(ctx) {
  const { pool, user, route, method, url, body = {} } = ctx;
  if (route.startsWith('/platform/poker')) return handlePlatformPoker(ctx);
  if (!route.startsWith('/practice/poker')) return null;

  if (route === '/practice/poker/status' && method === 'GET') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      const clock = await todayDate(db);
      const wallet = await ensurePokerWallet(db, user.identityId);
      const eligibility = await loadWalletEligibility(db, user.identityId);
      const acCount = await loadAccountAcCount(db, user.id);
      const allowance = computeBuyInAllowance(acCount, wallet.usedBuyIns, settings);
      const daily = dailyLimitsSummary(await loadDailyStats(db, user.identityId, clock.date), settings);
      const unlocked = settings.enabled && allowance.acUnlocked;

      const { rows: [activeSeat] } = await db.query(
        'SELECT table_id, seat_index, stack_cents FROM poker_seats WHERE account_id=$1',
        [user.id],
      );

      let tables = [];
      if (unlocked) {
        const { rows } = await db.query(`
          SELECT t.*,
            (SELECT count(*)::integer FROM poker_seats s WHERE s.table_id=t.id) AS seated_count,
            (SELECT count(*)::integer FROM poker_bot_seats b WHERE b.table_id=t.id) AS bot_count
          FROM poker_tables t
          WHERE t.enabled = true OR t.id = $1
          ORDER BY t.big_blind_cents ASC, t.created_at ASC
        `, [activeSeat?.table_id ?? null]);
        tables = rows.map(r => tableSummaryShape(r, settings));
      }

      return respond({
        enabled: settings.enabled,
        unlocked,
        allowance,
        settings,
        wallet: {
          scholarshipBalance: eligibility.scholarshipBalance,
          pokerBalanceCents: wallet.balanceCents,
          totalAvailableCents: eligibility.scholarshipBalance * 100 + wallet.balanceCents,
          walletEligible: eligibility.walletEligible,
        },
        daily,
        activeTableId: activeSeat?.table_id ?? null,
        tables,
      });
    });
  }

  if (route === '/practice/poker/wallet/withdraw' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const result = await creditCashoutAndSettle(db, {
        identityId: user.identityId,
        accountId: user.id,
        tableId: null,
        amountCents: 0,
        reason: '德州扑克筹码兑回平台钱包',
      });
      if (result.scholarshipCredited === 0) {
        fail(409, 'POKER_NO_WHOLE_SCHOLARSHIP', '扑克筹码零头不足 1 奖学金，暂无法兑回整数奖学金');
      }
      const eligibility = await loadWalletEligibility(db, user.identityId);
      return respond({
        scholarshipCredited: result.scholarshipCredited,
        pokerBalanceCents: result.balanceCents,
        scholarshipBalance: eligibility.scholarshipBalance,
      });
    });
  }

  if (route === '/practice/poker/history' && method === 'GET') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const { rows: ledgerRows } = await db.query(
        `SELECT id, delta_cents, balance_after_cents, kind, table_id, note, created_at
         FROM poker_wallet_ledger
         WHERE identity_id=$1
         ORDER BY id DESC LIMIT 40`,
        [user.identityId],
      );
      return respond({
        ledger: ledgerRows.map(r => ({
          id: String(r.id),
          deltaCents: Number(r.delta_cents),
          balanceAfterCents: Number(r.balance_after_cents),
          kind: r.kind,
          tableId: r.table_id,
          note: r.note,
          createdAt: r.created_at,
        })),
      });
    });
  }

  const tableRoute = route.match(/^\/practice\/poker\/tables\/([^/]+)(?:\/(join|rebuy|leave|action|bots))?$/);
  if (!tableRoute) return null;
  const tableId = uuid(tableRoute[1], '牌桌 ID');
  const subAction = tableRoute[2] ?? null;

  if (!subAction && method === 'GET') {
    const sinceParam = url.searchParams.get('since');
    const sinceRevision = sinceParam && /^\d+$/.test(sinceParam) ? Number(sinceParam) : null;
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      const clock = await todayDate(db);
      const wallet = await ensurePokerWallet(db, user.identityId);
      const acCount = await loadAccountAcCount(db, user.id);
      const allowance = computeBuyInAllowance(acCount, wallet.usedBuyIns, settings);

      const { rows: [mySeatPre] } = await db.query(
        'SELECT table_id FROM poker_seats WHERE account_id=$1',
        [user.id],
      );
      const isSeatedHere = mySeatPre?.table_id === tableId;
      if ((!settings.enabled || !allowance.acUnlocked) && !isSeatedHere) {
        fail(403, 'POKER_LOCKED', settings.enabled
          ? `全站去重 AC 题目需达到 ${allowance.initialUnlockAcProblems} 题方可解锁德州扑克`
          : '开放平台德州扑克暂未开启');
      }

      // Fast path when polling with ?since=<rev> and nothing needs a lifecycle tick.
      if (sinceRevision !== null) {
        const { rows: [peek] } = await db.query(
          'SELECT revision, status, next_hand_at, state, use_default_blinds, small_blind_cents, big_blind_cents FROM poker_tables WHERE id=$1',
          [tableId],
        );
        if (!peek) fail(404, 'NOT_FOUND', '牌桌不存在');
        const deadlineDue = peek.status === 'playing' && peek.state?.turnDeadlineAt && Date.parse(peek.state.turnDeadlineAt) <= clock.nowMs;
        const actingPlayer = peek.status === 'playing' && peek.state?.actingSeat !== null
          ? peek.state?.players?.find(p => p.seatIndex === peek.state.actingSeat)
          : null;
        const botActionDue = Boolean(
          actingPlayer?.isBot &&
          (!peek.state?.nextBotActionAt || Date.parse(peek.state.nextBotActionAt) <= clock.nowMs),
        );
        const showdownDue = peek.status === 'showdown' && peek.next_hand_at && Date.parse(peek.next_hand_at) <= clock.nowMs;
        const blindsDrift = peek.status === 'waiting' && peek.use_default_blinds &&
          (Number(peek.small_blind_cents) !== settings.defaultSmallBlindCents || Number(peek.big_blind_cents) !== settings.defaultBigBlindCents);
        if (Number(peek.revision) === sinceRevision && !deadlineDue && !botActionDue && !showdownDue && !blindsDrift) {
          if (isSeatedHere) {
            await db.query(
              "UPDATE poker_seats SET last_seen_at=clock_timestamp() WHERE table_id=$1 AND account_id=$2 AND last_seen_at < clock_timestamp() - interval '10 seconds'",
              [tableId, user.id],
            );
          }
          return respond({ unchanged: true, revision: sinceRevision, serverTime: new Date(clock.nowMs).toISOString() });
        }
      }

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      if (isSeatedHere) {
        await db.query(
          'UPDATE poker_seats SET last_seen_at=clock_timestamp() WHERE table_id=$1 AND account_id=$2',
          [tableId, user.id],
        );
      }
      const table = await advanceTableLifecycle(db, locked, settings, clock);
      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  if (subAction === 'join' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      if (!settings.enabled) fail(403, 'POKER_DISABLED', '开放平台德州扑克暂未开启');
      const clock = await todayDate(db);

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      let table = await advanceTableLifecycle(db, locked, settings, clock);
      if (!table.enabled) fail(409, 'TABLE_DISABLED', '该牌桌已关闭');

      const { rows: [existingSeat] } = await db.query(
        'SELECT table_id FROM poker_seats WHERE account_id=$1',
        [user.id],
      );
      if (existingSeat) {
        fail(409, 'ALREADY_SEATED', existingSeat.table_id === tableId ? '你已经在这张牌桌入座' : '你已在另一张牌桌入座，请先离桌');
      }

      const humanSeats = await loadTableSeats(db, tableId);
      const botSeats = await loadTableBotSeats(db, tableId);
      const humanOccupied = new Set(humanSeats.map(s => s.seatIndex));
      const botOccupied = new Set(botSeats.map(s => s.seatIndex));
      const occupied = new Set([...humanOccupied, ...botOccupied]);
      let seatIndex;
      if (body.seatIndex !== undefined && body.seatIndex !== null) {
        seatIndex = integer(Number(body.seatIndex), 0, Number(table.max_seats) - 1, '座位号');
        if (humanOccupied.has(seatIndex)) fail(409, 'SEAT_TAKEN', '该座位已被占用');
        if (botOccupied.has(seatIndex)) {
          if (table.status === 'playing') fail(409, 'SEAT_TAKEN', '该座位当前正在对局中');
          await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1 AND seat_index=$2', [tableId, seatIndex]);
        }
      } else {
        seatIndex = Array.from({ length: Number(table.max_seats) }, (_, i) => i).find(i => !occupied.has(i));
        if (seatIndex === undefined && table.status !== 'playing' && botSeats.length > 0) {
          seatIndex = botSeats[botSeats.length - 1].seatIndex;
          await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1 AND seat_index=$2', [tableId, seatIndex]);
        }
        if (seatIndex === undefined) fail(409, 'TABLE_FULL', '牌桌已满');
      }

      const bigBlindCents = Number(table.big_blind_cents);
      const minBuyIn = settings.minBuyInBb * bigBlindCents;
      const maxBuyIn = settings.maxBuyInBb * bigBlindCents;
      const buyInCents = integer(Number(body.buyInCents), minBuyIn, maxBuyIn, '买入金额（分）');
      const fillBots = body.fillBots === undefined || body.fillBots === null
        ? 0
        : integer(Number(body.fillBots), 0, 5, 'AI 对手数量');

      await debitForBuyIn(db, {
        identityId: user.identityId,
        accountId: user.id,
        tableId,
        amountCents: buyInCents,
        kind: 'table_buyin',
        consumeAllowance: true,
        settings,
        statDate: clock.date,
      });

      await db.query(
        `INSERT INTO poker_seats(table_id, seat_index, account_id, identity_id, stack_cents)
         VALUES($1, $2, $3, $4, $5)`,
        [tableId, seatIndex, user.id, user.identityId, buyInCents],
      );

      if (fillBots > 0 && settings.allowBots) {
        await addBotsToTable(db, table, settings, fillBots);
      }

      const { rows: [bumped] } = await db.query(
        'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
        [tableId],
      );
      table = await advanceTableLifecycle(db, bumped, settings, clock);
      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  if (subAction === 'rebuy' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      if (!settings.enabled) fail(403, 'POKER_DISABLED', '开放平台德州扑克暂未开启');
      const clock = await todayDate(db);

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      let table = await advanceTableLifecycle(db, locked, settings, clock);
      if (!table.enabled) fail(409, 'TABLE_DISABLED', '该牌桌已关闭');

      const { rows: [seat] } = await db.query(
        'SELECT * FROM poker_seats WHERE table_id=$1 AND account_id=$2',
        [tableId, user.id],
      );
      if (!seat) fail(409, 'NOT_SEATED', '你尚未在这张牌桌入座');

      const inActiveHand = table.status === 'playing' && table.state && !table.state.finished &&
        table.state.players.some(p => p.accountId === user.id && !p.folded);
      if (inActiveHand) {
        fail(409, 'HAND_IN_PROGRESS', '当前手牌进行中，请在本局结束后补充筹码');
      }

      const bigBlindCents = Number(table.big_blind_cents);
      const maxBuyIn = settings.maxBuyInBb * bigBlindCents;
      const currentStack = Number(seat.stack_cents);
      const maxAdd = maxBuyIn - currentStack;
      if (maxAdd <= 0) fail(409, 'STACK_AT_MAX', '当前筹码已达本桌上限');

      const minAdd = currentStack === 0 ? Math.min(maxAdd, settings.minBuyInBb * bigBlindCents) : Math.min(maxAdd, bigBlindCents);
      const amountCents = integer(Number(body.amountCents), minAdd, maxAdd, '补充筹码金额（分）');

      await debitForBuyIn(db, {
        identityId: user.identityId,
        accountId: user.id,
        tableId,
        amountCents,
        kind: 'table_rebuy',
        consumeAllowance: true,
        settings,
        statDate: clock.date,
      });

      await db.query(
        `UPDATE poker_seats
         SET stack_cents=stack_cents+$3, sitting_out=false, leave_after_hand=false,
             consecutive_timeouts=0, last_seen_at=clock_timestamp()
         WHERE table_id=$1 AND account_id=$2`,
        [tableId, user.id, amountCents],
      );

      const { rows: [bumped] } = await db.query(
        'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
        [tableId],
      );
      table = await advanceTableLifecycle(db, bumped, settings, clock);
      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  if (subAction === 'action' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      const clock = await todayDate(db);

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      let table = await advanceTableLifecycle(db, locked, settings, clock);

      if (table.status !== 'playing' || !table.state || table.state.finished) {
        fail(409, 'NO_ACTIVE_HAND', '当前没有进行中的手牌');
      }
      const handId = uuid(body.handId, '手牌 ID');
      if (table.state.handId !== handId) {
        fail(409, 'HAND_CHANGED', '手牌状态已更新，请重试');
      }

      const { rows: [seat] } = await db.query(
        'SELECT seat_index FROM poker_seats WHERE table_id=$1 AND account_id=$2',
        [tableId, user.id],
      );
      if (!seat) fail(403, 'NOT_SEATED', '你未入座当前牌桌');

      const action = enumValue(body.action, ['fold', 'check', 'call', 'bet', 'raise', 'all_in'], '操作类型');
      const amountCents = body.amountCents === undefined || body.amountCents === null
        ? null
        : integer(Number(body.amountCents), 1, 1000000000, '下注金额（分）');

      const state = structuredClone(table.state);
      try {
        applyAction(state, {
          seatIndex: Number(seat.seat_index),
          action,
          amountCents,
          nowMs: clock.nowMs,
        });
      } catch (err) {
        fail(409, err.code || 'INVALID_ACTION', err.message || '当前无法执行该操作');
      }

      await db.query(
        'UPDATE poker_seats SET consecutive_timeouts=0, last_seen_at=clock_timestamp() WHERE table_id=$1 AND account_id=$2',
        [tableId, user.id],
      );

      if (state.finished) {
        table = await finalizeCompletedHand(db, table, state, settings, clock);
      } else {
        scheduleBotPace(state, clock.nowMs);
        const { rows: [saved] } = await db.query(
          `UPDATE poker_tables SET state=$2::jsonb, revision=revision+1, updated_at=clock_timestamp()
           WHERE id=$1 RETURNING *`,
          [tableId, JSON.stringify(state)],
        );
        table = saved;
      }

      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  if (subAction === 'bots' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      if (!settings.enabled) fail(403, 'POKER_DISABLED', '开放平台德州扑克暂未开启');
      const clock = await todayDate(db);

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      let table = await advanceTableLifecycle(db, locked, settings, clock);
      if (!table.enabled) fail(409, 'TABLE_DISABLED', '该牌桌已关闭');

      const { rows: [mySeat] } = await db.query(
        'SELECT seat_index FROM poker_seats WHERE table_id=$1 AND account_id=$2',
        [tableId, user.id],
      );
      if (!mySeat) fail(403, 'NOT_SEATED', '请先入座牌桌再管理 AI 对手');

      const action = enumValue(body.action ?? 'add', ['add', 'remove', 'clear'], '操作类型');
      if (action === 'add') {
        const count = integer(Number(body.count ?? 1), 1, 5, 'AI 对手数量');
        const added = await addBotsToTable(db, table, settings, count);
        if (added === 0) fail(409, 'NO_BOT_SEAT_AVAILABLE', '当前牌桌没有可添加 AI 对手的空位或已达上限');
      } else if (action === 'clear') {
        if (table.status === 'playing') {
          await db.query('UPDATE poker_bot_seats SET leave_after_hand=true WHERE table_id=$1', [tableId]);
        } else {
          await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1', [tableId]);
        }
      } else if (action === 'remove') {
        const botSeats = await loadTableBotSeats(db, tableId);
        const targetSeat = body.seatIndex !== undefined && body.seatIndex !== null
          ? integer(Number(body.seatIndex), 0, Number(table.max_seats) - 1, '座位号')
          : botSeats.at(-1)?.seatIndex;
        if (targetSeat !== undefined) {
          if (table.status === 'playing') {
            await db.query(
              'UPDATE poker_bot_seats SET leave_after_hand=true WHERE table_id=$1 AND seat_index=$2',
              [tableId, targetSeat],
            );
          } else {
            await db.query('DELETE FROM poker_bot_seats WHERE table_id=$1 AND seat_index=$2', [tableId, targetSeat]);
          }
        }
      }

      const { rows: [bumped] } = await db.query(
        'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
        [tableId],
      );
      table = await advanceTableLifecycle(db, bumped, settings, clock);
      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  if (subAction === 'leave' && method === 'POST') {
    return transaction(pool, async db => {
      await activeAccount(db, user.id);
      const settings = await loadSettings(db);
      const clock = await todayDate(db);

      const { rows: [locked] } = await db.query('SELECT * FROM poker_tables WHERE id=$1 FOR UPDATE', [tableId]);
      if (!locked) fail(404, 'NOT_FOUND', '牌桌不存在');
      let table = await advanceTableLifecycle(db, locked, settings, clock);

      const { rows: [seat] } = await db.query(
        'SELECT * FROM poker_seats WHERE table_id=$1 AND account_id=$2',
        [tableId, user.id],
      );
      if (!seat) {
        return respond(await buildTableView(db, table, user, settings, clock));
      }

      const immediate = body.immediate === true;
      const cancel = body.cancel === true;
      const inPlayingHand = table.status === 'playing' && table.state && !table.state.finished;
      const handPlayer = inPlayingHand ? table.state.players.find(p => p.accountId === user.id) : null;
      const activeInHand = Boolean(handPlayer && !handPlayer.folded);

      if (activeInHand && !immediate) {
        await db.query(
          'UPDATE poker_seats SET leave_after_hand=$3, last_seen_at=clock_timestamp() WHERE table_id=$1 AND account_id=$2',
          [tableId, user.id, !cancel],
        );
        const { rows: [saved] } = await db.query(
          'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [tableId],
        );
        return respond(await buildTableView(db, saved, user, settings, clock));
      }

      if (inPlayingHand && handPlayer) {
        const state = structuredClone(table.state);
        const p = state.players.find(item => item.accountId === user.id);
        if (!p.folded) {
          forceFoldSeat(state, Number(seat.seat_index), clock.nowMs);
        }
        if (state.finished) {
          await db.query(
            'UPDATE poker_seats SET leave_after_hand=true WHERE table_id=$1 AND account_id=$2',
            [tableId, user.id],
          );
          table = await finalizeCompletedHand(db, table, state, settings, clock);
        } else {
          // Cash out remaining stack immediately and mark cashedOutOnLeave so finalizeCompletedHand skips double credit.
          const cashoutCents = p.stackCents;
          p.cashedOutOnLeave = true;
          scheduleBotPace(state, clock.nowMs);
          await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [tableId, Number(seat.seat_index)]);
          await creditCashoutAndSettle(db, {
            identityId: user.identityId,
            accountId: user.id,
            tableId,
            amountCents: cashoutCents,
          });
          const { rows: [saved] } = await db.query(
            'UPDATE poker_tables SET state=$2::jsonb, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
            [tableId, JSON.stringify(state)],
          );
          table = saved;
        }
      } else {
        await db.query('DELETE FROM poker_seats WHERE table_id=$1 AND seat_index=$2', [tableId, Number(seat.seat_index)]);
        await creditCashoutAndSettle(db, {
          identityId: user.identityId,
          accountId: user.id,
          tableId,
          amountCents: Number(seat.stack_cents),
        });
        const { rows: [saved] } = await db.query(
          'UPDATE poker_tables SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [tableId],
        );
        table = await advanceTableLifecycle(db, saved, settings, clock);
      }

      return respond(await buildTableView(db, table, user, settings, clock));
    });
  }

  return null;
}

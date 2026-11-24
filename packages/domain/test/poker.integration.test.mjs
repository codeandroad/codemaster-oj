import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handlePoker } from '../src/poker.mjs';

test('open platform texas holdem poker end-to-end rules, wallet, buy-in allowances and role isolation', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 120000,
}, async t => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  assert.match(base.pathname, /^\/campus_qa(?:_[a-z0-9_]+)?$/);
  const manager = createPool(base.href);
  const schema = `poker_${randomBytes(5).toString('hex')}`;
  const scoped = new URL(base);
  scoped.searchParams.set('options', `-csearch_path=${schema}`);
  const owner = createPool(scoped.href);
  let app, worker;

  try {
    await manager.query(`CREATE SCHEMA ${schema}`);
    await migrate(owner);
    const grants = (await readFile(new URL('../grants.mjs', import.meta.url), 'utf8'))
      .match(/await pool\.query\(`([\s\S]*?)`\);/)?.[1];
    assert.ok(grants);
    await owner.query(grants.replaceAll('SCHEMA public', `SCHEMA ${schema}`));

    const asRole = role => {
      const u = new URL(scoped);
      u.searchParams.set('options', `-crole=${role} -csearch_path=${schema}`);
      return createPool(u.href);
    };
    app = asRole('campus_app');
    worker = asRole('campus_worker');

    const call = async (user, route, body, method = body ? 'POST' : 'GET') => {
      const res = await handlePoker({
        pool: app,
        user,
        route: route.split('?')[0],
        url: new URL('http://unit.test' + route),
        method,
        body: body ?? {},
      });
      return res.body;
    };

    async function seedUser(label, { platformAdmin = false, scholarship = 50, nickname = label } = {}) {
      const identityId = randomUUID();
      const accountId = randomUUID();
      await owner.query(
        `INSERT INTO identities(id, kind, number, name) VALUES($1, 'student', $2, $3)`,
        [identityId, `S-${label}-${randomBytes(2).toString('hex')}`, label],
      );
      await owner.query(
        `INSERT INTO accounts(id, identity_id, username, password_hash, nickname, leaderboard_use_nickname)
         VALUES($1, $2, $3, 'hash', $4, true)`,
        [accountId, identityId, `user_${label}_${randomBytes(3).toString('hex')}`, nickname],
      );
      if (platformAdmin) {
        await owner.query('INSERT INTO platform_admins(account_id) VALUES($1)', [accountId]);
      }
      if (scholarship > 0) {
        await owner.query(
          "SELECT luq_post_entry($1, $2, 'admin_grant', $3, NULL, 'Test seed scholarship')",
          [identityId, scholarship, `seed:${identityId}`],
        );
      }
      return { id: accountId, identityId, platformAdmin, roles: [] };
    }

    // Seed a school + bank + N problems so we can grant exact site-wide AC counts.
    const schoolId = randomUUID();
    const bankId = randomUUID();
    const admin = await seedUser('admin', { platformAdmin: true, scholarship: 100 });
    await owner.query(
      `INSERT INTO schools(id, slug, name, name_zh, name_en) VALUES($1, $2, 'Test School', '测试学校', 'Test School')`,
      [schoolId, `s-${randomBytes(3).toString('hex')}`],
    );
    await owner.query("SELECT set_config('campus.school_id', $1, false)", [schoolId]);
    await owner.query(
      `INSERT INTO school_problem_banks(school_id, id, owner_account_id, name, request_id) VALUES($1, $2, $3, 'Bank', $4)`,
      [schoolId, bankId, admin.id, randomUUID()],
    );

    const problems = [];
    for (let i = 0; i < 40; i++) {
      const pid = randomUUID();
      const vid = randomUUID();
      await owner.query(
        `INSERT INTO school_problems(school_id, id, bank_id, owner_account_id, draft, published, request_id)
         VALUES($1, $2, $3, $4, '{"title":"P"}', true, $5)`,
        [schoolId, pid, bankId, admin.id, randomUUID()],
      );
      await owner.query(
        `INSERT INTO school_problem_versions(school_id, id, problem_id, draft_revision, definition)
         VALUES($1, $2, $3, 1, '{"title":"P"}')`,
        [schoolId, vid, pid],
      );
      problems.push({ pid, vid });
    }

    async function grantAcs(user, startIdx, count, context = 'school') {
      for (let i = startIdx; i < startIdx + count; i++) {
        const { pid, vid } = problems[i];
        await owner.query(
          `INSERT INTO school_judge_jobs(school_id, problem_id, version_id, account_id, request_id, request_hash, kind, access_context, payload, state, result)
           VALUES($1, $2, $3, $4, $5, 'h', 'submit', $6, '{}', 'completed', '{"status":"AC","score":100}')`,
          [schoolId, pid, vid, user.id, randomUUID(), context],
        );
      }
    }

    const alice = await seedUser('alice', { scholarship: 0, nickname: 'AlicePro' });
    const bob = await seedUser('bob', { scholarship: 0, nickname: 'BobPro' });
    const defaultTableId = '00000000-0000-4000-8000-000000000901';

    await t.test('disabled by default and rejects non-admin configuration', async () => {
      const status = await call(alice, '/practice/poker/status');
      assert.equal(status.enabled, false);
      assert.equal(status.unlocked, false);
      assert.equal(status.settings.initialUnlockAcProblems, 32);
      assert.equal(status.settings.defaultSmallBlindCents, 10);
      assert.equal(status.settings.defaultBigBlindCents, 20);
      assert.deepEqual(status.tables, []);

      await assert.rejects(
        () => call(alice, '/platform/poker/settings', { enabled: true }, 'PATCH'),
        e => e.status === 403 && e.code === 'PLATFORM_ADMIN_REQUIRED',
      );
      await assert.rejects(
        () => call(alice, `/practice/poker/tables/${defaultTableId}`),
        e => e.status === 403 && e.code === 'POKER_LOCKED',
      );
    });

    await t.test('enforces 32-AC initial unlock and 3 buy-ins per subsequent AC batch (across school + public ACs)', async () => {
      // Admin enables poker with default 32 initial AC, 5 AC per batch, 3 buy-ins per batch, 0.10/0.20 blinds.
      const updated = await call(admin, '/platform/poker/settings', { enabled: true }, 'PATCH');
      assert.equal(updated.settings.enabled, true);

      // Give Alice 20 school ACs + 11 public ACs = 31 distinct ACs -> still locked!
      await grantAcs(alice, 0, 20, 'school');
      await grantAcs(alice, 20, 11, 'public');
      // Duplicate AC on problem 0 should NOT count as 32nd!
      await grantAcs(alice, 0, 1, 'public');

      const s31 = await call(alice, '/practice/poker/status');
      assert.equal(s31.allowance.acCount, 31);
      assert.equal(s31.unlocked, false);
      assert.equal(s31.allowance.missingForInitialUnlock, 1);
      assert.equal(s31.allowance.remainingBuyIns, 0);

      // 32nd distinct AC unlocks with 3 buy-in allowances!
      await grantAcs(alice, 31, 1, 'school');
      await grantAcs(bob, 0, 32, 'school');

      const s32 = await call(alice, '/practice/poker/status');
      assert.equal(s32.unlocked, true);
      assert.equal(s32.allowance.acCount, 32);
      assert.equal(s32.allowance.totalUnlockedBuyIns, 3);
      assert.equal(s32.allowance.remainingBuyIns, 3);
      assert.equal(s32.tables.length, 1);
      assert.equal(s32.tables[0].smallBlindCents, 10);
      assert.equal(s32.tables[0].bigBlindCents, 20);
    });

    await t.test('fractional buy-in, multiplayer hand play, hole-card privacy, and exact integer/fractional settlement', async () => {
      const totalCentsBefore = async () => {
        const aLuq = Number((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1', [alice.identityId])).rows[0].balance);
        const bLuq = Number((await owner.query('SELECT balance FROM luq_accounts WHERE identity_id=$1', [bob.identityId])).rows[0].balance);
        const aPok = Number((await owner.query('SELECT balance_cents FROM poker_wallets WHERE identity_id=$1', [alice.identityId])).rows[0]?.balance_cents ?? 0);
        const bPok = Number((await owner.query('SELECT balance_cents FROM poker_wallets WHERE identity_id=$1', [bob.identityId])).rows[0]?.balance_cents ?? 0);
        const seats = Number((await owner.query('SELECT COALESCE(sum(stack_cents),0) s FROM poker_seats')).rows[0].s);
        return (aLuq + bLuq) * 100 + aPok + bPok + seats;
      };
      const initialSystemCents = await totalCentsBefore();
      assert.equal(initialSystemCents, 20000); // 100 + 100 initial student scholarship

      // Alice buys in 450 cents (4.50 scholarship -> debits 5 integer scholarship, keeps 50 cents fractional).
      const joinA = await call(alice, `/practice/poker/tables/${defaultTableId}/join`, { seatIndex: 0, buyInCents: 450 });
      assert.equal(joinA.wallet.scholarshipBalance, 95);
      assert.equal(joinA.wallet.pokerBalanceCents, 50);
      assert.equal(joinA.allowance.remainingBuyIns, 2);
      assert.equal(joinA.table.status, 'waiting');

      // Bob buys in 450 cents -> immediately starts Hand #1!
      const joinB = await call(bob, `/practice/poker/tables/${defaultTableId}/join`, { seatIndex: 1, buyInCents: 450 });
      assert.equal(joinB.table.status, 'playing');
      assert.equal(joinB.hand.handNumber, 1);

      // Privacy check: Bob sees own hole cards, NOT Alice's!
      const seatAForBob = joinB.seats.find(s => s.seatIndex === 0);
      const seatBForBob = joinB.seats.find(s => s.seatIndex === 1);
      assert.equal(seatAForBob.holeCards, null);
      assert.equal(seatBForBob.holeCards.length, 2);

      // Acting player (SB = seat 0 = Alice in heads-up) folds -> Bob wins SB (10 cents)!
      const actingSeat = joinB.hand.actingSeat;
      const actor = actingSeat === 0 ? alice : bob;
      const afterFold = await call(actor, `/practice/poker/tables/${defaultTableId}/action`, {
        handId: joinB.hand.handId,
        action: 'fold',
      });
      assert.equal(afterFold.table.status, 'showdown');
      assert.equal(afterFold.hand.showdownResult.reason, 'fold');

      // Both players leave during showdown -> cash out immediately!
      await call(alice, `/practice/poker/tables/${defaultTableId}/leave`, {});
      const afterBobLeave = await call(bob, `/practice/poker/tables/${defaultTableId}/leave`, {});

      // Alice lost 10 cents (440 + 50 = 490 -> 4 integer scholarship returned -> 99, 90 cents fractional).
      // Bob won 10 cents (460 + 50 = 510 -> 5 integer scholarship returned -> 100, 10 cents fractional).
      const aliceFinalStatus = await call(alice, '/practice/poker/status');
      assert.equal(aliceFinalStatus.wallet.scholarshipBalance, 99);
      assert.equal(aliceFinalStatus.wallet.pokerBalanceCents, 90);
      assert.equal(afterBobLeave.wallet.scholarshipBalance, 100);
      assert.equal(afterBobLeave.wallet.pokerBalanceCents, 10);
      assert.equal(await totalCentsBefore(), initialSystemCents, 'strict zero-sum chip conservation');
    });

    await t.test('exhausting 3 buy-in allowances blocks 4th buy-in until 5 more ACs are earned', async () => {
      // Alice already used 1 buy-in above; use 2 more (2nd and 3rd).
      await call(alice, `/practice/poker/tables/${defaultTableId}/join`, { seatIndex: 0, buyInCents: 400 });
      await call(alice, `/practice/poker/tables/${defaultTableId}/leave`, {});
      await call(alice, `/practice/poker/tables/${defaultTableId}/join`, { seatIndex: 0, buyInCents: 400 });
      await call(alice, `/practice/poker/tables/${defaultTableId}/leave`, {});

      const exhausted = await call(alice, '/practice/poker/status');
      assert.equal(exhausted.allowance.usedBuyIns, 3);
      assert.equal(exhausted.allowance.remainingBuyIns, 0);

      // 4th buy-in rejected!
      await assert.rejects(
        () => call(alice, `/practice/poker/tables/${defaultTableId}/join`, { seatIndex: 0, buyInCents: 400 }),
        e => e.status === 409 && e.code === 'POKER_BUYIN_LIMIT_REACHED',
      );

      // Earn 5 more distinct ACs (total 37) -> unlocks 3 more buy-ins!
      await grantAcs(alice, 32, 5, 'public');
      const refilled = await call(alice, '/practice/poker/status');
      assert.equal(refilled.allowance.acCount, 37);
      assert.equal(refilled.allowance.totalUnlockedBuyIns, 6);
      assert.equal(refilled.allowance.remainingBuyIns, 3);

      // 4th buy-in now succeeds with 1 AI opponent -> immediately deals Hand #2 without needing a 2nd human!
      const soloStart = await call(alice, `/practice/poker/tables/${defaultTableId}/join`, {
        seatIndex: 0,
        buyInCents: 400,
        fillBots: 1,
      });
      assert.equal(soloStart.table.status, 'playing');
      assert.equal(soloStart.table.humanCount, 1);
      assert.equal(soloStart.table.botCount, 1);
      assert.ok(soloStart.seats.some(s => s.isBot && s.occupied));

      // Add 2 more AI bots mid-table via /bots endpoint -> now 3 bots seated!
      const withMoreBots = await call(alice, `/practice/poker/tables/${defaultTableId}/bots`, {
        action: 'add',
        count: 2,
      });
      assert.equal(withMoreBots.table.botCount, 3);

      // Immediate leave cashes Alice out and clears bots once no humans remain!
      await call(alice, `/practice/poker/tables/${defaultTableId}/leave`, { immediate: true });
      const afterSoloLeave = await call(alice, `/practice/poker/tables/${defaultTableId}`);
      assert.equal(afterSoloLeave.table.humanCount, 0);
      assert.equal(afterSoloLeave.table.botCount, 0);
    });

    await t.test('campus_worker is denied access to all poker tables and AC count function', async () => {
      for (const table of ['poker_settings', 'poker_wallets', 'poker_wallet_ledger', 'poker_daily_stats', 'poker_tables', 'poker_seats', 'poker_hands', 'poker_bot_settings', 'poker_bot_seats']) {
        await assert.rejects(worker.query(`SELECT * FROM ${table}`), e => e.code === '42501');
      }
      await assert.rejects(worker.query('SELECT poker_account_ac_count($1)', [alice.id]), e => e.code === '42501');
    });
  } finally {
    await Promise.allSettled([app?.end(), worker?.end(), owner.end()]);
    await manager.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await manager.end();
  }
});

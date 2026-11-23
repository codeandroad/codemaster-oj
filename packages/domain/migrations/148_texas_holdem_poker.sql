-- Open Platform Texas Hold'em Poker: integer scholarship wallet buy-in/cash-out
-- with 100-cent fractional table chips, site-wide AC milestone buy-in allowances,
-- daily risk limits, and admin-managed public tables (disabled by default).

ALTER TABLE luq_ledger DROP CONSTRAINT luq_ledger_kind_check,
 ADD CHECK(kind IN (
  'initial_grant','admin_grant','admin_adjustment','first_ac','activity',
  'purchase','refund','exchange','wallet_relocation','poker_buyin','poker_cashout'
 ));

CREATE OR REPLACE FUNCTION luq_post_entry(p_identity uuid,p_delta integer,p_kind text,p_source text,p_actor uuid,p_reason text,
 p_metadata jsonb DEFAULT '{}',p_refund bigint DEFAULT NULL,p_hash text DEFAULT NULL,p_request text DEFAULT NULL) RETURNS luq_ledger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing luq_ledger; original luq_ledger; current_balance integer; result luq_ledger;
BEGIN
 IF p_request IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('luq-request:'||p_request,0)); END IF;
 IF p_delta=0 OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'LUQ_INVALID_ENTRY'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM identities i WHERE i.id=p_identity AND (
   i.kind IN ('student','personal') OR
   (p_kind IN ('initial_grant','first_ac','purchase','refund','poker_buyin','poker_cashout') AND (
    EXISTS (SELECT 1 FROM luq_initial_grants g WHERE g.identity_id=i.id) OR
    EXISTS (SELECT 1 FROM accounts a JOIN public_practice_preferences pref ON pref.account_id=a.id
            WHERE a.identity_id=i.id AND pref.scholarship_enabled)
   ))
  )
 ) THEN RAISE EXCEPTION 'LUQ_STUDENT_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('luq-account:'||p_identity::text,0));
 SELECT * INTO existing FROM luq_ledger WHERE source_key=p_source OR (p_request IS NOT NULL AND request_key=p_request);
 IF FOUND THEN
  IF existing.source_key<>p_source OR existing.identity_id<>p_identity OR existing.delta<>p_delta OR existing.kind<>p_kind OR existing.request_hash IS DISTINCT FROM p_hash
   OR existing.refund_of IS DISTINCT FROM p_refund THEN RAISE EXCEPTION 'LUQ_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN existing;
 END IF;
 IF p_kind='refund' THEN
  SELECT * INTO original FROM luq_ledger WHERE id=p_refund;
  IF NOT FOUND OR original.identity_id<>p_identity OR original.kind<>'purchase' OR p_delta<>-original.delta THEN RAISE EXCEPTION 'LUQ_INVALID_REFUND'; END IF;
  SELECT * INTO existing FROM luq_ledger WHERE refund_of=p_refund;
  IF FOUND THEN RETURN existing; END IF;
 END IF;
 INSERT INTO luq_accounts(identity_id) VALUES(p_identity) ON CONFLICT DO NOTHING;
 SELECT balance INTO current_balance FROM luq_accounts WHERE identity_id=p_identity FOR UPDATE;
 IF current_balance::bigint+p_delta<0 THEN RAISE EXCEPTION 'LUQ_INSUFFICIENT_BALANCE'; END IF;
 IF current_balance::bigint+p_delta>2147483647 THEN RAISE EXCEPTION 'LUQ_BALANCE_LIMIT'; END IF;
 UPDATE luq_accounts SET balance=balance+p_delta,updated_at=clock_timestamp() WHERE identity_id=p_identity RETURNING balance INTO current_balance;
 INSERT INTO luq_ledger(identity_id,delta,balance_after,kind,source_key,actor_account_id,reason,metadata,refund_of,request_hash,request_key)
 VALUES(p_identity,p_delta,current_balance,p_kind,p_source,p_actor,p_reason,COALESCE(p_metadata,'{}'),p_refund,p_hash,p_request) RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION luq_post_entry(uuid,integer,text,text,uuid,text,jsonb,bigint,text,text) FROM PUBLIC, campus_worker;
GRANT EXECUTE ON FUNCTION luq_post_entry(uuid,integer,text,text,uuid,text,jsonb,bigint,text,text) TO campus_app;

-- Count site-wide distinct AC problems (both school workspaces and open platform)
-- without exposing any private school problem records.
CREATE POLICY school_judge_jobs_poker_ac_owner ON school_judge_jobs FOR SELECT TO CURRENT_USER
 USING (kind='submit' AND state='completed' AND result->>'status'='AC');

CREATE FUNCTION poker_account_ac_count(p_account_id uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH target AS (
    SELECT a.id AS account_id, a.identity_id
    FROM accounts a
    WHERE a.id = p_account_id
  ), solved AS (
    SELECT j.problem_id
    FROM school_judge_jobs j
    JOIN target t ON j.account_id = t.account_id
    WHERE j.kind = 'submit' AND j.state = 'completed' AND j.result->>'status' = 'AC'
    UNION
    SELECT s.problem_id
    FROM submissions s
    JOIN target t ON (s.account_id = t.account_id OR s.identity_id = t.identity_id)
    WHERE s.kind = 'submit' AND s.status = 'AC'
  )
  SELECT count(DISTINCT problem_id)::integer FROM solved;
$$;
REVOKE ALL ON FUNCTION poker_account_ac_count(uuid) FROM PUBLIC, campus_worker;
GRANT EXECUTE ON FUNCTION poker_account_ac_count(uuid) TO campus_app;

-- Poker global settings: disabled by default, initial unlock at 32 distinct ACs,
-- every subsequent N ACs grants 3 buy-in allowances; default SB/BB = 0.10 / 0.20 scholarship.
CREATE TABLE poker_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  initial_unlock_ac_problems integer NOT NULL DEFAULT 32 CHECK (initial_unlock_ac_problems BETWEEN 0 AND 100000),
  ac_per_buyin_batch integer NOT NULL DEFAULT 5 CHECK (ac_per_buyin_batch BETWEEN 1 AND 10000),
  buyins_per_batch integer NOT NULL DEFAULT 3 CHECK (buyins_per_batch BETWEEN 1 AND 100),
  default_small_blind_cents integer NOT NULL DEFAULT 10 CHECK (default_small_blind_cents BETWEEN 1 AND 1000000),
  default_big_blind_cents integer NOT NULL DEFAULT 20 CHECK (default_big_blind_cents BETWEEN 2 AND 2000000),
  min_buy_in_bb integer NOT NULL DEFAULT 20 CHECK (min_buy_in_bb BETWEEN 10 AND 500),
  max_buy_in_bb integer NOT NULL DEFAULT 100 CHECK (max_buy_in_bb BETWEEN 20 AND 1000),
  turn_timeout_seconds integer NOT NULL DEFAULT 25 CHECK (turn_timeout_seconds BETWEEN 10 AND 120),
  daily_buy_in_limit_cents integer NOT NULL DEFAULT 5000 CHECK (daily_buy_in_limit_cents BETWEEN 0 AND 100000000),
  daily_net_loss_limit_cents integer NOT NULL DEFAULT 2000 CHECK (daily_net_loss_limit_cents BETWEEN 0 AND 100000000),
  daily_net_win_limit_cents integer NOT NULL DEFAULT 2000 CHECK (daily_net_win_limit_cents BETWEEN 0 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES accounts(id),
  CHECK (default_big_blind_cents >= default_small_blind_cents * 2),
  CHECK (max_buy_in_bb >= min_buy_in_bb)
);
INSERT INTO poker_settings(singleton) VALUES (true);

-- Fractional chip balance (100 cents = 1 integer scholarship) & consumed buy-in counter.
CREATE TABLE poker_wallets (
  identity_id uuid PRIMARY KEY REFERENCES identities(id),
  balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  used_buy_ins integer NOT NULL DEFAULT 0 CHECK (used_buy_ins >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE poker_wallet_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identities(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  delta_cents bigint NOT NULL CHECK (delta_cents <> 0),
  balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
  kind text NOT NULL CHECK (kind IN (
    'scholarship_deposit',
    'scholarship_withdraw',
    'table_buyin',
    'table_rebuy',
    'table_cashout'
  )),
  table_id uuid,
  luq_ledger_id bigint REFERENCES luq_ledger(id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX poker_wallet_ledger_identity_idx ON poker_wallet_ledger(identity_id, id DESC);

CREATE TABLE poker_daily_stats (
  identity_id uuid NOT NULL REFERENCES identities(id),
  stat_date date NOT NULL,
  buy_in_cents bigint NOT NULL DEFAULT 0 CHECK (buy_in_cents >= 0),
  net_cents bigint NOT NULL DEFAULT 0,
  hands_played integer NOT NULL DEFAULT 0 CHECK (hands_played >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (identity_id, stat_date)
);

CREATE TABLE poker_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  small_blind_cents integer NOT NULL CHECK (small_blind_cents BETWEEN 1 AND 1000000),
  big_blind_cents integer NOT NULL CHECK (big_blind_cents BETWEEN 2 AND 2000000),
  use_default_blinds boolean NOT NULL DEFAULT false,
  max_seats integer NOT NULL DEFAULT 6 CHECK (max_seats BETWEEN 2 AND 6),
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1,
  hand_number integer NOT NULL DEFAULT 0,
  dealer_seat integer CHECK (dealer_seat IS NULL OR dealer_seat BETWEEN 0 AND 5),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'showdown')),
  current_hand_id uuid,
  next_hand_at timestamptz,
  state jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (big_blind_cents >= small_blind_cents * 2)
);

INSERT INTO poker_tables(id, name, small_blind_cents, big_blind_cents, use_default_blinds, max_seats, enabled)
VALUES ('00000000-0000-4000-8000-000000000901', '公开桌 #1', 10, 20, true, 6, true);

CREATE TABLE poker_seats (
  table_id uuid NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat_index integer NOT NULL CHECK (seat_index BETWEEN 0 AND 5),
  account_id uuid NOT NULL REFERENCES accounts(id),
  identity_id uuid NOT NULL REFERENCES identities(id),
  stack_cents bigint NOT NULL DEFAULT 0 CHECK (stack_cents >= 0),
  leave_after_hand boolean NOT NULL DEFAULT false,
  sitting_out boolean NOT NULL DEFAULT false,
  consecutive_timeouts integer NOT NULL DEFAULT 0 CHECK (consecutive_timeouts >= 0),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_id, seat_index),
  UNIQUE (account_id)
);
CREATE INDEX poker_seats_table_idx ON poker_seats(table_id, seat_index);

CREATE TABLE poker_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  hand_number integer NOT NULL,
  small_blind_cents integer NOT NULL,
  big_blind_cents integer NOT NULL,
  dealer_seat integer NOT NULL,
  community_cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  pot_cents bigint NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz
);
CREATE INDEX poker_hands_table_idx ON poker_hands(table_id, hand_number DESC);

REVOKE ALL ON poker_settings, poker_wallets, poker_wallet_ledger, poker_daily_stats, poker_tables, poker_seats, poker_hands FROM PUBLIC, campus_worker;
GRANT SELECT, INSERT, UPDATE ON poker_settings, poker_wallets, poker_daily_stats, poker_tables, poker_hands TO campus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON poker_seats TO campus_app;
GRANT SELECT, INSERT ON poker_wallet_ledger TO campus_app;
GRANT USAGE, SELECT ON SEQUENCE poker_wallet_ledger_id_seq TO campus_app;

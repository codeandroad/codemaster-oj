-- Optional AI bot opponents for Open Platform Texas Hold'em tables so learners
-- can start playing immediately even when fewer than 2 humans are seated.
-- Kept in separate tables from poker_settings / poker_seats so existing human
-- seat constraints and pre-existing table schemas remain untouched.

CREATE TABLE poker_bot_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  allow_bots boolean NOT NULL DEFAULT true,
  max_bots_per_table integer NOT NULL DEFAULT 5 CHECK (max_bots_per_table BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES accounts(id)
);
INSERT INTO poker_bot_settings(singleton) VALUES (true);

CREATE TABLE poker_bot_seats (
  table_id uuid NOT NULL REFERENCES poker_tables(id) ON DELETE CASCADE,
  seat_index integer NOT NULL CHECK (seat_index BETWEEN 0 AND 5),
  bot_id text NOT NULL CHECK (length(btrim(bot_id)) BETWEEN 1 AND 40),
  bot_name text NOT NULL CHECK (length(btrim(bot_name)) BETWEEN 1 AND 40),
  bot_style text NOT NULL CHECK (bot_style IN ('tight', 'balanced', 'loose', 'aggressive')),
  avatar text NOT NULL,
  stack_cents bigint NOT NULL DEFAULT 0 CHECK (stack_cents >= 0),
  leave_after_hand boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_id, seat_index)
);
CREATE INDEX poker_bot_seats_table_idx ON poker_bot_seats(table_id, seat_index);

REVOKE ALL ON poker_bot_settings, poker_bot_seats FROM PUBLIC, campus_worker;
GRANT SELECT, INSERT, UPDATE ON poker_bot_settings TO campus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON poker_bot_seats TO campus_app;

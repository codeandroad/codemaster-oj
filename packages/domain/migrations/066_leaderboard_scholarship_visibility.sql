-- Current Scholarship balance is an optional student-facing leaderboard field.
-- Keep all existing visibility choices, balances, ledgers and ordering unchanged.
ALTER TABLE leaderboard_settings
  ADD COLUMN show_luq_balance boolean NOT NULL DEFAULT true;

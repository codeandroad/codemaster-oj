-- Existing and new accounts use the student's identity name until they explicitly opt in.
ALTER TABLE accounts ADD COLUMN leaderboard_use_nickname boolean NOT NULL DEFAULT false;

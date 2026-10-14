-- Student-facing leaderboard columns are a school-wide administrative policy.
-- Historical per-class settings remain for migration history but are no longer read.
CREATE TABLE leaderboard_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 show_solved_problems boolean NOT NULL DEFAULT true,
 show_attempts boolean NOT NULL DEFAULT false,
 show_ac_rate boolean NOT NULL DEFAULT true,
 updated_by uuid REFERENCES accounts(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO leaderboard_settings (id) VALUES (true);

CREATE TABLE class_leaderboard_settings (
 class_id uuid PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
 show_solved_problems boolean NOT NULL DEFAULT true,
 show_attempts boolean NOT NULL DEFAULT false,
 show_ac_rate boolean NOT NULL DEFAULT true,
 updated_by uuid REFERENCES accounts(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);

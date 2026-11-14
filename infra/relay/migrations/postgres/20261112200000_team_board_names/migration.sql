ALTER TABLE "relay_team_boards" ADD COLUMN IF NOT EXISTS "names" jsonb DEFAULT '{}'::jsonb NOT NULL;

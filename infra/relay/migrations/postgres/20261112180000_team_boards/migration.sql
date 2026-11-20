ALTER TABLE "relay_team_threads" ADD COLUMN IF NOT EXISTS "hidden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relay_team_boards" (
	"team_id" varchar(64) PRIMARY KEY REFERENCES "relay_teams"("id") ON DELETE CASCADE,
	"board" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_at" varchar(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS "relay_teams" (
	"id" varchar(64) PRIMARY KEY,
	"name" varchar(120) NOT NULL,
	"owner_user_id" varchar(191) NOT NULL,
	"created_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relay_team_members" (
	"team_id" varchar(64) NOT NULL REFERENCES "relay_teams"("id") ON DELETE CASCADE,
	"user_id" varchar(191) NOT NULL,
	"name" varchar(120) NOT NULL,
	"avatar_url" text,
	"joined_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_team_members_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_team_members_user" ON "relay_team_members" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relay_team_invites" (
	"name" varchar(64) PRIMARY KEY,
	"team_id" varchar(64) NOT NULL REFERENCES "relay_teams"("id") ON DELETE CASCADE,
	"created_by_user_id" varchar(191) NOT NULL,
	"expires_at" varchar(64) NOT NULL,
	"created_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_team_invites_team" ON "relay_team_invites" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_team_invites_expires_at" ON "relay_team_invites" ("expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relay_team_threads" (
	"environment_id" varchar(191) NOT NULL,
	"thread_id" varchar(255) NOT NULL,
	"team_id" varchar(64) NOT NULL REFERENCES "relay_teams"("id") ON DELETE CASCADE,
	"share_id" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"host" varchar(255) NOT NULL,
	"credential" varchar(255) NOT NULL,
	"owner_user_id" varchar(191) NOT NULL,
	"expires_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_team_threads_pkey" PRIMARY KEY("environment_id","thread_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_team_threads_team" ON "relay_team_threads" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_team_threads_expires_at" ON "relay_team_threads" ("expires_at");

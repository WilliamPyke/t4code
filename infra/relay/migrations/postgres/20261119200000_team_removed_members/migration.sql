CREATE TABLE IF NOT EXISTS "relay_team_removed_members" (
	"team_id" varchar(64) NOT NULL REFERENCES "relay_teams"("id") ON DELETE CASCADE,
	"user_id" varchar(191) NOT NULL,
	"name" varchar(120) NOT NULL,
	"removed_by_user_id" varchar(191) NOT NULL,
	"removed_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_team_removed_members_pkey" PRIMARY KEY("team_id","user_id")
);

CREATE TABLE IF NOT EXISTS "relay_guest_links" (
	"name" varchar(64) PRIMARY KEY,
	"environment_id" varchar(191) NOT NULL,
	"host" varchar(255) NOT NULL,
	"credential" varchar(255) NOT NULL,
	"expires_at" varchar(64) NOT NULL,
	"created_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_relay_guest_links_credential" ON "relay_guest_links" ("credential");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_guest_links_expires_at" ON "relay_guest_links" ("expires_at");

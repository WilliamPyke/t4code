CREATE TABLE IF NOT EXISTS "relay_computer_approvals" (
	"user_id" varchar(191) NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"environment_public_key" text,
	"expires_at" varchar(64) NOT NULL,
	"used_at" varchar(64),
	"created_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_computer_approvals_pkey" PRIMARY KEY("user_id","code_challenge")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relay_computer_approvals_expires_at" ON "relay_computer_approvals" ("expires_at");

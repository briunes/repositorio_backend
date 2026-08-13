ALTER TABLE "system_config"
  ALTER COLUMN "session_duration_minutes" SET DEFAULT 60;

UPDATE "system_config"
SET "session_duration_minutes" = 60;

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_sessions_user_id_revoked_at_expires_at_idx"
  ON "user_sessions"("user_id", "revoked_at", "expires_at");

CREATE INDEX "user_sessions_last_activity_at_idx"
  ON "user_sessions"("last_activity_at");

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

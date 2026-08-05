ALTER TABLE "system_config"
  ADD COLUMN IF NOT EXISTS "my_work_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notifications_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "system_config"
  ADD COLUMN "default_view" VARCHAR(30) NOT NULL DEFAULT 'all',
  ADD COLUMN "default_page_size" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN "default_sort" VARCHAR(40) NOT NULL DEFAULT 'name-asc',
  ADD COLUMN "show_inactive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "session_duration_minutes" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "idle_timeout_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "read_only_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maintenance_message" VARCHAR(500),
  ADD COLUMN "environment_name" VARCHAR(80) NOT NULL DEFAULT 'Produção';

CREATE TABLE "release_notes" (
  "id" TEXT NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "hero_image_url" TEXT,
  "blocks" JSONB NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "release_notes_version_key" ON "release_notes"("version");
CREATE INDEX "release_notes_published_published_at_idx" ON "release_notes"("published", "published_at");

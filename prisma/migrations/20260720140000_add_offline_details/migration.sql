-- Store the detail endpoint payload so previews remain available offline.
ALTER TABLE "communication_localizations"
ADD COLUMN "preview_filename" VARCHAR(500),
ADD COLUMN "preview_base64" TEXT;

ALTER TABLE "sync_runs"
ADD COLUMN "details" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "detail_errors" INTEGER NOT NULL DEFAULT 0;

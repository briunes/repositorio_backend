-- Preserve the complete, unmodified response returned by GBox details.
ALTER TABLE "communication_localizations"
ADD COLUMN "source_payload" JSONB;

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "communications"
ADD COLUMN "metadata" JSONB,
ADD COLUMN "last_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "communications" INTEGER NOT NULL DEFAULT 0,
    "versions" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_runs_source_started_at_idx" ON "sync_runs"("source", "started_at");

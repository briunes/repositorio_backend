CREATE TABLE "repository_snapshots" (
    "key" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "repository_snapshots_pkey" PRIMARY KEY ("key")
);

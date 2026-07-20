CREATE TABLE "system_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "app_version" VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "system_config" ("id", "app_version")
VALUES ('default', '1.0.0')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "communications" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "CommunicationStatus" RENAME TO "CommunicationStatus_old";

CREATE TYPE "CommunicationStatus" AS ENUM (
  'ACTIVE',
  'PENDING',
  'SCHEDULED',
  'INACTIVE'
);

ALTER TABLE "communications"
ALTER COLUMN "status" TYPE "CommunicationStatus"
USING (
  CASE "status"::text
    WHEN 'AVAILABLE' THEN 'ACTIVE'
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'SCHEDULED' THEN 'PENDING'
    WHEN 'UNAVAILABLE' THEN 'INACTIVE'
    WHEN 'ARCHIVED' THEN 'INACTIVE'
    WHEN 'DRAFT' THEN 'SCHEDULED'
  END
)::"CommunicationStatus";

ALTER TABLE "communications" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "CommunicationStatus_old";

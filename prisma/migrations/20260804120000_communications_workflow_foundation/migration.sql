-- Additive workflow foundation. Legacy version states remain available until
-- ownership and pending-version backfills have been reviewed.
ALTER TYPE "VersionStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "VersionStatus" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "VersionStatus" ADD VALUE 'APPROVED';
ALTER TYPE "VersionStatus" ADD VALUE 'DEPLOYING';
ALTER TYPE "VersionStatus" ADD VALUE 'DEPLOYED';
ALTER TYPE "VersionStatus" ADD VALUE 'DEPLOY_FAILED';
ALTER TYPE "VersionStatus" ADD VALUE 'REJECTED';
ALTER TYPE "VersionStatus" ADD VALUE 'CANCELLED';

ALTER TYPE "AuditAction" ADD VALUE 'SUBMIT';
ALTER TYPE "AuditAction" ADD VALUE 'WITHDRAW';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_CHANGES';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT';
ALTER TYPE "AuditAction" ADD VALUE 'SCHEDULE';
ALTER TYPE "AuditAction" ADD VALUE 'DEPLOY';
ALTER TYPE "AuditAction" ADD VALUE 'DEPLOY_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'RETRY';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGN';
ALTER TYPE "AuditAction" ADD VALUE 'UNASSIGN';

CREATE TYPE "TeamMemberRole" AS ENUM ('VIEWER', 'EDITOR', 'APPROVER', 'PUBLISHER', 'OWNER');
CREATE TYPE "ApprovalOutcome" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'REJECT');
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "DeploymentTrigger" AS ENUM ('IMMEDIATE', 'SCHEDULED', 'RETRY', 'ROLLBACK');
CREATE TYPE "NotificationType" AS ENUM ('VERSION_SUBMITTED', 'VERSION_APPROVED', 'CHANGES_REQUESTED', 'VERSION_REJECTED', 'DEPLOYMENT_SCHEDULED', 'DEPLOYMENT_RESCHEDULED', 'DEPLOYMENT_CANCELLED', 'DEPLOYMENT_SUCCEEDED', 'DEPLOYMENT_FAILED', 'TEAM_MEMBERSHIP_CHANGED', 'OWNERSHIP_CHANGED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

ALTER TABLE "teams"
  ADD COLUMN "description" VARCHAR(500),
  ADD COLUMN "required_approvals" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approval_expires_days" INTEGER DEFAULT 30;

ALTER TABLE "communications" ADD COLUMN "owner_team_id" TEXT;

ALTER TABLE "communication_versions"
  ADD COLUMN "source_version_id" TEXT,
  ADD COLUMN "revision" INTEGER,
  ADD COLUMN "external_version" VARCHAR(60),
  ADD COLUMN "change_summary" VARCHAR(1000),
  ADD COLUMN "content_checksum" VARCHAR(128),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_reason" VARCHAR(1000);

ALTER TABLE "communication_comments"
  ADD COLUMN "version_id" TEXT,
  ADD COLUMN "approval_request_id" TEXT,
  ADD COLUMN "comment_type" VARCHAR(40) NOT NULL DEFAULT 'GENERAL';

CREATE TABLE "team_members" (
  "id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "TeamMemberRole" NOT NULL,
  "assigned_by_id" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_collaborator_teams" (
  "communication_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_collaborator_teams_pkey" PRIMARY KEY ("communication_id", "team_id")
);

CREATE TABLE "approval_requests" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL,
  "outcome" "ApprovalOutcome" NOT NULL DEFAULT 'PENDING',
  "submitted_by_id" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "change_summary" VARCHAR(1000) NOT NULL,
  "content_checksum" VARCHAR(128) NOT NULL,
  "required_approvals" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_decisions" (
  "id" TEXT NOT NULL,
  "approval_request_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "decision" "ApprovalDecisionType" NOT NULL,
  "comment" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deployments" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "requested_by_id" TEXT,
  "target_environment" VARCHAR(80) NOT NULL,
  "target_system" VARCHAR(80) NOT NULL,
  "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger" "DeploymentTrigger" NOT NULL,
  "scheduled_at" TIMESTAMP(3),
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" VARCHAR(191) NOT NULL,
  "external_reference" VARCHAR(191),
  "request_summary" JSONB,
  "response_summary" JSONB,
  "error_code" VARCHAR(120),
  "error_message" VARCHAR(1000),
  "retry_of_id" TEXT,
  "rollback_of_deployment_id" TEXT,
  CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_active_versions" (
  "communication_id" TEXT NOT NULL,
  "target_environment" VARCHAR(80) NOT NULL,
  "version_id" TEXT NOT NULL,
  "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_active_versions_pkey" PRIMARY KEY ("communication_id", "target_environment")
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" VARCHAR(191) NOT NULL,
  "action_url" VARCHAR(500),
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outbox_event_id" TEXT,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" TEXT NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" VARCHAR(191) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_members_team_id_user_id_role_key" ON "team_members"("team_id", "user_id", "role");
CREATE INDEX "team_members_user_id_role_idx" ON "team_members"("user_id", "role");
CREATE INDEX "team_members_team_id_role_idx" ON "team_members"("team_id", "role");
CREATE INDEX "communications_owner_team_id_status_idx" ON "communications"("owner_team_id", "status");
CREATE UNIQUE INDEX "communication_versions_communication_id_revision_key" ON "communication_versions"("communication_id", "revision");
CREATE INDEX "communication_collaborator_teams_team_id_idx" ON "communication_collaborator_teams"("team_id");
CREATE UNIQUE INDEX "approval_requests_version_id_cycle_key" ON "approval_requests"("version_id", "cycle");
CREATE INDEX "approval_requests_outcome_submitted_at_idx" ON "approval_requests"("outcome", "submitted_at");
CREATE INDEX "approval_requests_submitted_by_id_submitted_at_idx" ON "approval_requests"("submitted_by_id", "submitted_at");
CREATE INDEX "approval_decisions_approval_request_id_created_at_idx" ON "approval_decisions"("approval_request_id", "created_at");
CREATE INDEX "approval_decisions_reviewer_id_created_at_idx" ON "approval_decisions"("reviewer_id", "created_at");
CREATE UNIQUE INDEX "deployments_idempotency_key_key" ON "deployments"("idempotency_key");
CREATE INDEX "deployments_status_scheduled_at_idx" ON "deployments"("status", "scheduled_at");
CREATE INDEX "deployments_version_id_requested_at_idx" ON "deployments"("version_id", "requested_at");
CREATE INDEX "deployments_requested_by_id_requested_at_idx" ON "deployments"("requested_by_id", "requested_at");
CREATE INDEX "communication_active_versions_version_id_idx" ON "communication_active_versions"("version_id");
CREATE INDEX "communication_comments_version_id_created_at_idx" ON "communication_comments"("version_id", "created_at");
CREATE INDEX "communication_comments_approval_request_id_created_at_idx" ON "communication_comments"("approval_request_id", "created_at");
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");
CREATE UNIQUE INDEX "notifications_recipient_id_outbox_event_id_key" ON "notifications"("recipient_id", "outbox_event_id");
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_created_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");

ALTER TABLE "communications" ADD CONSTRAINT "communications_owner_team_id_fkey" FOREIGN KEY ("owner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "communication_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_collaborator_teams" ADD CONSTRAINT "communication_collaborator_teams_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_collaborator_teams" ADD CONSTRAINT "communication_collaborator_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_rollback_of_deployment_id_fkey" FOREIGN KEY ("rollback_of_deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_active_versions" ADD CONSTRAINT "communication_active_versions_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_active_versions" ADD CONSTRAINT "communication_active_versions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_comments" ADD CONSTRAINT "communication_comments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

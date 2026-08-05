import { VersionStatus } from '@prisma/client';

const transitions: Partial<Record<VersionStatus, readonly VersionStatus[]>> = {
  DRAFT: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'DRAFT'],
  CHANGES_REQUESTED: ['DRAFT', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'DEPLOYING', 'CANCELLED'],
  SCHEDULED: ['APPROVED', 'DEPLOYING', 'CANCELLED'],
  DEPLOYING: ['DEPLOYED', 'DEPLOY_FAILED'],
  DEPLOY_FAILED: ['DEPLOYING', 'CANCELLED'],
  DEPLOYED: ['ARCHIVED'],
};

export function canTransitionVersion(from: VersionStatus, to: VersionStatus) {
  return transitions[from]?.includes(to) ?? false;
}

export function editableVersion(status: VersionStatus) {
  return status === 'DRAFT';
}

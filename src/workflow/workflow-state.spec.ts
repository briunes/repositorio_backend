import { canTransitionVersion, editableVersion } from './workflow-state';

describe('communication version workflow', () => {
  it.each([
    ['DRAFT', 'IN_REVIEW'],
    ['IN_REVIEW', 'APPROVED'],
    ['IN_REVIEW', 'CHANGES_REQUESTED'],
    ['CHANGES_REQUESTED', 'DRAFT'],
    ['APPROVED', 'DEPLOYING'],
    ['APPROVED', 'SCHEDULED'],
    ['SCHEDULED', 'DEPLOYING'],
    ['DEPLOYING', 'DEPLOYED'],
    ['DEPLOYING', 'DEPLOY_FAILED'],
    ['DEPLOY_FAILED', 'DEPLOYING'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionVersion(from, to)).toBe(true);
  });

  it.each([
    ['DRAFT', 'DEPLOYED'],
    ['IN_REVIEW', 'DEPLOYING'],
    ['REJECTED', 'APPROVED'],
    ['DEPLOYED', 'DRAFT'],
    ['ARCHIVED', 'DEPLOYED'],
  ] as const)('forbids %s -> %s', (from, to) => {
    expect(canTransitionVersion(from, to)).toBe(false);
  });

  it('only permits draft content to be edited', () => {
    expect(editableVersion('DRAFT')).toBe(true);
    expect(editableVersion('IN_REVIEW')).toBe(false);
    expect(editableVersion('DEPLOYED')).toBe(false);
  });
});

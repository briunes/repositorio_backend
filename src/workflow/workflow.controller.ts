import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { WorkflowService } from './workflow.service';

@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post('communications')
  @RequirePermissions('communications.create')
  createCommunication(
    @Body()
    body: {
      code?: string;
      name?: string;
      description?: string;
      channelId?: string;
      ownerTeamId?: string;
      categoryIds?: string[];
      subcategoryIds?: string[];
      serviceIds?: string[];
      tagNames?: string[];
      locale?: string;
      content?: string;
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.createCommunication(body, userId);
  }

  @Get('communication-variables/catalog')
  @RequirePermissions('communications.create')
  variableCatalog(
    @Query('channel') channel = 'SMS',
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.variableCatalog(channel, userId);
  }

  @Get('communications/:communicationId/manage')
  @RequirePermissions('communications.read')
  communication(
    @Param('communicationId') communicationId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.communicationDetail(communicationId, userId);
  }

  @Post('communications/:communicationId/versions')
  @RequirePermissions('communications.draft.create')
  createDraft(
    @Param('communicationId') communicationId: string,
    @Body() body: { sourceVersionId?: string; changeSummary?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.createDraft(communicationId, body, userId);
  }

  @Post('versions/:versionId/submit')
  @RequirePermissions('communications.submit')
  submit(
    @Param('versionId') versionId: string,
    @Body() body: { changeSummary?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.submit(versionId, body, userId);
  }

  @Get('versions/:versionId')
  @RequirePermissions('communications.read')
  version(
    @Param('versionId') versionId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.versionDetail(versionId, userId);
  }

  @Post('versions/:versionId/resume')
  @RequirePermissions('communications.draft.update')
  resume(
    @Param('versionId') versionId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.resumeDraft(versionId, userId);
  }

  @Post('versions/:versionId/rollback-draft')
  @RequirePermissions('communications.draft.create')
  rollbackDraft(
    @Param('versionId') versionId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.rollbackDraft(versionId, userId);
  }

  @Post('versions/:versionId/content')
  @RequirePermissions('communications.draft.update')
  updateDraft(
    @Param('versionId') versionId: string,
    @Body()
    body: {
      expectedUpdatedAt?: string;
      changeSummary?: string;
      localizations?: Array<{
        locale?: string;
        subject?: string | null;
        content?: string | null;
      }>;
      communication?: {
        name?: string;
        description?: string | null;
        categoryIds?: string[];
        subcategoryIds?: string[];
        serviceIds?: string[];
        tagNames?: string[];
      };
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.updateDraft(versionId, body, userId);
  }

  @Get('approvals')
  @RequirePermissions('communications.review')
  approvals(
    @Query('scope')
    scope:
      'assigned-to-me' | 'submitted-by-me' | 'completed' = 'assigned-to-me',
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.approvals(scope, userId);
  }

  @Get('me/tasks')
  @RequirePermissions('communications.read')
  tasks(@Headers('x-repo-user-id') userId?: string) {
    return this.workflow.tasks(userId);
  }

  @Get('approvals/:approvalRequestId')
  @RequirePermissions('communications.review')
  approvalDetail(
    @Param('approvalRequestId') approvalRequestId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.approvalDetail(approvalRequestId, userId);
  }

  @Post('approvals/:approvalRequestId/approve')
  @RequirePermissions('communications.approve')
  approve(
    @Param('approvalRequestId') approvalRequestId: string,
    @Body() body: { comment?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.decide(
      approvalRequestId,
      'APPROVE',
      body.comment,
      userId,
    );
  }

  @Post('approvals/:approvalRequestId/request-changes')
  @RequirePermissions('communications.approve')
  requestChanges(
    @Param('approvalRequestId') approvalRequestId: string,
    @Body() body: { comment?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.decide(
      approvalRequestId,
      'REQUEST_CHANGES',
      body.comment,
      userId,
    );
  }

  @Post('approvals/:approvalRequestId/reject')
  @RequirePermissions('communications.approve')
  reject(
    @Param('approvalRequestId') approvalRequestId: string,
    @Body() body: { comment?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.decide(
      approvalRequestId,
      'REJECT',
      body.comment,
      userId,
    );
  }

  @Post('versions/:versionId/deployments')
  @RequirePermissions('communications.publish')
  deployment(
    @Param('versionId') versionId: string,
    @Body()
    body: {
      targetEnvironment?: string;
      targetSystem?: string;
      scheduledAt?: string;
      idempotencyKey?: string;
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.createDeployment(versionId, body, userId);
  }

  @Get('deployments')
  @RequirePermissions('communications.publish')
  deployments(
    @Query('status')
    status:
      | 'all'
      | 'QUEUED'
      | 'RUNNING'
      | 'SUCCEEDED'
      | 'FAILED'
      | 'CANCELLED' = 'all',
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.deployments(status, userId);
  }

  @Post('deployments/:deploymentId/retry')
  @RequirePermissions('communications.deployment.retry')
  retryDeployment(
    @Param('deploymentId') deploymentId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.retryDeployment(deploymentId, userId);
  }

  @Post('deployments/:deploymentId/cancel')
  @RequirePermissions('communications.publish')
  cancelDeployment(
    @Param('deploymentId') deploymentId: string,
    @Body() body: { reason?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.cancelDeployment(deploymentId, body.reason, userId);
  }

  @Post('versions/:versionId/withdraw')
  @RequirePermissions('communications.submit')
  withdraw(
    @Param('versionId') versionId: string,
    @Body() body: { reason?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.workflow.withdraw(versionId, body.reason, userId);
  }
}

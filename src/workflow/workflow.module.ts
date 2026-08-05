import { Module } from '@nestjs/common';
import { WorkflowAccessService } from './workflow-access.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { DeploymentCallbackController } from './deployment-callback.controller';
import { DeploymentDispatcherService } from './deployment-dispatcher.service';

@Module({
  controllers: [WorkflowController, DeploymentCallbackController],
  providers: [
    WorkflowAccessService,
    WorkflowService,
    DeploymentDispatcherService,
  ],
})
export class WorkflowModule {}

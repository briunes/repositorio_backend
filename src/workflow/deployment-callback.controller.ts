import crypto from 'crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { WorkflowService } from './workflow.service';

@Controller('integrations')
export class DeploymentCallbackController {
  constructor(
    private readonly config: ConfigService,
    private readonly workflow: WorkflowService,
  ) {}

  @Post(':integrationKey/deployment-callback')
  @Public()
  callback(
    @Param('integrationKey') integrationKey: string,
    @Headers('x-deployment-token') suppliedToken: string | undefined,
    @Body()
    body: {
      deploymentId?: string;
      status?: 'SUCCEEDED' | 'FAILED';
      externalReference?: string;
      errorCode?: string;
      errorMessage?: string;
      responseSummary?: Record<string, unknown>;
    },
  ) {
    const expected = this.config.get<string>('DEPLOYMENT_CALLBACK_TOKEN');
    if (!expected) {
      throw new ServiceUnavailableException(
        'Deployment callbacks are not configured.',
      );
    }
    const supplied = suppliedToken ?? '';
    if (
      expected.length !== supplied.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      throw new ForbiddenException('Invalid deployment callback token.');
    }
    return this.workflow.confirmDeployment(integrationKey, body);
  }
}

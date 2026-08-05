import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { WorkflowService } from './workflow.service';

@Injectable()
export class DeploymentDispatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.dispatch(), 15_000);
    this.timer.unref();
    void this.dispatch();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch() {
    const baseUrl = this.config
      .get<string>('DEPLOYMENT_TARGET_BASE_URL')
      ?.replace(/\/$/, '');
    const token = this.config.get<string>('DEPLOYMENT_TARGET_TOKEN');
    if (!baseUrl || !token || this.running) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          status: 'PENDING',
          eventType: 'DEPLOYMENT_QUEUED',
          availableAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      for (const event of events) {
        const payload =
          event.payload &&
          typeof event.payload === 'object' &&
          !Array.isArray(event.payload)
            ? event.payload
            : {};
        const deploymentId =
          typeof payload.deploymentId === 'string' ? payload.deploymentId : '';
        const deployment = deploymentId
          ? await this.prisma.deployment.findUnique({
              where: { id: deploymentId },
            })
          : null;
        if (!deployment || deployment.status !== 'QUEUED') {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'PROCESSED', processedAt: new Date() },
          });
          continue;
        }
        if (deployment.scheduledAt && deployment.scheduledAt > new Date())
          continue;
        const version = await this.prisma.communicationVersion.findUnique({
          where: { id: deployment.versionId },
          include: { localizations: true, variables: true },
        });
        if (!version) continue;
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSING', attempts: { increment: 1 } },
        });
        await this.prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        try {
          const response = await fetch(
            `${baseUrl}/${encodeURIComponent(deployment.targetSystem)}/deployments`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': deployment.idempotencyKey,
              },
              body: JSON.stringify({
                deploymentId: deployment.id,
                environment: deployment.targetEnvironment,
                version: {
                  id: version.id,
                  label: version.version,
                  localizations: version.localizations,
                  variables: version.variables,
                  metadata: version.metadata,
                },
              }),
            },
          );
          if (!response.ok)
            throw new Error(`Target returned HTTP ${response.status}`);
          const result = (await response.json().catch(() => ({}))) as {
            externalReference?: string;
          };
          await this.prisma.deployment.update({
            where: { id: deployment.id },
            data: { externalReference: result.externalReference },
          });
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
              lastError: null,
            },
          });
        } catch (error) {
          await this.workflow.confirmDeployment(deployment.targetSystem, {
            deploymentId: deployment.id,
            status: 'FAILED',
            errorCode: 'DISPATCH_FAILED',
            errorMessage:
              error instanceof Error
                ? error.message
                : 'Deployment dispatch failed',
          });
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'FAILED',
              lastError: (error instanceof Error
                ? error.message
                : 'Deployment dispatch failed'
              ).slice(0, 1000),
            },
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

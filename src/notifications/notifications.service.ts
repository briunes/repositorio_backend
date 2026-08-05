import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.processOutbox(), 30_000);
    this.timer.unref();
    void this.processOutbox();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(gboxUserId?: string) {
    const user = await this.user(gboxUserId);
    const data = await this.prisma.notification.findMany({
      where: { recipientId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { status: true, data };
  }

  async read(notificationId: string, gboxUserId?: string) {
    const user = await this.user(gboxUserId);
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, recipientId: true },
    });
    if (!notification)
      throw new NotFoundException('Notificação não encontrada.');
    if (notification.recipientId !== user.id) throw new ForbiddenException();
    const data = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    return { status: true, data };
  }

  async readAll(gboxUserId?: string) {
    const user = await this.user(gboxUserId);
    await this.prisma.notification.updateMany({
      where: { recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { status: true, data: { read: true } };
  }

  async processOutbox() {
    let events: Array<{
      id: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload: Prisma.JsonValue;
    }> = [];
    try {
      events = await this.prisma.outboxEvent.findMany({
        where: {
          status: 'PENDING',
          eventType: { not: 'DEPLOYMENT_QUEUED' },
          availableAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          payload: true,
        },
      });
    } catch {
      return;
    }
    for (const event of events) {
      try {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSING', attempts: { increment: 1 } },
        });
        const payload = this.object(event.payload);
        const recipients = await this.recipients(event.eventType, payload);
        const content = this.content(event.eventType, payload);
        if (content && recipients.length) {
          await this.prisma.notification.createMany({
            data: recipients.map((recipientId) => ({
              recipientId,
              type: content.type,
              title: content.title,
              message: content.message,
              entityType: event.aggregateType,
              entityId: event.aggregateId,
              actionUrl: content.actionUrl,
              outboxEventId: event.id,
            })),
            skipDuplicates: true,
          });
        }
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            lastError: null,
          },
        });
      } catch (error) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            lastError: (error instanceof Error
              ? error.message
              : 'Unknown error'
            ).slice(0, 1000),
          },
        });
      }
    }
  }

  private async recipients(
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    if (eventType === 'VERSION_SUBMITTED') {
      return this.teamRecipients(
        typeof payload.ownerTeamId === 'string' ? payload.ownerTeamId : '',
        ['APPROVER'],
      );
    }
    const direct = [payload.submittedById, payload.requestedById].filter(
      (value): value is string => typeof value === 'string' && Boolean(value),
    );
    const communicationId =
      typeof payload.communicationId === 'string'
        ? payload.communicationId
        : '';
    if (!communicationId) return [...new Set(direct)];
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { ownerTeamId: true },
    });
    const roles = eventType.startsWith('DEPLOYMENT_')
      ? (['PUBLISHER'] as const)
      : (['EDITOR'] as const);
    const team = communication?.ownerTeamId
      ? await this.teamRecipients(communication.ownerTeamId, [...roles])
      : [];
    return [...new Set([...direct, ...team])];
  }

  private async teamRecipients(
    teamId: string,
    roles: Array<'EDITOR' | 'APPROVER' | 'PUBLISHER'>,
  ) {
    if (!teamId) return [];
    const members = await this.prisma.teamMember.findMany({
      where: {
        teamId,
        role: { in: roles },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { userId: true },
    });
    return [...new Set(members.map(({ userId }) => userId))];
  }

  private content(eventType: string, payload: Record<string, unknown>) {
    const approvalId =
      typeof payload.approvalRequestId === 'string'
        ? payload.approvalRequestId
        : '';
    const deploymentId =
      typeof payload.deploymentId === 'string' ? payload.deploymentId : '';
    const mapping: Partial<
      Record<
        string,
        {
          type: NotificationType;
          title: string;
          message: string;
          actionUrl: string;
        }
      >
    > = {
      VERSION_SUBMITTED: {
        type: 'VERSION_SUBMITTED',
        title: 'Nova versão para revisão',
        message: 'Uma comunicação foi submetida para aprovação.',
        actionUrl: `/internal/my-work/review?id=${encodeURIComponent(approvalId)}`,
      },
      VERSION_APPROVED: {
        type: 'VERSION_APPROVED',
        title: 'Versão aprovada',
        message: 'A versão submetida foi aprovada.',
        actionUrl: '/internal/my-work',
      },
      VERSION_CHANGES_REQUESTED: {
        type: 'CHANGES_REQUESTED',
        title: 'Alterações pedidas',
        message: 'O aprovador pediu alterações à versão.',
        actionUrl: '/internal/my-work',
      },
      VERSION_REJECTED: {
        type: 'VERSION_REJECTED',
        title: 'Versão rejeitada',
        message: 'A versão submetida foi rejeitada.',
        actionUrl: '/internal/my-work',
      },
      DEPLOYMENT_SUCCEEDED: {
        type: 'DEPLOYMENT_SUCCEEDED',
        title: 'Implementação concluída',
        message: 'A nova versão já está ativa.',
        actionUrl: `/internal/deployments?id=${encodeURIComponent(deploymentId)}`,
      },
      DEPLOYMENT_FAILED: {
        type: 'DEPLOYMENT_FAILED',
        title: 'Implementação falhou',
        message:
          'A versão anterior continua ativa. Consulte o erro e tente novamente.',
        actionUrl: `/internal/deployments?id=${encodeURIComponent(deploymentId)}`,
      },
    };
    return mapping[eventType];
  }

  private object(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  private async user(gboxUserId?: string) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const user = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException();
    return user;
  }
}

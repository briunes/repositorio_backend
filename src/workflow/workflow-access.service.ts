import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TeamMemberRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WorkflowAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async user(gboxUserId?: string) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const user = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: { id: true, status: true, username: true, displayName: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Active user access is required.');
    }
    return user;
  }

  async communication(communicationId: string) {
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: {
        id: true,
        code: true,
        name: true,
        ownerTeamId: true,
        channelId: true,
      },
    });
    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');
    if (!communication.ownerTeamId) {
      throw new ForbiddenException(
        'A comunicação tem de receber uma equipa responsável antes de usar o workflow.',
      );
    }
    return communication;
  }

  async requireTeamRole(
    userId: string,
    teamId: string,
    allowedRoles: TeamMemberRole[],
  ) {
    if (await this.isAdmin(userId)) return;
    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        teamId,
        role: { in: allowedRoles },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'A função necessária na equipa não está atribuída.',
      );
    }
  }

  private async isAdmin(userId: string) {
    const role = await this.prisma.role.findUnique({
      where: { key: 'admin' },
      select: { id: true },
    });
    if (!role) return false;
    return Boolean(
      await this.prisma.userRole.findFirst({
        where: { userId, roleId: role.id },
        select: { userId: true },
      }),
    );
  }
}

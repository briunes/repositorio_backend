import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma, TeamMemberRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const TEAM_ROLES = new Set<TeamMemberRole>([
  'VIEWER',
  'EDITOR',
  'APPROVER',
  'PUBLISHER',
  'OWNER',
]);

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(gboxUserId?: string) {
    const actor = await this.requireUser(gboxUserId);
    const [memberships, teams] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { userId: actor.id },
        select: { teamId: true, role: true, expiresAt: true },
      }),
      this.prisma.team.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          isActive: true,
          requiredApprovals: true,
          allowSelfApproval: true,
          approvalExpiresDays: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    const now = Date.now();
    const rolesByTeam = new Map<string, TeamMemberRole[]>();
    for (const membership of memberships) {
      if (membership.expiresAt && membership.expiresAt.getTime() <= now)
        continue;
      rolesByTeam.set(membership.teamId, [
        ...(rolesByTeam.get(membership.teamId) ?? []),
        membership.role,
      ]);
    }
    return {
      status: true,
      data: teams.map((team) => ({
        ...team,
        myRoles: rolesByTeam.get(team.id) ?? [],
      })),
    };
  }

  async detail(teamId: string, gboxUserId?: string) {
    await this.requireUser(gboxUserId);
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        requiredApprovals: true,
        allowSelfApproval: true,
        approvalExpiresDays: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!team) throw new NotFoundException('Equipa não encontrada.');
    const [memberCount, communicationCount] = await Promise.all([
      this.prisma.teamMember.count({ where: { teamId } }),
      this.prisma.communication.count({ where: { ownerTeamId: teamId } }),
    ]);
    return { status: true, data: { ...team, memberCount, communicationCount } };
  }

  async unownedCommunications(gboxUserId?: string) {
    await this.requireUser(gboxUserId);
    const data = await this.prisma.communication.findMany({
      where: { ownerTeamId: null },
      orderBy: [{ channelId: 'asc' }, { name: 'asc' }],
      take: 500,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        channel: { select: { key: true, name: true } },
        updatedAt: true,
      },
    });
    return { status: true, data };
  }

  async create(
    body: { name?: string; description?: string },
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    const name = this.requiredName(body.name);
    const slug = this.slug(name);
    const existing = await this.prisma.team.findFirst({
      where: { OR: [{ name }, { slug }] },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('Já existe uma equipa com este nome.');

    const team = await this.prisma.team.create({
      data: {
        name,
        slug,
        description: this.optionalText(body.description, 500),
        members: {
          create: { userId: actor.id, role: 'OWNER', assignedById: actor.id },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
      },
    });
    await this.audit(actor.id, 'CREATE', team.id, { name, ownerId: actor.id });
    return { status: true, data: team };
  }

  async update(
    teamId: string,
    body: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
      requiredApprovals?: number;
      allowSelfApproval?: boolean;
      approvalExpiresDays?: number | null;
    },
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    const existing = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, isActive: true },
    });
    if (!existing) throw new NotFoundException('Equipa não encontrada.');
    if (body.isActive === false) {
      const owned = await this.prisma.communication.count({
        where: { ownerTeamId: teamId, status: { not: 'INACTIVE' } },
      });
      if (owned) {
        throw new ConflictException(
          'Transfira as comunicações ativas antes de desativar a equipa.',
        );
      }
    }
    if (
      body.requiredApprovals !== undefined &&
      (!Number.isInteger(body.requiredApprovals) ||
        body.requiredApprovals < 1 ||
        body.requiredApprovals > 10)
    ) {
      throw new BadRequestException(
        'O número de aprovações deve estar entre 1 e 10.',
      );
    }
    if (
      body.approvalExpiresDays !== undefined &&
      body.approvalExpiresDays !== null &&
      (!Number.isInteger(body.approvalExpiresDays) ||
        body.approvalExpiresDays < 1 ||
        body.approvalExpiresDays > 365)
    ) {
      throw new BadRequestException(
        'A validade da aprovação deve estar entre 1 e 365 dias.',
      );
    }
    const name =
      body.name === undefined ? undefined : this.requiredName(body.name);
    const data: Prisma.TeamUpdateInput = {
      name,
      slug: name ? this.slug(name) : undefined,
      description:
        body.description === undefined
          ? undefined
          : this.optionalText(body.description, 500),
      isActive: body.isActive,
      requiredApprovals: body.requiredApprovals,
      allowSelfApproval: body.allowSelfApproval,
      approvalExpiresDays: body.approvalExpiresDays,
    };
    const team = await this.prisma.team.update({
      where: { id: teamId },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
        requiredApprovals: true,
        allowSelfApproval: true,
        approvalExpiresDays: true,
      },
    });
    await this.audit(actor.id, 'UPDATE', teamId, {
      previous: existing,
      current: team,
    });
    return { status: true, data: team };
  }

  async members(teamId: string, gboxUserId?: string) {
    await this.requireUser(gboxUserId);
    await this.requireTeam(teamId);
    const assignments = await this.prisma.teamMember.findMany({
      where: { teamId },
      orderBy: [{ assignedAt: 'asc' }],
      select: {
        userId: true,
        role: true,
        assignedAt: true,
        expiresAt: true,
      },
    });
    const users = assignments.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: [...new Set(assignments.map(({ userId }) => userId))] },
          },
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            avatarUrl: true,
            status: true,
          },
        })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const grouped = new Map<
      string,
      {
        user: (typeof users)[number];
        roles: TeamMemberRole[];
        assignedAt: Date;
        expiresAt: Date | null;
      }
    >();
    for (const assignment of assignments) {
      const user = usersById.get(assignment.userId);
      if (!user) continue;
      const current = grouped.get(user.id);
      grouped.set(user.id, {
        user,
        roles: [...(current?.roles ?? []), assignment.role],
        assignedAt: current?.assignedAt ?? assignment.assignedAt,
        expiresAt: assignment.expiresAt,
      });
    }
    return { status: true, data: [...grouped.values()] };
  }

  async communications(teamId: string, gboxUserId?: string) {
    await this.requireUser(gboxUserId);
    await this.requireTeam(teamId);
    const data = await this.prisma.communication.findMany({
      where: { ownerTeamId: teamId },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        channel: { select: { key: true, name: true } },
        updatedAt: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, version: true, status: true, updatedAt: true },
        },
      },
    });
    return { status: true, data };
  }

  async transferCommunication(
    communicationId: string,
    teamId: string,
    rawReason: string | undefined,
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    const target = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true, isActive: true },
    });
    if (!target || !target.isActive) {
      throw new BadRequestException('A equipa de destino não está ativa.');
    }
    const communication = await this.prisma.communication.findUnique({
      where: { id: communicationId },
      select: { id: true, ownerTeamId: true, name: true },
    });
    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');
    if (communication.ownerTeamId === teamId) {
      return { status: true, data: communication };
    }
    const reason = rawReason?.trim();
    if (communication.ownerTeamId && !reason) {
      throw new BadRequestException('O motivo da transferência é obrigatório.');
    }
    const activeWorkflow = await this.prisma.communicationVersion.findFirst({
      where: {
        communicationId,
        status: { in: ['IN_REVIEW', 'APPROVED', 'SCHEDULED', 'DEPLOYING'] },
      },
      select: { id: true, status: true },
    });
    if (activeWorkflow) {
      throw new ConflictException(
        'Conclua ou cancele o workflow ativo antes de transferir a comunicação.',
      );
    }
    const updated = await this.prisma.communication.update({
      where: { id: communicationId },
      data: { ownerTeamId: teamId },
      select: { id: true, name: true, ownerTeamId: true, updatedAt: true },
    });
    await this.audit(actor.id, 'TRANSFER', teamId, {
      communicationId,
      previousOwnerTeamId: communication.ownerTeamId,
      ownerTeamId: teamId,
      reason: reason || 'Atribuição inicial',
    });
    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'OWNERSHIP_CHANGED',
        aggregateType: 'communication',
        aggregateId: communicationId,
        payload: {
          communicationId,
          previousOwnerTeamId: communication.ownerTeamId,
          ownerTeamId: teamId,
          actorId: actor.id,
        },
      },
    });
    return { status: true, data: updated };
  }

  async addMember(
    teamId: string,
    body: { userId?: string; roles?: TeamMemberRole[]; expiresAt?: string },
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    await this.requireTeam(teamId);
    const member = await this.requireMemberUser(body.userId);
    const roles = this.roles(body.roles);
    const expiresAt = this.expiry(body.expiresAt);
    await this.prisma.teamMember.createMany({
      data: roles.map((role) => ({
        teamId,
        userId: member.id,
        role,
        assignedById: actor.id,
        expiresAt,
      })),
      skipDuplicates: true,
    });
    await this.audit(actor.id, 'ASSIGN', teamId, {
      memberUserId: member.id,
      roles,
      expiresAt,
    });
    return this.members(teamId, gboxUserId);
  }

  async updateMember(
    teamId: string,
    memberUserId: string,
    body: { roles?: TeamMemberRole[]; expiresAt?: string | null },
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    await this.requireTeam(teamId);
    await this.requireMemberUser(memberUserId);
    const roles = this.roles(body.roles);
    const existing = await this.prisma.teamMember.findMany({
      where: { teamId, userId: memberUserId },
      select: { role: true, expiresAt: true },
    });
    if (!existing.length)
      throw new NotFoundException('Membro da equipa não encontrado.');
    await this.assertOwnerRemains(teamId, memberUserId, roles);
    const expiresAt = this.expiry(body.expiresAt);
    await this.prisma.teamMember.deleteMany({
      where: { teamId, userId: memberUserId },
    });
    await this.prisma.teamMember.createMany({
      data: roles.map((role) => ({
        teamId,
        userId: memberUserId,
        role,
        assignedById: actor.id,
        expiresAt,
      })),
    });
    await this.audit(actor.id, 'UPDATE', teamId, {
      memberUserId,
      previousRoles: existing.map(({ role }) => role),
      roles,
      expiresAt,
    });
    return this.members(teamId, gboxUserId);
  }

  async removeMember(
    teamId: string,
    memberUserId: string,
    gboxUserId?: string,
  ) {
    const actor = await this.requireUser(gboxUserId);
    await this.requireTeam(teamId);
    const existing = await this.prisma.teamMember.findMany({
      where: { teamId, userId: memberUserId },
      select: { role: true },
    });
    if (!existing.length)
      throw new NotFoundException('Membro da equipa não encontrado.');
    await this.assertOwnerRemains(teamId, memberUserId, []);
    await this.prisma.teamMember.deleteMany({
      where: { teamId, userId: memberUserId },
    });
    await this.audit(actor.id, 'UNASSIGN', teamId, {
      memberUserId,
      roles: existing.map(({ role }) => role),
    });
    return { status: true, data: { removed: true } };
  }

  private async assertOwnerRemains(
    teamId: string,
    memberUserId: string,
    nextRoles: TeamMemberRole[],
  ) {
    if (nextRoles.includes('OWNER')) return;
    const wasOwner = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: memberUserId, role: 'OWNER' },
      select: { id: true },
    });
    if (!wasOwner) return;
    const otherOwner = await this.prisma.teamMember.findFirst({
      where: { teamId, role: 'OWNER', userId: { not: memberUserId } },
      select: { id: true },
    });
    if (!otherOwner) {
      throw new ConflictException(
        'A equipa tem de manter pelo menos um responsável.',
      );
    }
  }

  private async requireUser(gboxUserId?: string) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const user = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Active user access is required.');
    }
    return user;
  }

  private async requireMemberUser(userId?: string) {
    if (!userId) throw new BadRequestException('O utilizador é obrigatório.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('Utilizador não encontrado.');
    if (user.status !== 'ACTIVE')
      throw new BadRequestException('O utilizador não está ativo.');
    return user;
  }

  private async requireTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!team) throw new NotFoundException('Equipa não encontrada.');
    return team;
  }

  private roles(input?: TeamMemberRole[]) {
    const roles = [...new Set(input ?? [])];
    if (!roles.length || roles.some((role) => !TEAM_ROLES.has(role))) {
      throw new BadRequestException('Selecione pelo menos uma função válida.');
    }
    return roles;
  }

  private expiry(input?: string | null) {
    if (!input) return null;
    const value = new Date(input);
    if (Number.isNaN(value.getTime()) || value <= new Date()) {
      throw new BadRequestException('A validade do acesso não é válida.');
    }
    return value;
  }

  private requiredName(input?: string) {
    const value = input?.trim();
    if (!value)
      throw new BadRequestException('O nome da equipa é obrigatório.');
    if (value.length > 120)
      throw new BadRequestException('O nome da equipa é demasiado longo.');
    return value;
  }

  private optionalText(input: string | null | undefined, maximum: number) {
    const value = input?.trim() || null;
    if (value && value.length > maximum) {
      throw new BadRequestException('O texto é demasiado longo.');
    }
    return value;
  }

  private slug(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private audit(
    actorId: string,
    action: AuditAction,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({
      data: { actorId, action, entityType: 'team', entityId, changes },
    });
  }
}

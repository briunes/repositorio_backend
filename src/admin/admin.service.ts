import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TeamMemberRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { VersionService } from '../version/version.service';

type ReleaseBlock = {
  title: string;
  description: string;
  imageUrl?: string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: VersionService,
  ) {}

  async users() {
    const data = await this.prisma.user.findMany({
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        email: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: {
          select: { role: { select: { id: true, key: true, name: true } } },
        },
        teamMemberships: {
          select: {
            role: true,
            team: { select: { id: true, name: true, isActive: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
    });
    return { status: true, data };
  }

  async roles() {
    const data = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        _count: { select: { users: true } },
        permissions: {
          select: {
            permission: { select: { id: true, key: true, description: true } },
          },
          orderBy: { permission: { key: 'asc' } },
        },
      },
    });
    return { status: true, data };
  }

  async permissions() {
    const data = await this.prisma.permission.findMany({
      orderBy: { key: 'asc' },
    });
    return { status: true, data };
  }

  async updateUserRoles(userId: string, roleIds: string[] = []) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Utilizador não encontrado.');
    const uniqueRoleIds = [...new Set(roleIds)];
    await this.assertPermissionsExist('role', uniqueRoleIds);
    await this.prisma.userRole.deleteMany({ where: { userId } });
    if (uniqueRoleIds.length) {
      await this.prisma.userRole.createMany({
        data: uniqueRoleIds.map((roleId) => ({ userId, roleId })),
      });
    }
    return { status: true, data: { userId, roleIds: uniqueRoleIds } };
  }

  async updateUserTeam(
    userId: string,
    teamId?: string | null,
    role: TeamMemberRole = 'VIEWER',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Utilizador não encontrado.');
    const allowedRoles = new Set<TeamMemberRole>([
      'VIEWER',
      'EDITOR',
      'APPROVER',
      'PUBLISHER',
      'OWNER',
    ]);
    if (!allowedRoles.has(role))
      throw new BadRequestException('Função na equipa inválida.');
    if (teamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, isActive: true },
      });
      if (!team) throw new NotFoundException('Equipa não encontrada.');
      if (!team.isActive)
        throw new BadRequestException('A equipa selecionada está inativa.');
    }
    await this.prisma.teamMember.deleteMany({ where: { userId } });
    if (teamId) {
      await this.prisma.teamMember.create({ data: { userId, teamId, role } });
    }
    return { status: true, data: { userId, teamId: teamId || null, role: teamId ? role : null } };
  }

  async updateUser(
    userId: string,
    body: { name?: string; avatarUrl?: string | null },
  ) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome é obrigatório.');
    if (name.length > 160)
      throw new BadRequestException('O nome é demasiado longo.');
    const avatarUrl = body.avatarUrl?.trim() || null;
    if (
      avatarUrl &&
      (!/^data:image\/(?:jpeg|png|webp);base64,/.test(avatarUrl) ||
        avatarUrl.length > 1_500_000)
    ) {
      throw new BadRequestException('A fotografia é inválida ou demasiado grande.');
    }
    try {
      const data = await this.prisma.user.update({
        where: { id: userId },
        data: { displayName: name, avatarUrl },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          email: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          roles: {
            select: { role: { select: { id: true, key: true, name: true } } },
          },
          teamMemberships: {
            select: {
              role: true,
              team: { select: { id: true, name: true, isActive: true } },
            },
            orderBy: { assignedAt: 'asc' },
          },
        },
      });
      return { status: true, data };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Utilizador não encontrado.');
      }
      throw error;
    }
  }

  async createRole(body: {
    name?: string;
    description?: string;
    permissionIds?: string[];
  }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome da função é obrigatório.');
    const permissionIds = [...new Set(body.permissionIds ?? [])];
    await this.assertPermissionsExist('permission', permissionIds);
    const key = `custom-${this.slug(name)}-${Date.now().toString(36)}`;
    const role = await this.prisma.role.create({
      data: {
        key,
        name,
        description: body.description?.trim() || null,
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      select: { id: true },
    });
    return { status: true, data: role };
  }

  async updateRole(
    id: string,
    body: { name?: string; description?: string; permissionIds?: string[] },
  ) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Função não encontrada.');
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome da função é obrigatório.');
    const permissionIds = [...new Set(body.permissionIds ?? [])];
    await this.assertPermissionsExist('permission', permissionIds);
    await this.prisma.role.update({
      where: { id },
      data: { name, description: body.description?.trim() || null },
    });
    await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissionIds.length) {
      await this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: id,
          permissionId,
        })),
      });
    }
    return { status: true, data: { id } };
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { isSystem: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Função não encontrada.');
    if (role.isSystem)
      throw new ConflictException(
        'As funções de sistema não podem ser eliminadas.',
      );
    if (role._count.users)
      throw new ConflictException(
        'Remova esta função dos utilizadores antes de a eliminar.',
      );
    await this.prisma.role.delete({ where: { id } });
    return { status: true, data: { id } };
  }

  async syncRuns() {
    const data = await this.prisma.syncRun.findMany({
      take: 100,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        source: true,
        status: true,
        communications: true,
        versions: true,
        details: true,
        detailErrors: true,
        error: true,
        startedAt: true,
        completedAt: true,
      },
    });
    return { status: true, data };
  }

  async settings() {
    const data = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', appVersion: '1.0.0' },
      select: this.settingsSelection(),
    });
    return { status: true, data };
  }

  async updateVersion(version?: string) {
    const normalized = version?.trim();
    if (
      !normalized ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)
    )
      throw new BadRequestException(
        'Indique uma versão válida, por exemplo 1.2.3.',
      );
    const data = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      update: { appVersion: normalized },
      create: { id: 'default', appVersion: normalized },
      select: this.settingsSelection(),
    });
    this.versions.invalidate();
    return { status: true, data };
  }

  async updateSettings(body: Record<string, unknown>) {
    const defaultView = this.oneOf(
      body.defaultView,
      ['all', 'email', 'sms', 'letter', 'push'],
      'Vista predefinida',
    );
    const defaultSort = this.oneOf(
      body.defaultSort,
      ['name-asc', 'name-desc', 'date-desc', 'date-asc'],
      'Ordenação predefinida',
    );
    const defaultPageSize = this.integer(
      body.defaultPageSize,
      12,
      200,
      'Registos por página',
    );
    const sessionDurationMinutes = this.integer(
      body.sessionDurationMinutes,
      15,
      1440,
      'Duração da sessão',
    );
    const idleTimeoutMinutes = this.integer(
      body.idleTimeoutMinutes,
      5,
      sessionDurationMinutes,
      'Tempo de inatividade',
    );
    const environmentName = this.text(body.environmentName, 80, 'Ambiente');
    const maintenanceMessage =
      typeof body.maintenanceMessage === 'string'
        ? body.maintenanceMessage.trim().slice(0, 500) || null
        : null;
    const data = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      update: {
        defaultView,
        defaultSort,
        defaultPageSize,
        showInactive: Boolean(body.showInactive),
        sessionDurationMinutes,
        idleTimeoutMinutes,
        maintenanceMode: Boolean(body.maintenanceMode),
        readOnlyMode: Boolean(body.readOnlyMode),
        fullSmsEditingEnabled: Boolean(body.fullSmsEditingEnabled),
        myWorkEnabled: Boolean(body.myWorkEnabled),
        notificationsEnabled: Boolean(body.notificationsEnabled),
        maintenanceMessage,
        environmentName,
      },
      create: {
        id: 'default',
        appVersion: '1.0.0',
        defaultView,
        defaultSort,
        defaultPageSize,
        showInactive: Boolean(body.showInactive),
        sessionDurationMinutes,
        idleTimeoutMinutes,
        maintenanceMode: Boolean(body.maintenanceMode),
        readOnlyMode: Boolean(body.readOnlyMode),
        fullSmsEditingEnabled: Boolean(body.fullSmsEditingEnabled),
        myWorkEnabled: Boolean(body.myWorkEnabled),
        notificationsEnabled: Boolean(body.notificationsEnabled),
        maintenanceMessage,
        environmentName,
      },
      select: this.settingsSelection(),
    });
    return { status: true, data };
  }

  async changelog() {
    const data = await this.prisma.releaseNote.findMany({
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return { status: true, data };
  }

  async createRelease(body: Record<string, unknown>) {
    const input = this.releaseInput(body);
    const data = await this.prisma.releaseNote.create({
      data: { ...input, publishedAt: input.published ? new Date() : null },
    });
    return { status: true, data };
  }

  async updateRelease(id: string, body: Record<string, unknown>) {
    const input = this.releaseInput(body);
    const existing = await this.prisma.releaseNote.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Novidade não encontrada.');
    const data = await this.prisma.releaseNote.update({
      where: { id },
      data: {
        ...input,
        publishedAt: input.published
          ? (existing.publishedAt ?? new Date())
          : null,
      },
    });
    return { status: true, data };
  }

  async deleteRelease(id: string) {
    await this.prisma.releaseNote.delete({ where: { id } });
    return { status: true, data: { id } };
  }

  private settingsSelection() {
    return {
      appVersion: true,
      defaultView: true,
      defaultPageSize: true,
      defaultSort: true,
      showInactive: true,
      sessionDurationMinutes: true,
      idleTimeoutMinutes: true,
      maintenanceMode: true,
      readOnlyMode: true,
      fullSmsEditingEnabled: true,
      myWorkEnabled: true,
      notificationsEnabled: true,
      maintenanceMessage: true,
      environmentName: true,
      updatedAt: true,
    } as const;
  }

  private releaseInput(body: Record<string, unknown>) {
    const version = this.text(body.version, 40, 'Versão');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
      throw new BadRequestException('Indique uma versão válida.');
    const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
    const blocks: ReleaseBlock[] = rawBlocks.map((value) => {
      if (!value || typeof value !== 'object')
        throw new BadRequestException('Conteúdo da novidade inválido.');
      const block = value as Record<string, unknown>;
      return {
        title: this.text(block.title, 160, 'Título da funcionalidade'),
        description: this.text(
          block.description,
          1000,
          'Descrição da funcionalidade',
        ),
        ...(typeof block.imageUrl === 'string' && block.imageUrl.trim()
          ? { imageUrl: block.imageUrl.trim().slice(0, 2000) }
          : {}),
      };
    });
    if (!blocks.length)
      throw new BadRequestException('Adicione pelo menos uma funcionalidade.');
    return {
      version,
      title: this.text(body.title, 180, 'Título'),
      summary: this.text(body.summary, 600, 'Resumo'),
      heroImageUrl:
        typeof body.heroImageUrl === 'string'
          ? body.heroImageUrl.trim().slice(0, 2000) || null
          : null,
      blocks,
      published: Boolean(body.published),
    };
  }

  private text(value: unknown, max: number, label: string) {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`${label} é obrigatório.`);
    return value.trim().slice(0, max);
  }

  private integer(value: unknown, min: number, max: number, label: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max)
      throw new BadRequestException(
        `${label} deve estar entre ${min} e ${max}.`,
      );
    return number;
  }

  private oneOf(value: unknown, allowed: string[], label: string) {
    if (typeof value !== 'string' || !allowed.includes(value))
      throw new BadRequestException(`${label} é inválida.`);
    return value;
  }

  private async assertPermissionsExist(
    model: 'role' | 'permission',
    ids: string[],
  ) {
    if (!ids.length) return;
    const count =
      model === 'role'
        ? await this.prisma.role.count({ where: { id: { in: ids } } })
        : await this.prisma.permission.count({ where: { id: { in: ids } } });
    if (count !== ids.length)
      throw new BadRequestException(
        model === 'role'
          ? 'Uma ou mais funções são inválidas.'
          : 'Uma ou mais permissões são inválidas.',
      );
  }

  private slug(value: string) {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'role'
    );
  }
}

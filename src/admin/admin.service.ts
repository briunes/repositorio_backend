import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async users() {
    const data = await this.prisma.user.findMany({
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
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
          select: { permission: { select: { id: true, key: true, description: true } } },
          orderBy: { permission: { key: 'asc' } },
        },
      },
    });
    return { status: true, data };
  }

  async permissions() {
    const data = await this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
    return { status: true, data };
  }

  async updateUserRoles(userId: string, roleIds: string[] = []) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Utilizador não encontrado.');
    const uniqueRoleIds = [...new Set(roleIds)];
    await this.assertPermissionsExist('role', uniqueRoleIds);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...(uniqueRoleIds.length ? [this.prisma.userRole.createMany({ data: uniqueRoleIds.map((roleId) => ({ userId, roleId })) })] : []),
    ]);
    return { status: true, data: { userId, roleIds: uniqueRoleIds } };
  }

  async createRole(body: { name?: string; description?: string; permissionIds?: string[] }) {
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
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      select: { id: true },
    });
    return { status: true, data: role };
  }

  async updateRole(id: string, body: { name?: string; description?: string; permissionIds?: string[] }) {
    const role = await this.prisma.role.findUnique({ where: { id }, select: { id: true } });
    if (!role) throw new NotFoundException('Função não encontrada.');
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome da função é obrigatório.');
    const permissionIds = [...new Set(body.permissionIds ?? [])];
    await this.assertPermissionsExist('permission', permissionIds);
    await this.prisma.$transaction([
      this.prisma.role.update({ where: { id }, data: { name, description: body.description?.trim() || null } }),
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...(permissionIds.length ? [this.prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) })] : []),
    ]);
    return { status: true, data: { id } };
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, select: { isSystem: true, _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('Função não encontrada.');
    if (role.isSystem) throw new ConflictException('As funções de sistema não podem ser eliminadas.');
    if (role._count.users) throw new ConflictException('Remova esta função dos utilizadores antes de a eliminar.');
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

  private async assertPermissionsExist(model: 'role' | 'permission', ids: string[]) {
    if (!ids.length) return;
    const count = model === 'role'
      ? await this.prisma.role.count({ where: { id: { in: ids } } })
      : await this.prisma.permission.count({ where: { id: { in: ids } } });
    if (count !== ids.length) throw new BadRequestException(model === 'role' ? 'Uma ou mais funções são inválidas.' : 'Uma ou mais permissões são inválidas.');
  }

  private slug(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'role';
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const gboxUserId = request.headers['x-repo-user-id'];
    if (typeof gboxUserId !== 'string' || !gboxUserId) {
      throw new UnauthorizedException('User is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Active user access is required.');
    }

    const assignments = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      select: { roleId: true },
    });
    if (!assignments.length) {
      throw new ForbiddenException('Required permission is missing.');
    }

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: assignments.map(({ roleId }) => roleId) } },
      select: { permissionId: true },
    });
    const permissions = rolePermissions.length
      ? await this.prisma.permission.findMany({
          where: {
            id: {
              in: rolePermissions.map(({ permissionId }) => permissionId),
            },
          },
          select: { key: true },
        })
      : [];
    const granted = new Set(permissions.map(({ key }) => key));
    if (required.every((permission) => granted.has(permission))) return true;
    throw new ForbiddenException('Required permission is missing.');
  }
}

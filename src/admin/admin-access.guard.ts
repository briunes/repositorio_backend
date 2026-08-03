import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const gboxUserId = request.headers['x-repo-user-id'];
    if (typeof gboxUserId !== 'string' || !gboxUserId) {
      throw new UnauthorizedException('User is required.');
    }

    // Keep these as flat queries: the Supabase Data API adapter does not
    // support Prisma's nested relation filters (for example `roles.some`).
    const [user, adminRole] = await Promise.all([
      this.prisma.user.findUnique({
        where: { gboxUserId },
        select: { id: true, status: true },
      }),
      this.prisma.role.findUnique({
        where: { key: 'admin' },
        select: { id: true },
      }),
    ]);
    if (!user || user.status !== 'ACTIVE' || !adminRole) {
      throw new ForbiddenException('Administrator access is required.');
    }

    const assignment = await this.prisma.userRole.findFirst({
      where: { userId: user.id, roleId: adminRole.id },
      select: { userId: true },
    });
    if (!assignment)
      throw new ForbiddenException('Administrator access is required.');
    return true;
  }
}

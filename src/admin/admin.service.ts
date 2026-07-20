import { Injectable } from '@nestjs/common';
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
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const FALLBACK_VERSION = '1.0.0';
const CACHE_TTL_MS = 5_000;

@Injectable()
export class VersionService {
  private cache?: { version: string; expiresAt: number };

  constructor(private readonly prisma: PrismaService) {}

  async current() {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.version;
    }

    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
      select: { appVersion: true },
    });
    const version = config?.appVersion ?? FALLBACK_VERSION;
    this.cache = { version, expiresAt: Date.now() + CACHE_TTL_MS };
    return version;
  }
}

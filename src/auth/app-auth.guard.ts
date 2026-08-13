import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppTokenService } from './app-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AppTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    if (!token) throw new UnauthorizedException('App token is required.');
    const { claims, renewedToken } = await this.tokens.authenticate(token, {
      ipAddress: this.ipAddress(request),
      userAgent: request.get('user-agent')?.slice(0, 500),
    });
    if (renewedToken) response.setHeader('X-Repo-Access-Token', renewedToken);
    request.headers['x-repo-user-id'] = claims.sub;
    request.headers['x-repo-session-id'] = claims.sid;
    await this.enforceOperationalMode(request, claims.sub);
    return true;
  }

  private ipAddress(request: Request) {
    const forwarded = request.get('x-forwarded-for')?.split(',')[0]?.trim();
    return (forwarded || request.ip || request.socket.remoteAddress)?.slice(
      0,
      45,
    );
  }

  private async enforceOperationalMode(request: Request, gboxUserId: string) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const settingsRequest = request.originalUrl.includes('/admin/settings');
    if (settingsRequest) return;
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
      select: { maintenanceMode: true, readOnlyMode: true },
    });
    if (!config?.maintenanceMode && !config?.readOnlyMode) return;
    if (
      request.originalUrl.includes('/admin/') &&
      (await this.isAdmin(gboxUserId))
    )
      return;
    if (config.maintenanceMode)
      throw new ServiceUnavailableException(
        'A aplicação encontra-se em manutenção.',
      );
    throw new ForbiddenException(
      'A aplicação encontra-se em modo só de leitura.',
    );
  }

  private async isAdmin(gboxUserId: string) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { gboxUserId },
        select: { id: true },
      }),
      this.prisma.role.findUnique({
        where: { key: 'admin' },
        select: { id: true },
      }),
    ]);
    if (!user || !role) return false;
    return Boolean(
      await this.prisma.userRole.findFirst({
        where: { userId: user.id, roleId: role.id },
        select: { userId: true },
      }),
    );
  }
}

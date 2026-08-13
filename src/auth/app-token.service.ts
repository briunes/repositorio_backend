import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

type AppTokenClaims = {
  sub: string;
  username: string;
  sid: string;
  iat: number;
  exp: number;
  iss: 'repositorio-comunicacoes';
};

export type SessionRequestMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

const RENEWAL_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AppTokenService {
  private readonly secret?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.secret = config.get<string>('APP_TOKEN_SECRET');
  }

  async createSession(
    userId: string | number,
    username: string,
    lifetimeSeconds: number,
    metadata: SessionRequestMetadata,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { gboxUserId: String(userId) },
      select: { id: true },
    });
    if (!user) {
      throw new ServiceUnavailableException(
        'The authenticated user does not have a local profile.',
      );
    }
    const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000);
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
      select: { id: true },
    });
    return this.issue(userId, username, session.id, expiresAt);
  }

  async authenticate(token: string, metadata: SessionRequestMetadata) {
    const claims = this.verifySignature(token);
    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        lastActivityAt: true,
        user: { select: { gboxUserId: true, status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.user.status !== 'ACTIVE' ||
      session.user.gboxUserId !== claims.sub
    ) {
      throw new UnauthorizedException('App session is invalid or revoked.');
    }

    const now = new Date();
    const graceEndsAt = new Date(
      session.expiresAt.getTime() + RENEWAL_WINDOW_SECONDS * 1000,
    );
    if (now > graceEndsAt) {
      throw new UnauthorizedException('App session expired.');
    }

    const renewalStartsAt = new Date(
      session.expiresAt.getTime() - RENEWAL_WINDOW_SECONDS * 1000,
    );
    const shouldRenew = now >= renewalStartsAt;
    const expiresAt = shouldRenew
      ? new Date(now.getTime() + RENEWAL_WINDOW_SECONDS * 1000)
      : session.expiresAt;
    const shouldTouch =
      shouldRenew || now.getTime() - session.lastActivityAt.getTime() >= 60_000;

    if (shouldTouch) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          lastActivityAt: now,
          expiresAt,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
    }

    return {
      claims,
      renewedToken: shouldRenew
        ? this.issue(claims.sub, claims.username, session.id, expiresAt)
        : undefined,
    };
  }

  private issue(
    userId: string | number,
    username: string,
    sessionId: string,
    expiresAt: Date,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const claims: AppTokenClaims = {
      sub: String(userId),
      username,
      sid: sessionId,
      iat: now,
      exp: Math.floor(expiresAt.getTime() / 1000),
      iss: 'repositorio-comunicacoes',
    };
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode(claims);
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }

  private verifySignature(token: string): AppTokenClaims {
    const [header, payload, signature, extra] = token.split('.');
    if (!header || !payload || !signature || extra)
      throw new UnauthorizedException('Invalid app token.');
    const expected = Buffer.from(this.sign(`${header}.${payload}`));
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid app token.');
    }
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as AppTokenClaims;
      if (
        claims.iss !== 'repositorio-comunicacoes' ||
        !claims.sub ||
        !claims.sid ||
        !Number.isFinite(claims.exp)
      ) {
        throw new Error('invalid');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('App token is invalid.');
    }
  }

  private encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private sign(value: string) {
    if (!this.secret || this.secret.length < 32) {
      throw new ServiceUnavailableException(
        'APP_TOKEN_SECRET must contain at least 32 characters.',
      );
    }
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }
}

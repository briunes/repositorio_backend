import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type AppTokenClaims = {
  sub: string;
  username: string;
  iat: number;
  exp: number;
  iss: 'repositorio-comunicacoes';
};

@Injectable()
export class AppTokenService {
  private readonly secret?: string;
  private readonly lifetimeSeconds: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('APP_TOKEN_SECRET');
    this.lifetimeSeconds = Number(
      config.get('APP_TOKEN_TTL_SECONDS') ?? 8 * 60 * 60,
    );
  }

  issue(userId: string | number, username: string) {
    const now = Math.floor(Date.now() / 1000);
    const claims: AppTokenClaims = {
      sub: String(userId),
      username,
      iat: now,
      exp: now + this.lifetimeSeconds,
      iss: 'repositorio-comunicacoes',
    };
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode(claims);
    return `${header}.${payload}.${this.sign(`${header}.${payload}`)}`;
  }

  verify(token: string): AppTokenClaims {
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
        claims.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new Error('expired');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('App token expired or invalid.');
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

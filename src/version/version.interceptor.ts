import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { VersionService } from './version.service';

export const APP_VERSION_HEADER = 'x-repositorio-app-version';

function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

@Injectable()
export class VersionInterceptor implements NestInterceptor {
  constructor(private readonly versions: VersionService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const frontendVersion = request.header(APP_VERSION_HEADER)?.trim();

    if (frontendVersion && request.path !== '/version') {
      const currentVersion = await this.versions.current();

      if (compareVersions(frontendVersion, currentVersion) < 0) {
        throw new ConflictException({
          status: false,
          appVersion: currentVersion,
          error: {
            code: 'APP_VERSION_OUTDATED',
            message: 'A newer application version is available.',
            details: { frontendVersion, currentVersion },
          },
        });
      }
    }

    return next.handle();
  }
}

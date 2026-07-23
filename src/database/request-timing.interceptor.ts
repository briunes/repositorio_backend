import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { currentRequestTiming, withRequestTiming } from './request-timing';

@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return new Observable((subscriber) =>
      withRequestTiming(() =>
        next.handle().subscribe({
          next: (value) => {
            const timing = currentRequestTiming();
            if (timing && !response.headersSent) {
              const total = performance.now() - timing.startedAt;
              const metrics = [
                `app;dur=${total.toFixed(1)}`,
                `supabase;dur=${timing.supabaseDurationMs.toFixed(1)};desc="${timing.supabaseCalls} API call(s)"`,
              ];
              if (timing.cache) metrics.push(`cache;desc="${timing.cache}"`);
              response.setHeader('Server-Timing', metrics.join(', '));
              response.setHeader('X-Data-Source', 'supabase-api');
            }
            subscriber.next(value);
          },
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}

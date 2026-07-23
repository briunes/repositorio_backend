import { AsyncLocalStorage } from 'node:async_hooks';

type RequestTiming = {
  startedAt: number;
  supabaseDurationMs: number;
  supabaseCalls: number;
  cache?: 'hit' | 'miss' | 'config';
};

const storage = new AsyncLocalStorage<RequestTiming>();

export function withRequestTiming<T>(callback: () => T) {
  return storage.run(
    { startedAt: performance.now(), supabaseDurationMs: 0, supabaseCalls: 0 },
    callback,
  );
}

export function recordSupabaseCall(durationMs: number) {
  const timing = storage.getStore();
  if (!timing) return;
  timing.supabaseDurationMs += durationMs;
  timing.supabaseCalls += 1;
}

export function markRequestCache(cache: RequestTiming['cache']) {
  const timing = storage.getStore();
  if (timing) timing.cache = cache;
}

export function currentRequestTiming() {
  return storage.getStore();
}

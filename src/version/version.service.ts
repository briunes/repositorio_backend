import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import {
  markRequestCache,
  recordSupabaseCall,
} from '../database/request-timing';

const FALLBACK_VERSION = '1.0.0';
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class VersionService {
  private cache?: { version: string; expiresAt: number };
  private refresh?: Promise<string>;
  private readonly configuredVersion?: string;
  private readonly cacheTtlMs: number;

  constructor(
    config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.configuredVersion = config.get<string>('APP_VERSION')?.trim();
    const configuredTtl = Number(
      config.get<string>('APP_VERSION_CACHE_TTL_MS'),
    );
    this.cacheTtlMs =
      Number.isFinite(configuredTtl) && configuredTtl >= 0
        ? configuredTtl
        : DEFAULT_CACHE_TTL_MS;
  }

  async current() {
    if (this.configuredVersion) {
      markRequestCache('config');
      return this.configuredVersion;
    }

    if (this.cache && this.cache.expiresAt > Date.now()) {
      markRequestCache('hit');
      return this.cache.version;
    }

    markRequestCache('miss');
    this.refresh ??= this.loadCurrent();
    try {
      const version = await this.refresh;
      this.cache = { version, expiresAt: Date.now() + this.cacheTtlMs };
      return version;
    } finally {
      this.refresh = undefined;
    }
  }

  invalidate() {
    this.cache = undefined;
  }

  private async loadCurrent() {
    const startedAt = performance.now();
    const { data, error } = await this.supabase.client
      .from('system_config')
      .select('appVersion:app_version')
      .eq('id', 'default')
      .maybeSingle<{ appVersion: string }>();
    recordSupabaseCall(performance.now() - startedAt);
    if (error) throw error;
    return data?.appVersion ?? FALLBACK_VERSION;
  }
}

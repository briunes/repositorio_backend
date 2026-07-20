import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly url?: string;
  private readonly secretKey?: string;
  private readonly supabase?: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    this.url = this.config.get<string>('SUPABASE_URL')?.replace(/\/$/, '');
    this.secretKey = this.config.get<string>('SUPABASE_SECRET_KEY');

    if (this.url && this.secretKey) {
      this.supabase = createClient(this.url, this.secretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    }
  }

  get client(): SupabaseClient {
    if (!this.supabase) {
      throw new ServiceUnavailableException(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.',
      );
    }

    return this.supabase;
  }

  get region() {
    return this.config.get<string>('SUPABASE_REGION') || null;
  }

  async health() {
    if (!this.url || !this.secretKey) {
      return { configured: false, connected: false, region: this.region };
    }

    try {
      const response = await fetch(`${this.url}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          apikey: this.secretKey,
          Authorization: `Bearer ${this.secretKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      });

      return {
        configured: true,
        connected: response.ok,
        region: this.region,
        status: response.status,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        region: this.region,
      };
    }
  }
}

import { Controller, Get } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('health/supabase')
export class SupabaseController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  health() {
    return this.supabase.health();
  }
}

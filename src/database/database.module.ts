import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { createSupabaseApiPrismaClient } from './supabase-api-prisma.client';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => createSupabaseApiPrismaClient(),
    },
  ],
  exports: [PrismaService],
})
export class DatabaseModule {}

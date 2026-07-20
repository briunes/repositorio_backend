import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';
import { RepoModule } from './repo/repo.module';
import { VersionModule } from './version/version.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SupabaseModule,
    RepoModule,
    VersionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

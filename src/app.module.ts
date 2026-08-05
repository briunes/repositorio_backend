import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';
import { RepoModule } from './repo/repo.module';
import { VersionModule } from './version/version.module';
import { AdminModule } from './admin/admin.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestTimingInterceptor } from './database/request-timing.interceptor';
import { AppAuthGuard } from './auth/app-auth.guard';
import { AppTokenService } from './auth/app-token.service';
import { PermissionGuard } from './auth/permission.guard';
import { TeamsModule } from './teams/teams.module';
import { WorkflowModule } from './workflow/workflow.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SupabaseModule,
    RepoModule,
    VersionModule,
    AdminModule,
    TeamsModule,
    WorkflowModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AppTokenService,
    { provide: APP_GUARD, useClass: AppAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestTimingInterceptor },
  ],
})
export class AppModule {}

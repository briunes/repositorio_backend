import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { VersionController } from './version.controller';
import { VersionInterceptor } from './version.interceptor';
import { VersionService } from './version.service';

@Module({
  controllers: [VersionController],
  providers: [
    VersionService,
    { provide: APP_INTERCEPTOR, useClass: VersionInterceptor },
  ],
})
export class VersionModule {}

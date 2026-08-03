import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { VersionModule } from '../version/version.module';
import { AdminAccessGuard } from './admin-access.guard';

@Module({
  imports: [VersionModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAccessGuard],
})
export class AdminModule {}

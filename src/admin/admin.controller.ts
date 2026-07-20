import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Get('roles')
  roles() {
    return this.admin.roles();
  }

  @Get('sync-runs')
  syncRuns() {
    return this.admin.syncRuns();
  }
}

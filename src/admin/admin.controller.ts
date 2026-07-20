import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
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

  @Get('permissions')
  permissions() {
    return this.admin.permissions();
  }

  @Put('users/:id/roles')
  updateUserRoles(@Param('id') id: string, @Body() body: { roleIds?: string[] }) {
    return this.admin.updateUserRoles(id, body.roleIds);
  }

  @Post('roles')
  createRole(@Body() body: { name?: string; description?: string; permissionIds?: string[] }) {
    return this.admin.createRole(body);
  }

  @Patch('roles/:id')
  updateRole(@Param('id') id: string, @Body() body: { name?: string; description?: string; permissionIds?: string[] }) {
    return this.admin.updateRole(id, body);
  }

  @Delete('roles/:id')
  deleteRole(@Param('id') id: string) {
    return this.admin.deleteRole(id);
  }

  @Get('sync-runs')
  syncRuns() {
    return this.admin.syncRuns();
  }

  @Get('settings')
  settings() {
    return this.admin.settings();
  }

  @Patch('settings/version')
  updateVersion(@Body() body: { version?: string }) {
    return this.admin.updateVersion(body.version);
  }
}

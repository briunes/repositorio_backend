import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TeamMemberRole } from '@prisma/client';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { TeamsService } from './teams.service';

@Controller('teams')
@RequirePermissions('teams.read')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@Headers('x-repo-user-id') userId?: string) {
    return this.teams.list(userId);
  }

  @Post()
  @RequirePermissions('teams.manage')
  create(
    @Body() body: { name?: string; description?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.create(body, userId);
  }

  @Get('management/unowned-communications')
  @RequirePermissions('communications.transfer')
  unownedCommunications(@Headers('x-repo-user-id') userId?: string) {
    return this.teams.unownedCommunications(userId);
  }

  @Get(':teamId')
  detail(
    @Param('teamId') teamId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.detail(teamId, userId);
  }

  @Patch(':teamId')
  @RequirePermissions('teams.manage')
  update(
    @Param('teamId') teamId: string,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
      requiredApprovals?: number;
      allowSelfApproval?: boolean;
      approvalExpiresDays?: number | null;
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.update(teamId, body, userId);
  }

  @Get(':teamId/members')
  members(
    @Param('teamId') teamId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.members(teamId, userId);
  }

  @Get(':teamId/communications')
  communications(
    @Param('teamId') teamId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.communications(teamId, userId);
  }

  @Post(':teamId/communications/:communicationId/claim')
  @RequirePermissions('communications.transfer')
  claimCommunication(
    @Param('teamId') teamId: string,
    @Param('communicationId') communicationId: string,
    @Body() body: { reason?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.transferCommunication(
      communicationId,
      teamId,
      body.reason,
      userId,
    );
  }

  @Post(':teamId/members')
  @RequirePermissions('teams.members.manage')
  addMember(
    @Param('teamId') teamId: string,
    @Body()
    body: { userId?: string; roles?: TeamMemberRole[]; expiresAt?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.addMember(teamId, body, userId);
  }

  @Patch(':teamId/members/:memberUserId')
  @RequirePermissions('teams.members.manage')
  updateMember(
    @Param('teamId') teamId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() body: { roles?: TeamMemberRole[]; expiresAt?: string | null },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.updateMember(teamId, memberUserId, body, userId);
  }

  @Delete(':teamId/members/:memberUserId')
  @RequirePermissions('teams.members.manage')
  removeMember(
    @Param('teamId') teamId: string,
    @Param('memberUserId') memberUserId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.teams.removeMember(teamId, memberUserId, userId);
  }
}

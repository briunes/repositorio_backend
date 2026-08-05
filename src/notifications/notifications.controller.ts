import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Headers('x-repo-user-id') userId?: string) {
    return this.notifications.list(userId);
  }

  @Post(':notificationId/read')
  read(
    @Param('notificationId') notificationId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.notifications.read(notificationId, userId);
  }

  @Post('read-all')
  readAll(@Headers('x-repo-user-id') userId?: string) {
    return this.notifications.readAll(userId);
  }
}

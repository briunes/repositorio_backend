import { Controller, Get, Header } from '@nestjs/common';
import { VersionService } from './version.service';

@Controller('version')
export class VersionController {
  constructor(private readonly versions: VersionService) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async current() {
    return { status: true, data: { version: await this.versions.currentFresh() } };
  }
}

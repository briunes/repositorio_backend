import { Controller, Get, Header } from '@nestjs/common';
import { VersionService } from './version.service';

@Controller('version')
export class VersionController {
  constructor(private readonly versions: VersionService) {}

  @Get()
  @Header(
    'Cache-Control',
    'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  )
  async current() {
    return { status: true, data: { version: await this.versions.current() } };
  }
}

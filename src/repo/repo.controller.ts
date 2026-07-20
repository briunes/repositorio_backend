import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RepoService } from './repo.service';

@Controller('repo')
export class RepoController {
  constructor(private readonly repo: RepoService) {}

  @Post('login')
  login(@Body() body: Record<string, unknown>) {
    return this.repo.login(body);
  }

  @Post('refresh')
  refresh(@Body() body: Record<string, unknown>) {
    return this.repo.refresh(body);
  }

  @Get()
  templates() {
    return this.repo.templates();
  }

  @Post('sync')
  sync(@Headers('authorization') authorization?: string) {
    return this.repo.sync(authorization);
  }

  @Get('filters')
  @Header(
    'Cache-Control',
    'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  )
  filters() {
    return this.repo.filters();
  }

  @Get('details')
  details(
    @Query() query: Record<string, string>,
    @Headers('authorization') authorization?: string,
  ) {
    void authorization;
    return this.repo.details(query.tipo, query.codigo, query.lang);
  }

  @Get(':type/:code')
  detail(
    @Param('type') type: string,
    @Param('code') code: string,
    @Query() query: Record<string, string>,
    @Headers('authorization') authorization?: string,
  ) {
    void authorization;
    return this.repo.details(type, code, query.lang);
  }
}

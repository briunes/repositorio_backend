import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
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
  refresh(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return this.repo.refresh(body, authorization);
  }

  @Get()
  templates() {
    return this.repo.templates();
  }

  @Post('sync')
  sync(
    @Headers('authorization') authorization?: string,
    @Body() body?: { userId?: string | number },
  ) {
    return this.repo.sync(authorization, body?.userId);
  }

  @Post('sync/details')
  syncDetails(@Headers('authorization') authorization?: string) {
    return this.repo.syncDetails(authorization);
  }

  @Get('filters')
  filters() {
    return this.repo.filters();
  }

  @Get('taxonomy')
  taxonomy() {
    return this.repo.taxonomy();
  }

  @Get('taxonomy/history')
  taxonomyHistory() {
    return this.repo.taxonomyHistory();
  }

  @Post('taxonomy')
  createTaxonomyItem(@Body() body: { name?: string; parentId?: string | null }, @Headers('x-repo-user-id') userId?: string) {
    return this.repo.createTaxonomyItem(body, userId);
  }

  @Patch('taxonomy/order')
  reorderTaxonomy(@Body() body: { ids?: string[]; parentId?: string | null }, @Headers('x-repo-user-id') userId?: string) {
    return this.repo.reorderTaxonomy(body, userId);
  }

  @Patch('taxonomy/:id')
  updateTaxonomyItem(@Param('id') id: string, @Body() body: { name?: string; kind?: 'category' | 'subcategory' }, @Headers('x-repo-user-id') userId?: string) {
    return this.repo.updateTaxonomyItem(id, body, userId);
  }

  @Delete('taxonomy/:id')
  deleteTaxonomyItem(@Param('id') id: string, @Query('kind') kind?: 'category' | 'subcategory', @Headers('x-repo-user-id') userId?: string) {
    return this.repo.deleteTaxonomyItem(id, kind, userId);
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

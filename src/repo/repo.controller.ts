import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  @Header('Cache-Control', 'no-store')
  templates(@Headers('authorization') authorization?: string) {
    return this.repo.templates(authorization);
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
  @Header('Cache-Control', 'no-store')
  filters() {
    return this.repo.filters();
  }

  @Get('taxonomy')
  @Header('Cache-Control', 'no-store')
  taxonomy() {
    return this.repo.taxonomy();
  }

  @Get('taxonomy/history')
  @Header('Cache-Control', 'no-store')
  taxonomyHistory() {
    return this.repo.taxonomyHistory();
  }

  @Post('taxonomy')
  createTaxonomyItem(
    @Body()
    body: {
      name?: string;
      description?: string | null;
      kind?: 'category' | 'subcategory';
      parentId?: string | null;
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.createTaxonomyItem(body, userId);
  }

  @Patch('taxonomy/order')
  reorderTaxonomy(
    @Body() body: { ids?: string[]; parentId?: string | null },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.reorderTaxonomy(body, userId);
  }

  @Post('taxonomy/assign')
  assignSubcategory(
    @Body()
    body: { categoryId?: string; subcategoryId?: string; sortOrder?: number },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.assignSubcategory(body, userId);
  }

  @Delete('taxonomy/assign')
  unassignSubcategory(
    @Query('categoryId') categoryId: string,
    @Query('subcategoryId') subcategoryId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.unassignSubcategory(categoryId, subcategoryId, userId);
  }

  @Patch('taxonomy/:id')
  updateTaxonomyItem(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      kind?: 'category' | 'subcategory';
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateTaxonomyItem(id, body, userId);
  }

  @Delete('taxonomy/:id')
  deleteTaxonomyItem(
    @Param('id') id: string,
    @Query('kind') kind?: 'category' | 'subcategory',
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.deleteTaxonomyItem(id, kind, userId);
  }

  @Patch(':type/:code/taxonomy')
  updateCommunicationTaxonomy(
    @Param('type') type: string,
    @Param('code') code: string,
    @Body() body: { categoryIds?: string[]; subcategoryId?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateCommunicationTaxonomy(type, code, body, userId);
  }

  @Get('details')
  details(
    @Query() query: Record<string, string>,
    @Headers('authorization') authorization?: string,
  ) {
    void authorization;
    return this.repo.details(query.tipo, query.codigo, query.lang, query.version);
  }

  @Get(':type/:code')
  detail(
    @Param('type') type: string,
    @Param('code') code: string,
    @Query() query: Record<string, string>,
    @Headers('authorization') authorization?: string,
  ) {
    void authorization;
    return this.repo.details(type, code, query.lang, query.version);
  }
}

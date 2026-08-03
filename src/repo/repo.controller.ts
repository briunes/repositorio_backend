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
import { Public } from '../auth/public.decorator';

@Controller('repo')
export class RepoController {
  constructor(private readonly repo: RepoService) {}

  @Post('login')
  @Public()
  login(@Body() body: Record<string, unknown>) {
    return this.repo.login(body);
  }

  @Get('profile')
  profile(@Headers('x-repo-user-id') userId?: string) {
    return this.repo.profile(userId);
  }

  @Patch('profile')
  updateProfile(
    @Headers('x-repo-user-id') userId: string | undefined,
    @Body()
    body: { name?: string; email?: string | null; avatarUrl?: string | null },
  ) {
    return this.repo.updateProfile(userId, body);
  }

  @Get('profile/preferences')
  preferences(@Headers('x-repo-user-id') userId?: string) {
    return this.repo.preferences(userId);
  }

  @Get('changelog')
  changelog() {
    return this.repo.changelog();
  }

  @Get('config')
  config() {
    return this.repo.config();
  }

  @Patch('profile/preferences')
  updatePreferences(
    @Headers('x-repo-user-id') userId: string | undefined,
    @Body()
    body: {
      theme?: string;
      tableDensity?: string;
      language?: string;
      dateFormat?: string;
      timeZone?: string;
    },
  ) {
    return this.repo.updatePreferences(userId, body);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  templates(
    @Query('activity') activity?: 'all' | 'active' | 'pending' | 'inactive',
  ) {
    return this.repo.templates(activity);
  }

  @Post('sync')
  sync(
    @Headers('x-gbox-authorization') authorization?: string,
    @Body() body?: { userId?: string | number },
  ) {
    return this.repo.sync(authorization, body?.userId);
  }

  @Post('sync/details')
  syncDetails(@Headers('x-gbox-authorization') authorization?: string) {
    return this.repo.syncDetails(authorization);
  }

  @Post('sync/rows')
  syncRows(@Headers('x-gbox-authorization') authorization?: string) {
    return this.repo.syncRows(authorization);
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
  taxonomyHistory(
    @Query('entityType') entityType?: 'category' | 'subcategory',
    @Query('entityId') entityId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('authorId') authorId?: string,
    @Query('action') action?: 'CREATE' | 'UPDATE' | 'DELETE',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.repo.taxonomyHistory(entityType, entityId, {
      page,
      pageSize,
      authorId,
      action,
      dateFrom,
      dateTo,
    });
  }

  @Get('comment-authors')
  commentAuthors() {
    return this.repo.commentAuthors();
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
    @Body() body: { categoryIds?: string[]; subcategoryIds?: string[] },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateCommunicationTaxonomy(type, code, body, userId);
  }

  @Patch(':type/:code/properties')
  updateCommunicationProperties(
    @Param('type') type: string,
    @Param('code') code: string,
    @Body()
    body: {
      name?: string | null;
      description?: string | null;
      tags?: string[];
      services?: string[];
      teams?: string[];
    },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateCommunicationProperties(type, code, body, userId);
  }

  @Patch(':type/:code/content')
  updateCommunicationContent(
    @Param('type') type: string,
    @Param('code') code: string,
    @Body()
    body: { version?: string; locale?: string; content?: string | null },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateCommunicationContent(type, code, body, userId);
  }

  @Get(':type/:code/history')
  communicationHistory(
    @Param('type') type: string,
    @Param('code') code: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('authorId') authorId?: string,
    @Query('action') action?: 'CREATE' | 'UPDATE' | 'DELETE',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.repo.communicationHistory(type, code, {
      page,
      pageSize,
      authorId,
      action,
      dateFrom,
      dateTo,
    });
  }

  @Get(':type/:code/comments')
  communicationComments(
    @Param('type') type: string,
    @Param('code') code: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('authorId') authorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.repo.communicationComments(type, code, {
      page,
      pageSize,
      authorId,
      dateFrom,
      dateTo,
    });
  }

  @Post(':type/:code/comments')
  createCommunicationComment(
    @Param('type') type: string,
    @Param('code') code: string,
    @Body() body: { content?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.createCommunicationComment(type, code, body, userId);
  }

  @Patch(':type/:code/comments/:commentId')
  updateCommunicationComment(
    @Param('type') type: string,
    @Param('code') code: string,
    @Param('commentId') commentId: string,
    @Body() body: { content?: string },
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.updateCommunicationComment(
      type,
      code,
      commentId,
      body,
      userId,
    );
  }

  @Delete(':type/:code/comments/:commentId')
  deleteCommunicationComment(
    @Param('type') type: string,
    @Param('code') code: string,
    @Param('commentId') commentId: string,
    @Headers('x-repo-user-id') userId?: string,
  ) {
    return this.repo.deleteCommunicationComment(type, code, commentId, userId);
  }

  @Get('details')
  details(
    @Query() query: Record<string, string>,
    @Headers('authorization') authorization?: string,
  ) {
    void authorization;
    return this.repo.details(
      query.tipo,
      query.codigo,
      query.lang,
      query.version,
    );
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

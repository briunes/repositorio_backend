import { Module } from '@nestjs/common';
import { RepoController } from './repo.controller';
import { RepoService } from './repo.service';
import { GboxImporterService } from '../sync/gbox-importer.service';
import { GboxDetailSyncService } from '../sync/gbox-detail-sync.service';

@Module({
  controllers: [RepoController],
  providers: [RepoService, GboxImporterService, GboxDetailSyncService],
})
export class RepoModule {}

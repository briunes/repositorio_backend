import { Injectable } from '@nestjs/common';
import { Prisma, VersionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  GboxLocalizedVersion,
  GboxTemplate,
  GboxTemplates,
  GboxVersion,
} from './gbox.types';

type ImportEntry = { channel: string; code: string; template: GboxTemplate };

@Injectable()
export class GboxImporterService {
  constructor(private readonly prisma: PrismaService) {}

  async import(templates: GboxTemplates) {
    const run = await this.prisma.syncRun.create({
      data: { source: 'GBOX' },
    });

    try {
      const entries = this.entries(templates);
      if (entries.length === 0) {
        throw new Error(
          'GBox sync returned no communications; local data was preserved.',
        );
      }
      const lookups = await this.prepareLookups(entries);
      let versionCount = 0;

      for (let index = 0; index < entries.length; index += 8) {
        const counts = await Promise.all(
          entries
            .slice(index, index + 8)
            .map((entry) => this.importCommunication(entry, lookups)),
        );
        versionCount += counts.reduce((total, count) => total + count, 0);
      }

      const sourceIds = entries.map(
        ({ channel, code }) => `${channel}:${code}`,
      );
      await this.prisma.communication.updateMany({
        where: {
          sourceSystem: 'GBOX',
          ...(sourceIds.length > 0 ? { sourceId: { notIn: sourceIds } } : {}),
        },
        data: { status: 'UNAVAILABLE' },
      });

      await this.prisma.repositorySnapshot.upsert({
        where: { key: 'gbox-templates' },
        update: { payload: this.json(templates), syncedAt: new Date() },
        create: {
          key: 'gbox-templates',
          payload: this.json(templates),
          syncedAt: new Date(),
        },
      });

      return await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          communications: entries.length,
          versions: versionCount,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Unknown sync error',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private entries(templates: GboxTemplates) {
    const entries: ImportEntry[] = [];
    for (const [channel, byCode] of Object.entries(templates)) {
      if (!byCode || Array.isArray(byCode)) continue;
      for (const [code, template] of Object.entries(byCode)) {
        entries.push({ channel: channel.toUpperCase(), code, template });
      }
    }
    return entries;
  }

  private async prepareLookups(entries: ImportEntry[]) {
    const channels = new Set(entries.map(({ channel }) => channel));
    const categories = new Set<string>();
    const services = new Set<string>();
    const teams = new Set<string>();
    const tags = new Set<string>();

    for (const { template } of entries) {
      (template.subcategoria?.length
        ? template.subcategoria
        : ['Sem subcategoria']
      ).forEach((value) => categories.add(value.trim()));
      (template.servico?.length ? template.servico : ['Sem serviço']).forEach(
        (value) => services.add(value.trim()),
      );
      (template.equipa?.length ? template.equipa : ['Sem equipa']).forEach(
        (value) => teams.add(value.trim()),
      );
      this.tags(template.tags).forEach((value) => tags.add(value));
    }

    const channelMap = new Map<string, string>();
    for (const key of channels) {
      const row = await this.prisma.channel.upsert({
        where: { key },
        update: { isActive: true },
        create: { key, name: key },
      });
      channelMap.set(key, row.id);
    }

    return {
      channels: channelMap,
      categories: await this.upsertNamed('category', categories),
      services: await this.upsertNamed('service', services),
      teams: await this.upsertNamed('team', teams),
      tags: await this.upsertNamed('tag', tags),
    };
  }

  private async upsertNamed(
    model: 'category' | 'service' | 'team' | 'tag',
    names: Set<string>,
  ) {
    const result = new Map<string, string>();
    for (const name of names) {
      if (!name) continue;
      const slug = this.slug(name);
      const row =
        model === 'category'
          ? await this.prisma.category.upsert({
              where: { slug },
              update: { name },
              create: { name, slug },
            })
          : model === 'service'
            ? await this.prisma.service.upsert({
                where: { slug },
                update: { name },
                create: { name, slug },
              })
            : model === 'team'
              ? await this.prisma.team.upsert({
                  where: { slug },
                  update: { name },
                  create: { name, slug },
                })
              : await this.prisma.tag.upsert({
                  where: { slug },
                  update: { name },
                  create: { name, slug },
                });
      result.set(name, row.id);
    }
    return result;
  }

  private async importCommunication(
    { channel, code, template }: ImportEntry,
    lookups: Awaited<ReturnType<GboxImporterService['prepareLookups']>>,
  ) {
    const versions = Object.entries(template.versoes ?? {});
    const latestDate = versions
      .map(([, value]) => this.date(value.dataVersao))
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const now = new Date();
    const communication = await this.prisma.communication.upsert({
      where: {
        channelId_code: { channelId: lookups.channels.get(channel)!, code },
      },
      update: {
        name: template.nome?.trim() || code,
        description: template.desc?.trim(),
        status:
          latestDate && latestDate > now
            ? 'SCHEDULED'
            : versions.length
              ? 'AVAILABLE'
              : 'UNAVAILABLE',
        sourceSystem: 'GBOX',
        sourceId: `${channel}:${code}`,
        templateFolder: template.templateFolder,
        metadata: this.json(template),
        lastSyncedAt: now,
      },
      create: {
        channelId: lookups.channels.get(channel)!,
        code,
        name: template.nome?.trim() || code,
        description: template.desc?.trim(),
        status:
          latestDate && latestDate > now
            ? 'SCHEDULED'
            : versions.length
              ? 'AVAILABLE'
              : 'UNAVAILABLE',
        sourceSystem: 'GBOX',
        sourceId: `${channel}:${code}`,
        templateFolder: template.templateFolder,
        metadata: this.json(template),
        lastSyncedAt: now,
      },
    });

    const categoryNames = template.subcategoria?.length
      ? template.subcategoria
      : ['Sem subcategoria'];
    await this.prisma.$transaction([
      this.prisma.communicationVersion.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationCategory.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationService.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationTeam.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationTag.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationCategory.createMany({
        data: categoryNames.map((name) => ({
          communicationId: communication.id,
          categoryId: lookups.categories.get(name.trim())!,
        })),
      }),
      this.prisma.communicationService.createMany({
        data: (template.servico?.length
          ? template.servico
          : ['Sem serviço']
        ).map((name) => ({
          communicationId: communication.id,
          serviceId: lookups.services.get(name.trim())!,
        })),
      }),
      this.prisma.communicationTeam.createMany({
        data: (template.equipa?.length ? template.equipa : ['Sem equipa']).map(
          (name) => ({
            communicationId: communication.id,
            teamId: lookups.teams.get(name.trim())!,
          }),
        ),
      }),
      this.prisma.communicationTag.createMany({
        data: this.tags(template.tags).map((name) => ({
          communicationId: communication.id,
          tagId: lookups.tags.get(name)!,
        })),
      }),
      ...versions.map(([key, version]) =>
        this.prisma.communicationVersion.create({
          data: this.versionData(communication.id, key, version),
        }),
      ),
    ]);
    return versions.length;
  }

  private versionData(
    communicationId: string,
    key: string,
    version: GboxVersion,
  ) {
    const localized = this.localized(version);
    const variables = new Map<string, string>();
    localized.forEach(([, value]) =>
      Object.entries(value.vars ?? {}).forEach(([name, sample]) =>
        variables.set(name, String(sample)),
      ),
    );
    const effectiveAt = this.date(version.dataVersao);
    return {
      communicationId,
      // The object key is the stable GBox version identifier. Some legacy
      // records reuse the human-facing `versao` value more than once.
      version: key,
      status: (effectiveAt && effectiveAt > new Date()
        ? 'SCHEDULED'
        : 'PUBLISHED') as VersionStatus,
      effectiveAt,
      publishedAt:
        effectiveAt && effectiveAt <= new Date() ? effectiveAt : null,
      sourceTicketId: this.firstTicket(localized),
      metadata: this.json(version),
      localizations: {
        create: localized.map(([locale, value]) => ({
          locale: locale.toUpperCase(),
          content: value.text,
          filename: value.templateFilename,
        })),
      },
      variables: {
        create: Array.from(variables, ([name, sampleValue], sortOrder) => ({
          key: name,
          sampleValue,
          sortOrder,
        })),
      },
    };
  }

  private localized(
    version: GboxVersion,
  ): Array<[string, GboxLocalizedVersion]> {
    return Object.entries(version).filter(
      (entry): entry is [string, GboxLocalizedVersion] =>
        !['versao', 'dataVersao'].includes(entry[0]) &&
        typeof entry[1] === 'object' &&
        entry[1] !== null,
    );
  }

  private firstTicket(values: Array<[string, GboxLocalizedVersion]>) {
    const ticket = values.find(
      ([, value]) => value.iTicketID !== undefined,
    )?.[1].iTicketID;
    return ticket === undefined ? undefined : String(ticket);
  }

  private tags(value?: string | string[]) {
    const values = Array.isArray(value) ? value : (value?.split(/\s+/) ?? []);
    return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  }

  private date(value?: string) {
    if (!value) return null;
    const date = new Date(
      value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private slug(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private json(value: unknown) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

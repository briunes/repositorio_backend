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
type PreparedCommunication = { id: string; contentIsUnchanged: boolean };

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
      const communications = await this.upsertCommunications(entries, lookups);
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { communications: entries.length },
      });
      let versionCount = 0;

      // Match the bounded Prisma pool: four independent communication graphs
      // can be written concurrently without queuing beyond the pool timeout.
      for (let index = 0; index < entries.length; index += 4) {
        const counts = await Promise.all(
          entries
            .slice(index, index + 4)
            .map((entry) =>
              this.importCommunication(
                entry,
                lookups,
                communications.get(`${entry.channel}:${entry.code}`)!,
              ),
            ),
        );
        versionCount += counts.reduce((total, count) => total + count, 0);
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: {
            communications: Math.min(index + 4, entries.length),
            versions: versionCount,
          },
        });
      }

      const returnedCategorySlugs = new Set(
        [...lookups.categories.keys()].map((name) => this.slug(name)),
      );
      const obsoleteChannelCategorySlugs = [...lookups.channels.keys()]
        .map((channel) => this.slug(channel))
        .filter((slug) => !returnedCategorySlugs.has(slug));
      if (obsoleteChannelCategorySlugs.length) {
        await this.prisma.category.deleteMany({
          where: { slug: { in: obsoleteChannelCategorySlugs } },
        });
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
          communications: entries.length,
          versions: versionCount,
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

  private async upsertCommunications(
    entries: ImportEntry[],
    lookups: Awaited<ReturnType<GboxImporterService['prepareLookups']>>,
  ) {
    const sourceIds = entries.map(({ channel, code }) => `${channel}:${code}`);
    const existingRows = await this.prisma.communication.findMany({
      where: { sourceSystem: 'GBOX', sourceId: { in: sourceIds } },
      select: {
        id: true,
        sourceId: true,
        metadata: true,
        subcategories: { select: { categoryId: true, subcategoryId: true } },
      },
    });
    const existing = new Map(existingRows.map((row) => [row.sourceId!, row]));
    const now = new Date();
    const missing = entries.filter(
      ({ channel, code }) => !existing.has(`${channel}:${code}`),
    );
    for (let index = 0; index < missing.length; index += 50) {
      await this.prisma.communication.createMany({
        data: missing
          .slice(index, index + 50)
          .map((entry) => this.communicationData(entry, lookups, now)),
        skipDuplicates: true,
      });
    }
    const present = entries.filter(({ channel, code }) =>
      existing.has(`${channel}:${code}`),
    );
    for (let index = 0; index < present.length; index += 50) {
      await this.prisma.$transaction(
        present.slice(index, index + 50).map((entry) => {
          const sourceId = `${entry.channel}:${entry.code}`;
          return this.prisma.communication.update({
            where: { id: existing.get(sourceId)!.id },
            data: this.communicationData(entry, lookups, now),
          });
        }),
      );
    }
    const rows = await this.prisma.communication.findMany({
      where: { sourceSystem: 'GBOX', sourceId: { in: sourceIds } },
      select: { id: true, sourceId: true },
    });
    return new Map<string, PreparedCommunication>(
      rows.map((row) => {
        const old = existing.get(row.sourceId!);
        const entry = entries.find(
          ({ channel, code }) => `${channel}:${code}` === row.sourceId,
        )!;
        return [
          row.sourceId!,
          {
            id: row.id,
            contentIsUnchanged:
              Boolean(old) &&
              this.stableJson(old!.metadata) ===
                this.stableJson(entry.template) &&
              this.sameIds(
                old!.subcategories.map(
                  ({ categoryId, subcategoryId }) =>
                    `${categoryId}:${subcategoryId}`,
                ),
                this.taxonomyPairs(entry.template).map(
                  ({ category, subcategory }) =>
                    `${lookups.categories.get(category)!}:${lookups.subcategories.get(`${category}:${subcategory}`)!}`,
                ),
              ),
          },
        ];
      }),
    );
  }

  private communicationData(
    { channel, code, template }: ImportEntry,
    lookups: Awaited<ReturnType<GboxImporterService['prepareLookups']>>,
    now: Date,
  ): Prisma.CommunicationCreateManyInput {
    const versions = Object.values(template.versoes ?? {});
    const latestDate = versions
      .map((value) => this.date(value.dataVersao))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    return {
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
    };
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
    const categoryNames = new Set<string>();
    const subcategoryNamesByCategory = new Map<string, Set<string>>();
    const services = new Set<string>();
    const teams = new Set<string>();
    const tags = new Set<string>();

    for (const { template } of entries) {
      for (const { category, subcategory } of this.taxonomyPairs(template)) {
        categoryNames.add(category);
        const subcategories =
          subcategoryNamesByCategory.get(category) ?? new Set<string>();
        subcategories.add(subcategory);
        subcategoryNamesByCategory.set(category, subcategories);
      }
      (template.servico?.length ? template.servico : ['Sem serviço']).forEach(
        (value) => services.add(value.trim()),
      );
      (template.equipa?.length ? template.equipa : ['Sem equipa']).forEach(
        (value) => teams.add(value.trim()),
      );
      this.tags(template.tags).forEach((value) => tags.add(value));
    }

    const channelMap = new Map<string, string>();
    const subcategoryMap = new Map<string, string>();
    for (const key of channels) {
      const row = await this.prisma.channel.upsert({
        where: { key },
        update: { isActive: true },
        create: { key, name: key },
      });
      channelMap.set(key, row.id);
    }
    const categoryMap = new Map<string, string>();
    for (const name of categoryNames) {
      const category = await this.prisma.category.upsert({
        where: { slug: this.slug(name) },
        update: { name, isActive: true },
        create: { name, slug: this.slug(name) },
      });
      categoryMap.set(name, category.id);
      for (const [sortOrder, subcategoryName] of [
        ...(subcategoryNamesByCategory.get(name) ?? []),
      ].entries()) {
        const subcategory = await this.prisma.subcategory.upsert({
          where: { slug: this.slug(subcategoryName) },
          update: { name: subcategoryName, isActive: true },
          create: {
            name: subcategoryName,
            slug: this.slug(subcategoryName),
          },
        });
        await this.prisma.categorySubcategory.upsert({
          where: {
            categoryId_subcategoryId: {
              categoryId: category.id,
              subcategoryId: subcategory.id,
            },
          },
          update: {},
          create: {
            categoryId: category.id,
            subcategoryId: subcategory.id,
            sortOrder,
          },
        });
        subcategoryMap.set(`${name}:${subcategoryName}`, subcategory.id);
      }
    }

    return {
      channels: channelMap,
      categories: categoryMap,
      subcategories: subcategoryMap,
      services: await this.upsertNamed('service', services),
      teams: await this.upsertNamed('team', teams),
      tags: await this.upsertNamed('tag', tags),
    };
  }

  private async upsertNamed(
    model: 'service' | 'team' | 'tag',
    names: Set<string>,
  ) {
    const values = [...names]
      .filter(Boolean)
      .map((name) => ({ name, slug: this.slug(name) }));
    if (model === 'service') {
      await this.prisma.service.createMany({
        data: values,
        skipDuplicates: true,
      });
      const rows = await this.prisma.service.findMany({
        where: { slug: { in: values.map(({ slug }) => slug) } },
      });
      return new Map(
        values.map(({ name, slug }) => [
          name,
          rows.find((row) => row.slug === slug)!.id,
        ]),
      );
    }
    if (model === 'team') {
      await this.prisma.team.createMany({ data: values, skipDuplicates: true });
      const rows = await this.prisma.team.findMany({
        where: { slug: { in: values.map(({ slug }) => slug) } },
      });
      return new Map(
        values.map(({ name, slug }) => [
          name,
          rows.find((row) => row.slug === slug)!.id,
        ]),
      );
    }
    await this.prisma.tag.createMany({ data: values, skipDuplicates: true });
    const rows = await this.prisma.tag.findMany({
      where: { slug: { in: values.map(({ slug }) => slug) } },
    });
    return new Map(
      values.map(({ name, slug }) => [
        name,
        rows.find((row) => row.slug === slug)!.id,
      ]),
    );
  }

  private async importCommunication(
    { template }: ImportEntry,
    lookups: Awaited<ReturnType<GboxImporterService['prepareLookups']>>,
    communication: PreparedCommunication,
  ) {
    const versions = Object.entries(template.versoes ?? {});

    // GBox syncs are usually mostly unchanged. Avoid deleting and recreating
    // the complete version/localization/variable graph when its source payload
    // is identical; the lightweight communication update above still records
    // the new lastSyncedAt and availability.
    if (communication.contentIsUnchanged) return versions.length;

    const taxonomyPairs = this.taxonomyPairs(template);
    await Promise.all([
      this.prisma.communicationVersion.deleteMany({
        where: { communicationId: communication.id },
      }),
      this.prisma.communicationSubcategory.deleteMany({
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
    ]);
    await this.prisma.$transaction([
      this.prisma.communicationSubcategory.createMany({
        data: taxonomyPairs.map(({ category, subcategory }) => ({
          communicationId: communication.id,
          categoryId: lookups.categories.get(category)!,
          subcategoryId: lookups.subcategories.get(
            `${category}:${subcategory}`,
          )!,
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

  private taxonomyPairs(template: GboxTemplate) {
    const categories = (
      template.categoria?.length ? template.categoria : ['Sem categoria']
    ).map((value) => value.trim());
    const subcategories = (
      template.subcategoria?.length
        ? template.subcategoria
        : ['Sem subcategoria']
    ).map((value) => value.trim());
    const pairs = categories.flatMap((category) =>
      subcategories.map((subcategory) => ({ category, subcategory })),
    );
    return [
      ...new Map(
        pairs.map((pair) => [`${pair.category}:${pair.subcategory}`, pair]),
      ).values(),
    ];
  }

  private sameIds(left: string[], right: string[]) {
    const normalizedLeft = [...new Set(left)].sort();
    const normalizedRight = [...new Set(right)].sort();
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((value, index) => value === normalizedRight[index])
    );
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

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}

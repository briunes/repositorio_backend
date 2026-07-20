import { Injectable } from '@nestjs/common';
import { GboxTemplateDetail, GboxTemplates } from './gbox.types';
import { PrismaService } from '../database/prisma.service';

type DetailFetcher = (
  type: string,
  code: string,
  locale: string,
) => Promise<GboxTemplateDetail>;

type DetailTarget = { type: string; code: string; locale: string };

@Injectable()
export class GboxDetailSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(templates: GboxTemplates, fetchDetail: DetailFetcher) {
    const targets = this.targets(templates);
    let details = 0;
    let detailErrors = 0;
    const detailErrorSamples: Array<DetailTarget & { message: string }> = [];

    for (let index = 0; index < targets.length; index += 3) {
      const batchTargets = targets.slice(index, index + 3);
      const results = await Promise.allSettled(
        batchTargets.map(async (target) => {
          const detail = await fetchDetail(
            target.type,
            target.code,
            target.locale,
          );
          await this.save(target, detail);
        }),
      );
      details += results.filter(
        (result) => result.status === 'fulfilled',
      ).length;
      detailErrors += results.filter(
        (result) => result.status === 'rejected',
      ).length;
      results.forEach((result, resultIndex) => {
        if (result.status === 'fulfilled' || detailErrorSamples.length >= 10)
          return;
        detailErrorSamples.push({
          ...batchTargets[resultIndex],
          message:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      });
    }

    return { details, detailErrors, detailErrorSamples };
  }

  private targets(templates: GboxTemplates) {
    const targets: DetailTarget[] = [];
    for (const [type, byCode] of Object.entries(templates)) {
      if (!byCode || Array.isArray(byCode)) continue;
      for (const [code, template] of Object.entries(byCode)) {
        const locales = new Set<string>();
        for (const version of Object.values(template.versoes ?? {})) {
          Object.entries(version).forEach(([key, value]) => {
            if (
              !['versao', 'dataVersao'].includes(key) &&
              typeof value === 'object' &&
              value
            ) {
              locales.add(key.toUpperCase());
            }
          });
        }
        if (locales.size === 0) locales.add('PT');
        locales.forEach((locale) => targets.push({ type, code, locale }));
      }
    }
    return targets;
  }

  private async save(target: DetailTarget, detail: GboxTemplateDetail) {
    const channel = target.type === 'PUSH' ? 'BLIP' : target.type;
    const communication = await this.prisma.communication.findFirst({
      where: { code: target.code, channel: { key: channel } },
      select: {
        versions: {
          orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, version: true },
        },
      },
    });
    if (!communication?.versions.length) {
      throw new Error(`No local version for ${target.type}:${target.code}`);
    }

    const activeVersion = detail.versaoAtiva?.versao;
    const version =
      communication.versions.find((item) => item.version === activeVersion) ??
      communication.versions[0];
    const locale = detail.versaoAtiva?.lang?.toUpperCase() || target.locale;
    const pdf = detail.previewPdf;
    const variablesByKey = new Map(
      (detail.variaveis ?? []).map((variable) => [variable.key, variable]),
    );
    Object.keys(detail.exemplo?.variaveisAplicadas ?? {}).forEach((key) => {
      if (!variablesByKey.has(key)) variablesByKey.set(key, { key });
    });

    await this.prisma.$transaction([
      this.prisma.communicationLocalization.upsert({
        where: { versionId_locale: { versionId: version.id, locale } },
        update: {
          content: detail.exemplo?.conteudo,
          filename: detail.versaoAtiva?.templateFilename,
          mimeType: pdf?.mime,
          previewFilename: pdf?.filename,
          previewBase64: pdf?.base64,
        },
        create: {
          versionId: version.id,
          locale,
          content: detail.exemplo?.conteudo,
          filename: detail.versaoAtiva?.templateFilename,
          mimeType: pdf?.mime,
          previewFilename: pdf?.filename,
          previewBase64: pdf?.base64,
        },
      }),
      ...Array.from(variablesByKey.values()).map((variable) =>
        this.prisma.communicationVariable.upsert({
          where: {
            versionId_key: { versionId: version.id, key: variable.key },
          },
          update: {
            description: variable.description,
            placeholder: variable.placeholder,
            sampleValue: this.stringValue(
              detail.exemplo?.variaveisAplicadas?.[variable.key],
            ),
          },
          create: {
            versionId: version.id,
            key: variable.key,
            description: variable.description,
            placeholder: variable.placeholder,
            sampleValue: this.stringValue(
              detail.exemplo?.variaveisAplicadas?.[variable.key],
            ),
          },
        }),
      ),
    ]);
  }

  private stringValue(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return JSON.stringify(value);
  }
}

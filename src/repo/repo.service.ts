import {
  BadGatewayException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GboxImporterService } from '../sync/gbox-importer.service';
import { GboxTemplateDetail, GboxTemplates } from '../sync/gbox.types';
import { GboxDetailSyncService } from '../sync/gbox-detail-sync.service';

type JsonObject = Record<string, unknown>;

@Injectable()
export class RepoService {
  private readonly baseUrl?: string;
  private templatesCache?: { data: GboxTemplates; expiresAt: number };
  private filtersCache?: { data: JsonObject; expiresAt: number };

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly importer: GboxImporterService,
    private readonly detailSync: GboxDetailSyncService,
  ) {
    this.baseUrl = config.get<string>('GBOX_API_BASE_URL')?.replace(/\/$/, '');
  }

  async login(body: JsonObject) {
    const response = await this.request('/repo/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await this.syncLoggedInUser(response);
    return response;
  }

  refresh(body: JsonObject) {
    return this.request('/repo/refresh', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async templates() {
    if (this.templatesCache) {
      if (this.templatesCache.expiresAt <= Date.now()) {
        this.templatesCache.expiresAt = Date.now() + 30_000;
        void this.refreshSnapshotCache();
      }
      return { status: true, data: this.templatesCache.data };
    }

    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (snapshot && this.isObject(snapshot.payload)) {
      const data = snapshot.payload as GboxTemplates;
      this.cacheTemplates(data);
      return { status: true, data };
    }

    // One-time compatibility fallback for databases created before the
    // snapshot migration. The result is persisted so later reads stay fast.
    const rows = await this.prisma.communication.findMany({
      include: {
        channel: true,
        categories: { include: { category: true } },
        services: { include: { service: true } },
        teams: { include: { team: true } },
        tags: { include: { tag: true } },
        versions: {
          orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
          include: {
            localizations: true,
            variables: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
    const data: GboxTemplates = {};
    for (const row of rows) {
      const existing = data[row.channel.key];
      const byCode = !existing || Array.isArray(existing) ? {} : existing;
      byCode[row.code] = {
        ...(this.isObject(row.metadata) ? row.metadata : {}),
        nome: row.name,
        desc: row.description ?? undefined,
        templateFolder: row.templateFolder ?? undefined,
        subcategoria: row.categories.map(({ category }) => category.name),
        servico: row.services.map(({ service }) => service.name),
        equipa: row.teams.map(({ team }) => team.name),
        tags: row.tags.map(({ tag }) => tag.name),
        versoes: Object.fromEntries(
          row.versions.map((version) => [
            version.version,
            {
              ...(this.isObject(version.metadata) ? version.metadata : {}),
              versao: version.version,
              dataVersao: this.gboxDate(version.effectiveAt),
              ...Object.fromEntries(
                version.localizations.map((localization) => [
                  localization.locale,
                  {
                    iTicketID: version.sourceTicketId,
                    text: localization.content ?? undefined,
                    templateFilename: localization.filename ?? undefined,
                    vars: Object.fromEntries(
                      version.variables.map((variable) => [
                        variable.key,
                        variable.sampleValue ?? variable.placeholder ?? '',
                      ]),
                    ),
                  },
                ]),
              ),
            },
          ]),
        ),
      };
      data[row.channel.key] = byCode;
    }
    await this.prisma.repositorySnapshot.upsert({
      where: { key: 'gbox-templates' },
      update: { payload: this.toJson(data), syncedAt: new Date() },
      create: {
        key: 'gbox-templates',
        payload: this.toJson(data),
        syncedAt: new Date(),
      },
    });
    this.cacheTemplates(data);
    return { status: true, data };
  }

  async details(type: string, code: string, locale = 'PT') {
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    const communication = await this.prisma.communication.findFirst({
      where: { code, channel: { key: channel } },
      include: {
        channel: true,
        versions: {
          orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
          include: {
            localizations: true,
            variables: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!communication)
      throw new HttpException(
        { status: false, message: 'Communication not found.' },
        404,
      );
    const version = communication.versions[0];
    const localization =
      version?.localizations.find(
        (item) => item.locale.toUpperCase() === locale.toUpperCase(),
      ) ?? version?.localizations[0];
    return {
      status: true,
      data: {
        tipoSolicitado: type.toUpperCase(),
        tipoRepositorio: communication.channel.key,
        codigo: communication.code,
        nome: communication.name,
        desc: communication.description ?? undefined,
        versaoAtiva: version
          ? {
              versao: version.version,
              dataVersao: this.gboxDate(version.effectiveAt),
              lang: localization?.locale,
              templateFilename: localization?.filename,
            }
          : undefined,
        variaveis: version?.variables.map((variable) => ({
          key: variable.key,
          description: variable.description ?? undefined,
          placeholder: variable.placeholder ?? undefined,
        })),
        exemplo: localization
          ? {
              conteudo: localization.content ?? undefined,
              variaveisAplicadas: Object.fromEntries(
                (version?.variables ?? []).map((variable) => [
                  variable.key,
                  variable.sampleValue ?? '',
                ]),
              ),
            }
          : undefined,
        previewPdf: localization?.previewBase64
          ? {
              mime: localization.mimeType || 'application/pdf',
              filename:
                localization.previewFilename ||
                localization.filename ||
                `${communication.code}.pdf`,
              base64: localization.previewBase64,
            }
          : undefined,
      },
    };
  }

  async filters() {
    if (this.filtersCache && this.filtersCache.expiresAt > Date.now()) {
      return { status: true, data: this.filtersCache.data };
    }

    // One round trip is important on serverless deployments, where Prisma is
    // intentionally limited to one pooled connection per function instance.
    const [row] = await this.prisma.$queryRaw<Array<{ data: JsonObject }>>`
      SELECT json_build_object(
        'categories', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'name', name, 'slug', slug, 'parentId', parent_id
          ) ORDER BY sort_order ASC, name ASC)
          FROM categories WHERE is_active = true
        ), '[]'::json),
        'subcategories', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'name', name, 'slug', slug, 'parentId', parent_id
          ) ORDER BY sort_order ASC, name ASC)
          FROM categories WHERE is_active = true
        ), '[]'::json),
        'services', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'name', name, 'slug', slug
          ) ORDER BY name ASC)
          FROM services WHERE is_active = true
        ), '[]'::json),
        'teams', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'name', name, 'slug', slug
          ) ORDER BY name ASC)
          FROM teams WHERE is_active = true
        ), '[]'::json),
        'channels', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'key', key, 'name', name
          ) ORDER BY name ASC)
          FROM channels WHERE is_active = true
        ), '[]'::json)
      ) AS data
    `;
    const data = row?.data ?? {};
    this.filtersCache = { data, expiresAt: Date.now() + 5 * 60_000 };

    return {
      status: true,
      data,
    };
  }

  async sync(authorization?: string) {
    if (!authorization)
      throw new HttpException(
        { status: false, message: 'Authorization is required.' },
        401,
      );
    const payload = await this.request('/repo/', {
      headers: { Authorization: authorization },
    });
    const templates = this.unwrapTemplates(payload);
    const run = await this.importer.import(templates);
    const detailResult = await this.detailSync.sync(
      templates,
      async (type, code, locale) => {
        const search = new URLSearchParams({
          tipo: type,
          codigo: code,
          lang: locale,
          previewPdf: '1',
        });
        const detailPayload = await this.request(
          `/repo/details?${search.toString()}`,
          { headers: { Authorization: authorization } },
        );
        return this.unwrapDetail(detailPayload);
      },
    );
    const completedRun = await this.prisma.syncRun.update({
      where: { id: run.id },
      data: {
        details: detailResult.details,
        detailErrors: detailResult.detailErrors,
      },
    });
    this.cacheTemplates(templates);
    this.filtersCache = undefined;
    return {
      status: true,
      data: {
        ...completedRun,
        detailErrorSamples: detailResult.detailErrorSamples,
      },
    };
  }

  private async request(path: string, init: RequestInit = {}) {
    if (!this.baseUrl)
      throw new ServiceUnavailableException('GBox API is not configured.');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new BadGatewayException('Could not reach the GBox API.');
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok)
      throw new HttpException(
        payload ?? { status: false, message: 'GBox request failed.' },
        response.status,
      );
    return payload;
  }

  private async syncLoggedInUser(payload: unknown) {
    if (
      !this.isObject(payload) ||
      !this.isObject(payload.data) ||
      !this.isObject(payload.data.user)
    )
      return;
    const remoteUser = payload.data.user;
    const rawId = remoteUser.id ?? remoteUser.iUserId;
    const rawUsername = remoteUser.username;
    if (
      (typeof rawId !== 'string' && typeof rawId !== 'number') ||
      typeof rawUsername !== 'string'
    )
      return;
    const gboxUserId = String(rawId);
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ gboxUserId }, { username: rawUsername }] },
      select: { id: true },
    });
    const values = {
      gboxUserId,
      username: rawUsername,
      displayName: this.firstString(remoteUser.name, remoteUser.nome),
      email: this.firstString(remoteUser.email),
      lastLoginAt: new Date(),
    };
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: values,
        })
      : await this.prisma.user.create({ data: values });
    if (existing) return;

    const viewerRole = await this.prisma.role.findUnique({
      where: { key: 'viewer' },
      select: { id: true },
    });
    if (viewerRole)
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: viewerRole.id } },
        update: {},
        create: { userId: user.id, roleId: viewerRole.id },
      });
  }

  private unwrapTemplates(payload: unknown): GboxTemplates {
    if (!this.isObject(payload))
      throw new BadGatewayException(
        'GBox returned an invalid template payload.',
      );
    return (
      this.isObject(payload.data) ? payload.data : payload
    ) as GboxTemplates;
  }

  private unwrapDetail(payload: unknown): GboxTemplateDetail {
    if (!this.isObject(payload)) {
      throw new BadGatewayException('GBox returned an invalid detail payload.');
    }
    const detail = this.isObject(payload.data) ? payload.data : payload;
    return detail;
  }
  private isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  private firstString(...values: unknown[]) {
    return values.find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }
  private gboxDate(value: Date | null) {
    return (
      value
        ?.toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '') ?? undefined
    );
  }

  private cacheTemplates(data: GboxTemplates) {
    this.templatesCache = { data, expiresAt: Date.now() + 30_000 };
  }

  private async refreshSnapshotCache() {
    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (snapshot && this.isObject(snapshot.payload)) {
      this.cacheTemplates(snapshot.payload as GboxTemplates);
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

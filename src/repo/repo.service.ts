import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
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
    const appRole = await this.syncLoggedInUser(response);
    return this.withAppRole(response, appRole);
  }

  refresh(body: JsonObject, authorization?: string) {
    return this.request('/repo/refresh', {
      method: 'POST',
      headers: authorization ? { Authorization: authorization } : undefined,
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
        subcategories: {
          include: { subcategory: { include: { category: true } } },
        },
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
        categoria: [
          ...new Set(
            row.subcategories.map(
              ({ subcategory }) => subcategory.category.name,
            ),
          ),
        ],
        subcategoria: row.subcategories.map(({ subcategory }) => subcategory.name),
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
            'id', id, 'name', name, 'slug', slug
          ) ORDER BY sort_order ASC, name ASC)
          FROM categories WHERE is_active = true
        ), '[]'::json),
        'subcategories', COALESCE((
          SELECT json_agg(json_build_object(
            'id', id, 'name', name, 'slug', slug, 'parentId', category_id
          ) ORDER BY sort_order ASC, name ASC)
          FROM subcategories WHERE is_active = true
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

  async taxonomy() {
    const data = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        subcategories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, sortOrder: true },
        },
      },
    });
    return { status: true, data: data.map(({ subcategories, ...category }) => ({ ...category, children: subcategories })) };
  }

  async taxonomyHistory() {
    const data = await this.prisma.auditLog.findMany({
      where: { entityType: { in: ['category', 'subcategory'] } },
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, entityId: true, changes: true, createdAt: true },
    });
    return { status: true, data };
  }

  async createTaxonomyItem(body: { name?: string; parentId?: string | null }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome é obrigatório.');
    if (body.parentId) {
      const parent = await this.prisma.category.findFirst({ where: { id: body.parentId, isActive: true }, select: { id: true } });
      if (!parent) throw new BadRequestException('A categoria selecionada não existe.');
      const duplicate = await this.prisma.subcategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, categoryId: body.parentId, isActive: true }, select: { id: true } });
      if (duplicate) throw new ConflictException('Já existe uma subcategoria com este nome nesta categoria.');
      const sortOrder = await this.prisma.subcategory.count({ where: { categoryId: body.parentId, isActive: true } });
      const item = await this.prisma.subcategory.create({ data: { name, slug: `${this.slug(name)}-${Date.now().toString(36)}`, categoryId: body.parentId, sortOrder }, select: { id: true, name: true, sortOrder: true, categoryId: true } });
      await this.writeTaxonomyAudit('CREATE', 'subcategory', item.id, { name, parentId: item.categoryId });
      this.filtersCache = undefined;
      return { status: true, data: item };
    }
    const duplicate = await this.prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (duplicate) throw new ConflictException('Já existe uma categoria com este nome neste nível.');
    const sortOrder = await this.prisma.category.count({ where: { isActive: true } });
    const item = await this.prisma.category.create({ data: { name, slug: `${this.slug(name)}-${Date.now().toString(36)}`, sortOrder }, select: { id: true, name: true, sortOrder: true } });
    await this.writeTaxonomyAudit('CREATE', 'category', item.id, { name });
    this.filtersCache = undefined;
    return { status: true, data: item };
  }

  async updateTaxonomyItem(id: string, body: { name?: string; kind?: 'category' | 'subcategory' }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('O nome é obrigatório.');
    if (body.kind === 'subcategory') {
      const current = await this.prisma.subcategory.findFirst({ where: { id, isActive: true }, select: { name: true, categoryId: true } });
      if (!current) throw new NotFoundException('Subcategoria não encontrada.');
      const duplicate = await this.prisma.subcategory.findFirst({ where: { id: { not: id }, name: { equals: name, mode: 'insensitive' }, categoryId: current.categoryId, isActive: true }, select: { id: true } });
      if (duplicate) throw new ConflictException('Já existe uma subcategoria com este nome nesta categoria.');
      const item = await this.prisma.subcategory.update({ where: { id }, data: { name }, select: { id: true, name: true, sortOrder: true, categoryId: true } });
      await this.writeTaxonomyAudit('UPDATE', 'subcategory', id, { oldName: current.name, name });
      this.filtersCache = undefined;
      return { status: true, data: item };
    }
    const current = await this.prisma.category.findFirst({ where: { id, isActive: true }, select: { name: true } });
    if (!current) throw new NotFoundException('Categoria não encontrada.');
    const duplicate = await this.prisma.category.findFirst({ where: { id: { not: id }, name: { equals: name, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (duplicate) throw new ConflictException('Já existe uma categoria com este nome.');
    const item = await this.prisma.category.update({ where: { id }, data: { name }, select: { id: true, name: true, sortOrder: true } });
    await this.writeTaxonomyAudit('UPDATE', 'category', id, { oldName: current.name, name });
    this.filtersCache = undefined;
    return { status: true, data: item };
  }

  async deleteTaxonomyItem(id: string, kind?: 'category' | 'subcategory') {
    if (kind === 'subcategory') {
      const current = await this.prisma.subcategory.findFirst({ where: { id, isActive: true }, select: { name: true, _count: { select: { communications: true } } } });
      if (!current) throw new NotFoundException('Subcategoria não encontrada.');
      if (current._count.communications) throw new ConflictException('Esta subcategoria está associada a comunicações e não pode ser eliminada.');
      await this.prisma.subcategory.update({ where: { id }, data: { isActive: false } });
      await this.writeTaxonomyAudit('DELETE', 'subcategory', id, { name: current.name });
      this.filtersCache = undefined;
      return { status: true, data: { id } };
    }
    const current = await this.prisma.category.findFirst({ where: { id, isActive: true }, select: { id: true, name: true, _count: { select: { subcategories: true } } } });
    if (!current) throw new NotFoundException('Categoria não encontrada.');
    if (current._count.subcategories) throw new ConflictException('Elimine primeiro as subcategorias desta categoria.');
    await this.prisma.category.update({ where: { id }, data: { isActive: false } });
    await this.writeTaxonomyAudit('DELETE', 'category', id, { name: current.name });
    this.filtersCache = undefined;
    return { status: true, data: { id } };
  }

  async reorderTaxonomy(body: { ids?: string[]; parentId?: string | null }) {
    const ids = [...new Set(body.ids ?? [])];
    if (!ids.length) throw new BadRequestException('A nova ordem é obrigatória.');
    const count = body.parentId
      ? await this.prisma.subcategory.count({ where: { id: { in: ids }, categoryId: body.parentId, isActive: true } })
      : await this.prisma.category.count({ where: { id: { in: ids }, isActive: true } });
    if (count !== ids.length) throw new BadRequestException('A ordem contém categorias inválidas.');
    await this.prisma.$transaction(ids.map((id, sortOrder) => body.parentId
      ? this.prisma.subcategory.update({ where: { id }, data: { sortOrder } })
      : this.prisma.category.update({ where: { id }, data: { sortOrder } })));
    await this.writeTaxonomyAudit('UPDATE', body.parentId ? 'subcategory' : 'category', body.parentId ?? null, { operation: 'reorder', ids, parentId: body.parentId ?? null });
    this.filtersCache = undefined;
    return { status: true, data: { ids } };
  }

  private writeTaxonomyAudit(action: 'CREATE' | 'UPDATE' | 'DELETE', entityType: 'category' | 'subcategory', entityId: string | null, changes: JsonObject) {
    return this.prisma.auditLog.create({ data: { action, entityType, entityId, changes: this.toJson(changes) } });
  }

  private slug(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'category';
  }

  async sync(authorization?: string, userId?: string | number) {
    if (!authorization)
      throw new HttpException(
        { status: false, message: 'Authorization is required.' },
        401,
      );
    const activeRun = await this.prisma.syncRun.findFirst({
      where: { source: 'GBOX', status: 'RUNNING' },
      select: { id: true, startedAt: true },
    });
    if (activeRun) {
      throw new ConflictException({
        status: false,
        message: 'Já existe uma sincronização GBox em curso.',
        data: activeRun,
      });
    }
    const payload = await this.request('/repo/', {
      headers: { Authorization: authorization },
    });
    await this.saveSnapshot('gbox-repo-original', payload);
    const templates = this.unwrapTemplates(payload);
    const run = await this.importer.import(templates);
    try {
      let detailAuthorization = await this.refreshSyncAuthorization(
        userId,
        authorization,
      );
      let refreshedAuthorization: Promise<string> | undefined;
      const detailResult = await this.detailSync.sync(
        templates,
        async (type, code, locale) => {
          const search = new URLSearchParams({
            tipo: type,
            codigo: code,
            lang: locale,
            previewPdf: '1',
          });
          const path = `/repo/details?${search.toString()}`;
          let detailPayload: unknown;
          try {
            detailPayload = await this.request(path, {
              headers: { Authorization: detailAuthorization },
            });
          } catch (error) {
            if (!this.isAuthenticationError(error)) throw error;
            refreshedAuthorization ??= this.refreshSyncAuthorization(
              userId,
              detailAuthorization,
            );
            detailAuthorization = await refreshedAuthorization;
            detailPayload = await this.request(path, {
              headers: { Authorization: detailAuthorization },
            });
          }
          return {
            detail: this.unwrapDetail(detailPayload),
            originalPayload: detailPayload,
          };
        },
        async (details, detailErrors) => {
          await this.prisma.syncRun.update({
            where: { id: run.id },
            data: { details, detailErrors },
          });
        },
      );
      const allDetailsFailed =
        detailResult.details === 0 && detailResult.detailErrors > 0;
      const detailError = detailResult.detailErrors
        ? detailResult.detailErrorSamples
            .map(({ type, code, locale, message }) =>
              `${type}:${code}:${locale} — ${message}`,
            )
            .join('\n')
        : null;
      const completedRun = await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: allDetailsFailed ? 'FAILED' : 'SUCCEEDED',
          details: detailResult.details,
          detailErrors: detailResult.detailErrors,
          error: detailError,
          completedAt: new Date(),
        },
      });
      const unauthorized =
        allDetailsFailed &&
        detailResult.detailErrorSamples.length > 0 &&
        detailResult.detailErrorSamples.every(({ message }) =>
          this.isAuthenticationMessage(message),
        );
      if (unauthorized)
        throw new HttpException(
          { status: false, message: 'Unauthorized' },
          401,
        );
      this.cacheTemplates(templates);
      this.filtersCache = undefined;
      return {
        status: true,
        data: {
          ...completedRun,
          detailErrorSamples: detailResult.detailErrorSamples,
        },
      };
    } catch (error) {
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Detail sync failed.',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async syncDetails(authorization?: string) {
    if (!authorization)
      throw new HttpException(
        { status: false, message: 'Authorization is required.' },
        401,
      );
    const activeRun = await this.prisma.syncRun.findFirst({
      where: { status: 'RUNNING', source: { in: ['GBOX', 'GBOX_DETAILS'] } },
      select: { id: true, startedAt: true },
    });
    if (activeRun)
      throw new ConflictException({
        status: false,
        message: 'Já existe uma sincronização GBox em curso.',
        data: activeRun,
      });
    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (!snapshot || !this.isObject(snapshot.payload))
      throw new BadRequestException(
        'Sincronize primeiro o repositório antes de sincronizar os detalhes.',
      );
    const templates = snapshot.payload as GboxTemplates;
    const [communications, versions] = await Promise.all([
      this.prisma.communication.count({ where: { sourceSystem: 'GBOX' } }),
      this.prisma.communicationVersion.count({
        where: { communication: { sourceSystem: 'GBOX' } },
      }),
    ]);
    const run = await this.prisma.syncRun.create({
      data: { source: 'GBOX_DETAILS', communications, versions },
    });
    try {
      const result = await this.detailSync.sync(
        templates,
        async (type, code, locale) => {
          const search = new URLSearchParams({
            tipo: type,
            codigo: code,
            lang: locale,
            previewPdf: '1',
          });
          const payload = await this.request(
            `/repo/details?${search.toString()}`,
            { headers: { Authorization: authorization } },
          );
          return {
            detail: this.unwrapDetail(payload),
            originalPayload: payload,
          };
        },
        async (details, detailErrors) => {
          await this.prisma.syncRun.update({
            where: { id: run.id },
            data: { details, detailErrors },
          });
        },
      );
      const samples = result.detailErrorSamples;
      const allFailed = result.details === 0 && result.detailErrors > 0;
      const unauthorized =
        allFailed &&
        samples.length > 0 &&
        samples.every(({ message }) =>
          this.isAuthenticationMessage(message),
        );
      const error = samples.length
        ? samples
            .map(({ type, code, locale, message }) =>
              `${type}:${code}:${locale} — ${message}`,
            )
            .join('\n')
        : null;
      const completed = await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: allFailed ? 'FAILED' : 'SUCCEEDED',
          details: result.details,
          detailErrors: result.detailErrors,
          error,
          completedAt: new Date(),
        },
      });
      if (unauthorized)
        throw new HttpException(
          { status: false, message: 'Unauthorized' },
          401,
        );
      return {
        status: true,
        data: { ...completed, detailErrorSamples: samples },
      };
    } catch (error) {
      await this.prisma.syncRun.updateMany({
        where: { id: run.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Detail sync failed.',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async refreshSyncAuthorization(
    userId: string | number | undefined,
    fallbackAuthorization: string,
  ) {
    const normalizedUserId = Number(userId);
    if (!Number.isFinite(normalizedUserId)) {
      throw new BadRequestException(
        'Não foi possível renovar a sessão GBox antes de sincronizar os detalhes.',
      );
    }
    const payload = await this.request('/repo/refresh', {
      method: 'POST',
      headers: { Authorization: fallbackAuthorization },
      body: JSON.stringify({ iUserId: normalizedUserId }),
    });
    const token = this.isObject(payload) && this.isObject(payload.data)
      ? this.firstString(payload.data.token)
      : undefined;
    return token ? `Bearer ${token}` : fallbackAuthorization;
  }

  private isAuthenticationError(error: unknown) {
    return (
      error instanceof HttpException &&
      (error.getStatus() === 401 || error.getStatus() === 403)
    );
  }

  private isAuthenticationMessage(message: string) {
    const normalized = message.toLocaleLowerCase();
    return (
      normalized.includes('unauthorized') ||
      normalized.includes('invalid token') ||
      normalized.includes('token invalid') ||
      normalized.includes('token expir')
    );
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

  private async syncLoggedInUser(
    payload: unknown,
  ): Promise<string | undefined> {
    if (
      !this.isObject(payload) ||
      !this.isObject(payload.data) ||
      !this.isObject(payload.data.user)
    )
      return undefined;
    const remoteUser = payload.data.user;
    const rawId = remoteUser.id ?? remoteUser.iUserId;
    const rawUsername = remoteUser.username;
    if (
      (typeof rawId !== 'string' && typeof rawId !== 'number') ||
      typeof rawUsername !== 'string'
    )
      return undefined;
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
    if (existing) {
      const assignment = await this.prisma.userRole.findFirst({
        where: { userId: user.id },
        orderBy: { assignedAt: 'asc' },
        select: { role: { select: { name: true } } },
      });
      return assignment?.role.name;
    }

    const viewerRole = await this.prisma.role.findUnique({
      where: { key: 'viewer' },
      select: { id: true, name: true },
    });
    if (viewerRole) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: viewerRole.id } },
        update: {},
        create: { userId: user.id, roleId: viewerRole.id },
      });
      return viewerRole.name;
    }
    return undefined;
  }

  private withAppRole(payload: unknown, appRole?: string) {
    if (
      !appRole ||
      !this.isObject(payload) ||
      !this.isObject(payload.data) ||
      !this.isObject(payload.data.user)
    )
      return payload;
    return {
      ...payload,
      data: {
        ...payload.data,
        user: { ...payload.data.user, role: appRole },
      },
    };
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

  private async saveSnapshot(key: string, payload: unknown) {
    const syncedAt = new Date();
    await this.prisma.repositorySnapshot.upsert({
      where: { key },
      update: { payload: this.toJson(payload), syncedAt },
      create: { key, payload: this.toJson(payload), syncedAt },
    });
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

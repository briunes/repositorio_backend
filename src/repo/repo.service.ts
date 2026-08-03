import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GboxImporterService } from '../sync/gbox-importer.service';
import { GboxTemplateDetail, GboxTemplates } from '../sync/gbox.types';
import { GboxDetailSyncService } from '../sync/gbox-detail-sync.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AppTokenService } from '../auth/app-token.service';
import {
  markRequestCache,
  recordSupabaseCall,
} from '../database/request-timing';

type JsonObject = Record<string, unknown>;
type TaxonomyData = {
  categories: Array<JsonObject>;
  subcategories: Array<JsonObject>;
};

@Injectable()
export class RepoService {
  private readonly baseUrl?: string;
  private templatesCache?: { data: GboxTemplates; expiresAt: number };
  private filtersCache?: { data: JsonObject; expiresAt: number };
  private taxonomyCache?: { data: TaxonomyData; expiresAt: number };
  private taxonomyRefresh?: Promise<{ data: TaxonomyData; generation: number }>;
  private taxonomyGeneration = 0;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly importer: GboxImporterService,
    private readonly detailSync: GboxDetailSyncService,
    private readonly supabase: SupabaseService,
    private readonly appTokens: AppTokenService,
  ) {
    this.baseUrl = config.get<string>('GBOX_API_BASE_URL')?.replace(/\/$/, '');
  }

  async login(body: JsonObject) {
    const response = await this.request('/repo/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const appRole = await this.syncLoggedInUser(response);
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
      select: { sessionDurationMinutes: true },
    });
    return this.withAppSession(
      response,
      appRole,
      (config?.sessionDurationMinutes ?? 480) * 60,
    );
  }

  async profile(gboxUserId?: string) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const user = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarUrl: true,
      },
    });
    if (!user) throw new NotFoundException('User profile was not found.');
    const adminRole = await this.prisma.role.findUnique({
      where: { key: 'admin' },
      select: { id: true },
    });
    const adminAssignment = adminRole
      ? await this.prisma.userRole.findFirst({
          where: { userId: user.id, roleId: adminRole.id },
          select: { userId: true },
        })
      : null;
    return {
      status: true,
      data: {
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isAdmin: Boolean(adminAssignment),
      },
    };
  }

  async updateProfile(
    gboxUserId: string | undefined,
    body: { name?: string; email?: string | null; avatarUrl?: string | null },
  ) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Name is required.');
    if (name.length > 160) throw new BadRequestException('Name is too long.');
    const email = body.email?.trim() || null;
    if (
      email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      throw new BadRequestException('Email is invalid.');
    }
    const avatarUrl = body.avatarUrl?.trim() || null;
    if (
      avatarUrl &&
      (!/^data:image\/(?:jpeg|png|webp);base64,/.test(avatarUrl) ||
        avatarUrl.length > 1_500_000)
    ) {
      throw new BadRequestException('Profile picture is invalid or too large.');
    }
    try {
      const user = await this.prisma.user.update({
        where: { gboxUserId },
        data: { displayName: name, email, avatarUrl },
        select: {
          username: true,
          displayName: true,
          email: true,
          avatarUrl: true,
        },
      });
      return { status: true, data: user };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Email is already being used by another user.',
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User profile was not found.');
      }
      throw error;
    }
  }

  async preferences(gboxUserId?: string) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    const preferences = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: {
        theme: true,
        tableDensity: true,
        language: true,
        dateFormat: true,
        timeZone: true,
      },
    });
    if (!preferences)
      throw new NotFoundException('User preferences were not found.');
    return { status: true, data: preferences };
  }

  async updatePreferences(
    gboxUserId: string | undefined,
    body: {
      theme?: string;
      tableDensity?: string;
      language?: string;
      dateFormat?: string;
      timeZone?: string;
    },
  ) {
    if (!gboxUserId) throw new UnauthorizedException('User is required.');
    if (!['light', 'dark', 'system'].includes(body.theme ?? ''))
      throw new BadRequestException('Theme is invalid.');
    if (!['comfortable', 'compact'].includes(body.tableDensity ?? ''))
      throw new BadRequestException('Table density is invalid.');
    if (body.language !== 'pt-PT')
      throw new BadRequestException('Language is invalid.');
    if (!['dd/MM/yyyy', 'yyyy-MM-dd'].includes(body.dateFormat ?? ''))
      throw new BadRequestException('Date format is invalid.');
    if (
      !['Europe/Lisbon', 'UTC', 'Atlantic/Azores'].includes(body.timeZone ?? '')
    )
      throw new BadRequestException('Time zone is invalid.');

    try {
      const preferences = await this.prisma.user.update({
        where: { gboxUserId },
        data: {
          theme: body.theme,
          tableDensity: body.tableDensity,
          language: body.language,
          dateFormat: body.dateFormat,
          timeZone: body.timeZone,
        },
        select: {
          theme: true,
          tableDensity: true,
          language: true,
          dateFormat: true,
          timeZone: true,
        },
      });
      return { status: true, data: preferences };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User preferences were not found.');
      }
      throw error;
    }
  }

  async templates(activity: 'all' | 'active' | 'pending' | 'inactive' = 'all') {
    if (!['all', 'active', 'pending', 'inactive'].includes(activity)) {
      throw new BadRequestException('Invalid communication activity filter.');
    }

    if (
      this.templatesCache?.expiresAt &&
      this.templatesCache.expiresAt > Date.now()
    ) {
      return {
        status: true,
        data: this.filterTemplatesByActivity(
          this.templatesCache.data,
          activity,
        ),
      };
    }

    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (snapshot && this.isObject(snapshot.payload)) {
      const data = snapshot.payload as GboxTemplates;
      this.cacheTemplates(data);
      return {
        status: true,
        data: this.filterTemplatesByActivity(data, activity),
      };
    }

    // One-time compatibility fallback for databases created before the
    // snapshot migration. The result is persisted so later reads stay fast.
    const rows = await this.prisma.communication.findMany({
      include: {
        channel: true,
        subcategories: {
          include: { category: true, subcategory: true },
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
          ...new Set(row.subcategories.map(({ category }) => category.name)),
        ],
        subcategoria: [
          ...new Set(
            row.subcategories.map(({ subcategory }) => subcategory.name),
          ),
        ],
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
    return {
      status: true,
      data: this.filterTemplatesByActivity(data, activity),
    };
  }

  async changelog() {
    const data = await this.prisma.releaseNote.findMany({
      where: { published: true },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        version: true,
        title: true,
        summary: true,
        heroImageUrl: true,
        blocks: true,
        published: true,
        publishedAt: true,
      },
    });
    return { status: true, data };
  }

  async config() {
    const data = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', appVersion: '1.0.0' },
      select: {
        defaultView: true,
        defaultPageSize: true,
        defaultSort: true,
        showInactive: true,
        sessionDurationMinutes: true,
        idleTimeoutMinutes: true,
        maintenanceMode: true,
        readOnlyMode: true,
        fullSmsEditingEnabled: true,
        maintenanceMessage: true,
        environmentName: true,
      },
    });
    return { status: true, data };
  }

  async details(
    type: string,
    code: string,
    locale = 'PT',
    requestedVersion?: string,
  ) {
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    // PostgREST embeds use a left join by default. Filtering through the
    // relation (`channel: { key: channel }`) can therefore return an unrelated
    // communication with a null `channel` embed. Resolve the channel first and
    // filter by its scalar foreign key so the parent row is filtered correctly.
    const repositoryChannel = await this.prisma.channel.findUnique({
      where: { key: channel },
    });
    if (!repositoryChannel)
      throw new HttpException(
        { status: false, message: 'Communication not found.' },
        404,
      );
    const communication = await this.prisma.communication.findFirst({
      where: { code, channelId: repositoryChannel.id },
      include: {
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
    const version = requestedVersion
      ? communication.versions.find(
          ({ version: value }) => value === requestedVersion,
        )
      : communication.versions[0];
    if (requestedVersion && !version)
      throw new NotFoundException('Versão da comunicação não encontrada.');
    const localization =
      version?.localizations.find(
        (item) => item.locale.toUpperCase() === locale.toUpperCase(),
      ) ?? version?.localizations[0];
    return {
      status: true,
      data: {
        tipoSolicitado: type.toUpperCase(),
        tipoRepositorio: repositoryChannel.key,
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
            'id', id, 'name', name, 'slug', slug, 'sortOrder', sort_order
          ) ORDER BY sort_order ASC, name ASC)
          FROM categories WHERE is_active = true
        ), '[]'::json),
        'subcategories', COALESCE((
          SELECT json_agg(json_build_object(
            'id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description,
            'parentId', cs.category_id, 'sortOrder', cs.sort_order
          ) ORDER BY cs.sort_order ASC, s.name ASC)
          FROM category_subcategories cs
          JOIN subcategories s ON s.id = cs.subcategory_id
          JOIN categories c ON c.id = cs.category_id
          WHERE s.is_active = true AND c.is_active = true
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
    if (this.taxonomyCache && this.taxonomyCache.expiresAt > Date.now()) {
      markRequestCache('hit');
      return { status: true, data: this.taxonomyCache.data };
    }

    markRequestCache('miss');
    if (!this.taxonomyRefresh) {
      const generation = this.taxonomyGeneration;
      this.taxonomyRefresh = this.loadTaxonomy().then((data) => ({
        data,
        generation,
      }));
    }
    try {
      const { data, generation } = await this.taxonomyRefresh;
      if (generation === this.taxonomyGeneration) {
        this.taxonomyCache = { data, expiresAt: Date.now() + 5 * 60_000 };
      }
      return { status: true, data };
    } finally {
      this.taxonomyRefresh = undefined;
    }
  }

  private async loadTaxonomy(): Promise<TaxonomyData> {
    const startedAt = performance.now();
    const { data, error } = await this.supabase.client.rpc(
      'get_repository_taxonomy',
    );
    recordSupabaseCall(performance.now() - startedAt);
    if (error) throw error;
    if (!this.isObject(data)) return { categories: [], subcategories: [] };
    return data as TaxonomyData;
  }

  async taxonomyHistory(
    entityType?: 'category' | 'subcategory',
    entityId?: string,
    query: {
      page?: string;
      pageSize?: string;
      authorId?: string;
      action?: 'CREATE' | 'UPDATE' | 'DELETE';
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    const parsedPage = Number.parseInt(query.page ?? '1', 10);
    const parsedPageSize = Number.parseInt(query.pageSize ?? '8', 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const pageSize = Number.isFinite(parsedPageSize)
      ? Math.min(50, Math.max(1, parsedPageSize))
      : 8;
    const parseDate = (value: string | undefined, endExclusive = false) => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new BadRequestException('A data indicada não é válida.');
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException('A data indicada não é válida.');
      if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
      return date;
    };
    const dateFrom = parseDate(query.dateFrom);
    const dateTo = parseDate(query.dateTo, true);
    if (dateFrom && dateTo && dateFrom >= dateTo)
      throw new BadRequestException(
        'A data inicial não pode ser posterior à data final.',
      );
    const taxonomyWhere = {
      entityType: entityType ?? { in: ['category', 'subcategory'] },
      ...(entityId ? { entityId } : {}),
    } satisfies Prisma.AuditLogWhereInput;
    const where = {
      ...taxonomyWhere,
      ...(query.authorId ? { actorId: query.authorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lt: dateTo } : {}),
            },
          }
        : {}),
    } satisfies Prisma.AuditLogWhereInput;
    const select = {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      changes: true,
      createdAt: true,
      actor: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    } satisfies Prisma.AuditLogSelect;
    const [items, total, authorRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select,
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where: taxonomyWhere,
        take: 1000,
        orderBy: { createdAt: 'desc' },
        select: {
          actor: {
            select: { id: true, displayName: true, username: true, avatarUrl: true },
          },
        },
      }),
    ]);
    const authors = [
      ...new Map(
        authorRows
          .filter(({ actor }) => Boolean(actor))
          .map(({ actor }) => [actor!.id, actor!]),
      ).values(),
    ].sort((left, right) =>
      (left.displayName || left.username).localeCompare(
        right.displayName || right.username,
        'pt-PT',
      ),
    );
    return {
      status: true,
      data: {
        items,
        authors,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async communicationHistory(
    type: string,
    code: string,
    query: {
      page?: string;
      pageSize?: string;
      authorId?: string;
      action?: 'CREATE' | 'UPDATE' | 'DELETE';
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    const communication = await this.resolveCommunication(type, code);
    const parsedPage = Number.parseInt(query.page ?? '1', 10);
    const parsedPageSize = Number.parseInt(query.pageSize ?? '8', 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const pageSize = Number.isFinite(parsedPageSize)
      ? Math.min(50, Math.max(1, parsedPageSize))
      : 8;
    const parseDate = (value: string | undefined, endExclusive = false) => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new BadRequestException('A data indicada não é válida.');
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException('A data indicada não é válida.');
      if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
      return date;
    };
    const dateFrom = parseDate(query.dateFrom);
    const dateTo = parseDate(query.dateTo, true);
    if (dateFrom && dateTo && dateFrom >= dateTo)
      throw new BadRequestException(
        'A data inicial não pode ser posterior à data final.',
      );
    const historyWhere = {
      entityType: 'communication',
      entityId: communication.id,
    } satisfies Prisma.AuditLogWhereInput;
    const where = {
      ...historyWhere,
      ...(query.authorId ? { actorId: query.authorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lt: dateTo } : {}),
            },
          }
        : {}),
    } satisfies Prisma.AuditLogWhereInput;
    const select = {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        changes: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
    } satisfies Prisma.AuditLogSelect;
    const [items, total, authorRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select,
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where: historyWhere,
        take: 1000,
        orderBy: { createdAt: 'desc' },
        select: { actor: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
      }),
    ]);
    const authors = [
      ...new Map(
        authorRows
          .filter(({ actor }) => Boolean(actor))
          .map(({ actor }) => [actor!.id, actor!]),
      ).values(),
    ].sort((left, right) =>
      (left.displayName || left.username).localeCompare(
        right.displayName || right.username,
        'pt-PT',
      ),
    );
    return {
      status: true,
      data: {
        items,
        authors,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async createTaxonomyItem(
    body: {
      name?: string;
      description?: string | null;
      kind?: 'category' | 'subcategory';
      parentId?: string | null;
    },
    userId?: string,
  ) {
    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    if (!name) throw new BadRequestException('O nome é obrigatório.');
    if (description && description.length > 500)
      throw new BadRequestException(
        'A descrição não pode exceder 500 caracteres.',
      );
    if (body.kind === 'subcategory' || body.parentId) {
      if (body.parentId) {
        const parent = await this.prisma.category.findFirst({
          where: { id: body.parentId, isActive: true },
          select: { id: true },
        });
        if (!parent)
          throw new BadRequestException('A categoria selecionada não existe.');
      }
      const duplicate = await this.prisma.subcategory.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true },
      });
      if (duplicate)
        throw new ConflictException(
          'Já existe uma subcategoria com este nome.',
        );
      const sortOrder = await this.prisma.subcategory.count({
        where: { isActive: true },
      });
      const item = await this.prisma.subcategory.create({
        data: {
          name,
          description,
          slug: `${this.slug(name)}-${Date.now().toString(36)}`,
          sortOrder,
        },
        select: {
          id: true,
          name: true,
          description: true,
          sortOrder: true,
        },
      });
      if (body.parentId) {
        const assignmentSortOrder = await this.prisma.categorySubcategory.count(
          {
            where: { categoryId: body.parentId },
          },
        );
        await this.prisma.categorySubcategory.create({
          data: {
            categoryId: body.parentId,
            subcategoryId: item.id,
            sortOrder: assignmentSortOrder,
          },
        });
      }
      await this.writeTaxonomyAudit(
        'CREATE',
        'subcategory',
        item.id,
        { name, description, parentId: body.parentId ?? null },
        userId,
      );
      this.invalidateFiltersCache();
      return { status: true, data: item };
    }
    const duplicate = await this.prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        'Já existe uma categoria com este nome neste nível.',
      );
    const sortOrder = await this.prisma.category.count({
      where: { isActive: true },
    });
    const item = await this.prisma.category.create({
      data: {
        name,
        slug: `${this.slug(name)}-${Date.now().toString(36)}`,
        sortOrder,
      },
      select: { id: true, name: true, sortOrder: true },
    });
    await this.writeTaxonomyAudit(
      'CREATE',
      'category',
      item.id,
      { name },
      userId,
    );
    this.invalidateFiltersCache();
    return { status: true, data: item };
  }

  async updateTaxonomyItem(
    id: string,
    body: {
      name?: string;
      description?: string | null;
      kind?: 'category' | 'subcategory';
    },
    userId?: string,
  ) {
    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    if (!name) throw new BadRequestException('O nome é obrigatório.');
    if (description && description.length > 500)
      throw new BadRequestException(
        'A descrição não pode exceder 500 caracteres.',
      );
    if (body.kind === 'subcategory') {
      const current = await this.prisma.subcategory.findFirst({
        where: { id, isActive: true },
        select: { name: true, description: true },
      });
      if (!current) throw new NotFoundException('Subcategoria não encontrada.');
      const duplicate = await this.prisma.subcategory.findFirst({
        where: {
          id: { not: id },
          name: { equals: name, mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true },
      });
      if (duplicate)
        throw new ConflictException(
          'Já existe uma subcategoria com este nome.',
        );
      const item = await this.prisma.subcategory.update({
        where: { id },
        data: { name, description },
        select: {
          id: true,
          name: true,
          description: true,
          sortOrder: true,
        },
      });
      await this.writeTaxonomyAudit(
        'UPDATE',
        'subcategory',
        id,
        {
          oldName: current.name,
          name,
          oldDescription: current.description,
          description,
        },
        userId,
      );
      this.invalidateFiltersCache();
      return { status: true, data: item };
    }
    const current = await this.prisma.category.findFirst({
      where: { id, isActive: true },
      select: { name: true },
    });
    if (!current) throw new NotFoundException('Categoria não encontrada.');
    const duplicate = await this.prisma.category.findFirst({
      where: {
        id: { not: id },
        name: { equals: name, mode: 'insensitive' },
        isActive: true,
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException('Já existe uma categoria com este nome.');
    const item = await this.prisma.category.update({
      where: { id },
      data: { name },
      select: { id: true, name: true, sortOrder: true },
    });
    await this.writeTaxonomyAudit(
      'UPDATE',
      'category',
      id,
      { oldName: current.name, name },
      userId,
    );
    this.invalidateFiltersCache();
    return { status: true, data: item };
  }

  async deleteTaxonomyItem(
    id: string,
    kind?: 'category' | 'subcategory',
    userId?: string,
  ) {
    if (kind === 'subcategory') {
      const [current, communicationCount] = await Promise.all([
        this.prisma.subcategory.findFirst({
          where: { id, isActive: true },
          select: { id: true, name: true },
        }),
        this.prisma.communicationSubcategory.count({
          where: { subcategoryId: id },
        }),
      ]);
      if (!current) throw new NotFoundException('Subcategoria não encontrada.');
      if (communicationCount)
        throw new ConflictException(
          'Esta subcategoria está associada a comunicações e não pode ser eliminada.',
        );
      await this.prisma.subcategory.update({
        where: { id },
        data: { isActive: false },
      });
      await this.writeTaxonomyAudit(
        'DELETE',
        'subcategory',
        id,
        { name: current.name },
        userId,
      );
      this.invalidateFiltersCache();
      return { status: true, data: { id } };
    }
    const current = await this.prisma.category.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        _count: { select: { subcategories: true } },
      },
    });
    if (!current) throw new NotFoundException('Categoria não encontrada.');
    if (current._count.subcategories)
      throw new ConflictException(
        'Elimine primeiro as subcategorias desta categoria.',
      );
    await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    await this.writeTaxonomyAudit(
      'DELETE',
      'category',
      id,
      { name: current.name },
      userId,
    );
    this.invalidateFiltersCache();
    return { status: true, data: { id } };
  }

  async reorderTaxonomy(
    body: { ids?: string[]; parentId?: string | null },
    userId?: string,
  ) {
    const ids = [...new Set(body.ids ?? [])];
    if (!ids.length)
      throw new BadRequestException('A nova ordem é obrigatória.');
    const count = body.parentId
      ? await this.prisma.categorySubcategory.count({
          where: {
            categoryId: body.parentId,
            subcategoryId: { in: ids },
            subcategory: { isActive: true },
          },
        })
      : await this.prisma.category.count({
          where: { id: { in: ids }, isActive: true },
        });
    if (count !== ids.length)
      throw new BadRequestException('A ordem contém categorias inválidas.');
    await this.prisma.$transaction(
      ids.map((id, sortOrder) =>
        body.parentId
          ? this.prisma.categorySubcategory.update({
              where: {
                categoryId_subcategoryId: {
                  categoryId: body.parentId,
                  subcategoryId: id,
                },
              },
              data: { sortOrder },
            })
          : this.prisma.category.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    await this.writeTaxonomyAudit(
      'UPDATE',
      body.parentId ? 'subcategory' : 'category',
      body.parentId ?? null,
      { operation: 'reorder', ids, parentId: body.parentId ?? null },
      userId,
    );
    this.invalidateFiltersCache();
    return { status: true, data: { ids } };
  }

  async assignSubcategory(
    body: { categoryId?: string; subcategoryId?: string; sortOrder?: number },
    userId?: string,
  ) {
    if (!body.categoryId || !body.subcategoryId)
      throw new BadRequestException(
        'A categoria e a subcategoria são obrigatórias.',
      );
    const requestedSortOrder = Number.isInteger(body.sortOrder)
      ? Math.max(0, body.sortOrder!)
      : null;
    const [assignment] = await this.prisma.$queryRaw<
      Array<{
        categoryId: string;
        categoryName: string;
        subcategoryId: string;
        inserted: boolean;
        requestedPosition: number;
      }>
    >`
      WITH valid AS (
        SELECT c.id AS category_id, c.name AS category_name, s.id AS subcategory_id
        FROM categories c
        CROSS JOIN subcategories s
        WHERE c.id = ${body.categoryId}
          AND s.id = ${body.subcategoryId}
          AND c.is_active = true
          AND s.is_active = true
      ), inserted AS (
        INSERT INTO category_subcategories (category_id, subcategory_id, sort_order)
        SELECT
          valid.category_id,
          valid.subcategory_id,
          COALESCE((
            SELECT MAX(cs.sort_order) + 1
            FROM category_subcategories cs
            WHERE cs.category_id = valid.category_id
          ), 0)
        FROM valid
        ON CONFLICT (category_id, subcategory_id) DO NOTHING
        RETURNING category_id, subcategory_id
      )
      SELECT
        valid.category_id AS "categoryId",
        valid.category_name AS "categoryName",
        valid.subcategory_id AS "subcategoryId",
        EXISTS (SELECT 1 FROM inserted) AS inserted,
        LEAST(
          COALESCE(${requestedSortOrder}::integer, (SELECT COUNT(*) FROM category_subcategories cs WHERE cs.category_id = valid.category_id)),
          (SELECT COUNT(*) FROM category_subcategories cs WHERE cs.category_id = valid.category_id)
        )::integer AS "requestedPosition"
      FROM valid
    `;
    if (!assignment)
      throw new BadRequestException('A categoria ou subcategoria não existe.');
    if (assignment.inserted) {
      if (requestedSortOrder !== null) {
        await this.prisma.$transaction([
          this.prisma.$executeRaw`
            WITH ranked AS (
              SELECT
                subcategory_id,
                ROW_NUMBER() OVER (ORDER BY sort_order ASC, subcategory_id ASC) - 1 AS position
              FROM category_subcategories
              WHERE category_id = ${assignment.categoryId}
                AND subcategory_id <> ${assignment.subcategoryId}
            )
            UPDATE category_subcategories cs
            SET sort_order = CASE
              WHEN ranked.position >= ${assignment.requestedPosition}
                THEN ranked.position + 1
              ELSE ranked.position
            END
            FROM ranked
            WHERE cs.category_id = ${assignment.categoryId}
              AND cs.subcategory_id = ranked.subcategory_id
          `,
          this.prisma.categorySubcategory.update({
            where: {
              categoryId_subcategoryId: {
                categoryId: assignment.categoryId,
                subcategoryId: assignment.subcategoryId,
              },
            },
            data: { sortOrder: assignment.requestedPosition },
          }),
        ]);
      }
      await this.writeTaxonomyAudit(
        'UPDATE',
        'subcategory',
        assignment.subcategoryId,
        {
          operation: 'assign',
          categoryId: assignment.categoryId,
          category: assignment.categoryName,
        },
        userId,
      );
    }
    this.invalidateFiltersCache();
    return {
      status: true,
      data: {
        categoryId: assignment.categoryId,
        subcategoryId: assignment.subcategoryId,
      },
    };
  }

  async unassignSubcategory(
    categoryId: string,
    subcategoryId: string,
    userId?: string,
  ) {
    const assignment = await this.prisma.categorySubcategory.delete({
      where: { categoryId_subcategoryId: { categoryId, subcategoryId } },
      select: {
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
      },
    });
    await this.writeTaxonomyAudit(
      'UPDATE',
      'subcategory',
      subcategoryId,
      {
        operation: 'unassign',
        categoryId,
        category: assignment.category.name,
        subcategory: assignment.subcategory.name,
      },
      userId,
    );
    this.invalidateFiltersCache();
    return { status: true, data: { categoryId, subcategoryId } };
  }

  private async writeTaxonomyAudit(
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityType: 'category' | 'subcategory',
    entityId: string | null,
    changes: JsonObject,
    gboxUserId?: string,
  ) {
    const actor = gboxUserId
      ? await this.prisma.user.findUnique({
          where: { gboxUserId },
          select: { id: true },
        })
      : null;
    return this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action,
        entityType,
        entityId,
        changes: this.toJson(changes),
      },
    });
  }

  private async resolveCommunication(type: string, code: string) {
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    const repositoryChannel = await this.prisma.channel.findUnique({
      where: { key: channel },
      select: { id: true },
    });
    if (!repositoryChannel)
      throw new NotFoundException('Comunicação não encontrada.');
    const communication = await this.prisma.communication.findFirst({
      where: { code, channelId: repositoryChannel.id },
      select: { id: true },
    });
    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');
    return communication;
  }

  private async requireCommentAuthor(gboxUserId?: string) {
    if (!gboxUserId)
      throw new UnauthorizedException(
        'É necessário iniciar sessão para comentar.',
      );
    const author = await this.prisma.user.findUnique({
      where: { gboxUserId },
      select: { id: true },
    });
    if (!author) throw new UnauthorizedException('Utilizador não encontrado.');
    return author;
  }

  private commentContent(content?: string) {
    const value = content?.trim();
    if (!value)
      throw new BadRequestException('O comentário não pode estar vazio.');
    if (value.length > 2000)
      throw new BadRequestException(
        'O comentário não pode exceder 2000 caracteres.',
      );
    return value;
  }

  private normalizeCommunicationValues(
    values: string[] | undefined,
    field: 'tags' | 'services' | 'teams',
    maxLength: number,
  ) {
    if (values === undefined) return undefined;
    const normalized = [
      ...new Set(
        values
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (normalized.some((value) => value.length > maxLength)) {
      throw new BadRequestException(
        `O campo ${field} contém valores demasiado longos.`,
      );
    }
    return normalized;
  }

  private sameStringValues(left: string[], right: string[]) {
    const normalizedLeft = [...new Set(left)].sort();
    const normalizedRight = [...new Set(right)].sort();
    return (
      normalizedLeft.length === normalizedRight.length &&
      normalizedLeft.every((value, index) => value === normalizedRight[index])
    );
  }

  async commentAuthors() {
    const data = await this.prisma.user.findMany({
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });
    return { status: true, data };
  }

  async communicationComments(
    type: string,
    code: string,
    query: {
      page?: string;
      pageSize?: string;
      authorId?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    const communication = await this.resolveCommunication(type, code);
    const parsedPage = Number.parseInt(query.page ?? '1', 10);
    const parsedPageSize = Number.parseInt(query.pageSize ?? '5', 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const pageSize = Number.isFinite(parsedPageSize)
      ? Math.min(50, Math.max(1, parsedPageSize))
      : 5;
    const parseDate = (value: string | undefined, endOfDay = false) => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new BadRequestException('A data indicada não é válida.');
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException('A data indicada não é válida.');
      if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
      return date;
    };
    const dateFrom = parseDate(query.dateFrom);
    const dateToExclusive = parseDate(query.dateTo, true);
    if (dateFrom && dateToExclusive && dateFrom >= dateToExclusive)
      throw new BadRequestException(
        'A data inicial não pode ser posterior à data final.',
      );

    const where: Prisma.CommunicationCommentWhereInput = {
      communicationId: communication.id,
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(dateFrom || dateToExclusive
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateToExclusive ? { lt: dateToExclusive } : {}),
            },
          }
        : {}),
    };
    const commentSelect = {
      id: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      author: {
        select: {
          id: true,
          displayName: true,
          username: true,
          avatarUrl: true,
          gboxUserId: true,
        },
      },
    } satisfies Prisma.CommunicationCommentSelect;
    const [items, total] = await Promise.all([
      this.prisma.communicationComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: commentSelect,
      }),
      this.prisma.communicationComment.count({ where }),
    ]);
    return {
      status: true,
      data: {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async createCommunicationComment(
    type: string,
    code: string,
    body: { content?: string },
    gboxUserId?: string,
  ) {
    const content = this.commentContent(body.content);
    const [communication, author] = await Promise.all([
      this.resolveCommunication(type, code),
      this.requireCommentAuthor(gboxUserId),
    ]);
    const data = await this.prisma.communicationComment.create({
      data: { communicationId: communication.id, authorId: author.id, content },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            gboxUserId: true,
          },
        },
      },
    });
    return { status: true, data };
  }

  async updateCommunicationComment(
    type: string,
    code: string,
    commentId: string,
    body: { content?: string },
    gboxUserId?: string,
  ) {
    const content = this.commentContent(body.content);
    const [communication, author] = await Promise.all([
      this.resolveCommunication(type, code),
      this.requireCommentAuthor(gboxUserId),
    ]);
    const current = await this.prisma.communicationComment.findFirst({
      where: { id: commentId, communicationId: communication.id },
      select: { authorId: true },
    });
    if (!current) throw new NotFoundException('Comentário não encontrado.');
    if (current.authorId !== author.id)
      throw new ForbiddenException('Só pode editar os seus comentários.');
    const data = await this.prisma.communicationComment.update({
      where: { id: commentId },
      data: { content },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            gboxUserId: true,
          },
        },
      },
    });
    return { status: true, data };
  }

  async deleteCommunicationComment(
    type: string,
    code: string,
    commentId: string,
    gboxUserId?: string,
  ) {
    const [communication, author] = await Promise.all([
      this.resolveCommunication(type, code),
      this.requireCommentAuthor(gboxUserId),
    ]);
    const current = await this.prisma.communicationComment.findFirst({
      where: { id: commentId, communicationId: communication.id },
      select: { authorId: true },
    });
    if (!current) throw new NotFoundException('Comentário não encontrado.');
    if (current.authorId !== author.id)
      throw new ForbiddenException('Só pode eliminar os seus comentários.');
    await this.prisma.communicationComment.delete({ where: { id: commentId } });
    return { status: true, data: { id: commentId } };
  }

  async updateCommunicationProperties(
    type: string,
    code: string,
    body: {
      name?: string | null;
      description?: string | null;
      tags?: string[];
      services?: string[];
      teams?: string[];
    },
    gboxUserId?: string,
  ) {
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    if (channel !== 'SMS') {
      throw new BadRequestException(
        'A edição avançada está disponível apenas para comunicações SMS.',
      );
    }
    await this.assertFullSmsEditingEnabled();

    const name =
      body.name === undefined ? undefined : body.name?.trim() || null;
    if (name !== undefined && !name)
      throw new BadRequestException(
        'O nome da comunicação não pode estar vazio.',
      );
    if ((name?.length ?? 0) > 255)
      throw new BadRequestException('O nome da comunicação é demasiado longo.');

    const description =
      body.description === undefined
        ? undefined
        : body.description?.trim() || null;
    if ((description?.length ?? 0) > 4000)
      throw new BadRequestException(
        'As observações não podem exceder 4000 caracteres.',
      );

    const tags = this.normalizeCommunicationValues(body.tags, 'tags', 100);
    const services = this.normalizeCommunicationValues(
      body.services,
      'services',
      120,
    );
    const teams = this.normalizeCommunicationValues(body.teams, 'teams', 120);

    const [communication, actor] = await Promise.all([
      this.prisma.communication.findFirst({
        where: {
          code,
          channel: { key: channel },
        },
        select: {
          id: true,
          name: true,
          description: true,
          tags: { include: { tag: { select: { name: true } } } },
          services: {
            include: { service: { select: { name: true } } },
          },
          teams: { include: { team: { select: { name: true } } } },
        },
      }),
      gboxUserId
        ? this.prisma.user.findUnique({
            where: { gboxUserId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');

    const currentTags = [
      ...new Set(communication.tags.map(({ tag }) => tag.name)),
    ];
    const currentServices = [
      ...new Set(communication.services.map(({ service }) => service.name)),
    ];
    const currentTeams = [
      ...new Set(communication.teams.map(({ team }) => team.name)),
    ];

    const nextDescription =
      description === undefined ? communication.description : description;
    const nextName = name === undefined ? communication.name : name;
    const nextTags = tags ?? currentTags;
    const nextServices = services ?? currentServices;
    const nextTeams = teams ?? currentTeams;

    const nameChanged = name !== undefined && nextName !== communication.name;
    const descriptionChanged =
      description !== undefined &&
      nextDescription !== communication.description;
    const tagsChanged =
      tags !== undefined && !this.sameStringValues(currentTags, nextTags);
    const servicesChanged =
      services !== undefined &&
      !this.sameStringValues(currentServices, nextServices);
    const teamsChanged =
      teams !== undefined && !this.sameStringValues(currentTeams, nextTeams);

    if (
      !nameChanged &&
      !descriptionChanged &&
      !tagsChanged &&
      !servicesChanged &&
      !teamsChanged
    ) {
      return {
        status: true,
        data: {
          name: communication.name,
          description: communication.description ?? '',
          tags: currentTags,
          services: currentServices,
          teams: currentTeams,
        },
      };
    }

    if (nameChanged || descriptionChanged) {
      await this.prisma.communication.update({
        where: { id: communication.id },
        data: {
          ...(nameChanged ? { name: nextName! } : {}),
          ...(descriptionChanged ? { description: nextDescription } : {}),
        },
      });
    }

    if (tagsChanged) {
      const tagIds: string[] = [];
      for (const name of nextTags) {
        const slug = this.slug(name);
        const existingTag = await this.prisma.tag.findFirst({
          where: {
            OR: [{ name }, { slug }],
          },
          select: { id: true },
        });
        const tag =
          existingTag ??
          (await this.prisma.tag.create({
            data: { name, slug },
            select: { id: true },
          }));
        tagIds.push(tag.id);
      }

      await this.prisma.communicationTag.deleteMany({
        where: { communicationId: communication.id },
      });
      if (tagIds.length) {
        await this.prisma.communicationTag.createMany({
          data: tagIds.map((tagId) => ({
            communicationId: communication.id,
            tagId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (servicesChanged) {
      const serviceIds: string[] = [];
      for (const name of nextServices) {
        const service = await this.prisma.service.upsert({
          where: { name },
          update: { isActive: true },
          create: { name, slug: this.slug(name), isActive: true },
          select: { id: true },
        });
        serviceIds.push(service.id);
      }

      await this.prisma.communicationService.deleteMany({
        where: { communicationId: communication.id },
      });
      if (serviceIds.length) {
        await this.prisma.communicationService.createMany({
          data: serviceIds.map((serviceId) => ({
            communicationId: communication.id,
            serviceId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (teamsChanged) {
      const teamIds: string[] = [];
      for (const name of nextTeams) {
        const team = await this.prisma.team.upsert({
          where: { name },
          update: { isActive: true },
          create: { name, slug: this.slug(name), isActive: true },
          select: { id: true },
        });
        teamIds.push(team.id);
      }

      await this.prisma.communicationTeam.deleteMany({
        where: { communicationId: communication.id },
      });
      if (teamIds.length) {
        await this.prisma.communicationTeam.createMany({
          data: teamIds.map((teamId) => ({
            communicationId: communication.id,
            teamId,
          })),
          skipDuplicates: true,
        });
      }
    }

    const fields: Record<string, { previous: unknown; current: unknown }> = {};
    if (nameChanged) {
      fields.name = {
        previous: communication.name,
        current: nextName ?? '',
      };
    }
    if (descriptionChanged) {
      fields.description = {
        previous: communication.description ?? '',
        current: nextDescription ?? '',
      };
    }
    if (tagsChanged) {
      fields.tags = { previous: currentTags, current: nextTags };
    }
    if (servicesChanged) {
      fields.services = { previous: currentServices, current: nextServices };
    }
    if (teamsChanged) {
      fields.teams = { previous: currentTeams, current: nextTeams };
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action: 'UPDATE',
        entityType: 'communication',
        entityId: communication.id,
        changes: this.toJson({ operation: 'properties', fields }),
      },
    });

    await this.updateTemplateSnapshotProperties(channel, code, {
      name: nextName ?? communication.name,
      description: nextDescription ?? '',
      tags: nextTags,
      services: nextServices,
      teams: nextTeams,
    });

    this.invalidateTemplatesCache();
    this.invalidateFiltersCache();
    return {
      status: true,
      data: {
        name: nextName ?? communication.name,
        description: nextDescription ?? '',
        tags: nextTags,
        services: nextServices,
        teams: nextTeams,
      },
    };
  }

  async updateCommunicationContent(
    type: string,
    code: string,
    body: { version?: string; locale?: string; content?: string | null },
    gboxUserId?: string,
  ) {
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    if (channel !== 'SMS') {
      throw new BadRequestException(
        'A edição avançada está disponível apenas para comunicações SMS.',
      );
    }
    await this.assertFullSmsEditingEnabled();

    const locale = (body.locale?.trim() || 'PT').toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(locale)) {
      throw new BadRequestException('Idioma inválido.');
    }

    const content = body.content === null ? '' : (body.content ?? '');
    if (content.length > 5000) {
      throw new BadRequestException(
        'O conteúdo SMS não pode exceder 5000 caracteres.',
      );
    }

    const [communication, actor] = await Promise.all([
      this.prisma.communication.findFirst({
        where: { code, channel: { key: channel } },
        select: {
          id: true,
          versions: {
            orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              id: true,
              version: true,
              localizations: {
                select: { id: true, locale: true, content: true },
              },
            },
          },
        },
      }),
      gboxUserId
        ? this.prisma.user.findUnique({
            where: { gboxUserId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');

    const selectedVersion = body.version
      ? communication.versions.find(({ version }) => version === body.version)
      : communication.versions[0];
    if (!selectedVersion)
      throw new NotFoundException('Versão da comunicação não encontrada.');

    const localization =
      selectedVersion.localizations.find(
        (item) => item.locale.toUpperCase() === locale,
      ) ?? selectedVersion.localizations[0];
    if (!localization)
      throw new NotFoundException('Localização da comunicação não encontrada.');

    const previous = localization.content ?? '';
    if (previous === content) {
      return {
        status: true,
        data: { version: selectedVersion.version, locale, content },
      };
    }

    await this.prisma.communicationLocalization.update({
      where: { id: localization.id },
      data: { content },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action: 'UPDATE',
        entityType: 'communication',
        entityId: communication.id,
        changes: this.toJson({
          operation: 'content',
          fields: {
            content: {
              previous,
              current: content,
              version: selectedVersion.version,
              locale,
            },
          },
        }),
      },
    });

    await this.updateTemplateSnapshotContent(
      channel,
      code,
      selectedVersion.version,
      locale,
      content,
    );

    this.invalidateTemplatesCache();
    return {
      status: true,
      data: { version: selectedVersion.version, locale, content },
    };
  }

  async updateCommunicationTaxonomy(
    type: string,
    code: string,
    body: { categoryIds?: string[]; subcategoryIds?: string[] },
    gboxUserId?: string,
  ) {
    const categoryIds = [...new Set(body.categoryIds ?? [])];
    const subcategoryIds = [...new Set(body.subcategoryIds ?? [])];
    if (!categoryIds.length || !subcategoryIds.length)
      throw new BadRequestException(
        'É obrigatória pelo menos uma categoria e uma subcategoria.',
      );
    const channel = type.toUpperCase() === 'PUSH' ? 'BLIP' : type.toUpperCase();
    const repositoryChannel = await this.prisma.channel.findUnique({
      where: { key: channel },
      select: { id: true },
    });
    if (!repositoryChannel)
      throw new NotFoundException('Comunicação não encontrada.');
    const [communication, assignments, actor] = await Promise.all([
      this.prisma.communication.findFirst({
        where: { code, channelId: repositoryChannel.id },
        select: {
          id: true,
          subcategories: {
            select: {
              category: { select: { name: true } },
              subcategory: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.categorySubcategory.findMany({
        where: {
          categoryId: { in: categoryIds },
          subcategoryId: { in: subcategoryIds },
          category: { isActive: true },
          subcategory: { isActive: true },
        },
        select: {
          category: { select: { id: true, name: true } },
          subcategory: { select: { id: true, name: true } },
        },
      }),
      gboxUserId
        ? this.prisma.user.findUnique({
            where: { gboxUserId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!communication)
      throw new NotFoundException('Comunicação não encontrada.');
    const matchedCategoryIds = new Set(
      assignments.map(({ category }) => category.id),
    );
    const matchedSubcategoryIds = new Set(
      assignments.map(({ subcategory }) => subcategory.id),
    );
    if (
      matchedCategoryIds.size !== categoryIds.length ||
      matchedSubcategoryIds.size !== subcategoryIds.length
    )
      throw new BadRequestException(
        'Cada categoria e subcategoria selecionada deve formar pelo menos uma combinação válida.',
      );

    const categoryNames = [
      ...new Set(assignments.map(({ category }) => category.name)),
    ];
    const subcategoryNames = [
      ...new Set(assignments.map(({ subcategory }) => subcategory.name)),
    ];

    const previous = communication.subcategories.map(
      ({ category, subcategory: item }) => ({
        category: category.name,
        subcategory: item.name,
      }),
    );
    // Supabase Data API operations are HTTP requests. Passing already-started
    // promises to `$transaction` runs the delete and inserts concurrently, so
    // an unchanged assignment can be inserted before its old row is removed.
    await this.prisma.communicationSubcategory.deleteMany({
      where: { communicationId: communication.id },
    });
    await this.prisma.communicationSubcategory.createMany({
      data: assignments.map((assignment) => ({
        communicationId: communication.id,
        categoryId: assignment.category.id,
        subcategoryId: assignment.subcategory.id,
      })),
      skipDuplicates: true,
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id,
        action: 'UPDATE',
        entityType: 'communication',
        entityId: communication.id,
        changes: this.toJson({
          operation: 'taxonomy',
          previous,
          categories: categoryNames,
          subcategories: subcategoryNames,
        }),
      },
    });
    await this.prisma.$executeRaw`
      UPDATE repository_snapshots
      SET payload = jsonb_set(
        jsonb_set(payload, ARRAY[${channel}, ${code}, 'categoria']::text[], ${JSON.stringify(categoryNames)}::jsonb, true),
        ARRAY[${channel}, ${code}, 'subcategoria']::text[], ${JSON.stringify(subcategoryNames)}::jsonb, true
      ), synced_at = NOW()
      WHERE key = 'gbox-templates'
    `;
    this.invalidateTemplatesCache();
    return {
      status: true,
      data: {
        categories: categoryNames,
        subcategories: subcategoryNames,
      },
    };
  }

  private slug(value: string) {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'category'
    );
  }

  async sync(authorization?: string, userId?: string | number) {
    if (!authorization)
      throw new HttpException(
        { status: false, message: 'Authorization is required.' },
        401,
      );
    const activeRun = await this.prisma.syncRun.findFirst({
      where: { status: 'RUNNING', source: { in: ['GBOX', 'GBOX_DETAILS'] } },
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
            .map(
              ({ type, code, locale, message }) =>
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
      this.invalidateFiltersCache();
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

  async syncRows(authorization?: string) {
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

    const payload = await this.request('/repo/', {
      headers: { Authorization: authorization },
    });
    await this.saveSnapshot('gbox-repo-original', payload);
    const templates = this.unwrapTemplates(payload);
    const run = await this.importer.import(templates);
    const completed = await this.prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
    this.cacheTemplates(templates);
    this.invalidateFiltersCache();
    return { status: true, data: completed };
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
        samples.every(({ message }) => this.isAuthenticationMessage(message));
      const error = samples.length
        ? samples
            .map(
              ({ type, code, locale, message }) =>
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
    const token =
      this.isObject(payload) && this.isObject(payload.data)
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
      select: { id: true, displayName: true, email: true },
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
          data: {
            gboxUserId,
            username: rawUsername,
            lastLoginAt: values.lastLoginAt,
            ...(!existing.displayName && values.displayName
              ? { displayName: values.displayName }
              : {}),
            ...(!existing.email && values.email ? { email: values.email } : {}),
          },
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

  private withAppSession(
    payload: unknown,
    appRole?: string,
    lifetimeSeconds = 8 * 60 * 60,
  ) {
    if (
      !this.isObject(payload) ||
      !this.isObject(payload.data) ||
      !this.isObject(payload.data.user)
    )
      return payload;
    const gboxToken = this.firstString(payload.data.token);
    const userId = payload.data.user.id ?? payload.data.user.iUserId;
    const username = this.firstString(payload.data.user.username);
    if (
      !gboxToken ||
      (typeof userId !== 'string' && typeof userId !== 'number') ||
      !username
    )
      throw new BadGatewayException('GBox returned an invalid login payload.');
    return {
      ...payload,
      data: {
        ...payload.data,
        token: this.appTokens.issue(userId, username, lifetimeSeconds),
        gboxToken,
        expiresIn: lifetimeSeconds,
        user: { ...payload.data.user, ...(appRole ? { role: appRole } : {}) },
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

  private parseGboxDate(value?: string) {
    if (!value) return null;
    const date = new Date(value.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private cacheTemplates(data: GboxTemplates) {
    this.templatesCache = { data, expiresAt: Date.now() + 30_000 };
  }

  private filterTemplatesByActivity(
    templates: GboxTemplates,
    activity: 'all' | 'active' | 'pending' | 'inactive',
  ): GboxTemplates {
    if (activity === 'all') return templates;

    const filtered: GboxTemplates = {};
    for (const [channel, channelTemplates] of Object.entries(templates)) {
      if (!channelTemplates || Array.isArray(channelTemplates)) {
        filtered[channel] = channelTemplates;
        continue;
      }

      filtered[channel] = Object.fromEntries(
        Object.entries(channelTemplates).filter(([, template]) => {
          const versions = Object.values(template.versoes ?? {});
          if (activity === 'inactive') return versions.length === 0;
          if (versions.length === 0) return false;

          const newestLaunch = versions
            .map((version) => this.parseGboxDate(version.dataVersao))
            .filter((date): date is Date => Boolean(date))
            .sort((left, right) => right.getTime() - left.getTime())[0];
          const isPending = Boolean(newestLaunch && newestLaunch > new Date());
          return activity === 'pending' ? isPending : !isPending;
        }),
      );
    }

    return filtered;
  }

  private invalidateTemplatesCache() {
    this.templatesCache = undefined;
  }

  private async assertFullSmsEditingEnabled() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
      select: { fullSmsEditingEnabled: true },
    });
    if (!config?.fullSmsEditingEnabled) {
      throw new ForbiddenException(
        'A edição completa de SMS está desativada. Apenas categoria e subcategoria podem ser alteradas.',
      );
    }
  }

  private invalidateFiltersCache() {
    this.filtersCache = undefined;
    this.taxonomyCache = undefined;
    this.taxonomyGeneration += 1;
  }

  private async saveSnapshot(key: string, payload: unknown) {
    const syncedAt = new Date();
    await this.prisma.repositorySnapshot.upsert({
      where: { key },
      update: { payload: this.toJson(payload), syncedAt },
      create: { key, payload: this.toJson(payload), syncedAt },
    });
  }

  private async updateTemplateSnapshotProperties(
    channel: string,
    code: string,
    values: {
      name: string;
      description: string;
      tags: string[];
      services: string[];
      teams: string[];
    },
  ) {
    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (!snapshot || !this.isObject(snapshot.payload)) return;

    const payload = JSON.parse(JSON.stringify(snapshot.payload)) as JsonObject;
    const channelData = payload[channel];
    if (!this.isObject(channelData)) return;
    const communication = channelData[code];
    if (!this.isObject(communication)) return;

    communication.nome = values.name;
    communication.desc = values.description;
    communication.tags = values.tags;
    communication.servico = values.services;
    communication.equipa = values.teams;

    await this.prisma.repositorySnapshot.update({
      where: { key: 'gbox-templates' },
      data: { payload: this.toJson(payload), syncedAt: new Date() },
    });
  }

  private async updateTemplateSnapshotContent(
    channel: string,
    code: string,
    version: string,
    locale: string,
    content: string,
  ) {
    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { key: 'gbox-templates' },
      select: { payload: true },
    });
    if (!snapshot || !this.isObject(snapshot.payload)) return;

    const payload = JSON.parse(JSON.stringify(snapshot.payload)) as JsonObject;
    const channelData = payload[channel];
    if (!this.isObject(channelData)) return;
    const communication = channelData[code];
    if (!this.isObject(communication)) return;

    const versions = this.isObject(communication.versoes)
      ? (communication.versoes as JsonObject)
      : {};
    const versionValue = versions[version];
    const versionEntry = this.isObject(versionValue)
      ? (versionValue as JsonObject)
      : {};
    const localeValue = versionEntry[locale];
    const localeEntry = this.isObject(localeValue)
      ? (localeValue as JsonObject)
      : {};

    localeEntry.text = content;
    versionEntry[locale] = localeEntry;
    versions[version] = versionEntry;
    communication.versoes = versions;

    await this.prisma.repositorySnapshot.update({
      where: { key: 'gbox-templates' },
      data: { payload: this.toJson(payload), syncedAt: new Date() },
    });
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

import crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalDecisionType,
  AuditAction,
  DeploymentTrigger,
  Prisma,
  VersionStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WorkflowAccessService } from './workflow-access.service';
import { RepoService } from '../repo/repo.service';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkflowAccessService,
    private readonly repo: RepoService,
  ) {}

  async variableCatalog(channelKey = 'SMS', gboxUserId?: string) {
    await this.access.user(gboxUserId);
    const normalizedChannel = channelKey.trim().toUpperCase();
    const variables = await this.prisma.communicationVariable.findMany({
      where: {
        version: { communication: { channel: { key: normalizedChannel } } },
      },
      select: {
        key: true,
        description: true,
        placeholder: true,
        sampleValue: true,
        isRequired: true,
        version: {
          select: {
            communication: { select: { channel: { select: { key: true } } } },
          },
        },
      },
      orderBy: [{ key: 'asc' }, { sortOrder: 'asc' }],
    });
    const catalog = new Map<
      string,
      {
        key: string;
        description: string | null;
        placeholder: string | null;
        sampleValue: string | null;
        isRequired: boolean;
        usageCount: number;
      }
    >();
    for (const variable of variables) {
      const { version: _version, ...variableData } = variable;
      const existing = catalog.get(variable.key);
      if (!existing) {
        catalog.set(variable.key, { ...variableData, usageCount: 1 });
        continue;
      }
      existing.usageCount += 1;
      existing.description ||= variable.description;
      existing.placeholder ||= variable.placeholder;
      existing.sampleValue ||= variable.sampleValue;
      existing.isRequired ||= variable.isRequired;
    }
    return {
      status: true,
      data: [...catalog.values()].sort(
        (left, right) =>
          right.usageCount - left.usageCount ||
          left.key.localeCompare(right.key, 'pt-PT'),
      ),
    };
  }

  async createCommunication(
    body: {
      code?: string;
      name?: string;
      description?: string;
      channelId?: string;
      ownerTeamId?: string;
      categoryIds?: string[];
      subcategoryIds?: string[];
      serviceIds?: string[];
      tagNames?: string[];
      locale?: string;
      content?: string;
    },
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const name = body.name?.trim();
    const code = body.code?.trim() || this.communicationCode(name ?? '');
    const locale = body.locale?.trim().toUpperCase() || 'PT';
    if (locale !== 'PT')
      throw new BadRequestException(
        'De momento, o idioma tem de ser Português.',
      );
    if (!code || !name || !body.channelId || !body.ownerTeamId) {
      throw new BadRequestException(
        'Código, nome, canal e equipa responsável são obrigatórios.',
      );
    }
    if (!body.content?.trim())
      throw new BadRequestException('O conteúdo inicial é obrigatório.');
    const categoryIds = [...new Set(body.categoryIds ?? [])];
    const subcategoryIds = [...new Set(body.subcategoryIds ?? [])];
    if (!categoryIds.length || !subcategoryIds.length)
      throw new BadRequestException(
        'Selecione pelo menos uma categoria e uma subcategoria.',
      );
    const serviceIds = [...new Set(body.serviceIds ?? [])];
    const tagNames = [
      ...new Map(
        (body.tagNames ?? []).map((value) => [
          value.trim().toLocaleLowerCase('pt-PT'),
          value.trim(),
        ]),
      ).values(),
    ].filter(Boolean);
    if (tagNames.some((tag) => tag.length > 100))
      throw new BadRequestException(
        'As tags não podem exceder 100 caracteres.',
      );
    if (!serviceIds.length)
      throw new BadRequestException('Selecione pelo menos um serviço.');
    await this.access.requireTeamRole(actor.id, body.ownerTeamId, [
      'EDITOR',
      'OWNER',
    ]);
    const [channel, team, duplicate, taxonomyPairs, services] =
      await Promise.all([
        this.prisma.channel.findUnique({
          where: { id: body.channelId },
          select: { id: true, key: true },
        }),
        this.prisma.team.findUnique({
          where: { id: body.ownerTeamId },
          select: { id: true, isActive: true },
        }),
        this.prisma.communication.findFirst({
          where: { channelId: body.channelId, code },
          select: {
            id: true,
            status: true,
            sourceSystem: true,
            ownerTeamId: true,
            versions: { select: { id: true }, take: 1 },
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
            categoryId: true,
            subcategoryId: true,
          },
        }),
        this.prisma.service.findMany({
          where: { id: { in: serviceIds }, isActive: true },
          select: { id: true },
        }),
      ]);
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    if (channel.key !== 'SMS')
      throw new BadRequestException(
        'De momento, apenas podem ser criadas comunicações SMS.',
      );
    if (!team?.isActive)
      throw new BadRequestException('A equipa responsável não está ativa.');
    if (duplicate) {
      const incompleteLocalCreate =
        duplicate.status === 'PENDING' &&
        !duplicate.sourceSystem &&
        duplicate.ownerTeamId === body.ownerTeamId &&
        duplicate.versions.length === 0;
      if (incompleteLocalCreate) {
        await this.prisma.communication.delete({ where: { id: duplicate.id } });
      } else {
        throw new ConflictException(
          'Já existe uma comunicação com este código e canal.',
        );
      }
    }
    const matchedCategoryIds = new Set(
      taxonomyPairs.map((pair) => pair.categoryId),
    );
    const matchedSubcategoryIds = new Set(
      taxonomyPairs.map((pair) => pair.subcategoryId),
    );
    if (
      matchedCategoryIds.size !== categoryIds.length ||
      matchedSubcategoryIds.size !== subcategoryIds.length
    )
      throw new BadRequestException(
        'Cada categoria e subcategoria deve formar pelo menos uma combinação válida.',
      );
    if (services.length !== serviceIds.length)
      throw new BadRequestException(
        'Um dos serviços selecionados não está disponível.',
      );
    const invalidTag = tagNames.find((name) => !this.slug(name));
    if (invalidTag)
      throw new BadRequestException(
        `A tag “${invalidTag}” deve incluir letras ou números.`,
      );
    const tagIds: string[] = [];
    for (const name of tagNames) {
      const slug = this.slug(name);
      const existingTag = await this.prisma.tag.findFirst({
        where: { OR: [{ name }, { slug }] },
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
    const contentVariableKeys = [
      ...new Set(
        [...body.content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) =>
          match[1].trim(),
        ),
      ),
    ];
    const storedVariables = contentVariableKeys.length
      ? await this.prisma.communicationVariable.findMany({
          where: {
            key: { in: contentVariableKeys },
            version: { communication: { channelId: body.channelId } },
          },
          select: {
            key: true,
            description: true,
            placeholder: true,
            sampleValue: true,
            isRequired: true,
            version: {
              select: {
                communication: { select: { channelId: true } },
              },
            },
          },
          orderBy: { version: { updatedAt: 'desc' } },
        })
      : [];
    const variablesByKey = new Map(
      storedVariables.map(({ version: _version, ...variable }) => [
        variable.key,
        variable,
      ]),
    );
    const unknownVariable = contentVariableKeys.find(
      (key) => !variablesByKey.has(key),
    );
    if (unknownVariable) {
      throw new BadRequestException(
        `A variável “${unknownVariable}” não existe no catálogo do canal.`,
      );
    }
    const communication = await this.prisma.communication.create({
      data: {
        code,
        name,
        description: body.description?.trim() || null,
        channelId: body.channelId,
        ownerTeamId: body.ownerTeamId,
        status: 'PENDING',
        subcategories: {
          create: taxonomyPairs.map(({ categoryId, subcategoryId }) => ({
            categoryId,
            subcategoryId,
          })),
        },
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
        teams: { create: { teamId: body.ownerTeamId } },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      select: {
        id: true,
        code: true,
        name: true,
        ownerTeamId: true,
      },
    });
    const version = await this.prisma.communicationVersion.create({
      data: {
        communicationId: communication.id,
        version: 'v1',
        revision: 1,
        status: 'DRAFT',
        createdById: actor.id,
        changeSummary: null,
        localizations: {
          create: { locale, subject: null, content: body.content },
        },
        variables: {
          create: contentVariableKeys.map((key, sortOrder) => ({
            ...variablesByKey.get(key)!,
            sortOrder,
          })),
        },
      },
      select: { id: true, version: true, status: true },
    });
    await this.record(actor.id, 'CREATE', communication.id, {
      operation: 'communication',
      ownerTeamId: body.ownerTeamId,
      channelId: body.channelId,
      categoryIds,
      subcategoryIds,
      serviceIds,
      tagNames,
    });
    await this.repo.invalidateRepositoryTemplates();
    return { status: true, data: { ...communication, versions: [version] } };
  }

  private slug(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private communicationCode(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
  }

  async communicationDetail(communicationId: string, gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    const communication = await this.access.communication(communicationId);
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'VIEWER',
      'EDITOR',
      'APPROVER',
      'PUBLISHER',
      'OWNER',
    ]);
    const [team, channel, versions, active] = await Promise.all([
      this.prisma.team.findUnique({
        where: { id: communication.ownerTeamId! },
        select: { id: true, name: true },
      }),
      this.prisma.channel.findUnique({
        where: { id: communication.channelId },
        select: { id: true, key: true, name: true },
      }),
      this.prisma.communicationVersion.findMany({
        where: { communicationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          version: true,
          revision: true,
          status: true,
          changeSummary: true,
          createdById: true,
          createdAt: true,
          updatedAt: true,
          submittedAt: true,
          approvedAt: true,
          publishedAt: true,
        },
      }),
      this.prisma.communicationActiveVersion.findUnique({
        where: {
          communicationId_targetEnvironment: {
            communicationId,
            targetEnvironment: 'production',
          },
        },
        select: { versionId: true, activatedAt: true },
      }),
    ]);
    return {
      status: true,
      data: {
        ...communication,
        ownerTeam: team,
        channel,
        versions,
        activeVersion: active,
      },
    };
  }

  async versionDetail(versionId: string, gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    let version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      include: {
        localizations: { orderBy: { locale: 'asc' } },
        variables: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'VIEWER',
      'EDITOR',
      'APPROVER',
      'PUBLISHER',
      'OWNER',
    ]);
    if (version.status === 'DRAFT' && !version.localizations.length) {
      await this.prisma.communicationLocalization.create({
        data: { versionId, locale: 'PT', subject: null, content: '' },
      });
      version = await this.prisma.communicationVersion.findUnique({
        where: { id: versionId },
        include: {
          localizations: { orderBy: { locale: 'asc' } },
          variables: { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!version) throw new NotFoundException('Versão não encontrada.');
    }
    const metadata = await this.prisma.communication.findUnique({
      where: { id: version.communicationId },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        ownerTeamId: true,
        channelId: true,
        channel: { select: { key: true, name: true } },
        ownerTeam: { select: { id: true, name: true } },
        subcategories: { select: { categoryId: true, subcategoryId: true } },
        services: { select: { serviceId: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    });
    return { status: true, data: { ...version, communication: metadata } };
  }

  async resumeDraft(versionId: string, gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      select: { id: true, communicationId: true, status: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    if (version.status !== 'CHANGES_REQUESTED') {
      throw new ConflictException(
        'Apenas versões com alterações pedidas podem voltar a rascunho.',
      );
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'EDITOR',
    ]);
    const data = await this.prisma.communicationVersion.update({
      where: { id: versionId },
      data: {
        status: 'DRAFT',
        submittedAt: null,
        approvedAt: null,
        contentChecksum: null,
      },
      select: { id: true, status: true, updatedAt: true },
    });
    await this.record(actor.id, 'UPDATE', version.communicationId, {
      operation: 'resume_draft',
      versionId,
    });
    return { status: true, data };
  }

  async updateDraft(
    versionId: string,
    body: {
      expectedUpdatedAt?: string;
      changeSummary?: string;
      localizations?: Array<{
        locale?: string;
        subject?: string | null;
        content?: string | null;
      }>;
      communication?: {
        name?: string;
        description?: string | null;
        categoryIds?: string[];
        subcategoryIds?: string[];
        serviceIds?: string[];
        tagNames?: string[];
      };
    },
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      include: { localizations: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    if (version.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'VERSION_NOT_EDITABLE',
        message: 'A versão já não está em rascunho.',
      });
    }
    const expected = body.expectedUpdatedAt
      ? new Date(body.expectedUpdatedAt)
      : null;
    if (!expected || Number.isNaN(expected.getTime())) {
      throw new BadRequestException(
        'A versão esperada do rascunho é obrigatória.',
      );
    }
    if (expected.getTime() !== version.updatedAt.getTime()) {
      throw new ConflictException({
        code: 'VERSION_ALREADY_CHANGED',
        message:
          'O rascunho foi alterado por outra operação. Atualize a página.',
      });
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'EDITOR',
      'OWNER',
    ]);
    const [currentCommunication, currentTaxonomy, currentServices, currentTags] =
      await Promise.all([
        this.prisma.communication.findUnique({
          where: { id: version.communicationId },
          select: { name: true, description: true },
        }),
        this.prisma.communicationSubcategory.findMany({
          where: { communicationId: version.communicationId },
          select: {
            categoryId: true,
            subcategoryId: true,
            category: { select: { name: true } },
            subcategory: { select: { name: true } },
          },
        }),
        this.prisma.communicationService.findMany({
          where: { communicationId: version.communicationId },
          select: { serviceId: true, service: { select: { name: true } } },
        }),
        this.prisma.communicationTag.findMany({
          where: { communicationId: version.communicationId },
          select: { tagId: true, tag: { select: { name: true } } },
        }),
      ]);
    const draftCommunication = body.communication;
    const name = draftCommunication?.name?.trim();
    const description = draftCommunication?.description?.trim() || null;
    const categoryIds = [...new Set(draftCommunication?.categoryIds ?? [])];
    const subcategoryIds = [
      ...new Set(draftCommunication?.subcategoryIds ?? []),
    ];
    const serviceIds = [...new Set(draftCommunication?.serviceIds ?? [])];
    const tagNames = [
      ...new Map(
        (draftCommunication?.tagNames ?? []).map((value) => [
          value.trim().toLocaleLowerCase('pt-PT'),
          value.trim(),
        ]),
      ).values(),
    ].filter(Boolean);
    if (draftCommunication) {
      if ((name?.length ?? 0) > 255)
        throw new BadRequestException(
          'O nome não pode exceder 255 caracteres.',
        );
      if ((description?.length ?? 0) > 4000)
        throw new BadRequestException(
          'As observações não podem exceder 4000 caracteres.',
        );
      if (tagNames.some((tag) => tag.length > 100 || !this.slug(tag)))
        throw new BadRequestException('Uma das tags é inválida.');
    }
    const localizations = body.localizations ?? [];
    if (!localizations.length)
      throw new BadRequestException('Inclua pelo menos uma localização.');
    const existingLocales = new Set(
      version.localizations.map(({ locale }) => locale),
    );
    if (
      localizations.some(
        ({ locale }) => !locale || !existingLocales.has(locale),
      )
    ) {
      throw new BadRequestException(
        'Uma das localizações não pertence à versão.',
      );
    }
    const contentVariableKeys = [
      ...new Set(
        localizations.flatMap(({ content }) =>
          [...(content ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(
            (match) => match[1].trim(),
          ),
        ),
      ),
    ];
    const storedVariables = contentVariableKeys.length
      ? await this.prisma.communicationVariable.findMany({
          where: {
            key: { in: contentVariableKeys },
            version: {
              communication: { channelId: communication.channelId },
            },
          },
          select: {
            key: true,
            description: true,
            placeholder: true,
            sampleValue: true,
            isRequired: true,
            version: {
              select: {
                communication: { select: { channelId: true } },
              },
            },
          },
          orderBy: { version: { updatedAt: 'desc' } },
        })
      : [];
    const variablesByKey = new Map(
      storedVariables.map(({ version: _version, ...variable }) => [
        variable.key,
        variable,
      ]),
    );
    const unknownVariable = contentVariableKeys.find(
      (key) => !variablesByKey.has(key),
    );
    if (unknownVariable) {
      throw new BadRequestException(
        `A variável “${unknownVariable}” não existe no catálogo do canal.`,
      );
    }
    let taxonomyPairs: Array<{ categoryId: string; subcategoryId: string }> =
      [];
    let tagIds: string[] = [];
    let selectedCategoryNames: string[] = [];
    let selectedSubcategoryNames: string[] = [];
    let selectedServiceNames: string[] = [];
    if (draftCommunication) {
      const [pairs, services, existingTags] = await Promise.all([
        this.prisma.categorySubcategory.findMany({
          where: {
            categoryId: { in: categoryIds },
            subcategoryId: { in: subcategoryIds },
            category: { isActive: true },
            subcategory: { isActive: true },
          },
          select: {
            categoryId: true,
            subcategoryId: true,
            category: { select: { name: true } },
            subcategory: { select: { name: true } },
          },
        }),
        this.prisma.service.findMany({
          where: { id: { in: serviceIds }, isActive: true },
          select: { id: true, name: true },
        }),
        tagNames.length
          ? this.prisma.tag.findMany({
              where: {
                OR: tagNames.flatMap((tagName) => [
                  { name: tagName },
                  { slug: this.slug(tagName) },
                ]),
              },
              select: { id: true, name: true, slug: true },
            })
          : Promise.resolve([]),
      ]);
      const matchedCategories = new Set(pairs.map((pair) => pair.categoryId));
      const matchedSubcategories = new Set(
        pairs.map((pair) => pair.subcategoryId),
      );
      if (
        categoryIds.length > 0 &&
        subcategoryIds.length > 0 &&
        (matchedCategories.size !== categoryIds.length ||
          matchedSubcategories.size !== subcategoryIds.length)
      )
        throw new BadRequestException(
          'Cada categoria e subcategoria deve formar uma combinação válida.',
        );
      if (serviceIds.length > 0 && services.length !== serviceIds.length)
        throw new BadRequestException(
          'Um dos serviços selecionados não está disponível.',
        );
      const tagsBySlug = new Map(existingTags.map((tag) => [tag.slug, tag.id]));
      const missingTags = tagNames.filter(
        (tagName) => !tagsBySlug.has(this.slug(tagName)),
      );
      const createdTags = await Promise.all(
        missingTags.map((tagName) =>
          this.prisma.tag.create({
            data: { name: tagName, slug: this.slug(tagName) },
            select: { id: true, slug: true },
          }),
        ),
      );
      createdTags.forEach((tag) => tagsBySlug.set(tag.slug, tag.id));
      tagIds = tagNames.map((tagName) => tagsBySlug.get(this.slug(tagName))!);
      taxonomyPairs = pairs;
      selectedCategoryNames = [...new Set(pairs.map(({ category }) => category.name))];
      selectedSubcategoryNames = [...new Set(pairs.map(({ subcategory }) => subcategory.name))];
      selectedServiceNames = services.map(({ name: serviceName }) => serviceName);
    }
    const replaceTaxonomy = async () => {
      await this.prisma.communicationSubcategory.deleteMany({
        where: { communicationId: version.communicationId },
      });
      if (taxonomyPairs.length)
        await this.prisma.communicationSubcategory.createMany({
          data: taxonomyPairs.map((pair) => ({
            communicationId: version.communicationId,
            categoryId: pair.categoryId,
            subcategoryId: pair.subcategoryId,
          })),
          skipDuplicates: true,
        });
    };
    const replaceServices = async () => {
      await this.prisma.communicationService.deleteMany({
        where: { communicationId: version.communicationId },
      });
      if (serviceIds.length)
        await this.prisma.communicationService.createMany({
          data: serviceIds.map((serviceId) => ({
            communicationId: version.communicationId,
            serviceId,
          })),
          skipDuplicates: true,
        });
    };
    const replaceTags = async () => {
      await this.prisma.communicationTag.deleteMany({
        where: { communicationId: version.communicationId },
      });
      if (tagIds.length)
        await this.prisma.communicationTag.createMany({
          data: tagIds.map((tagId) => ({
            communicationId: version.communicationId,
            tagId,
          })),
          skipDuplicates: true,
        });
    };
    const replaceVariables = async () => {
      await this.prisma.communicationVariable.deleteMany({
        where: { versionId },
      });
      if (contentVariableKeys.length)
        await this.prisma.communicationVariable.createMany({
          data: contentVariableKeys.map((key, sortOrder) => ({
            versionId,
            ...variablesByKey.get(key)!,
            sortOrder,
          })),
          skipDuplicates: true,
        });
    };
    const versionUpdate = this.prisma.communicationVersion.update({
      where: { id: versionId },
      data: {
        changeSummary: body.changeSummary?.trim() || null,
        contentChecksum: null,
      },
      select: { id: true, status: true, changeSummary: true, updatedAt: true },
    });
    await Promise.all([
      ...localizations.map((localization) =>
        this.prisma.communicationLocalization.update({
          where: {
            versionId_locale: { versionId, locale: localization.locale! },
          },
          data: {
            subject: localization.subject?.trim() || null,
            content: localization.content ?? '',
          },
        }),
      ),
      replaceVariables(),
      ...(draftCommunication
        ? [
            this.prisma.communication.update({
              where: { id: version.communicationId },
              data: { name: name ?? '', description },
            }),
            replaceTaxonomy(),
            replaceServices(),
            replaceTags(),
          ]
        : []),
    ]);
    const data = await versionUpdate;
    const sameValues = (left: unknown[], right: unknown[]) =>
      [...left].map(String).sort().join('\u0000') ===
      [...right].map(String).sort().join('\u0000');
    const auditEntries: unknown[] = [];
    if (draftCommunication) {
      const fields: Record<string, { previous: unknown; current: unknown }> = {};
      if ((currentCommunication?.name ?? '') !== (name ?? ''))
        fields.name = { previous: currentCommunication?.name ?? '', current: name ?? '' };
      if ((currentCommunication?.description ?? '') !== (description ?? ''))
        fields.description = { previous: currentCommunication?.description ?? '', current: description ?? '' };
      const previousServices = currentServices.map(({ service }) => service.name);
      if (!sameValues(previousServices, selectedServiceNames))
        fields.services = { previous: previousServices, current: selectedServiceNames };
      const previousTags = currentTags.map(({ tag }) => tag.name);
      if (!sameValues(previousTags, tagNames))
        fields.tags = { previous: previousTags, current: tagNames };
      if (Object.keys(fields).length)
        auditEntries.push({ operation: 'properties', fields });

      const previousPairs = currentTaxonomy.map((item) => ({
        category: item.category.name,
        subcategory: item.subcategory.name,
      }));
      if (
        !sameValues(previousPairs.map(({ category }) => category), selectedCategoryNames) ||
        !sameValues(previousPairs.map(({ subcategory }) => subcategory), selectedSubcategoryNames)
      ) auditEntries.push({
        operation: 'taxonomy',
        previous: previousPairs,
        categories: selectedCategoryNames,
        subcategories: selectedSubcategoryNames,
      });
    }
    for (const localization of localizations) {
      const previous = version.localizations.find(({ locale }) => locale === localization.locale)?.content ?? '';
      const current = localization.content ?? '';
      if (previous !== current) auditEntries.push({
        operation: 'content',
        fields: { content: { previous, current, version: version.version, locale: localization.locale } },
      });
    }
    await Promise.all([
      ...auditEntries.map((changes) =>
        this.record(
          actor.id,
          'UPDATE',
          version.communicationId,
          JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue,
        ),
      ),
      ...(draftCommunication
        ? [this.repo.invalidateRepositoryTemplates()]
        : []),
    ]);
    return { status: true, data };
  }

  async createDraft(
    communicationId: string,
    body: { sourceVersionId?: string; changeSummary?: string },
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const communication = await this.access.communication(communicationId);
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'EDITOR',
    ]);
    const existingDraft = await this.prisma.communicationVersion.findFirst({
      where: { communicationId, status: 'DRAFT' },
      select: { id: true, version: true },
    });
    if (existingDraft) {
      throw new ConflictException({
        code: 'DRAFT_ALREADY_EXISTS',
        message: 'Já existe um rascunho para esta comunicação.',
        draft: existingDraft,
      });
    }
    const active = await this.prisma.communicationActiveVersion.findUnique({
      where: {
        communicationId_targetEnvironment: {
          communicationId,
          targetEnvironment: 'production',
        },
      },
      select: { versionId: true },
    });
    const sourceVersionId = body.sourceVersionId || active?.versionId;
    const source = sourceVersionId
      ? await this.prisma.communicationVersion.findFirst({
          where: { id: sourceVersionId, communicationId },
          include: {
            localizations: { orderBy: { locale: 'asc' } },
            variables: { orderBy: { sortOrder: 'asc' } },
          },
        })
      : await this.prisma.communicationVersion.findFirst({
          where: { communicationId },
          orderBy: { createdAt: 'desc' },
          include: {
            localizations: { orderBy: { locale: 'asc' } },
            variables: { orderBy: { sortOrder: 'asc' } },
          },
        });
    if (!source) {
      throw new BadRequestException(
        'A comunicação ainda não possui uma versão que possa servir de base.',
      );
    }
    const maximum = await this.prisma.communicationVersion.aggregate({
      where: { communicationId },
      _max: { revision: true },
    });
    const revision = (maximum._max.revision ?? 0) + 1;
    const version = await this.prisma.communicationVersion.create({
      data: {
        communicationId,
        version: `v${revision}`,
        revision,
        status: 'DRAFT',
        createdById: actor.id,
        sourceVersionId: source.id,
        sourceTicketId: source.sourceTicketId,
        changeSummary: body.changeSummary?.trim() || null,
        metadata: source.metadata ?? undefined,
        localizations: {
          create: source.localizations.map((item) => ({
            locale: item.locale,
            subject: item.subject,
            content: item.content,
            filename: item.filename,
            mimeType: item.mimeType,
            previewFilename: item.previewFilename,
            previewBase64: item.previewBase64,
            sourcePayload: item.sourcePayload ?? undefined,
          })),
        },
        variables: {
          create: source.variables.map((item) => ({
            key: item.key,
            description: item.description,
            placeholder: item.placeholder,
            sampleValue: item.sampleValue,
            isRequired: item.isRequired,
            sortOrder: item.sortOrder,
          })),
        },
      },
      select: {
        id: true,
        version: true,
        revision: true,
        status: true,
        sourceVersionId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await this.record(actor.id, 'CREATE', communicationId, {
      operation: 'draft',
      versionId: version.id,
      sourceVersionId: source.id,
      revision,
    });
    return { status: true, data: version };
  }

  async rollbackDraft(versionId: string, gboxUserId?: string) {
    const source = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      select: { id: true, communicationId: true, version: true, status: true },
    });
    if (!source) throw new NotFoundException('Versão não encontrada.');
    if (!['DEPLOYED', 'ARCHIVED', 'PUBLISHED'].includes(source.status)) {
      throw new BadRequestException(
        'Apenas versões publicadas ou arquivadas podem originar uma reversão.',
      );
    }
    const result = await this.createDraft(
      source.communicationId,
      {
        sourceVersionId: source.id,
        changeSummary: `Reversão baseada na ${source.version}`,
      },
      gboxUserId,
    );
    return result;
  }

  async submit(
    versionId: string,
    body: { changeSummary?: string },
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const changeSummary = body.changeSummary?.trim();
    if (!changeSummary) {
      throw new BadRequestException('O resumo das alterações é obrigatório.');
    }
    if (changeSummary.length > 1000) {
      throw new BadRequestException(
        'O resumo das alterações é demasiado longo.',
      );
    }
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      include: {
        localizations: { orderBy: { locale: 'asc' } },
        variables: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    if (version.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'VERSION_NOT_EDITABLE',
        message: 'Apenas versões em rascunho podem ser submetidas.',
      });
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'EDITOR',
      'OWNER',
    ]);
    const communicationReadiness = await this.prisma.communication.findUnique({
      where: { id: version.communicationId },
      select: {
        name: true,
        subcategories: {
          select: { categoryId: true, subcategoryId: true },
          take: 1,
        },
        services: { select: { serviceId: true }, take: 1 },
      },
    });
    if (
      !communicationReadiness?.name.trim() ||
      !communicationReadiness.subcategories.length ||
      !communicationReadiness.services.length
    ) {
      throw new BadRequestException(
        'Preencha nome, categoria, subcategoria e serviço antes de enviar para aprovação.',
      );
    }
    this.validateVersion(version.localizations, version.variables);
    const checksum = this.checksum(version.localizations, version.variables);
    const team = await this.prisma.team.findUnique({
      where: { id: communication.ownerTeamId! },
      select: { requiredApprovals: true, approvalExpiresDays: true },
    });
    if (!team)
      throw new NotFoundException('Equipa responsável não encontrada.');
    const previousRequests = await this.prisma.approvalRequest.findMany({
      where: { versionId },
      select: { cycle: true },
      orderBy: { cycle: 'desc' },
      take: 1,
    });
    const cycle = (previousRequests[0]?.cycle ?? 0) + 1;
    const expiresAt = team.approvalExpiresDays
      ? new Date(Date.now() + team.approvalExpiresDays * 86_400_000)
      : null;
    const approval = await this.prisma.approvalRequest.create({
      data: {
        versionId,
        cycle,
        submittedById: actor.id,
        changeSummary,
        contentChecksum: checksum,
        requiredApprovals: team.requiredApprovals,
        expiresAt,
      },
      select: {
        id: true,
        cycle: true,
        outcome: true,
        submittedAt: true,
        expiresAt: true,
      },
    });
    await this.prisma.communicationVersion.update({
      where: { id: versionId },
      data: {
        status: 'IN_REVIEW',
        changeSummary,
        contentChecksum: checksum,
        submittedAt: approval.submittedAt,
        approvedAt: null,
      },
    });
    await this.record(actor.id, 'SUBMIT', version.communicationId, {
      versionId,
      approvalRequestId: approval.id,
      cycle,
      checksum,
    });
    await this.outbox('VERSION_SUBMITTED', 'approval_request', approval.id, {
      approvalRequestId: approval.id,
      versionId,
      communicationId: version.communicationId,
      ownerTeamId: communication.ownerTeamId,
      submittedById: actor.id,
    });
    return {
      status: true,
      data: { versionId, versionStatus: 'IN_REVIEW', approval },
    };
  }

  async approvals(
    scope: 'assigned-to-me' | 'submitted-by-me' | 'completed',
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    if (!['assigned-to-me', 'submitted-by-me', 'completed'].includes(scope)) {
      throw new BadRequestException(
        'O âmbito dos pedidos de aprovação não é válido.',
      );
    }
    const requests = await this.prisma.approvalRequest.findMany({
      where:
        scope === 'submitted-by-me'
          ? { submittedById: actor.id }
          : scope === 'completed'
            ? { outcome: { not: 'PENDING' } }
            : { outcome: 'PENDING' },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        versionId: true,
        cycle: true,
        outcome: true,
        submittedById: true,
        submittedAt: true,
        expiresAt: true,
        changeSummary: true,
        requiredApprovals: true,
      },
    });
    const versions = requests.length
      ? await this.prisma.communicationVersion.findMany({
          where: { id: { in: requests.map(({ versionId }) => versionId) } },
          select: {
            id: true,
            communicationId: true,
            version: true,
            status: true,
          },
        })
      : [];
    const communications = versions.length
      ? await this.prisma.communication.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  versions.map(({ communicationId }) => communicationId),
                ),
              ],
            },
          },
          select: { id: true, code: true, name: true, ownerTeamId: true },
        })
      : [];
    const memberships = await this.prisma.teamMember.findMany({
      where: {
        userId: actor.id,
        role: 'APPROVER',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { teamId: true },
    });
    const approverTeams = new Set(memberships.map(({ teamId }) => teamId));
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    const communicationById = new Map(
      communications.map((communication) => [communication.id, communication]),
    );
    const data = requests
      .map((request) => {
        const version = versionById.get(request.versionId);
        const communication = version
          ? communicationById.get(version.communicationId)
          : undefined;
        return version && communication
          ? { ...request, version, communication }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(
        (item) =>
          scope !== 'assigned-to-me' ||
          (item.communication.ownerTeamId &&
            approverTeams.has(item.communication.ownerTeamId)),
      );
    return { status: true, data };
  }

  async tasks(gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    const memberships = await this.prisma.teamMember.findMany({
      where: {
        userId: actor.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { teamId: true, role: true },
    });
    const teamIds = [...new Set(memberships.map(({ teamId }) => teamId))];
    const teamCommunications = teamIds.length
      ? await this.prisma.communication.findMany({
          where: { ownerTeamId: { in: teamIds } },
          select: { id: true, code: true, name: true, ownerTeamId: true },
        })
      : [];
    const teamCommunicationIds = teamCommunications.map(({ id }) => id);
    const versions = await this.prisma.communicationVersion.findMany({
      where: {
        OR: [
          { createdById: actor.id },
          ...(teamCommunicationIds.length
            ? [{ communicationId: { in: teamCommunicationIds } }]
            : []),
        ],
        status: {
          in: [
            'DRAFT',
            'CHANGES_REQUESTED',
            'IN_REVIEW',
            'APPROVED',
            'SCHEDULED',
            'DEPLOY_FAILED',
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        communicationId: true,
        version: true,
        status: true,
        changeSummary: true,
        createdById: true,
        updatedAt: true,
        effectiveAt: true,
      },
    });
    const missingCommunicationIds = [
      ...new Set(versions.map(({ communicationId }) => communicationId)),
    ].filter((id) => !teamCommunicationIds.includes(id));
    const creatorCommunications = missingCommunicationIds.length
      ? await this.prisma.communication.findMany({
          where: { id: { in: missingCommunicationIds } },
          select: { id: true, code: true, name: true, ownerTeamId: true },
        })
      : [];
    const communications = [...teamCommunications, ...creatorCommunications];
    const communicationById = new Map(
      communications.map((communication) => [communication.id, communication]),
    );
    const rolesByTeam = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const roles = rolesByTeam.get(membership.teamId) ?? new Set<string>();
      roles.add(membership.role);
      rolesByTeam.set(membership.teamId, roles);
    }
    const enriched = versions.map((version) => ({
      ...version,
      communication: communicationById.get(version.communicationId),
    }));
    const hasRole = (item: (typeof enriched)[number], role: string) => {
      const teamId = item.communication?.ownerTeamId;
      return Boolean(teamId && rolesByTeam.get(teamId)?.has(role));
    };
    const submittedRequests = await this.prisma.approvalRequest.findMany({
      where: { submittedById: actor.id, outcome: 'PENDING' },
      select: { versionId: true },
    });
    const submittedVersionIds = new Set(
      submittedRequests.map(({ versionId }) => versionId),
    );
    return {
      status: true,
      data: {
        drafts: enriched.filter(
          (item) =>
            ['DRAFT', 'CHANGES_REQUESTED'].includes(item.status) &&
            (item.createdById === actor.id || hasRole(item, 'EDITOR')),
        ),
        reviews: enriched.filter(
          (item) => item.status === 'IN_REVIEW' && hasRole(item, 'APPROVER'),
        ),
        submitted: enriched.filter(
          (item) =>
            item.status === 'IN_REVIEW' && submittedVersionIds.has(item.id),
        ),
        readyToDeploy: enriched.filter(
          (item) => item.status === 'APPROVED' && hasRole(item, 'PUBLISHER'),
        ),
        scheduled: enriched.filter(
          (item) => item.status === 'SCHEDULED' && hasRole(item, 'PUBLISHER'),
        ),
        failed: enriched.filter(
          (item) =>
            item.status === 'DEPLOY_FAILED' && hasRole(item, 'PUBLISHER'),
        ),
      },
    };
  }

  async approvalDetail(approvalRequestId: string, gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalRequestId },
      include: {
        decisions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            reviewerId: true,
            decision: true,
            comment: true,
            createdAt: true,
          },
        },
      },
    });
    if (!approval)
      throw new NotFoundException('Pedido de aprovação não encontrado.');
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: approval.versionId },
      include: {
        localizations: { orderBy: { locale: 'asc' } },
        variables: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'VIEWER',
      'EDITOR',
      'APPROVER',
      'PUBLISHER',
      'OWNER',
    ]);
    const source = version.sourceVersionId
      ? await this.prisma.communicationVersion.findUnique({
          where: { id: version.sourceVersionId },
          include: {
            localizations: { orderBy: { locale: 'asc' } },
            variables: { orderBy: { sortOrder: 'asc' } },
          },
        })
      : null;
    return {
      status: true,
      data: { approval, version, sourceVersion: source, communication },
    };
  }

  async decide(
    approvalRequestId: string,
    decision: ApprovalDecisionType,
    rawComment: string | undefined,
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const comment = rawComment?.trim() || null;
    if (comment && comment.length > 2000) {
      throw new BadRequestException('O comentário é demasiado longo.');
    }
    if (decision !== 'APPROVE' && !comment) {
      throw new BadRequestException(
        'O comentário é obrigatório para esta decisão.',
      );
    }
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalRequestId },
      select: {
        id: true,
        versionId: true,
        outcome: true,
        submittedById: true,
        contentChecksum: true,
        requiredApprovals: true,
        expiresAt: true,
      },
    });
    if (!approval)
      throw new NotFoundException('Pedido de aprovação não encontrado.');
    if (approval.outcome !== 'PENDING') {
      throw new ConflictException('O pedido de aprovação já foi concluído.');
    }
    if (approval.expiresAt && approval.expiresAt <= new Date()) {
      await this.prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { outcome: 'EXPIRED', resolvedAt: new Date() },
      });
      throw new ConflictException('O pedido de aprovação expirou.');
    }
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: approval.versionId },
      select: {
        id: true,
        communicationId: true,
        status: true,
        createdById: true,
        contentChecksum: true,
      },
    });
    if (!version || version.status !== 'IN_REVIEW') {
      throw new ConflictException('A versão já não se encontra em revisão.');
    }
    if (version.contentChecksum !== approval.contentChecksum) {
      throw new ConflictException({
        code: 'VERSION_ALREADY_CHANGED',
        message:
          'O conteúdo mudou depois da submissão e tem de ser revisto novamente.',
      });
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'APPROVER',
    ]);
    const team = await this.prisma.team.findUnique({
      where: { id: communication.ownerTeamId! },
      select: { allowSelfApproval: true },
    });
    if (
      !team?.allowSelfApproval &&
      (actor.id === approval.submittedById || actor.id === version.createdById)
    ) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'Não pode aprovar a versão que submeteu.',
      });
    }
    const previousDecision = await this.prisma.approvalDecision.findFirst({
      where: { approvalRequestId, reviewerId: actor.id },
      select: { id: true },
    });
    if (previousDecision) {
      throw new ConflictException('Já registou uma decisão neste pedido.');
    }
    await this.prisma.approvalDecision.create({
      data: { approvalRequestId, reviewerId: actor.id, decision, comment },
    });

    let outcome: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' =
      'PENDING';
    let versionStatus: VersionStatus = 'IN_REVIEW';
    if (decision === 'REQUEST_CHANGES') {
      outcome = 'CHANGES_REQUESTED';
      versionStatus = 'CHANGES_REQUESTED';
    } else if (decision === 'REJECT') {
      outcome = 'REJECTED';
      versionStatus = 'REJECTED';
    } else {
      const approvals = await this.prisma.approvalDecision.findMany({
        where: { approvalRequestId, decision: 'APPROVE' },
        select: { reviewerId: true },
      });
      if (
        new Set(approvals.map(({ reviewerId }) => reviewerId)).size >=
        approval.requiredApprovals
      ) {
        outcome = 'APPROVED';
        versionStatus = 'APPROVED';
      }
    }
    const resolvedAt = outcome === 'PENDING' ? null : new Date();
    await this.prisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { outcome, resolvedAt },
    });
    await this.prisma.communicationVersion.update({
      where: { id: version.id },
      data: {
        status: versionStatus,
        approvedAt: versionStatus === 'APPROVED' ? resolvedAt : null,
      },
    });
    const action: AuditAction =
      decision === 'APPROVE'
        ? 'APPROVE'
        : decision === 'REQUEST_CHANGES'
          ? 'REQUEST_CHANGES'
          : 'REJECT';
    await this.record(actor.id, action, version.communicationId, {
      versionId: version.id,
      approvalRequestId,
      decision,
      outcome,
      comment,
    });
    await this.outbox(
      `VERSION_${outcome}`,
      'approval_request',
      approvalRequestId,
      {
        approvalRequestId,
        versionId: version.id,
        communicationId: version.communicationId,
        submittedById: approval.submittedById,
        reviewerId: actor.id,
        outcome,
      },
    );
    return {
      status: true,
      data: { approvalRequestId, outcome, versionStatus },
    };
  }

  async createDeployment(
    versionId: string,
    body: {
      targetEnvironment?: string;
      targetSystem?: string;
      scheduledAt?: string;
      idempotencyKey?: string;
    },
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const targetEnvironment = body.targetEnvironment?.trim() || 'production';
    const targetSystem = body.targetSystem?.trim();
    if (!targetSystem)
      throw new BadRequestException('O sistema de destino é obrigatório.');
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      select: { id: true, communicationId: true, status: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    if (version.status !== 'APPROVED') {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        message: 'Apenas versões aprovadas podem ser implementadas.',
      });
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'PUBLISHER',
    ]);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (
      scheduledAt &&
      (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())
    ) {
      throw new BadRequestException(
        'A data de implementação tem de ser futura.',
      );
    }
    const communicationVersions =
      await this.prisma.communicationVersion.findMany({
        where: { communicationId: version.communicationId },
        select: { id: true },
      });
    const conflict = await this.prisma.deployment.findFirst({
      where: {
        versionId: { in: communicationVersions.map(({ id }) => id) },
        targetEnvironment,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException({
        code: 'DEPLOYMENT_ALREADY_IN_PROGRESS',
        message: 'Já existe uma implementação pendente para este destino.',
      });
    }
    const idempotencyKey = body.idempotencyKey?.trim() || crypto.randomUUID();
    const trigger: DeploymentTrigger = scheduledAt ? 'SCHEDULED' : 'IMMEDIATE';
    const deployment = await this.prisma.deployment.create({
      data: {
        versionId,
        requestedById: actor.id,
        targetEnvironment,
        targetSystem,
        trigger,
        scheduledAt,
        idempotencyKey,
        requestSummary: { communicationId: version.communicationId },
      },
      select: {
        id: true,
        status: true,
        trigger: true,
        scheduledAt: true,
        requestedAt: true,
        targetEnvironment: true,
        targetSystem: true,
      },
    });
    await this.prisma.communicationVersion.update({
      where: { id: versionId },
      data: {
        status: scheduledAt ? 'SCHEDULED' : 'DEPLOYING',
        effectiveAt: scheduledAt,
      },
    });
    await this.record(
      actor.id,
      scheduledAt ? 'SCHEDULE' : 'DEPLOY',
      version.communicationId,
      {
        versionId,
        deploymentId: deployment.id,
        targetEnvironment,
        targetSystem,
        scheduledAt,
      },
    );
    await this.outbox('DEPLOYMENT_QUEUED', 'deployment', deployment.id, {
      deploymentId: deployment.id,
      versionId,
      communicationId: version.communicationId,
    });
    return { status: true, data: deployment };
  }

  async deployments(
    status: 'all' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const memberships = await this.prisma.teamMember.findMany({
      where: {
        userId: actor.id,
        role: { in: ['PUBLISHER', 'OWNER'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { teamId: true },
    });
    const communications = memberships.length
      ? await this.prisma.communication.findMany({
          where: {
            ownerTeamId: { in: memberships.map(({ teamId }) => teamId) },
          },
          select: { id: true, code: true, name: true, ownerTeamId: true },
        })
      : [];
    const versions = communications.length
      ? await this.prisma.communicationVersion.findMany({
          where: {
            communicationId: { in: communications.map(({ id }) => id) },
          },
          select: {
            id: true,
            communicationId: true,
            version: true,
            status: true,
          },
        })
      : [];
    const data = versions.length
      ? await this.prisma.deployment.findMany({
          where: {
            versionId: { in: versions.map(({ id }) => id) },
            ...(status === 'all' ? {} : { status }),
          },
          orderBy: { requestedAt: 'desc' },
          take: 300,
        })
      : [];
    const versionById = new Map(
      versions.map((version) => [version.id, version]),
    );
    const communicationById = new Map(
      communications.map((communication) => [communication.id, communication]),
    );
    return {
      status: true,
      data: data.map((deployment) => {
        const version = versionById.get(deployment.versionId);
        return {
          ...deployment,
          version,
          communication: version
            ? communicationById.get(version.communicationId)
            : undefined,
        };
      }),
    };
  }

  async retryDeployment(deploymentId: string, gboxUserId?: string) {
    const actor = await this.access.user(gboxUserId);
    const previous = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!previous) throw new NotFoundException('Implementação não encontrada.');
    if (previous.status !== 'FAILED') {
      throw new ConflictException(
        'Apenas implementações falhadas podem ser repetidas.',
      );
    }
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: previous.versionId },
      select: { id: true, communicationId: true, status: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'PUBLISHER',
    ]);
    const deployment = await this.prisma.deployment.create({
      data: {
        versionId: previous.versionId,
        requestedById: actor.id,
        targetEnvironment: previous.targetEnvironment,
        targetSystem: previous.targetSystem,
        status: 'QUEUED',
        trigger: 'RETRY',
        attempt: previous.attempt + 1,
        idempotencyKey: crypto.randomUUID(),
        retryOfId: previous.id,
        requestSummary: previous.requestSummary ?? undefined,
      },
    });
    await this.prisma.communicationVersion.update({
      where: { id: version.id },
      data: { status: 'DEPLOYING' },
    });
    await this.record(actor.id, 'RETRY', version.communicationId, {
      deploymentId: deployment.id,
      retryOfId: previous.id,
      versionId: version.id,
    });
    await this.outbox('DEPLOYMENT_QUEUED', 'deployment', deployment.id, {
      deploymentId: deployment.id,
      retryOfId: previous.id,
      versionId: version.id,
    });
    return { status: true, data: deployment };
  }

  async cancelDeployment(
    deploymentId: string,
    rawReason: string | undefined,
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const reason = rawReason?.trim();
    if (!reason)
      throw new BadRequestException('O motivo do cancelamento é obrigatório.');
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { id: true, versionId: true, status: true },
    });
    if (!deployment)
      throw new NotFoundException('Implementação não encontrada.');
    if (deployment.status !== 'QUEUED') {
      throw new ConflictException(
        'Apenas implementações em fila podem ser canceladas.',
      );
    }
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: deployment.versionId },
      select: { id: true, communicationId: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    const communication = await this.access.communication(
      version.communicationId,
    );
    await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
      'PUBLISHER',
    ]);
    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        responseSummary: { reason },
      },
    });
    await this.prisma.communicationVersion.update({
      where: { id: version.id },
      data: { status: 'APPROVED', effectiveAt: null },
    });
    await this.record(actor.id, 'CANCEL', version.communicationId, {
      deploymentId,
      versionId: version.id,
      reason,
    });
    return { status: true, data: { id: deploymentId, status: 'CANCELLED' } };
  }

  async withdraw(
    versionId: string,
    rawReason: string | undefined,
    gboxUserId?: string,
  ) {
    const actor = await this.access.user(gboxUserId);
    const reason = rawReason?.trim();
    if (!reason)
      throw new BadRequestException('O motivo da retirada é obrigatório.');
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        communicationId: true,
        status: true,
        createdById: true,
      },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    if (version.status !== 'IN_REVIEW') {
      throw new ConflictException(
        'Apenas versões em revisão podem ser retiradas.',
      );
    }
    const communication = await this.access.communication(
      version.communicationId,
    );
    if (version.createdById !== actor.id) {
      await this.access.requireTeamRole(actor.id, communication.ownerTeamId!, [
        'OWNER',
      ]);
    }
    const approval = await this.prisma.approvalRequest.findFirst({
      where: { versionId, outcome: 'PENDING' },
      orderBy: { cycle: 'desc' },
      select: { id: true },
    });
    if (approval) {
      await this.prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { outcome: 'WITHDRAWN', resolvedAt: new Date() },
      });
    }
    await this.prisma.communicationVersion.update({
      where: { id: versionId },
      data: { status: 'DRAFT', submittedAt: null, contentChecksum: null },
    });
    await this.record(actor.id, 'WITHDRAW', version.communicationId, {
      versionId,
      approvalRequestId: approval?.id,
      reason,
    });
    return { status: true, data: { versionId, status: 'DRAFT' } };
  }

  async confirmDeployment(
    integrationKey: string,
    body: {
      deploymentId?: string;
      status?: 'SUCCEEDED' | 'FAILED';
      externalReference?: string;
      errorCode?: string;
      errorMessage?: string;
      responseSummary?: Record<string, unknown>;
    },
  ) {
    if (
      !body.deploymentId ||
      !['SUCCEEDED', 'FAILED'].includes(body.status ?? '')
    ) {
      throw new BadRequestException(
        'O resultado da implementação não é válido.',
      );
    }
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: body.deploymentId },
      select: {
        id: true,
        versionId: true,
        status: true,
        targetSystem: true,
        targetEnvironment: true,
      },
    });
    if (!deployment)
      throw new NotFoundException('Implementação não encontrada.');
    if (deployment.targetSystem !== integrationKey) {
      throw new ForbiddenException(
        'A implementação não pertence a esta integração.',
      );
    }
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(deployment.status)) {
      return {
        status: true,
        data: { id: deployment.id, status: deployment.status },
      };
    }
    const version = await this.prisma.communicationVersion.findUnique({
      where: { id: deployment.versionId },
      select: { id: true, communicationId: true },
    });
    if (!version) throw new NotFoundException('Versão não encontrada.');
    const completedAt = new Date();
    if (body.status === 'FAILED') {
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'FAILED',
          completedAt,
          externalReference: body.externalReference,
          errorCode: body.errorCode?.slice(0, 120),
          errorMessage: body.errorMessage?.slice(0, 1000),
          responseSummary:
            (body.responseSummary as Prisma.InputJsonValue) ?? undefined,
        },
      });
      await this.prisma.communicationVersion.update({
        where: { id: version.id },
        data: { status: 'DEPLOY_FAILED' },
      });
      await this.record(null, 'DEPLOY_FAILED', version.communicationId, {
        deploymentId: deployment.id,
        versionId: version.id,
        errorCode: body.errorCode,
      });
      await this.outbox('DEPLOYMENT_FAILED', 'deployment', deployment.id, {
        deploymentId: deployment.id,
        versionId: version.id,
        communicationId: version.communicationId,
      });
      return { status: true, data: { id: deployment.id, status: 'FAILED' } };
    }
    const previousActive =
      await this.prisma.communicationActiveVersion.findUnique({
        where: {
          communicationId_targetEnvironment: {
            communicationId: version.communicationId,
            targetEnvironment: deployment.targetEnvironment,
          },
        },
        select: { versionId: true },
      });
    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'SUCCEEDED',
        completedAt,
        externalReference: body.externalReference,
        responseSummary:
          (body.responseSummary as Prisma.InputJsonValue) ?? undefined,
      },
    });
    await this.prisma.communicationActiveVersion.upsert({
      where: {
        communicationId_targetEnvironment: {
          communicationId: version.communicationId,
          targetEnvironment: deployment.targetEnvironment,
        },
      },
      update: { versionId: version.id, activatedAt: completedAt },
      create: {
        communicationId: version.communicationId,
        targetEnvironment: deployment.targetEnvironment,
        versionId: version.id,
        activatedAt: completedAt,
      },
    });
    await this.prisma.communicationVersion.update({
      where: { id: version.id },
      data: {
        status: 'DEPLOYED',
        publishedAt: completedAt,
        effectiveAt: completedAt,
      },
    });
    if (previousActive && previousActive.versionId !== version.id) {
      await this.prisma.communicationVersion.update({
        where: { id: previousActive.versionId },
        data: { status: 'ARCHIVED' },
      });
    }
    await this.prisma.communication.update({
      where: { id: version.communicationId },
      data: { status: 'ACTIVE', publishedAt: completedAt },
    });
    await this.record(null, 'DEPLOY', version.communicationId, {
      deploymentId: deployment.id,
      versionId: version.id,
      previousVersionId: previousActive?.versionId,
      targetEnvironment: deployment.targetEnvironment,
    });
    await this.outbox('DEPLOYMENT_SUCCEEDED', 'deployment', deployment.id, {
      deploymentId: deployment.id,
      versionId: version.id,
      communicationId: version.communicationId,
    });
    return { status: true, data: { id: deployment.id, status: 'SUCCEEDED' } };
  }

  private validateVersion(
    localizations: Array<{
      locale: string;
      content: string | null;
      subject: string | null;
    }>,
    variables: Array<{ key: string }>,
  ) {
    if (!localizations.length) {
      throw new BadRequestException(
        'A versão tem de incluir pelo menos uma localização.',
      );
    }
    if (
      localizations.some(
        ({ locale, content }) => !locale.trim() || !content?.trim(),
      )
    ) {
      throw new BadRequestException(
        'Todas as localizações têm de possuir conteúdo.',
      );
    }
    const keys = variables.map(({ key }) => key.trim());
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
      throw new BadRequestException(
        'As variáveis da versão não são válidas ou estão repetidas.',
      );
    }
  }

  private checksum(localizations: unknown, variables: unknown) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ localizations, variables }))
      .digest('hex');
  }

  private record(
    actorId: string | null,
    action: AuditAction,
    communicationId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'communication',
        entityId: communicationId,
        changes,
      },
    });
  }

  private outbox(
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Prisma.InputJsonValue,
  ) {
    return this.prisma.outboxEvent.create({
      data: { eventType, aggregateType, aggregateId, payload },
    });
  }
}

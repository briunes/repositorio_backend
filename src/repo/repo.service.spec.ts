import { RepoService } from './repo.service';

describe('RepoService taxonomy visibility', () => {
  it('removes inactive taxonomy from template metadata and taxonomy pairs', async () => {
    const prisma = {
      communicationSubcategory: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: { name: 'Onboarding' },
            subcategory: { name: 'Adesão' },
            communication: {
              code: 'WELCOME',
              channel: { key: 'SMS' },
            },
          },
        ]),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([{ name: 'Onboarding' }]),
      },
      subcategory: {
        findMany: jest.fn().mockResolvedValue([{ name: 'Adesão' }]),
      },
    };
    const service = new RepoService(
      { get: jest.fn() } as never,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await (
      service as unknown as {
        enrichTemplatesWithTaxonomyPairs: (templates: unknown) => Promise<{
          SMS: Record<string, Record<string, unknown>>;
        }>;
      }
    ).enrichTemplatesWithTaxonomyPairs({
      SMS: {
        WELCOME: {
          categoria: ['Onboarding', 'tom'],
          subcategoria: ['Adesão'],
        },
      },
    });

    expect(result.SMS.WELCOME).toMatchObject({
      categoria: ['Onboarding'],
      subcategoria: ['Adesão'],
      taxonomyPairs: [{ category: 'Onboarding', subcategory: 'Adesão' }],
    });
    expect(prisma.communicationSubcategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: { isActive: true },
          subcategory: { isActive: true },
        },
      }),
    );
  });
});

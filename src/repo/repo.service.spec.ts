import { HttpException } from '@nestjs/common';
import { RepoService } from './repo.service';

describe('RepoService login errors', () => {
  it('translates an unauthorized GBox origin error to Portuguese', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: false, message: 'Unauthorized origin' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const service = new RepoService(
      { get: jest.fn().mockReturnValue('https://gbox.example') } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    try {
      await service.login({ username: 'user', password: 'password' });
      throw new Error('Expected login to reject.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        status: false,
        message: 'Origem não autorizada',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('RepoService taxonomy visibility', () => {
  it('reads taxonomy from the shared database on every request', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: { categories: [{ id: 'deleted' }], subcategories: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { categories: [], subcategories: [] },
        error: null,
      });
    const service = new RepoService(
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { client: { rpc } } as never,
      {} as never,
    );

    await expect(service.taxonomy()).resolves.toMatchObject({
      data: { categories: [{ id: 'deleted' }] },
    });
    await expect(service.taxonomy()).resolves.toMatchObject({
      data: { categories: [] },
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

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

  it('does not revive a deleted assignment when its category name is reused', async () => {
    const prisma = {
      communicationSubcategory: { findMany: jest.fn().mockResolvedValue([]) },
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
        WELCOME: { categoria: ['tom'], subcategoria: ['Adesão'] },
      },
    });

    expect(result.SMS.WELCOME).toMatchObject({
      categoria: [],
      subcategoria: [],
      taxonomyPairs: [],
    });
  });
});

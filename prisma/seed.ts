import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  ['communications.read', 'Consultar comunicações e respetivas versões'],
  ['communications.create', 'Criar comunicações'],
  ['communications.update', 'Editar comunicações e versões em rascunho'],
  ['communications.publish', 'Publicar e agendar versões de comunicações'],
  ['communications.archive', 'Arquivar comunicações'],
  ['taxonomy.manage', 'Gerir categorias, serviços, equipas, etiquetas e canais'],
  ['users.read', 'Consultar utilizadores da aplicação'],
  ['users.manage', 'Ativar, bloquear e atribuir funções a utilizadores'],
  ['roles.manage', 'Gerir funções e permissões'],
  ['audit.read', 'Consultar o histórico de auditoria'],
] as const;

const rolePermissions: Record<string, string[]> = {
  viewer: ['communications.read'],
  editor: [
    'communications.read',
    'communications.create',
    'communications.update',
  ],
  publisher: [
    'communications.read',
    'communications.create',
    'communications.update',
    'communications.publish',
    'communications.archive',
  ],
  admin: permissions.map(([key]) => key),
};

const roles = [
  ['viewer', 'Leitor', 'Pode consultar o repositório de comunicações'],
  ['editor', 'Editor', 'Pode criar e editar comunicações em rascunho'],
  [
    'publisher',
    'Publicador',
    'Pode publicar, agendar e arquivar comunicações',
  ],
  ['admin', 'Administrador', 'Administração completa da aplicação'],
] as const;

const channels = [
  ['EMAIL', 'Email'],
  ['SMS', 'SMS'],
  ['CARTA', 'Carta'],
  ['BLIP', 'Blip'],
  ['PUSH', 'Push'],
] as const;

const categories = [
  'Onboarding',
  'Tracking',
  'Winback',
  'Mobie',
  'Solar',
  'Preços',
  'Excedentes',
  'Fatura',
  'Marketing',
  'Embaixadores',
  'Tarifa Social',
  'Sem subcategoria',
];

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main() {
  const permissionIds = new Map<string, string>();

  for (const [key, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
    permissionIds.set(key, permission.id);
  }

  for (const [key, name, description] of roles) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name, description, isSystem: true },
      create: { key, name, description, isSystem: true },
    });

    await prisma.rolePermission.createMany({
      data: rolePermissions[key].map((permissionKey) => ({
        roleId: role.id,
        permissionId: permissionIds.get(permissionKey)!,
      })),
      skipDuplicates: true,
    });
  }

  for (const [categoryOrder, [key, name]] of channels.entries()) {
    await prisma.channel.upsert({
      where: { key },
      update: { name, isActive: true },
      create: { key, name },
    });
    const category = await prisma.category.upsert({
      where: { slug: slug(key) },
      update: { name, sortOrder: categoryOrder, isActive: true },
      create: { name, slug: slug(key), sortOrder: categoryOrder },
    });
    for (const [sortOrder, subcategoryName] of categories.entries()) {
      await prisma.subcategory.upsert({
        where: { categoryId_slug: { categoryId: category.id, slug: slug(subcategoryName) } },
        update: { name: subcategoryName, sortOrder, isActive: true },
        create: { categoryId: category.id, name: subcategoryName, slug: slug(subcategoryName), sortOrder },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

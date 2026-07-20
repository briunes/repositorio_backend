import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  ['communications.read', 'View communications and their versions'],
  ['communications.create', 'Create communications'],
  ['communications.update', 'Edit communications and draft versions'],
  ['communications.publish', 'Publish and schedule communication versions'],
  ['communications.archive', 'Archive communications'],
  ['taxonomy.manage', 'Manage categories, services, teams, tags and channels'],
  ['users.read', 'View application users'],
  ['users.manage', 'Activate, block and assign roles to users'],
  ['roles.manage', 'Manage roles and permissions'],
  ['audit.read', 'View the audit trail'],
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
  ['viewer', 'Viewer', 'Can browse the communication repository'],
  ['editor', 'Editor', 'Can create and edit draft communications'],
  [
    'publisher',
    'Publisher',
    'Can publish, schedule and archive communications',
  ],
  ['admin', 'Administrator', 'Full application administration'],
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

  for (const [key, name] of channels) {
    await prisma.channel.upsert({
      where: { key },
      update: { name, isActive: true },
      create: { key, name },
    });
  }

  for (const [sortOrder, name] of categories.entries()) {
    const categorySlug = slug(name);
    await prisma.category.upsert({
      where: { slug: categorySlug },
      update: { name, sortOrder, isActive: true },
      create: { name, slug: categorySlug, sortOrder },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

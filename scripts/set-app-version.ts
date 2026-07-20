import { PrismaClient } from '@prisma/client';

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: npm run app:version -- 1.2.3');
}

const prisma = new PrismaClient();

async function main() {
  const config = await prisma.systemConfig.upsert({
    where: { id: 'default' },
    update: { appVersion: version },
    create: { id: 'default', appVersion: version },
    select: { appVersion: true, updatedAt: true },
  });
  console.log(`Application version set to ${config.appVersion}.`);
}

void main().finally(() => prisma.$disconnect());

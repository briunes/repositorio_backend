import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const snapshot = await prisma.repositorySnapshot.findUnique({
    where: { key: 'gbox-repo-original' },
    select: { payload: true, syncedAt: true },
  });
  if (!snapshot) throw new Error('No captured GBox /repo/ response exists.');

  const output = resolve(process.cwd(), '..', 'gbox-repo-response.json');
  await writeFile(output, `${JSON.stringify(snapshot.payload, null, 2)}\n`, 'utf8');
  console.log(`Exported ${snapshot.syncedAt.toISOString()} snapshot to ${output}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../src/database/prisma.service';
import { GboxImporterService } from '../src/sync/gbox-importer.service';
import { GboxTemplates } from '../src/sync/gbox.types';

async function main() {
  const path = resolve(
    process.cwd(),
    '../repositorio_comunicacoes_frontend/database/swsRepositorio.templates.json',
  );
  const templates = JSON.parse(await readFile(path, 'utf8')) as GboxTemplates;
  const prisma = new PrismaService();
  const importer = new GboxImporterService(prisma);

  await prisma.$connect();
  const run = await importer.import(templates);
  console.log(
    `Imported ${run.communications} communications and ${run.versions} versions.`,
  );
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

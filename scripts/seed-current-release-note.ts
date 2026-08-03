import { createSupabaseApiPrismaClient } from '../src/database/supabase-api-prisma.client';

const prisma = createSupabaseApiPrismaClient();
const DEVELOPMENT_PROJECT = 'wfnqmlibtybskcohlwlc';

function assertDevelopmentDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (
    !databaseUrl?.includes(DEVELOPMENT_PROJECT) ||
    !supabaseUrl?.includes(DEVELOPMENT_PROJECT)
  ) {
    throw new Error(
      `Refusing to seed: DATABASE_URL and SUPABASE_URL must both target development project ${DEVELOPMENT_PROJECT}.`,
    );
  }
}

async function main() {
  assertDevelopmentDatabase();
  const version = '1.0.12';
  const release = {
    title: 'Uma experiência mais pessoal, segura e preparada',
    summary:
      'Esta versão torna o repositório mais adaptável a cada utilizador, reforça a administração e introduz controlos operacionais e uma nova área para acompanhar todas as melhorias.',
    heroImageUrl: '/changelog/1-0-12/hero.png',
    blocks: [
      {
        title: 'Preferências à tua medida',
        description:
          'Escolhe o tema, a densidade das tabelas, o formato das datas e o fuso horário. As preferências são guardadas por utilizador e aplicadas de forma consistente em toda a aplicação.',
        imageUrl: '/changelog/1-0-12/preferences.png',
      },
      {
        title: 'Administração protegida',
        description:
          'A área de administração está agora reservada a administradores, com validação no frontend e no backend, páginas de acesso restrito e gestão mais segura de utilizadores e funções.',
        imageUrl: '/changelog/1-0-12/administration.png',
      },
      {
        title: 'Manutenção e modo só de leitura',
        description:
          'Novos controlos globais permitem colocar a aplicação em manutenção ou impedir alterações temporariamente. Os utilizadores recebem páginas claras e os administradores mantêm acesso à área de gestão.',
        imageUrl: '/changelog/1-0-12/administration.png',
      },
      {
        title: 'Um repositório mais claro',
        description:
          'As tabelas e os detalhes apresentam versões e datas de forma consistente, os formulários foram refinados e a edição de categorias e subcategorias ganhou uma disposição mais simples e equilibrada.',
        imageUrl: '/changelog/1-0-12/hero.png',
      },
      {
        title: 'Novidades em cada versão',
        description:
          'A nova página O que há de novo reúne as alterações de cada versão num formato visual, responsivo e fácil de explorar, com capas e destaques ilustrados.',
        imageUrl: '/changelog/1-0-12/hero.png',
      },
    ],
    published: true,
    publishedAt: new Date(),
  };

  await prisma.releaseNote.upsert({
    where: { version },
    update: release,
    create: { version, ...release },
  });
  await prisma.releaseNote.deleteMany({ where: { version: '1.0.6' } });
}

void main();

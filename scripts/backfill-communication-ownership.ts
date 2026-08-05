import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const communications = await prisma.communication.findMany({
    where: { ownerTeamId: null },
    select: {
      id: true,
      code: true,
      name: true,
      channel: { select: { key: true } },
      teams: { select: { teamId: true, team: { select: { name: true } } } },
    },
    orderBy: [{ channelId: 'asc' }, { code: 'asc' }],
  });
  const assignable = communications.filter(({ teams }) => teams.length === 1);
  const ambiguous = communications.filter(({ teams }) => teams.length > 1);
  const unassigned = communications.filter(({ teams }) => teams.length === 0);

  if (apply) {
    for (const communication of assignable) {
      await prisma.communication.update({
        where: { id: communication.id },
        data: { ownerTeamId: communication.teams[0].teamId },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'applied' : 'dry-run',
        totalWithoutOwner: communications.length,
        assigned: apply ? assignable.length : 0,
        safelyAssignable: assignable.map((item) => ({
          id: item.id,
          channel: item.channel.key,
          code: item.code,
          name: item.name,
          team: item.teams[0].team.name,
        })),
        ambiguous: ambiguous.map((item) => ({
          id: item.id,
          channel: item.channel.key,
          code: item.code,
          name: item.name,
          teams: item.teams.map(({ team }) => team.name),
        })),
        unassigned: unassigned.map((item) => ({
          id: item.id,
          channel: item.channel.key,
          code: item.code,
          name: item.name,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

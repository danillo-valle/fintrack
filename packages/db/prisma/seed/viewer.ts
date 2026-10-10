// Ver a "Família Exemplo" no app (M08): o seed não cria login, então quem quer abrir o painel com
// os 24 meses sintéticos entra com uma conta de TESTE própria, que o seed põe na casa do exemplo.
//
//   SEED_VIEWER_EMAIL=teste@exemplo.test pnpm db:seed
//
// A conta precisa existir (cadastro pelo app) e não pode ser de outra casa: uma pessoa só tem um
// grupo. Ela entra como membro do grupo e editora do ambiente Casa (compartilhado). Os ambientes
// pessoais da Lia e do Caio continuam só deles. Rodar o seed de novo apaga o grupo e tira a
// conta junto; com a variável, ela volta.
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { SeedPlan } from "./plan";

export async function addSeedViewer(
  prisma: PrismaClient,
  plan: SeedPlan,
  email: string,
): Promise<{ name: string; wallets: string[] }> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    throw new Error(
      `Nenhuma conta com o e-mail ${email}. Crie a conta de teste pelo app (Cadastro) e rode de novo.`,
    );
  }
  const other = await prisma.householdMember.findFirst({
    where: { userId: user.id, householdId: { not: plan.household.id } },
  });
  if (other) {
    throw new Error(
      `A conta ${email} já é de outro grupo. Use uma conta de teste só para o exemplo.`,
    );
  }
  const shared = plan.wallets.filter((w) => w.kind === "SHARED");
  await prisma.$transaction([
    prisma.householdMember.create({
      data: { householdId: plan.household.id, userId: user.id, role: "MEMBER" },
    }),
    prisma.walletMember.createMany({
      data: shared.map((w) => ({
        householdId: plan.household.id,
        walletId: w.id,
        userId: user.id,
        role: "EDITOR" as const,
      })),
    }),
  ]);
  return { name: user.name, wallets: shared.map((w) => w.name) };
}

// Seed: 24 meses de dados SINTÉTICOS de um grupo fictício (Lia e Caio Exemplo).
//
//   pnpm db:seed    grava (ou regrava) a casa do seed
//   pnpm db:reset   apaga o banco, aplica as migrações e roda o seed (meta: menos de 30 s)
//
// Nada aqui é dado real. O seed APAGA o grupo fictício anterior antes de gravar, então só roda
// num banco local ou num banco confirmado com SEED_TARGET_HOST (produção do M05; seed/guard.ts).
// As duas pessoas fictícias não têm senha: o seed não cria login.
import { performance } from "node:perf_hooks";
import { monthOf, todayCivil } from "@fintrack/core";
import { prisma } from "../src/index";
import { checkSeedTarget } from "./seed/guard";
import { buildSeedPlan } from "./seed/plan";
import { writeSeedPlan } from "./seed/write";

async function main(): Promise<void> {
  // Banco local, ou outro banco confirmado com SEED_TARGET_HOST (veja seed/guard.ts)
  const target = checkSeedTarget(process.env);
  if (!target.ok) throw new Error(target.reason);
  const started = performance.now();
  const today = todayCivil();
  const plan = buildSeedPlan({ endMonth: monthOf(today), today });
  await writeSeedPlan(prisma, plan);
  const seconds = ((performance.now() - started) / 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });

  // process.stdout.write: saída normal do script (o ESLint proíbe console.log no projeto)
  process.stdout.write(
    [
      `Seed gravado em ${seconds} s: "${plan.household.name}", 24 meses até ${today}.`,
      `  ${plan.users.length} pessoas, ${plan.wallets.length} ambientes, ${plan.accounts.length} contas, ${plan.cards.length} cartões, ${plan.categories.length} categorias`,
      `  ${plan.transactions.length} lançamentos, ${plan.recurrences.length} recorrências, ${plan.statements.length} faturas, ${plan.installmentGroups.length} compras parceladas, ${plan.budgets.length} orçamentos`,
    ].join("\n") + "\n",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

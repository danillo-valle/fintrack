// As somas pesadas do M08, com cache ("use cache" do Cache Components, Next.js 16).
//
// Cada função recebe o ESCOPO (o crachá das carteiras que a pessoa vê, já conferido por quem
// chama) e os limites (meses, hoje). Tudo isso entra na chave do cache: duas pessoas com escopos
// diferentes nunca dividem uma entrada, e o dia seguinte é outra entrada. A etiqueta do lar
// (financeTag) é o que as Server Actions usam para jogar fora o que ficou velho
// (lib/finance-cache.ts). O tempo de vida curto ("minutes") cobre o que muda por fora do app (o
// seed, e no M09 a sincronização com o banco).
//
// Só números e ids saem daqui. Nomes (de categoria, carteira, pessoa) são lidos fora do cache, a
// cada página: renomear algo aparece na hora, sem precisar invalidar nada.
import "server-only";
import type { CivilDate, MonthKey } from "@fintrack/core";
import {
  cashRows,
  categoryNodes,
  listBudgets,
  prisma,
  recurrencePlans,
  spendingRows,
  type WalletScope,
} from "@fintrack/db";
import { cacheLife, cacheTag } from "next/cache";
import { financeTag } from "@/lib/finance-cache";

function tagged(scope: WalletScope<"view">) {
  cacheLife("minutes");
  if (scope.householdId) cacheTag(financeTag(scope.householdId));
}

/** Gasto e entradas por mês, ambiente, categoria, quem pagou e natureza. */
export async function cachedSpending(
  scope: WalletScope<"view">,
  from: MonthKey,
  to: MonthKey,
  today: CivilDate,
) {
  "use cache";
  tagged(scope);
  return spendingRows(prisma, scope, { from, to, today });
}

/** As recorrências ativas e os meses em que já viraram lançamento. */
export async function cachedRecurrences(scope: WalletScope<"view">, months: MonthKey[]) {
  "use cache";
  tagged(scope);
  return recurrencePlans(prisma, scope, months);
}

/** Os orçados do escopo num intervalo de meses, com a divisão. */
export async function cachedBudgets(scope: WalletScope<"view">, from: MonthKey, to: MonthKey) {
  "use cache";
  tagged(scope);
  return listBudgets(prisma, scope, from, to);
}

/** Os lançamentos do fluxo de caixa, somados por dia, conta, fatura e origem. */
export async function cachedCash(scope: WalletScope<"view">, from: CivilDate, to: CivilDate) {
  "use cache";
  tagged(scope);
  return cashRows(prisma, scope, from, to);
}

/** A árvore de categorias do lar (id e pai). Muda pouco; vai junto com a etiqueta do lar. */
export async function cachedCategoryTree(householdId: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(financeTag(householdId));
  return categoryNodes(prisma, householdId);
}

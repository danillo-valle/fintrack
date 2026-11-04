// O saldo das contas que não são cartão (M13.3a, ADR-025): o cabeçalho de Lançamentos ("Saldo em
// 1º de novembro", "Saldo hoje") e o "Na conta hoje" e o "Guardado" do Início.
//
// A regra é a accountBalance do @fintrack/core; aqui só se soma. Conta o que se mexeu na conta,
// de qualquer ambiente e em qualquer situação (o recebido ainda não conferido também já saiu ou
// entrou): o saldo é da conta, e quem vê a conta é quem vê o ambiente dela (o mesmo crachá de
// sempre). Apagado (inclusive o par juntado na revisão) não conta.
import {
  accountBalance,
  dbDateFromCivil,
  type AccountKind,
  type Balance,
  type CivilDate,
} from "@fintrack/core";
import type { WalletScope } from "./access";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal } from "./money";

export type AccountWithBalance = {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  walletId: string;
  /** Ligada ao banco (o saldo vem dele) */
  linked: boolean;
  /** Quando o banco informou o saldo */
  asOf: Date | null;
  balance: Balance;
};

type RawBalance = {
  id: string;
  upToToday: Prisma.Decimal | null;
  sinceStart: Prisma.Decimal | null;
};

/**
 * As contas que não são cartão no escopo (as das carteiras que a pessoa vê, não arquivadas), com
 * o saldo de hoje e o do começo do período (`periodStart`, o primeiro dia dele).
 */
export async function accountBalances(
  db: PrismaClient,
  scope: WalletScope<"view">,
  input: { today: CivilDate; periodStart: CivilDate },
): Promise<AccountWithBalance[]> {
  if (scope.walletIds.length === 0) return [];
  const accounts = await db.financialAccount.findMany({
    where: {
      walletId: { in: [...scope.walletIds] },
      kind: { not: "CREDIT_CARD" },
      archivedAt: null,
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      institution: true,
      walletId: true,
      connectionId: true,
      initialBalance: true,
      bankBalance: { select: { balance: true, asOf: true } },
    },
  });
  if (accounts.length === 0) return [];
  const today = dbDateFromCivil(input.today);
  const start = dbDateFromCivil(input.periodStart);
  const sums = await db.$queryRaw<RawBalance[]>(Prisma.sql`
    SELECT
      t."accountId"::text AS "id",
      SUM(t."amount") AS "upToToday",
      SUM(t."amount") FILTER (WHERE t."occurredOn" >= ${start}::date) AS "sinceStart"
    FROM "transaction" t
    WHERE t."accountId" = ANY(${accounts.map((a) => a.id)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."occurredOn" <= ${today}::date
    GROUP BY 1
  `);
  const byId = new Map(sums.map((s) => [s.id, s]));
  return accounts.map((a) => {
    const sum = byId.get(a.id);
    const bank = a.connectionId && a.bankBalance?.balance ? a.bankBalance.balance : null;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      institution: a.institution,
      walletId: a.walletId,
      linked: bank !== null,
      asOf: bank !== null ? (a.bankBalance?.asOf ?? null) : null,
      balance: accountBalance({
        bank: bank === null ? null : fromDbDecimal(bank),
        initial: fromDbDecimal(a.initialBalance),
        upToToday: sum?.upToToday ? fromDbDecimal(sum.upToToday) : 0n,
        sinceStart: sum?.sinceStart ? fromDbDecimal(sum.sinceStart) : 0n,
      }),
    };
  });
}

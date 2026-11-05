// O que se repete e o banco traz (M13.3c, ADR-027): a cobrança que chega toma o lugar da prevista,
// e toda fixa que chegar vira previsão.
//
//   linkRecurring         liga cada lançamento à recorrência do banco da mesma conta e comerciante;
//                         a saída fixa confirmada que não tem uma cria a sua (valor o último, sem fim,
//                         por volta do dia dela); a que deixou de ser fixa sai da recorrência
//   keepRecentLinked      o mesmo nos últimos dois meses (a busca diária: o que ficou para trás)
//   setRecurring          a escolha da pessoa no lançamento: Repete todo mês (o valor e o dia) ou não
//   recurringChoice       o que a tela mostra para essa escolha (a recorrência, as últimas, o valor)
//
// A parcela que a pessoa disse continua sozinha: a cobrança do mês seguinte da mesma loja, conta
// e valor vira a parcela seguinte (continueStatedInstallment), antes de qualquer ligação.
//
// Quem chama: a busca e os importadores (o que chegou), a revisão (o que foi confirmado), lançar,
// editar e o tipo da despesa. A regra de "fixa" é a do ADR-026 (natureOf); a chave, seriesKey.
import {
  addDays,
  addMonthsToKey,
  expectedAmount,
  civilFromDbDate,
  dbDateFromCivil,
  firstDayOf,
  installmentStem,
  monthOf,
  parseCivilDate,
  seriesKey,
  type Arrival,
  type Cents,
  type CivilDate,
  type RecurrenceSettings,
} from "@fintrack/core";
import { DomainError, type TransactionGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal } from "./money";
import { NATURE_SELECT, natureOf } from "./nature";
import { ARRIVALS_INCLUDE, LAST_ARRIVALS, applyRecurrenceSettings } from "./recurrences";

const LINK_SELECT = {
  id: true,
  householdId: true,
  walletId: true,
  accountId: true,
  cardId: true,
  categoryId: true,
  method: true,
  amount: true,
  occurredOn: true,
  description: true,
  label: true,
  status: true,
  deletedAt: true,
  transferId: true,
  reversalOfId: true,
  providerInstallmentNumber: true,
  installmentByPerson: true,
  ...NATURE_SELECT,
  recurrence: { select: { origin: true } },
  account: { select: { kind: true, name: true } },
} satisfies Prisma.TransactionSelect;

type LinkRow = Prisma.TransactionGetPayload<{ select: typeof LINK_SELECT }>;

/** Saída de uma conta ou compra no cartão (o estorno no cartão não se repete). */
const isExpense = (row: LinkRow) => fromDbDecimal(row.amount) < 0n;

/** Pode ser uma cobrança que se repete: não é transferência, estorno nem parcela. */
function canRepeat(row: LinkRow): boolean {
  return (
    row.deletedAt === null &&
    row.transferId === null &&
    row.reversalOfId === null &&
    row.installmentGroupId === null &&
    row.providerInstallmentCount === null
  );
}

/** A recorrência do banco ativa da conta, com a chave e o sentido (entra ou sai). */
async function bankSeries(
  tx: Prisma.TransactionClient,
  accountId: string,
  matchKey: string,
  income: boolean,
) {
  return tx.recurrence.findFirst({
    where: {
      accountId,
      matchKey,
      origin: "BANK",
      archivedAt: null,
      kind: income ? "INCOME" : { not: "INCOME" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

/**
 * Cria a recorrência do banco a partir de uma cobrança que chegou (o valor dela, por volta do dia
 * dela, sem fim): a saída fixa sozinha, a entrada só quando a pessoa diz que é fixa.
 */
async function createSeriesFrom(
  tx: Prisma.TransactionClient,
  row: LinkRow,
  matchKey: string,
  actorId: string | null,
  ctx: RequestContext,
) {
  const occurredOn = civilFromDbDate(row.occurredOn);
  const recurrence = await tx.recurrence.create({
    data: {
      householdId: row.householdId,
      walletId: row.walletId,
      accountId: row.accountId,
      cardId: row.cardId,
      categoryId: row.categoryId,
      kind: !isExpense(row)
        ? "INCOME"
        : row.account.kind === "CREDIT_CARD"
          ? "SUBSCRIPTION"
          : "FIXED_BILL",
      method: row.method,
      description: (row.label ?? row.description).slice(0, 200),
      amount: row.amount,
      dayOfMonth: parseCivilDate(occurredOn).day,
      startsOn: dbDateFromCivil(firstDayOf(monthOf(occurredOn))),
      origin: "BANK",
      amountRule: "LAST",
      dayRule: "DAY",
      matchKey,
      createdById: actorId,
    },
    select: { id: true, kind: true, origin: true, startsOn: true },
  });
  await writeAudit(
    tx,
    {
      actorId,
      householdId: row.householdId,
      action: "recurrence.created",
      entity: "recurrence",
      entityId: recurrence.id,
      metadata: {
        kind: "BANK",
        origin: actorId ? "escolha da pessoa" : "fixa que chegou",
        walletId: row.walletId,
      },
    },
    ctx,
  );
  return recurrence;
}

/**
 * Liga os lançamentos às recorrências do banco (ADR-027):
 *   - sem recorrência, de uma conta com a recorrência do banco da mesma chave e sentido: liga;
 *   - saída fixa CONFIRMADA sem recorrência nenhuma: cria a recorrência e liga;
 *   - ligada a uma recorrência do banco e marcada Variável à mão (ou virou parcela,
 *     transferência): desliga. A recorrência continua até a pessoa parar (Fixas e parcelas).
 * Ligada, a cobrança é fixa pela recorrência (ADR-026): só a marca Variável à mão a impede.
 * Nunca mexe no que veio da recorrência do app. Uma trava por conta e chave impede duas
 * recorrências iguais quando duas confirmações chegam juntas.
 */
export async function linkRecurring(
  tx: Prisma.TransactionClient,
  transactionIds: readonly string[],
  actorId: string | null,
  ctx: RequestContext,
): Promise<{ linked: number; created: number; unlinked: number }> {
  const counts = { linked: 0, created: 0, unlinked: 0 };
  if (transactionIds.length === 0) return counts;
  const rows = await tx.transaction.findMany({
    where: { id: { in: [...transactionIds] } },
    orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
    select: LINK_SELECT,
  });
  for (const found of rows) {
    const row = await continueStatedInstallment(tx, found);
    const markedVariable = row.nature === "VARIABLE";
    if (row.recurrenceId) {
      const fromBank = row.recurrence?.origin === "BANK";
      const stillRepeats = canRepeat(row) && !markedVariable;
      if (fromBank && !stillRepeats) {
        await tx.transaction.update({ where: { id: row.id }, data: { recurrenceId: null } });
        counts.unlinked += 1;
      }
      continue;
    }
    if (!canRepeat(row)) continue;
    const income = !isExpense(row);
    if (income && row.account.kind === "CREDIT_CARD") continue;
    const key = await lockSeries(tx, row);
    // A marca Variável à mão fala mais alto que a recorrência (ADR-026)
    if (markedVariable) continue;
    let series = await bankSeries(tx, row.accountId, key, income);
    if (!series) {
      const fixedExpense = !income && natureOf(row) === "fixed" && row.status === "CONFIRMED";
      if (!fixedExpense) continue;
      series = await createSeriesFrom(tx, row, key, actorId, ctx);
      counts.created += 1;
    }
    await tx.transaction.update({ where: { id: row.id }, data: { recurrenceId: series.id } });
    counts.linked += 1;
  }
  return counts;
}

/**
 * A chave da cobrança e a trava da conta + chave + sentido até o fim da transação: duas
 * confirmações juntas não criam duas recorrências iguais.
 */
async function lockSeries(tx: Prisma.TransactionClient, row: LinkRow): Promise<string> {
  const key = seriesKey(row.description);
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${row.accountId}|${key}|${!isExpense(row)}`}))`,
  );
  return key;
}

/** Quantos dias para trás a parcela dita pela pessoa procura a anterior (uma fatura e folga). */
const STATED_INSTALLMENT_DAYS = 75;

/**
 * A parcela que a pessoa disse continua sozinha (ADR-027): uma saída sem parcela, da mesma conta,
 * loja (seriesKey sem o "NN/NN") e valor de uma parcela dita num mês anterior, vira a parcela
 * seguinte, se ela ainda não chegou. Nada muda quando o banco diz a parcela.
 */
async function continueStatedInstallment(
  tx: Prisma.TransactionClient,
  row: LinkRow,
): Promise<LinkRow> {
  if (
    row.deletedAt !== null ||
    row.transferId !== null ||
    row.reversalOfId !== null ||
    row.installmentGroupId !== null ||
    row.providerInstallmentCount !== null ||
    row.recurrence?.origin === "APP" ||
    !isExpense(row)
  ) {
    return row;
  }
  const key = seriesKey(installmentStem(row.description));
  const occurredOn = civilFromDbDate(row.occurredOn);
  const stated = await tx.transaction.findMany({
    where: {
      accountId: row.accountId,
      walletId: row.walletId,
      installmentByPerson: true,
      deletedAt: null,
      amount: row.amount,
      occurredOn: {
        gte: dbDateFromCivil(addDays(occurredOn, -STATED_INSTALLMENT_DAYS)),
        lte: row.occurredOn,
      },
      id: { not: row.id },
    },
    select: {
      description: true,
      occurredOn: true,
      providerInstallmentNumber: true,
      providerInstallmentCount: true,
    },
  });
  const same = stated.filter((s) => seriesKey(installmentStem(s.description)) === key);
  const latest = same.reduce<(typeof same)[number] | null>(
    (best, s) =>
      !best || (s.providerInstallmentNumber ?? 0) > (best.providerInstallmentNumber ?? 0)
        ? s
        : best,
    null,
  );
  if (
    !latest ||
    latest.providerInstallmentNumber === null ||
    latest.providerInstallmentCount === null
  ) {
    return row;
  }
  // Uma parcela por mês: a do mesmo mês é outra compra, ou a mesma parcela de novo
  if (monthOf(civilFromDbDate(latest.occurredOn)) >= monthOf(occurredOn)) return row;
  const number = latest.providerInstallmentNumber + 1;
  if (number > latest.providerInstallmentCount) return row;
  const data = {
    providerInstallmentNumber: number,
    providerInstallmentCount: latest.providerInstallmentCount,
    installmentByPerson: true,
    nature: null,
    recurrenceId: row.recurrence?.origin === "BANK" ? null : row.recurrenceId,
  };
  await tx.transaction.update({ where: { id: row.id }, data });
  return {
    ...row,
    ...data,
    recurrence: data.recurrenceId === null ? null : row.recurrence,
  };
}

/** Quantos dias para trás a busca diária olha (os dois meses do previsto). */
export const KEEP_LINKED_DAYS = 62;

/**
 * A busca diária: liga o que chegou nos últimos dois meses e ficou para trás (uma categoria que
 * passou a ser fixa depois, uma recorrência criada à mão). Sem ninguém agindo: a auditoria
 * registra a recorrência criada sem autor.
 */
export async function keepRecentLinked(
  db: PrismaClient,
  householdId: string,
  today: CivilDate,
): Promise<{ linked: number; created: number; unlinked: number }> {
  const rows = await db.transaction.findMany({
    where: {
      householdId,
      deletedAt: null,
      transferId: null,
      occurredOn: { gte: dbDateFromCivil(addDays(today, -KEEP_LINKED_DAYS)) },
      OR: [{ recurrenceId: null }, { recurrence: { origin: "BANK" } }],
    },
    orderBy: { occurredOn: "asc" },
    select: { id: true },
  });
  return db.$transaction((tx) =>
    linkRecurring(
      tx,
      rows.map((r) => r.id),
      null,
      {},
    ),
  );
}

/** A escolha da pessoa no lançamento: repete todo mês (com o valor e o dia) ou não. */
export type RecurringChoice = { repeats: false } | { repeats: true; settings: RecurrenceSettings };

/** Repete todo mês só a cobrança avulsa que pode se repetir (no cartão, só a saída). */
function assertCanChoose(row: LinkRow) {
  const appSeries = row.recurrence?.origin === "APP";
  const incomeOnCard = !isExpense(row) && row.account.kind === "CREDIT_CARD";
  if (!canRepeat(row) || appSeries || incomeOnCard) {
    throw new DomainError("RECURRENCE_NOT_ALLOWED");
  }
}

/**
 * A escolha da pessoa no lançamento (ADR-027):
 *   saída, repete      a marca Fixa; a recorrência do banco é ligada (ou criada, mesmo antes da
 *                      revisão: foi a pessoa que disse) e fica com o valor e o dia escolhidos
 *   saída, não repete  a marca Variável: sai da recorrência, que continua até a pessoa parar
 *   entrada, repete    "Tipo da receita: Fixa": a recorrência da entrada, como a da saída
 *   entrada, não       "Variável": sai da recorrência e ela para (a entrada não tem a marca que
 *                      impediria a próxima de se ligar)
 * A marca vai para a auditoria como no toque da lista (transaction.nature_set).
 */
export async function setRecurring(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  choice: RecurringChoice,
  ctx: RequestContext,
) {
  await db.$transaction((tx) => setRecurringTx(tx, grant, choice, ctx));
}

/** setRecurring dentro de uma transação aberta (o tipo do lançamento junta com a parcela). */
export async function setRecurringTx(
  tx: Prisma.TransactionClient,
  grant: TransactionGrant<"edit">,
  choice: RecurringChoice,
  ctx: RequestContext,
) {
  const row = await tx.transaction.findFirst({
    where: { id: grant.transaction.id, deletedAt: null },
    select: LINK_SELECT,
  });
  if (!row) throw new DomainError("NOT_FOUND");
  assertCanChoose(row);
  const income = !isExpense(row);
  const audit = { actorId: grant.userId, householdId: row.householdId };
  if (!income) {
    const nature = choice.repeats ? "FIXED" : "VARIABLE";
    if (row.nature !== nature) {
      await tx.transaction.update({ where: { id: row.id }, data: { nature } });
      await writeAudit(
        tx,
        {
          ...audit,
          action: "transaction.nature_set",
          entity: "transaction",
          entityId: row.id,
          metadata: { nature, rule: false },
        },
        ctx,
      );
    }
  }
  if (!choice.repeats) {
    if (row.recurrenceId) {
      await tx.transaction.update({ where: { id: row.id }, data: { recurrenceId: null } });
      if (income) await stopSeries(tx, row.recurrenceId, audit, ctx);
    }
    return;
  }
  const key = await lockSeries(tx, row);
  const series =
    (row.recurrenceId
      ? await tx.recurrence.findUnique({
          where: { id: row.recurrenceId },
          select: { id: true, kind: true, origin: true, startsOn: true },
        })
      : null) ??
    (await bankSeriesFull(tx, row.accountId, key, income)) ??
    (await createSeriesFrom(tx, row, key, grant.userId, ctx));
  if (row.recurrenceId !== series.id) {
    await tx.transaction.update({ where: { id: row.id }, data: { recurrenceId: series.id } });
  }
  await applyRecurrenceSettings(tx, series, choice.settings, audit, ctx);
}

/** A recorrência do banco ativa da mesma conta, chave e sentido, com o que a regra precisa. */
async function bankSeriesFull(
  tx: Prisma.TransactionClient,
  accountId: string,
  matchKey: string,
  income: boolean,
) {
  const found = await bankSeries(tx, accountId, matchKey, income);
  if (!found) return null;
  return tx.recurrence.findUniqueOrThrow({
    where: { id: found.id },
    select: { id: true, kind: true, origin: true, startsOn: true },
  });
}

/** Para a recorrência da entrada que a pessoa disse ser variável (a do banco; a do app fica). */
async function stopSeries(
  tx: Prisma.TransactionClient,
  recurrenceId: string,
  audit: { actorId: string; householdId: string },
  ctx: RequestContext,
) {
  const { count } = await tx.recurrence.updateMany({
    where: { id: recurrenceId, origin: "BANK", archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) return;
  await writeAudit(
    tx,
    { ...audit, action: "recurrence.archived", entity: "recurrence", entityId: recurrenceId },
    ctx,
  );
}

/** Quantos meses de cobranças da mesma loja a escolha olha quando ainda não há recorrência. */
const CHOICE_MONTHS = 4;

/**
 * O que a tela do lançamento mostra para Repete todo mês (O-ReceitaFixa): se dá para escolher, a
 * recorrência ligada (com o valor e o dia), as últimas cobranças e o valor que cada regra daria.
 * Sem recorrência ainda, as cobranças da mesma conta e loja dos últimos meses (o que ela seria).
 */
export async function recurringChoice(db: PrismaClient, grant: TransactionGrant<"view">) {
  const row = await db.transaction.findFirst({
    where: { id: grant.transaction.id, deletedAt: null },
    select: LINK_SELECT,
  });
  if (!row) throw new DomainError("NOT_FOUND");
  const income = !isExpense(row);
  const allowed =
    canRepeat(row) &&
    row.recurrence?.origin !== "APP" &&
    !(income && row.account.kind === "CREDIT_CARD");
  if (!allowed) return { allowed: false as const };
  const occurredOn = civilFromDbDate(row.occurredOn);
  const series = row.recurrenceId
    ? await db.recurrence.findUnique({
        where: { id: row.recurrenceId },
        select: {
          id: true,
          amountRule: true,
          dayRule: true,
          dayOfMonth: true,
          endsOn: true,
          amount: true,
          startsOn: true,
          transactions: ARRIVALS_INCLUDE,
        },
      })
    : null;
  let arrivals: Arrival[];
  if (series) {
    arrivals = series.transactions.map((t) => ({
      occurredOn: civilFromDbDate(t.occurredOn),
      amount: fromDbDecimal(t.amount),
    }));
  } else {
    const key = seriesKey(row.description);
    const since = firstDayOf(addMonthsToKey(monthOf(occurredOn), -CHOICE_MONTHS + 1));
    const same = await db.transaction.findMany({
      where: {
        accountId: row.accountId,
        walletId: row.walletId,
        deletedAt: null,
        transferId: null,
        OR: [{ status: "CONFIRMED" }, { id: row.id }],
        amount: income ? { gt: 0 } : { lt: 0 },
        occurredOn: { gte: dbDateFromCivil(since), lte: row.occurredOn },
      },
      orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
      select: { description: true, occurredOn: true, amount: true },
    });
    arrivals = same
      .filter((t) => seriesKey(t.description) === key)
      .map((t) => ({ occurredOn: civilFromDbDate(t.occurredOn), amount: fromDbDecimal(t.amount) }));
  }
  const own = fromDbDecimal(row.amount);
  const positive = (c: Cents) => (c < 0n ? -c : c);
  return {
    allowed: true as const,
    income,
    accountName: row.account.name,
    repeats: series !== null,
    settings: series
      ? {
          amountRule: series.amountRule,
          fixed: series.amountRule === "FIXED" ? positive(fromDbDecimal(series.amount)) : null,
          dayRule: series.dayRule,
          day: series.dayOfMonth,
          endsOn: series.endsOn ? civilFromDbDate(series.endsOn) : null,
        }
      : {
          amountRule: "LAST" as const,
          fixed: null,
          dayRule: "DAY" as const,
          day: parseCivilDate(occurredOn).day,
          endsOn: null,
        },
    startsOn: series ? civilFromDbDate(series.startsOn) : firstDayOf(monthOf(occurredOn)),
    lastArrivals: arrivals
      .slice(0, LAST_ARRIVALS)
      .map((a) => ({ ...a, amount: positive(a.amount) })),
    previews: {
      LAST: positive(expectedAmount("LAST", own, arrivals)),
      AVERAGE_3: positive(expectedAmount("AVERAGE_3", own, arrivals)),
    },
  };
}

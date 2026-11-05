// O tipo de um lançamento que já existe (M13.3c, ADR-027; canvas O-Parcelada e O-ReceitaFixa):
//
//   saída     Fixa (repete todo mês, com o valor e o dia) | Variável | Parcelada (a parcela e o total)
//   entrada   Fixa (repete todo mês) | Variável
//
// Uma escolha só, numa transação só: deixar de ser a parcela que a pessoa disse, ligar ou criar a
// recorrência, gravar a marca e, se pedido, "as próximas desta loja também" (a regra da loja dá a
// categoria e o tipo, ADR-026). As regras de cada parte são as de recurring.ts e installments.ts.
import { civilFromDbDate, monthOf, type RecurrenceSettings } from "@fintrack/core";
import { DomainError, type TransactionGrant } from "./access";
import type { RequestContext } from "./audit";
import type { PrismaClient } from "./generated/prisma/client";
import { setInstallmentTx } from "./installments";
import { fromDbDecimal } from "./money";
import { NATURE_SELECT, natureOf } from "./nature";
import { recurringChoice, setRecurringTx } from "./recurring";
import { rememberForNext, type CategorizationOptions } from "./transactions";

export type EntryTypeChoice =
  | { type: "FIXED"; settings: RecurrenceSettings }
  | { type: "VARIABLE" }
  | { type: "INSTALLMENT"; number: number; count: number };

export async function setEntryType(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  choice: EntryTypeChoice,
  options: Pick<CategorizationOptions, "rememberRule">,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    const row = await tx.transaction.findFirst({
      where: { id: grant.transaction.id, deletedAt: null },
      select: { amount: true, description: true, categoryId: true, installmentByPerson: true },
    });
    if (!row) throw new DomainError("NOT_FOUND");
    const expense = fromDbDecimal(row.amount) < 0n;
    if (choice.type === "INSTALLMENT") {
      await setInstallmentTx(tx, grant, { number: choice.number, count: choice.count }, ctx);
    } else {
      // Fixa ou variável: a parcela que a pessoa tinha dito sai primeiro
      if (row.installmentByPerson) await setInstallmentTx(tx, grant, null, ctx);
      await setRecurringTx(
        tx,
        grant,
        choice.type === "FIXED" ? { repeats: true, settings: choice.settings } : { repeats: false },
        ctx,
      );
    }
    if (expense) {
      await rememberForNext(
        tx,
        options,
        {
          description: row.description,
          categoryId: row.categoryId,
          nature: choice.type === "INSTALLMENT" ? undefined : choice.type,
        },
        ctx,
      );
    }
  });
}

/**
 * O que a tela do tipo mostra: o tipo de agora (a recorrência e as últimas cobranças, ou a
 * parcela que a pessoa disse), se a Parcelada pode ser escolhida, o valor de uma parcela e o mês
 * da fatura desta compra (a linha das parcelas conta dela).
 */
export async function entryTypeView(db: PrismaClient, grant: TransactionGrant<"view">) {
  const [repeat, row] = await Promise.all([
    recurringChoice(db, grant),
    db.transaction.findFirst({
      where: { id: grant.transaction.id, deletedAt: null },
      select: {
        amount: true,
        description: true,
        occurredOn: true,
        transferId: true,
        reversalOfId: true,
        installmentByPerson: true,
        providerInstallmentNumber: true,
        statement: { select: { dueDate: true } },
        account: { select: { name: true } },
        recurrence: { select: { origin: true } },
        ...NATURE_SELECT,
      },
    }),
  ]);
  if (!row) throw new DomainError("NOT_FOUND");
  const amount = fromDbDecimal(row.amount);
  const expense = amount < 0n;
  const bankSaid = row.providerInstallmentCount !== null && !row.installmentByPerson;
  const installmentAllowed =
    expense &&
    !row.transferId &&
    !row.reversalOfId &&
    !row.installmentGroupId &&
    !bankSaid &&
    row.recurrence?.origin !== "APP";
  const stated =
    row.installmentByPerson &&
    row.providerInstallmentNumber !== null &&
    row.providerInstallmentCount !== null
      ? { number: row.providerInstallmentNumber, count: row.providerInstallmentCount }
      : null;
  const current: EntryTypeChoice["type"] = stated
    ? "INSTALLMENT"
    : expense
      ? natureOf(row) === "fixed"
        ? "FIXED"
        : "VARIABLE"
      : repeat.allowed && repeat.repeats
        ? "FIXED"
        : "VARIABLE";
  return {
    expense,
    current,
    repeat,
    /** Pode escolher algum tipo: a saída avulsa ou a entrada que pode se repetir */
    choosable: repeat.allowed || installmentAllowed || stated !== null,
    perParcel: expense ? -amount : amount,
    originText: row.description,
    accountName: row.account.name,
    /** O mês em que esta compra conta (o vencimento da fatura, ADR-025) */
    dueMonth: monthOf(civilFromDbDate(row.statement?.dueDate ?? row.occurredOn)),
    installment: { allowed: installmentAllowed, stated },
  };
}

/** O que a tela do tipo de um lançamento recebe (entryTypeView). */
export type EntryTypeView = Awaited<ReturnType<typeof entryTypeView>>;

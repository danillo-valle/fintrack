// Lançamentos (M07): lançar, editar, excluir com "desfazer", transferir, listar com filtros e
// cursor, somar e exportar.
//
// Cada operação exige crachás (access.ts):
//   lançar       WalletGrant<"edit"> da carteira (DE QUEM é) + AccountGrant da conta (QUEM paga)
//   editar       TransactionGrant<"edit"> do lançamento + os dois de cima para o destino
//   listar/somar WalletScope<"view"> (as carteiras que a pessoa vê)
//   exportar     WalletGrant<"export"> (só o dono; a tela pede reautenticação antes)
// Recurso de outra pessoa nunca aparece: as consultas partem dos crachás, nunca de um id solto.
import { randomUUID } from "node:crypto";
import {
  allowedMethods,
  categorizedBy,
  civilFromDbDate,
  csvMoney,
  dbDateFromCivil,
  decodeCursor,
  defaultMethod,
  encodeCursor,
  isCorrection,
  methodAllowsCard,
  resolvePayer,
  signedAmount,
  suggestRulePattern,
  toCsv,
  TRANSFER_METHODS,
  transferLegs,
  type Cents,
  type CivilDate,
  type PaymentMethod,
  type PayerFilter,
  type Totals,
  type TransactionKind,
} from "@fintrack/core";
import {
  authorizeWallet,
  DomainError,
  type AccountGrant,
  type HouseholdGrant,
  type TransactionGrant,
  type WalletGrant,
  type WalletScope,
} from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { assertUsableCategory, createRuleTx, suggestCategory } from "./categories";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";

// ── Entrada ─────────────────────────────────────────────────────────────────────

export type TransactionInput = {
  kind: TransactionKind;
  /** Sempre positivo: o tipo decide o sinal */
  cents: Cents;
  description: string;
  occurredOn: CivilDate;
  categoryId: string | null;
  /** Sem forma escolhida: a padrão da conta (defaultMethod) */
  method?: PaymentMethod | null;
  cardId?: string | null;
  notes?: string | null;
};

/** O que acompanha a categoria escolhida: a cascata e, se a pessoa pediu, a regra nova. */
export type CategorizationOptions = {
  /** Carteiras que a pessoa vê: a cascata roda de novo AQUI, no servidor (não confia na tela) */
  scope: WalletScope<"view">;
  /** "Sempre categorizar assim": cria a regra a partir da correção (precisa do crachá do lar) */
  rememberRule?: { grant: HouseholdGrant<"manage_categories">; pattern?: string } | null;
};

/** Forma de pagamento e cartão conferidos contra a conta (a mesma regra do gatilho do banco). */
export function resolvePayment(
  account: AccountGrant,
  input: Pick<TransactionInput, "kind" | "method" | "cardId">,
) {
  const method = input.method ?? defaultMethod(account.account.kind, input.kind);
  if (!allowedMethods(account.account.kind).includes(method)) {
    throw new DomainError("METHOD_NOT_ALLOWED");
  }
  // Pela porta do cartão (adicional), a pessoa lança com um cartão dela, nunca sem cartão
  const cardId = input.cardId || (account.via === "CARD" ? (account.cardIds[0] ?? null) : null);
  if (cardId && (!account.cardIds.includes(cardId) || !methodAllowsCard(method))) {
    throw new DomainError("CARD_NOT_ALLOWED");
  }
  return { method, cardId };
}

export function sameHousehold(wallet: WalletGrant<"edit">, account: AccountGrant) {
  // Um lar por pessoa: na prática nunca falha. A chave composta do banco garante de novo.
  if (wallet.wallet.householdId !== account.account.householdId) throw new DomainError("NOT_FOUND");
}

/** Registra a correção como exemplo de treino e, se pedido, cria a regra. */
export async function recordCorrection(
  tx: Prisma.TransactionClient,
  input: {
    householdId: string;
    transactionId: string;
    description: string;
    kind: TransactionKind;
    from: { categoryId: string | null; source: "MANUAL" | "RULE" | "HISTORY" | null };
    to: string | null;
    userId: string;
  },
  options: CategorizationOptions,
  ctx: RequestContext,
) {
  if (!isCorrection({ chosenCategoryId: input.to, previousCategoryId: input.from.categoryId })) {
    return;
  }
  await tx.categorizationExample.create({
    data: {
      householdId: input.householdId,
      transactionId: input.transactionId,
      description: input.description,
      isExpense: input.kind === "expense",
      fromCategoryId: input.from.categoryId,
      fromSource: input.from.source,
      toCategoryId: input.to as string,
      createdById: input.userId,
    },
  });
  if (options.rememberRule && input.to) {
    const pattern = options.rememberRule.pattern ?? suggestRulePattern(input.description);
    if (pattern) {
      await createRuleTx(
        tx,
        options.rememberRule.grant,
        { categoryId: input.to, pattern, match: "CONTAINS" },
        ctx,
        "correction",
      );
    }
  }
}

// ── Lançar ──────────────────────────────────────────────────────────────────────

/**
 * Lança uma despesa ou receita. A cascata roda de novo aqui para saber se a pessoa ACEITOU a
 * sugestão (categorizedBy = RULE/HISTORY) ou escolheu outra (MANUAL + exemplo de treino).
 */
export async function createTransaction(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  account: AccountGrant,
  input: TransactionInput,
  options: CategorizationOptions,
  ctx: RequestContext,
) {
  sameHousehold(wallet, account);
  const amount = signedAmount(input.kind, input.cents);
  const { method, cardId } = resolvePayment(account, input);
  const suggestion = await suggestCategory(db, options.scope, {
    description: input.description,
    kind: input.kind,
  });

  return db.$transaction(async (tx) => {
    const categoryId = await assertUsableCategory(
      tx,
      wallet.wallet.householdId,
      input.categoryId,
      input.kind,
    );
    const created = await tx.transaction.create({
      data: {
        householdId: wallet.wallet.householdId,
        walletId: wallet.wallet.id,
        accountId: account.account.id,
        cardId,
        method,
        categoryId,
        categorizedBy: categorizedBy(categoryId, suggestion),
        amount: toDbDecimal(amount),
        occurredOn: dbDateFromCivil(input.occurredOn),
        description: input.description,
        notes: input.notes ?? null,
        createdById: wallet.userId,
      },
      select: { id: true },
    });
    await recordCorrection(
      tx,
      {
        householdId: wallet.wallet.householdId,
        transactionId: created.id,
        description: input.description,
        kind: input.kind,
        from: { categoryId: suggestion?.categoryId ?? null, source: suggestion?.source ?? null },
        to: categoryId,
        userId: wallet.userId,
      },
      options,
      ctx,
    );
    return { id: created.id, suggestion };
  });
}

// ── Ler e editar ────────────────────────────────────────────────────────────────

/** Um lançamento para a tela de edição. */
export async function getTransaction(db: PrismaClient, grant: TransactionGrant<"view">) {
  const t = await db.transaction.findUniqueOrThrow({
    where: { id: grant.transaction.id },
    select: {
      id: true,
      walletId: true,
      accountId: true,
      cardId: true,
      categoryId: true,
      categorizedBy: true,
      method: true,
      amount: true,
      occurredOn: true,
      description: true,
      notes: true,
      status: true,
      source: true,
      transferId: true,
      recurrenceId: true,
      createdAt: true,
      updatedAt: true,
      wallet: { select: { name: true } },
      account: { select: { name: true } },
      category: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  return {
    ...t,
    amount: fromDbDecimal(t.amount),
    occurredOn: civilFromDbDate(t.occurredOn),
    canEdit: grant.wallet.role !== "VIEWER",
  };
}

/**
 * Edita um lançamento. Pode mudar de carteira (`target`, crachá de "edit" na nova) e de conta.
 * Trocar a categoria que estava gravada é uma CORREÇÃO: vira exemplo de treino (M10).
 * Transferência não se edita aqui (os dois lados precisam mudar juntos): exclua e lance de novo.
 */
export async function updateTransaction(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  target: WalletGrant<"edit">,
  account: AccountGrant,
  input: TransactionInput,
  options: CategorizationOptions,
  ctx: RequestContext,
) {
  if (grant.transaction.transferId) throw new DomainError("TRANSFER_READONLY");
  sameHousehold(target, account);
  const amount = signedAmount(input.kind, input.cents);
  const { method, cardId } = resolvePayment(account, input);
  const suggestion = await suggestCategory(db, options.scope, {
    description: input.description,
    kind: input.kind,
  });

  await db.$transaction(async (tx) => {
    const current = await tx.transaction.findFirst({
      where: { id: grant.transaction.id, deletedAt: null },
      select: { categoryId: true, categorizedBy: true },
    });
    if (!current) throw new DomainError("NOT_FOUND");
    const categoryId = await assertUsableCategory(
      tx,
      target.wallet.householdId,
      input.categoryId,
      input.kind,
    );
    const unchanged = categoryId !== null && categoryId === current.categoryId;
    await tx.transaction.update({
      where: { id: grant.transaction.id },
      data: {
        walletId: target.wallet.id,
        accountId: account.account.id,
        cardId,
        method,
        categoryId,
        categorizedBy: unchanged ? current.categorizedBy : categorizedBy(categoryId, suggestion),
        amount: toDbDecimal(amount),
        occurredOn: dbDateFromCivil(input.occurredOn),
        description: input.description,
        notes: input.notes ?? null,
      },
    });
    await recordCorrection(
      tx,
      {
        householdId: target.wallet.householdId,
        transactionId: grant.transaction.id,
        description: input.description,
        kind: input.kind,
        from: { categoryId: current.categoryId, source: current.categorizedBy },
        to: categoryId,
        userId: grant.userId,
      },
      options,
      ctx,
    );
  });
}

/** Agendado (recorrência) → aconteceu. */
export async function confirmTransaction(db: PrismaClient, grant: TransactionGrant<"edit">) {
  const { count } = await db.transaction.updateMany({
    where: { id: grant.transaction.id, status: "SCHEDULED", deletedAt: null },
    data: { status: "CONFIRMED" },
  });
  if (count === 0) throw new DomainError("NOT_FOUND");
}

// ── Excluir e desfazer ──────────────────────────────────────────────────────────

/** Os lados do lançamento: ele mesmo, ou os dois lados da transferência. */
async function legsOf(
  db: PrismaClient | Prisma.TransactionClient,
  t: TransactionGrant["transaction"],
) {
  return t.transferId
    ? db.transaction.findMany({
        where: { transferId: t.transferId },
        select: { id: true, walletId: true },
      })
    : [{ id: t.id, walletId: t.walletId }];
}

/** Os dois lados de uma transferência exigem "edit" nas duas carteiras. */
async function assertEditAllLegs(db: PrismaClient, grant: TransactionGrant<"edit">) {
  const legs = await legsOf(db, grant.transaction);
  for (const walletId of new Set(legs.map((l) => l.walletId))) {
    if (walletId === grant.transaction.walletId) continue;
    const access = await authorizeWallet(db, grant.userId, walletId, "edit");
    if (!access.ok) throw new DomainError("NOT_FOUND");
  }
  return legs.map((l) => l.id);
}

/**
 * Exclusão LÓGICA (deletedAt): some das telas e dos totais, mas o "desfazer" e a auditoria
 * continuam possíveis. Transferência: os dois lados juntos.
 */
export async function deleteTransaction(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  ctx: RequestContext,
) {
  const ids = await assertEditAllLegs(db, grant);
  await db.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.transaction.householdId,
        action: "transaction.deleted",
        entity: "transaction",
        entityId: grant.transaction.id,
        metadata: { legs: count, transfer: grant.transaction.transferId !== null },
      },
      ctx,
    );
  });
}

/** O "desfazer" da exclusão. O crachá vem de authorizeTransaction com includeDeleted. */
export async function restoreTransaction(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  ctx: RequestContext,
) {
  const ids = await assertEditAllLegs(db, grant);
  await db.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: ids }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.transaction.householdId,
        action: "transaction.restored",
        entity: "transaction",
        entityId: grant.transaction.id,
        metadata: { legs: count },
      },
      ctx,
    );
  });
}

// ── Transferência ───────────────────────────────────────────────────────────────

/**
 * Transferência entre contas (ou pagamento da fatura do cartão): dois lançamentos com o mesmo
 * transferId, cada um na carteira da própria conta. Não contam como gasto nem receita.
 * As duas contas precisam vir pela porta da CARTEIRA: o portador de um adicional não move
 * dinheiro da conta do titular.
 */
export async function createTransfer(
  db: PrismaClient,
  from: AccountGrant,
  to: AccountGrant,
  input: { cents: Cents; occurredOn: CivilDate; description: string; method?: PaymentMethod },
) {
  if (from.via !== "WALLET" || to.via !== "WALLET") throw new DomainError("NOT_FOUND");
  if (from.account.householdId !== to.account.householdId) throw new DomainError("NOT_FOUND");
  if (from.account.id === to.account.id) throw new DomainError("SAME_ACCOUNT");
  const method = input.method ?? (to.account.kind === "CASH" ? "WITHDRAWAL" : "TRANSFER");
  if (!TRANSFER_METHODS.includes(method)) throw new DomainError("METHOD_NOT_ALLOWED");

  const transferId = randomUUID();
  const legs = transferLegs({
    fromAccountId: from.account.id,
    toAccountId: to.account.id,
    cents: input.cents,
  });
  const walletOf = {
    [from.account.id]: from.account.walletId,
    [to.account.id]: to.account.walletId,
  };

  await db.$transaction(async (tx) => {
    for (const leg of legs) {
      await tx.transaction.create({
        data: {
          householdId: from.account.householdId,
          walletId: walletOf[leg.accountId] as string,
          accountId: leg.accountId,
          method,
          amount: toDbDecimal(leg.amount),
          occurredOn: dbDateFromCivil(input.occurredOn),
          description: input.description,
          transferId,
          createdById: from.userId,
        },
      });
    }
  });
  return { transferId };
}

// ── Lista, totais e exportação ──────────────────────────────────────────────────

export type TransactionType = "expense" | "income" | "transfer";

export type TransactionFilters = {
  from: CivilDate;
  to: CivilDate;
  accountId?: string | null;
  /** id da categoria, ou "none" para "sem categoria" (transferências não entram) */
  categoryId?: string | null;
  text?: string | null;
  type?: TransactionType | null;
  /** "Pago por" (M07.4): Compartilhado ou uma pessoa */
  payer?: PayerFilter | null;
};

/**
 * O WHERE de "Pago por": a mesma regra do resolvePayer (packages/core/payer.ts), escrita para o
 * banco. Cartão de compras conjuntas → Compartilhado; cartão → o portador; sem cartão → o
 * titular da conta. O teste de integração confere que os dois lados concordam.
 */
function payerWhere(payer: PayerFilter): Prisma.TransactionWhereInput {
  if (payer.kind === "shared") return { card: { is: { sharedPurchases: true } } };
  return {
    OR: [
      { card: { is: { sharedPurchases: false, holderId: payer.userId } } },
      { cardId: null, account: { is: { holderId: payer.userId } } },
    ],
  };
}

/**
 * O WHERE de lista, totais e exportação: UM só, para os três nunca discordarem. As carteiras
 * vêm sempre de um crachá (escopo ou carteira), nunca da URL.
 */
function whereOf(
  walletIds: readonly string[],
  f: TransactionFilters,
): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [
    { walletId: { in: [...walletIds] }, deletedAt: null },
    { occurredOn: { gte: dbDateFromCivil(f.from), lte: dbDateFromCivil(f.to) } },
  ];
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.categoryId === "none") and.push({ categoryId: null, transferId: null });
  else if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.text) {
    and.push({
      OR: [
        { description: { contains: f.text, mode: "insensitive" } },
        { notes: { contains: f.text, mode: "insensitive" } },
      ],
    });
  }
  if (f.type === "transfer") and.push({ transferId: { not: null } });
  if (f.type === "expense") and.push({ transferId: null, amount: { lt: 0 } });
  if (f.type === "income") and.push({ transferId: null, amount: { gt: 0 } });
  if (f.payer) and.push(payerWhere(f.payer));
  return { AND: and };
}

const LIST_SELECT = {
  id: true,
  occurredOn: true,
  description: true,
  amount: true,
  status: true,
  method: true,
  source: true,
  transferId: true,
  recurrenceId: true,
  categorizedBy: true,
  installmentNumber: true,
  installmentGroup: { select: { installmentCount: true } },
  wallet: { select: { id: true, name: true, kind: true } },
  account: { select: { id: true, name: true, kind: true, holderId: true } },
  category: { select: { id: true, name: true } },
  card: { select: { nickname: true, lastFour: true, holderId: true, sharedPurchases: true } },
} satisfies Prisma.TransactionSelect;

type ListRow = Prisma.TransactionGetPayload<{ select: typeof LIST_SELECT }>;

function toItem(row: ListRow) {
  const { installmentNumber, installmentGroup, ...rest } = row;
  return {
    ...rest,
    amount: fromDbDecimal(row.amount),
    occurredOn: civilFromDbDate(row.occurredOn),
    // "Pago por" (M07.4): calculado do cartão e da conta, pela mesma regra do filtro
    payer: resolvePayer({ card: row.card, account: row.account }),
    /** "Parcela 2 de 10"; nulo fora de compra parcelada */
    installment:
      installmentNumber !== null && installmentGroup
        ? { number: installmentNumber, count: installmentGroup.installmentCount }
        : null,
  };
}

export const PAGE_SIZE = 50;

/**
 * Uma página da lista, do mais recente para o mais antigo, com cursor (keyset): a próxima
 * página começa logo depois do último item desta. Busca um item a mais para saber se há
 * próxima página.
 */
export async function listTransactions(
  db: PrismaClient,
  scope: WalletScope<"view">,
  filters: TransactionFilters,
  cursor: string | null = null,
  pageSize: number = PAGE_SIZE,
) {
  const after = decodeCursor(cursor);
  const where = whereOf(scope.walletIds, filters);
  const rows = await db.transaction.findMany({
    where: after
      ? {
          AND: [
            where,
            {
              OR: [
                { occurredOn: { lt: dbDateFromCivil(after.occurredOn) } },
                { occurredOn: dbDateFromCivil(after.occurredOn), id: { lt: after.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    select: LIST_SELECT,
  });
  const items = rows.slice(0, pageSize).map(toItem);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > pageSize && last
        ? encodeCursor({ occurredOn: last.occurredOn, id: last.id })
        : null,
  };
}

/** Os totais do filtro, calculados no banco (soma exata em NUMERIC). Mesmo WHERE da lista. */
export async function sumTransactions(
  db: PrismaClient,
  scope: WalletScope<"view">,
  filters: TransactionFilters,
): Promise<Totals> {
  const where = whereOf(scope.walletIds, filters);
  const [income, expense, count] = await Promise.all([
    db.transaction.aggregate({
      where: { AND: [where, { transferId: null, amount: { gt: 0 } }] },
      _sum: { amount: true },
    }),
    db.transaction.aggregate({
      where: { AND: [where, { transferId: null, amount: { lt: 0 } }] },
      _sum: { amount: true },
    }),
    db.transaction.count({ where }),
  ]);
  const inCents = income._sum.amount ? fromDbDecimal(income._sum.amount) : 0n;
  const outCents = expense._sum.amount ? fromDbDecimal(expense._sum.amount) : 0n;
  return { income: inCents, expense: outCents, net: inCents + outCents, count };
}

/** Limite de linhas de uma exportação (proteção contra pedidos enormes). */
export const EXPORT_LIMIT = 20_000;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CREDIT: "Crédito",
  DEBIT: "Débito",
  PIX: "PIX",
  BOLETO: "Boleto",
  TRANSFER: "Transferência",
  DEPOSIT: "Depósito",
  CASH: "Dinheiro",
  WITHDRAWAL: "Saque",
  VOUCHER: "Vale",
};
const STATUS_LABEL = { PENDING: "A revisar", SCHEDULED: "Agendado", CONFIRMED: "Confirmado" };

/**
 * Exporta em CSV os lançamentos de UMA carteira (crachá de "export": só o dono). A leitura e a
 * auditoria acontecem na mesma transação: não existe exportação sem registro.
 * A auditoria guarda o período, a quantidade e quais filtros foram usados; nunca o conteúdo.
 */
export async function exportTransactions(
  db: PrismaClient,
  grant: WalletGrant<"export">,
  filters: TransactionFilters,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    const rows = await tx.transaction.findMany({
      where: whereOf([grant.wallet.id], filters),
      orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
      take: EXPORT_LIMIT,
      select: { ...LIST_SELECT, notes: true },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "transactions.exported",
        entity: "wallet",
        entityId: grant.wallet.id,
        metadata: {
          from: filters.from,
          to: filters.to,
          rows: rows.length,
          filters: Object.entries(filters)
            .filter(([key, value]) => key !== "from" && key !== "to" && value)
            .map(([key]) => key),
        },
      },
      ctx,
    );
    const csv = toCsv(
      [
        "Data",
        "Descrição",
        "Valor",
        "Tipo",
        "Categoria",
        "Conta",
        "Cartão",
        "Forma",
        "Situação",
        "Carteira",
        "Observações",
      ],
      rows.map((r) => {
        const amount = fromDbDecimal(r.amount);
        const type = r.transferId ? "Transferência" : amount < 0n ? "Despesa" : "Receita";
        return [
          { raw: civilFromDbDate(r.occurredOn) },
          { text: r.description },
          { raw: csvMoney(amount) },
          { raw: type },
          { text: r.category?.name ?? null },
          { text: r.account.name },
          { text: r.card?.nickname ?? null },
          { raw: METHOD_LABEL[r.method] },
          { raw: STATUS_LABEL[r.status] },
          { text: r.wallet.name },
          { text: r.notes },
        ];
      }),
    );
    return { csv, rows: rows.length };
  });
}

/**
 * A carteira e a conta do último lançamento da pessoa: o lançamento rápido começa com elas
 * escolhidas (são só valores padrão; quem decide é o crachá na hora de gravar).
 */
export async function lastUsedChoice(db: PrismaClient, userId: string) {
  return db.transaction.findFirst({
    where: { createdById: userId, deletedAt: null, transferId: null },
    orderBy: { createdAt: "desc" },
    select: { walletId: true, accountId: true },
  });
}

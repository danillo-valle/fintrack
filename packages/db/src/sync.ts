// A sincronização com o banco (M09.1, ADR-011): lê do provedor (TransactionProvider) e grava no
// FinTrack, sempre do mesmo jeito, venha da agenda diária ou do botão "Buscar agora".
//
//   1. abre um SyncRun (RUNNING); se já há outro rodando para a conexão, não começa outro
//   2. para cada banco (item): nome do banco, hora da última atualização, saldos e limites
//   3. para cada conta ligada: as faturas fechadas (cartão) e os lançamentos do período
//      (importWindow: da data de corte, depois os últimos 40 dias)
//   4. cada lançamento é achado pela chave (conta, OPEN_FINANCE, id no banco):
//        novo        entra PENDING ("recebido"), com a categoria sugerida pela cascata
//        já existe   atualiza só o que o banco corrigiu (importChanges); a categoria e a
//                    revisão são da pessoa e nunca mudam aqui
//   5. fecha o SyncRun com as contagens (novos, atualizados, sem mudança, fora)
//
// Buscar duas vezes cria ZERO lançamentos novos: é a chave única (accountId, source, externalId)
// do M04 + o achar-antes-de-gravar daqui. Nada aqui entra nas somas do painel: PENDING fica de
// fora até a revisão (M09.2), então a sincronização não precisa invalidar o cache das somas.
import {
  cardForLastFour,
  civilFromDbDate,
  compareCivil,
  dbDateFromCivil,
  importChanges,
  importedDescription,
  importedMethod,
  importWalletFor,
  importWindow,
  installmentSiblingKey,
  runCascade,
  statementForDueDate,
  todayCivil,
  type CivilDate,
  type ImportedFields,
} from "@fintrack/core";
import {
  isProviderError,
  PluggyProvider,
  type FetchLike,
  type ProviderAccount,
  type ProviderBill,
  type ProviderTransaction,
  type TransactionProvider,
} from "@fintrack/importers";
import { authorizeScope, DomainError } from "./access";
import { defaultSuggesters, type CascadeServices } from "./categories";
import { openSecret, SecretKeyError, type SecretKeyring } from "./connection-secret";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import type { SyncTrigger } from "./generated/prisma/enums";
import { fromDbDecimal, fromDbDecimalOrNull, toDbDecimal } from "./money";

export type SyncOutcome =
  | {
      status: "SUCCEEDED";
      runId: string;
      householdId: string;
      created: number;
      updated: number;
      unchanged: number;
      skipped: number;
    }
  | { status: "FAILED"; runId: string; householdId: string; error: string }
  | { status: "ALREADY_RUNNING" | "NOT_READY" };

/** Uma busca parada há mais que isto (servidor reiniciou no meio) não segura a próxima. */
const STALE_RUN_MS = 15 * 60 * 1000;

type LinkedAccount = {
  id: string;
  walletId: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";
  externalId: string;
  closingDay: number | null;
  dueDay: number | null;
  holderId: string | null;
  cards: { id: string; lastFour: string; holderId: string | null; importWalletId: string | null }[];
};

/** A cascata de categorização vista por uma pessoa (as carteiras que ELA vê). */
type SuggestersFor = (viewerId: string) => Promise<ReturnType<typeof defaultSuggesters>>;

type Counts = { created: number; updated: number; unchanged: number; skipped: number };

/**
 * O provedor pronto, ou uma função que o monta (decifrando o segredo) já DENTRO da busca: assim
 * uma chave errada vira uma execução "Falhou" com código, visível na tela, e não um erro solto.
 * A função devolve null quando a conexão não tem credenciais gravadas.
 */
export type ProviderSource = TransactionProvider | (() => Promise<TransactionProvider | null>);

/** Os códigos que vão para o SyncRun.error (nunca a mensagem crua). */
function failureCode(error: unknown): string {
  if (isProviderError(error)) return error.code;
  if (error instanceof SecretKeyError) return "CONNECTION_SECRET_UNREADABLE";
  if (error instanceof DomainError && error.code === "CONNECTION_KEY_MISSING") return error.code;
  if (error instanceof DomainError && error.code === "CONNECTION_SECRET_REQUIRED")
    return error.code;
  return "SYNC_FAILED";
}

/** Falhas que só a pessoa resolve (salvar as credenciais de novo): a conexão fica em erro. */
const NEEDS_CREDENTIALS = new Set([
  "PROVIDER_AUTH_FAILED",
  "CONNECTION_SECRET_UNREADABLE",
  "CONNECTION_SECRET_REQUIRED",
]);

/**
 * Roda uma sincronização da conexão. Nunca lança erro do provedor: devolve FAILED com o código
 * (PROVIDER_AUTH_FAILED, PROVIDER_UNAVAILABLE...), que vai para o SyncRun e para a tela.
 */
export async function runSync(
  db: PrismaClient,
  input: {
    connectionId: string;
    trigger: SyncTrigger;
    provider: ProviderSource;
    requestedById?: string | null;
    now?: Date;
    /** O classificador (M10.1). Sem ele, a cascata da busca usa regras, histórico e banco */
    services?: CascadeServices;
  },
): Promise<SyncOutcome> {
  const now = input.now ?? new Date();
  const today = todayCivil(now);
  const connection = await db.providerConnection.findUnique({
    where: { id: input.connectionId },
    select: {
      id: true,
      userId: true,
      importFrom: true,
      lastSyncedAt: true,
      wallet: { select: { householdId: true } },
      items: { select: { id: true, externalId: true } },
      accounts: {
        where: { archivedAt: null, externalId: { not: null } },
        select: {
          id: true,
          walletId: true,
          kind: true,
          externalId: true,
          closingDay: true,
          dueDay: true,
          holderId: true,
          cards: {
            where: { archivedAt: null },
            select: { id: true, lastFour: true, holderId: true, importWalletId: true },
          },
        },
      },
    },
  });
  if (!connection || !connection.importFrom || connection.items.length === 0)
    return { status: "NOT_READY" };
  const householdId = connection.wallet.householdId;

  // Uma busca por vez em cada conexão (a agenda e o botão podem se cruzar)
  const running = await db.syncRun.findFirst({
    where: {
      connectionId: connection.id,
      status: "RUNNING",
      startedAt: { gt: new Date(now.getTime() - STALE_RUN_MS) },
    },
    select: { id: true },
  });
  if (running) return { status: "ALREADY_RUNNING" };
  const run = await db.syncRun.create({
    data: {
      connectionId: connection.id,
      trigger: input.trigger,
      requestedById: input.requestedById ?? null,
      startedAt: now,
    },
    select: { id: true },
  });

  const counts: Counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  try {
    const provider = typeof input.provider === "function" ? await input.provider() : input.provider;
    if (!provider) throw new DomainError("CONNECTION_SECRET_REQUIRED");
    const importFrom = civilFromDbDate(connection.importFrom);
    const lastSyncedOn = connection.lastSyncedAt ? todayCivil(connection.lastSyncedAt) : null;
    const window = importWindow({ importFrom, lastSyncedOn, today });
    const linked = new Map(
      connection.accounts.map((a) => [
        a.externalId as string,
        { ...a, externalId: a.externalId as string } as LinkedAccount,
      ]),
    );
    // A cascata de cada compra enxerga só as carteiras de quem vai ver a compra (o dono da
    // conexão, ou o portador do adicional): a mesma regra da tela (skill categorizacao)
    const cascades = new Map<string, ReturnType<typeof defaultSuggesters>>();
    const suggestersFor: SuggestersFor = async (viewerId) => {
      const cached = cascades.get(viewerId);
      if (cached) return cached;
      const created = defaultSuggesters(
        db,
        await authorizeScope(db, viewerId, "view"),
        input.services,
      );
      cascades.set(viewerId, created);
      return created;
    };
    const personalWallets = await personalWalletsOf(db, householdId);

    for (const item of connection.items) {
      // Nome do banco e hora da atualização: informativo; se falhar, a busca continua
      const info = await provider.getItem(item.externalId).catch(() => null);
      if (info) {
        await db.providerItem.update({
          where: { id: item.id },
          data: { institution: info.institution, bankUpdatedAt: info.updatedAt },
        });
      }
      const bankAccounts = await provider.listAccounts(item.externalId);
      for (const bankAccount of bankAccounts) {
        const account = linked.get(bankAccount.externalId);
        if (!account) continue; // conta que a pessoa escolheu não importar
        await saveBalance(db, account.id, bankAccount, now);
        const statements =
          account.kind === "CREDIT_CARD"
            ? await saveBills(
                db,
                account,
                await provider.listBills(bankAccount.externalId),
                importFrom,
                bankAccount,
              )
            : new Map<string, string>();
        const { transactions, skipped } = await provider.listTransactions(
          bankAccount.externalId,
          window,
        );
        counts.skipped += skipped;
        const purchases = transactions.filter((t) => !t.isBillPayment);
        await saveTransactions(db, {
          account,
          householdId,
          ownerId: connection.userId,
          transactions: purchases,
          statements,
          suggestersFor,
          personalWallets,
          counts,
        });
        if (account.kind === "CREDIT_CARD") {
          await saveCardPayments(
            db,
            account.id,
            transactions.filter((t) => t.isBillPayment),
            today,
          );
        }
      }
    }

    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          itemsCreated: counts.created,
          itemsUpdated: counts.updated,
          itemsUnchanged: counts.unchanged,
          itemsSkipped: counts.skipped,
        },
      }),
      db.providerConnection.update({
        where: { id: connection.id },
        data: { lastSyncedAt: now, status: "ACTIVE" },
      }),
    ]);
    return { status: "SUCCEEDED", runId: run.id, householdId, ...counts };
  } catch (error) {
    // Só o CÓDIGO vai para o banco: a mensagem crua pode ter dado pessoal da resposta
    const code = failureCode(error);
    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), error: code },
      }),
      ...(NEEDS_CREDENTIALS.has(code)
        ? [
            db.providerConnection.update({
              where: { id: connection.id },
              data: { status: "ERROR" },
            }),
          ]
        : []),
    ]);
    return { status: "FAILED", runId: run.id, householdId, error: code };
  }
}

/** O ambiente pessoal de cada pessoa do lar (o dono dele), para o adicional do cônjuge. */
export async function personalWalletsOf(
  db: PrismaClient | Prisma.TransactionClient,
  householdId: string,
) {
  const rows = await db.walletMember.findMany({
    where: { role: "OWNER", wallet: { householdId, kind: "PERSONAL", archivedAt: null } },
    select: { userId: true, walletId: true },
  });
  return new Map(rows.map((r) => [r.userId, r.walletId]));
}

// ── Saldos e limites ────────────────────────────────────────────────────────────

async function saveBalance(db: PrismaClient, accountId: string, bank: ProviderAccount, now: Date) {
  const data = {
    balance: bank.balance === null ? null : toDbDecimal(bank.balance),
    creditLimit: bank.credit?.limit != null ? toDbDecimal(bank.credit.limit) : null,
    availableCredit: bank.credit?.available != null ? toDbDecimal(bank.credit.available) : null,
    closeDate: bank.credit?.closeDate ? dbDateFromCivil(bank.credit.closeDate) : null,
    dueDate: bank.credit?.dueDate ? dbDateFromCivil(bank.credit.dueDate) : null,
    currency: /^[A-Z]{3}$/.test(bank.currency) ? bank.currency : "BRL",
    asOf: now,
  };
  await db.accountBalance.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
}

// ── Faturas fechadas (Bill → CardStatement) ─────────────────────────────────────

/**
 * Grava as faturas fechadas que vencem a partir da data de corte e devolve o mapa
 * "id da Bill no banco → id da fatura no FinTrack" (para ligar as compras à fatura).
 * A fatura do mês pode já existir (criada por uma compra parcelada do M07.4): ela é atualizada
 * com os números do banco, que passam a valer.
 */
async function saveBills(
  db: PrismaClient,
  account: LinkedAccount,
  bills: readonly ProviderBill[],
  importFrom: CivilDate,
  bank: ProviderAccount,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cycle =
    account.closingDay !== null && account.dueDay !== null
      ? { closingDay: account.closingDay, dueDay: account.dueDay }
      : null;
  for (const bill of bills) {
    if (compareCivil(bill.dueDate, importFrom) < 0) continue;
    const statement = statementForDueDate(bill.dueDate, cycle, bank.credit?.closeDate ?? null);
    const data = {
      closingDate: dbDateFromCivil(statement.closingDate),
      dueDate: dbDateFromCivil(statement.dueDate),
      total: toDbDecimal(bill.total),
      minimumPayment: bill.minimumPayment === null ? null : toDbDecimal(bill.minimumPayment),
      source: "OPEN_FINANCE" as const,
      externalId: bill.externalId,
    };
    const row = await db.$transaction(async (tx) => {
      const saved = await tx.cardStatement.upsert({
        where: {
          accountId_referenceMonth: {
            accountId: account.id,
            referenceMonth: dbDateFromCivil(`${statement.referenceMonth}-01`),
          },
        },
        create: {
          accountId: account.id,
          referenceMonth: dbDateFromCivil(`${statement.referenceMonth}-01`),
          status: "CLOSED",
          ...data,
        },
        update: data,
        select: { id: true },
      });
      // Encargos: regravados do jeito que o banco informa agora
      await tx.statementCharge.deleteMany({ where: { statementId: saved.id } });
      if (bill.charges.length > 0) {
        await tx.statementCharge.createMany({
          data: bill.charges.map((c) => ({
            statementId: saved.id,
            accountId: account.id,
            kind: c.kind,
            amount: toDbDecimal(c.amount),
          })),
        });
      }
      return saved;
    });
    map.set(bill.externalId, row.id);
  }
  // Pagamentos que vêm na Bill N+1 pagam a fatura N
  const ordered = [...bills].sort((a, b) => compareCivil(a.dueDate, b.dueDate));
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = map.get((ordered[i - 1] as ProviderBill).externalId);
    if (!previous) continue;
    for (const payment of (ordered[i] as ProviderBill).payments) {
      await recordPayment(db, previous, account.id, payment.paidOn, payment.amount);
    }
  }
  return map;
}

/** Grava um pagamento uma vez só (mesmo dia e mesmo valor = o mesmo pagamento). */
async function recordPayment(
  db: PrismaClient,
  statementId: string,
  accountId: string,
  paidOn: CivilDate,
  amount: bigint,
) {
  const exists = await db.statementPayment.findFirst({
    where: { statementId, paidOn: dbDateFromCivil(paidOn), amount: toDbDecimal(amount) },
    select: { id: true },
  });
  if (!exists) {
    await db.statementPayment.create({
      data: {
        statementId,
        accountId,
        paidOn: dbDateFromCivil(paidOn),
        amount: toDbDecimal(amount),
      },
    });
  }
  await refreshStatementStatus(db, statementId);
}

/** PAID quando os pagamentos cobrem o total; senão, CLOSED. */
async function refreshStatementStatus(db: PrismaClient, statementId: string) {
  const statement = await db.cardStatement.findUnique({
    where: { id: statementId },
    select: { total: true, payments: { select: { amount: true } } },
  });
  if (!statement || statement.total === null) return;
  const paid = statement.payments.reduce((sum, p) => sum + fromDbDecimal(p.amount), 0n);
  await db.cardStatement.update({
    where: { id: statementId },
    data: { status: paid >= fromDbDecimal(statement.total) ? "PAID" : "CLOSED" },
  });
}

/**
 * "Pagamento recebido" dentro da conta do cartão: vira pagamento da fatura fechada mais recente
 * até aquele dia (não vira lançamento: a outra perna já entra pela conta corrente).
 */
async function saveCardPayments(
  db: PrismaClient,
  accountId: string,
  payments: readonly ProviderTransaction[],
  today: CivilDate,
) {
  for (const payment of payments) {
    if (compareCivil(payment.occurredOn, today) > 0) continue;
    const statement = await db.cardStatement.findFirst({
      where: {
        accountId,
        total: { not: null },
        closingDate: { lte: dbDateFromCivil(payment.occurredOn) },
      },
      orderBy: { closingDate: "desc" },
      select: { id: true },
    });
    if (statement)
      await recordPayment(
        db,
        statement.id,
        accountId,
        payment.occurredOn,
        payment.amount < 0n ? -payment.amount : payment.amount,
      );
  }
}

// ── Lançamentos ─────────────────────────────────────────────────────────────────

const EXISTING_SELECT = {
  id: true,
  status: true,
  occurredOn: true,
  description: true,
  amount: true,
  cardId: true,
  walletId: true,
  providerCardLastFour: true,
  statementId: true,
  providerCategory: true,
  providerInstallmentNumber: true,
  providerInstallmentCount: true,
  originalAmount: true,
  originalCurrency: true,
  externalId: true,
} satisfies Prisma.TransactionSelect;

type ExistingRow = Prisma.TransactionGetPayload<{ select: typeof EXISTING_SELECT }>;

/**
 * As parcelas anteriores das compras parceladas que estão chegando (M13.2): o "O que foi" e a
 * categoria que a pessoa deu, pela chave da compra (`installmentSiblingKey`). Só o que já foi
 * conferido conta para a categoria; o "O que foi" vale de qualquer parcela.
 */
async function installmentSiblings(
  db: PrismaClient,
  accountId: string,
  transactions: readonly ProviderTransaction[],
): Promise<Map<string, { label: string | null; categoryId: string | null }>> {
  const counts = [
    ...new Set(transactions.flatMap((t) => (t.installment ? [t.installment.count] : []))),
  ];
  const found = new Map<string, { label: string | null; categoryId: string | null }>();
  if (counts.length === 0) return found;
  const rows = await db.transaction.findMany({
    where: {
      accountId,
      deletedAt: null,
      providerInstallmentCount: { in: counts },
      OR: [{ label: { not: null } }, { status: "CONFIRMED", categoryId: { not: null } }],
    },
    orderBy: [{ occurredOn: "desc" }, { id: "asc" }],
    select: {
      amount: true,
      description: true,
      label: true,
      status: true,
      categoryId: true,
      providerInstallmentCount: true,
    },
  });
  for (const row of rows) {
    const key = installmentSiblingKey({
      accountId,
      amount: fromDbDecimal(row.amount),
      description: row.description,
      installmentCount: row.providerInstallmentCount,
    });
    if (!key) continue;
    const current = found.get(key) ?? { label: null, categoryId: null };
    found.set(key, {
      label: current.label ?? row.label,
      categoryId: current.categoryId ?? (row.status === "CONFIRMED" ? row.categoryId : null),
    });
  }
  return found;
}

async function saveTransactions(
  db: PrismaClient,
  input: {
    account: LinkedAccount;
    householdId: string;
    /** O dono da conexão (o titular das contas) */
    ownerId: string;
    transactions: readonly ProviderTransaction[];
    statements: Map<string, string>;
    suggestersFor: SuggestersFor;
    personalWallets: ReadonlyMap<string, string>;
    counts: Counts;
  },
) {
  const { account, transactions, statements, counts } = input;
  if (transactions.length === 0) return;
  // Uma compra pode estar numa fatura gravada antes (de outra busca): procura no banco também
  const billIds = [
    ...new Set(
      transactions
        .map((t) => t.billExternalId)
        .filter((b): b is string => !!b && !statements.has(b)),
    ),
  ];
  if (billIds.length > 0) {
    const known = await db.cardStatement.findMany({
      where: { accountId: account.id, source: "OPEN_FINANCE", externalId: { in: billIds } },
      select: { id: true, externalId: true },
    });
    for (const s of known) if (s.externalId) statements.set(s.externalId, s.id);
  }
  const existing = new Map<string, ExistingRow>(
    (
      await db.transaction.findMany({
        where: {
          accountId: account.id,
          source: "OPEN_FINANCE",
          externalId: { in: transactions.map((t) => t.externalId) },
        },
        select: EXISTING_SELECT,
      })
    ).map((row) => [row.externalId as string, row]),
  );
  // O cartão pelo final que o banco mandou (M09.2): final que não está cadastrado (adicional
  // novo) fica sem cartão, e não no titular; sem final, o cartão único da conta
  const cardOf = (lastFour: string | null) =>
    account.kind === "CREDIT_CARD" ? cardForLastFour(account.cards, lastFour) : null;
  const walletFor = (card: LinkedAccount["cards"][number] | null) =>
    importWalletFor({ account, card, personalWallets: input.personalWallets });

  const siblings = await installmentSiblings(db, account.id, transactions);

  const creates: Prisma.TransactionCreateManyInput[] = [];
  const updates: { id: string; data: Prisma.TransactionUncheckedUpdateInput }[] = [];
  for (const t of transactions) {
    const statementId =
      account.kind === "CREDIT_CARD" && t.billExternalId
        ? (statements.get(t.billExternalId) ?? null)
        : null;
    const card = cardOf(t.cardLastFour);
    const cardId = card?.id ?? null;
    // A fatura é comparada no formato GRAVADO (id), para uma compra de fatura que não foi
    // importada (antes da data de corte) não parecer "mudada" a cada busca
    const incoming: ImportedFields = { ...fieldsOf(t), statementExternalId: statementId };
    const row = existing.get(t.externalId);
    if (!row) {
      const kind = t.amount < 0n ? "expense" : "income";
      const destination = walletFor(card);
      const suggesters = await input.suggestersFor(destination.viewerId ?? input.ownerId);
      // A próxima parcela de uma compra que a pessoa já nomeou ou categorizou (M13.2) entra com o
      // "O que foi" e a categoria da parcela anterior: é a mesma compra
      const sibling = siblings.get(
        installmentSiblingKey({
          accountId: account.id,
          amount: t.amount,
          description: incoming.description,
          installmentCount: t.installment?.count ?? null,
        }) ?? "",
      );
      const suggestion = sibling?.categoryId
        ? { categoryId: sibling.categoryId, source: "HISTORY" as const, confidence: 100 }
        : await runCascade(suggesters, {
            description: incoming.description,
            kind,
            providerCategory: t.category,
          });
      creates.push({
        householdId: input.householdId,
        walletId: destination.walletId,
        accountId: account.id,
        cardId,
        method: importedMethod(account.kind, t.paymentHint, t.amount),
        categoryId: suggestion?.categoryId ?? null,
        categorizedBy: suggestion ? suggestion.source : null,
        categorizationConfidence: suggestion?.confidence ?? null,
        amount: toDbDecimal(t.amount),
        occurredOn: dbDateFromCivil(t.occurredOn),
        description: incoming.description,
        label: sibling?.label ?? null,
        status: "PENDING",
        source: "OPEN_FINANCE",
        externalId: t.externalId,
        statementId,
        originalAmount: t.original ? toDbDecimal(t.original.amount) : null,
        originalCurrency: t.original?.currency ?? null,
        providerCategory: t.category,
        providerInstallmentNumber: t.installment?.number ?? null,
        providerInstallmentCount: t.installment?.count ?? null,
        providerCardLastFour: t.cardLastFour,
      });
      continue;
    }
    // Já conferido pela pessoa: o banco não muda mais (a diferença aparece na revisão, M09.2)
    if (row.status !== "PENDING") {
      counts.unchanged += 1;
      continue;
    }
    const current: ImportedFields = {
      occurredOn: civilFromDbDate(row.occurredOn),
      description: row.description,
      amount: fromDbDecimal(row.amount),
      statementExternalId: row.statementId,
      cardLastFour: row.providerCardLastFour,
      installment:
        row.providerInstallmentNumber !== null && row.providerInstallmentCount !== null
          ? { number: row.providerInstallmentNumber, count: row.providerInstallmentCount }
          : null,
      original:
        row.originalAmount !== null && row.originalCurrency !== null
          ? {
              amount: fromDbDecimalOrNull(row.originalAmount) as bigint,
              currency: row.originalCurrency,
            }
          : null,
      providerCategory: row.providerCategory,
    };
    const changed = importChanges(current, incoming);
    // O cartão muda também sem o banco mudar nada: a pessoa cadastrou o final do adicional
    const cardMoved = row.cardId !== cardId;
    if (changed.length === 0 && !cardMoved) {
      counts.unchanged += 1;
      continue;
    }
    updates.push({
      id: row.id,
      data: {
        occurredOn: dbDateFromCivil(t.occurredOn),
        description: incoming.description,
        amount: toDbDecimal(t.amount),
        statementId,
        cardId,
        providerCardLastFour: t.cardLastFour,
        // Com o cartão, muda o ambiente, se a pessoa não tinha escolhido outro
        ...(cardMoved ? rerouteWallet(row, account, card, walletFor) : {}),
        originalAmount: t.original ? toDbDecimal(t.original.amount) : null,
        originalCurrency: t.original?.currency ?? null,
        providerCategory: t.category,
        providerInstallmentNumber: t.installment?.number ?? null,
        providerInstallmentCount: t.installment?.count ?? null,
      },
    });
  }
  await db.$transaction(async (tx) => {
    if (creates.length > 0) {
      // skipDuplicates: se duas buscas se cruzarem, a chave única descarta a segunda cópia
      const result = await tx.transaction.createMany({ data: creates, skipDuplicates: true });
      counts.created += result.count;
      counts.unchanged += creates.length - result.count;
    }
    for (const update of updates) {
      await tx.transaction.update({ where: { id: update.id }, data: update.data });
      counts.updated += 1;
    }
  });
}

/**
 * O ambiente de um recebido cujo cartão mudou (adicional cadastrado depois): vai para o ambiente
 * do cartão novo SÓ se ainda estava no ambiente que o cartão antigo daria. Se a pessoa já tinha
 * mudado o ambiente, a escolha dela fica.
 */
export function rerouteWallet<C extends { id: string }>(
  row: { walletId: string; cardId: string | null },
  account: { cards: readonly C[] },
  card: C | null,
  walletFor: (card: C | null) => { walletId: string },
): { walletId?: string } {
  const previous = account.cards.find((c) => c.id === row.cardId) ?? null;
  if (row.walletId !== walletFor(previous).walletId) return {};
  return { walletId: walletFor(card).walletId };
}

function fieldsOf(t: ProviderTransaction): ImportedFields {
  return {
    occurredOn: t.occurredOn,
    description: importedDescription(t.description),
    amount: t.amount,
    statementExternalId: t.billExternalId,
    cardLastFour: t.cardLastFour,
    installment: t.installment,
    original: t.original,
    providerCategory: t.category,
  };
}

/** Uma linha para o log: só contagens e códigos (nunca valor, descrição ou credencial). */
export function describeOutcome(outcome: SyncOutcome): string {
  switch (outcome.status) {
    case "SUCCEEDED":
      return `novos ${outcome.created}, atualizados ${outcome.updated}, sem mudança ${outcome.unchanged}, fora ${outcome.skipped}`;
    case "FAILED":
      return `falhou: ${outcome.error}`;
    case "ALREADY_RUNNING":
      return "outra busca já está em andamento";
    case "NOT_READY":
      return "conexão sem credenciais, bancos ou data de corte";
  }
}

// ── O provedor de uma conexão ───────────────────────────────────────────────────

/**
 * Monta o adaptador do Meu Pluggy de uma conexão: decifra o Client Secret só agora, na memória
 * do processo que vai sincronizar. Sem credenciais gravadas: null.
 */
export async function providerForConnection(
  db: PrismaClient,
  connectionId: string,
  keyring: SecretKeyring,
  options: { baseUrl?: string; fetch?: FetchLike } = {},
): Promise<PluggyProvider | null> {
  const connection = await db.providerConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, clientId: true, secretCiphertext: true },
  });
  if (!connection?.clientId || !connection.secretCiphertext) return null;
  return new PluggyProvider({
    credentials: {
      clientId: connection.clientId,
      clientSecret: openSecret(keyring, connection.id, connection.secretCiphertext),
    },
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  });
}

/** As conexões prontas para a busca agendada (com credenciais, bancos e data de corte). */
export async function connectionsDueForSync(db: PrismaClient) {
  const rows = await db.providerConnection.findMany({
    where: {
      provider: "PLUGGY",
      status: { not: "REVOKED" },
      secretCiphertext: { not: null },
      importFrom: { not: null },
      items: { some: {} },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

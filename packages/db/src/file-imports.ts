// Importar extrato (M09.3, ADR-013) e a fatura em PDF (M09.4, ADR-014): o arquivo que a pessoa
// manda vira Recebidos, como os do Meu Pluggy, e ganha a revisão do M09.2 de graça. O formato
// (OFX ou PDF) só muda a origem das linhas; o resto é o mesmo. Três passos, cada um curto:
//
//   createFilePreview   o arquivo já foi LIDO (parseOfx, ou o serviço Python no PDF) e
//                       descartado; grava só o resumo, a impressão digital e as linhas lidas,
//                       para a pessoa conferir (1 hora)
//   filePreviewFor      a conferência: o resumo, a fatura conferida ao centavo (PDF), as contas
//                       possíveis, a sugerida, o aviso de "este arquivo já foi importado"
//   importFilePreview   "Importar N lançamentos": confere tudo DE NOVO e grava, numa transação,
//                       só as linhas novas (PENDING, origem OFX ou PDF), com a cascata de
//                       categoria; no PDF, também a fatura (total, mínimo, encargos) e o vínculo
//                       de cada compra com ela
//   cancelFilePreview   "Cancelar": apaga a conferência (nada foi gravado)
//
// Sem duplicar (matchImportRows, @fintrack/core):
//   já importado            o mesmo id (FITID, ou o hash da linha do PDF) já entrou nesta conta;
//                           ou a mesma compra já entrou pelo OUTRO formato (OFX ↔ PDF)
//   já veio pelo Meu Pluggy a conta tem um recebido do banco com o mesmo valor e a mesma data
//
// Quem importa: quem EDITA a carteira da conta (authorizeAccountUse pela porta WALLET). O
// portador de um adicional não importa a fatura inteira: veria compras que não são dele.
import {
  cardForLastFour,
  centsToDecimal,
  civilFromDbDate,
  dbDateFromCivil,
  decimalToCents,
  importAccountKinds,
  importedMethod,
  importWalletFor,
  isCivilDate,
  matchImportRows,
  runCascade,
  settlementCheck,
  statementForDueDate,
  suggestImportAccount,
  type Cents,
  type CivilDate,
  type ImportAccountSuggestion,
  type ImportRowState,
  type PaymentHint,
  type StatementChargeKind,
  type StatementKind,
} from "@fintrack/core";
import type { FileInvoice, StatementFile } from "@fintrack/importers";
import { authorizeScope, DomainError, isUuid, type AccountGrant, type WalletScope } from "./access";
import { listUsableAccounts } from "./accounts";
import { writeAudit, type RequestContext } from "./audit";
import { defaultSuggesters } from "./categories";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";
import { personalWalletsOf } from "./sync";

/** Quanto tempo a conferência espera a pessoa decidir. */
export const FILE_PREVIEW_MS = 60 * 60 * 1000;
/** Quantos arquivos o histórico de "Arquivos importados" mostra. */
export const FILE_HISTORY_LIMIT = 20;

// ── As linhas guardadas durante a conferência ──────────────────────────────────

/** Uma linha lida do arquivo, como fica guardada enquanto a pessoa confere. */
export type PreviewRow = {
  externalId: string;
  occurredOn: CivilDate;
  description: string;
  amount: Cents;
  paymentHint: PaymentHint;
  installment: { number: number; count: number } | null;
};

type StoredRow = {
  id: string;
  on: string;
  d: string;
  a: string;
  h: PaymentHint;
  i: [number, number] | null;
};
type StoredInvoice = {
  due: string;
  close: string | null;
  total: string;
  min: string | null;
  ch: { k: StatementChargeKind; a: string }[];
};
type StoredPreview = {
  rows: StoredRow[];
  balance: { a: string; on: string } | null;
  /** A fatura do PDF (M09.4); ausente no OFX */
  inv?: StoredInvoice | null;
};

const HINTS = new Set<PaymentHint>(["PIX", "BOLETO", "TRANSFER", null]);
const CHARGE_KINDS = new Set<StatementChargeKind>([
  "IOF",
  "LATE_INTEREST",
  "LATE_FEE",
  "REMUNERATIVE_INTEREST",
  "OTHER",
]);

function toStored(statement: StatementFile): StoredPreview {
  const invoice = statement.invoice;
  return {
    rows: statement.transactions.map((t) => ({
      id: t.externalId,
      on: t.occurredOn,
      d: t.description,
      a: centsToDecimal(t.amount),
      h: t.paymentHint,
      i: t.installment ? [t.installment.number, t.installment.count] : null,
    })),
    balance: statement.balance
      ? { a: centsToDecimal(statement.balance.amount), on: statement.balance.on }
      : null,
    inv: invoice
      ? {
          due: invoice.dueDate,
          close: invoice.closingDate,
          total: centsToDecimal(invoice.total),
          min: invoice.minimum === null ? null : centsToDecimal(invoice.minimum),
          ch: invoice.charges.map((c) => ({ k: c.kind, a: centsToDecimal(c.amount) })),
        }
      : null,
  };
}

function invoiceFromStored(inv: StoredInvoice | null | undefined): FileInvoice | null {
  if (!inv) return null;
  if (
    !isCivilDate(inv.due) ||
    (inv.close !== null && !isCivilDate(inv.close)) ||
    !Array.isArray(inv.ch) ||
    inv.ch.some((c) => !CHARGE_KINDS.has(c.k))
  ) {
    throw new Error("Fatura da conferência fora do formato");
  }
  return {
    dueDate: inv.due,
    closingDate: inv.close,
    total: decimalToCents(inv.total),
    minimum: inv.min === null ? null : decimalToCents(inv.min),
    charges: inv.ch.map((c) => ({ kind: c.k, amount: decimalToCents(c.a) })),
  };
}

/** Lê de volta o que createFilePreview gravou (e recusa o que não tiver esse formato). */
function fromStored(value: Prisma.JsonValue | null): {
  rows: PreviewRow[];
  balance: { amount: Cents; on: CivilDate } | null;
  invoice: FileInvoice | null;
} {
  const stored = value as Partial<StoredPreview> | null;
  if (!stored || !Array.isArray(stored.rows)) throw new Error("Conferência sem linhas");
  const rows = stored.rows.map((r) => {
    if (
      typeof r.id !== "string" ||
      typeof r.d !== "string" ||
      typeof r.a !== "string" ||
      typeof r.on !== "string" ||
      !isCivilDate(r.on) ||
      !HINTS.has(r.h)
    ) {
      throw new Error("Linha da conferência fora do formato");
    }
    return {
      externalId: r.id,
      occurredOn: r.on,
      description: r.d,
      amount: decimalToCents(r.a),
      paymentHint: r.h,
      installment: Array.isArray(r.i) ? { number: r.i[0], count: r.i[1] } : null,
    };
  });
  const balance =
    stored.balance && isCivilDate(stored.balance.on)
      ? { amount: decimalToCents(stored.balance.a), on: stored.balance.on }
      : null;
  return { rows, balance, invoice: invoiceFromStored(stored.inv) };
}

// ── A fatura confere? ──────────────────────────────────────────────────────────

/** A conferência da fatura do PDF: as compras lidas + os encargos = o total impresso? */
export type InvoiceCheck = {
  dueDate: CivilDate;
  closingDate: CivilDate | null;
  total: Cents;
  minimum: Cents | null;
  charges: FileInvoice["charges"];
  /** Soma das compras lidas (positiva = a pagar; estornos já descontados) */
  purchases: Cents;
  /** Total impresso − (compras + encargos). Zero = confere ao centavo */
  difference: Cents;
  matches: boolean;
};

export function invoiceCheck(
  invoice: FileInvoice,
  rows: readonly { amount: Cents }[],
): InvoiceCheck {
  const check = settlementCheck({
    total: invoice.total,
    charges: invoice.charges.map((c) => c.amount),
    purchases: rows.map((r) => r.amount),
  });
  return {
    ...invoice,
    purchases: check.found - invoice.charges.reduce((sum, c) => sum + c.amount, 0n),
    difference: check.difference,
    matches: check.matches,
  };
}

// ── 1. Guardar o que foi lido ──────────────────────────────────────────────────

/** Conferências vencidas (a pessoa fechou a aba): apagadas a cada envio novo. */
export async function purgeExpiredPreviews(db: PrismaClient, now: Date): Promise<number> {
  const result = await db.fileImport.deleteMany({
    where: { status: "PREVIEW", expiresAt: { lt: now } },
  });
  return result.count;
}

/**
 * Grava a conferência de um arquivo JÁ LIDO. O arquivo em si nunca chega aqui: só o resultado
 * do parseOfx e o SHA-256. Quem não tem nenhuma carteira para editar não importa nada.
 */
export async function createFilePreview(
  db: PrismaClient,
  input: {
    scope: WalletScope<"edit">;
    fileName: string;
    sha256: string;
    statement: StatementFile;
    now: Date;
  },
): Promise<{ id: string }> {
  const { scope, statement, now } = input;
  if (!scope.householdId || scope.walletIds.length === 0) throw new DomainError("NOT_FOUND");
  await purgeExpiredPreviews(db, now);
  const created = await db.fileImport.create({
    data: {
      householdId: scope.householdId,
      userId: scope.userId,
      kind: statement.format,
      profile: statement.format === "PDF" ? statement.profile : null,
      sha256: input.sha256,
      fileName: cleanFileName(input.fileName),
      statementKind: statement.kind,
      institution: statement.institution,
      bankId: statement.bankId,
      accountLastFour: statement.lastFour,
      periodFrom: statement.period ? dbDateFromCivil(statement.period.from) : null,
      periodTo: statement.period ? dbDateFromCivil(statement.period.to) : null,
      rowCount: statement.transactions.length,
      skippedCount: statement.skipped,
      preview: toStored(statement),
      expiresAt: new Date(now.getTime() + FILE_PREVIEW_MS),
    },
    select: { id: true },
  });
  return created;
}

/** O nome como a pessoa mandou, sem caminho e no tamanho da coluna (CHECK de 1 a 120). */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/\s+/g, " ").trim() ?? "";
  const text = base === "" ? "extrato" : base;
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

// ── 2. A conferência ───────────────────────────────────────────────────────────

export type ImportAccountOption = {
  id: string;
  name: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  walletName: string;
  /** Finais dos cartões ativos (cartão de crédito) */
  cardLastFours: string[];
};

export type FilePreview = {
  id: string;
  format: "OFX" | "PDF";
  /** O perfil que leu o PDF ("Banco Exemplo", "Genérico"); nulo no OFX */
  profile: string | null;
  fileName: string;
  statementKind: StatementKind;
  institution: string | null;
  lastFour: string | null;
  period: { from: CivilDate; to: CivilDate } | null;
  balance: { amount: Cents; on: CivilDate } | null;
  rows: PreviewRow[];
  /** A fatura do PDF, conferida com as linhas lidas; nula no OFX */
  invoice: InvoiceCheck | null;
  skipped: number;
  expiresAt: Date;
  /** O mesmo arquivo (mesmo SHA-256) já entrou: quando, e em qual conta */
  alreadyImported: { at: Date; accountName: string | null } | null;
  /** As contas em que o arquivo pode entrar (do tipo certo, que a pessoa edita) */
  accounts: ImportAccountOption[];
  suggestion: ImportAccountSuggestion | null;
};

/**
 * A conferência, só para quem enviou e só enquanto vale. De outra pessoa, vencida ou já
 * importada: null (a tela responde 404 e não confirma que existe).
 */
export async function filePreviewFor(
  db: PrismaClient,
  userId: string,
  id: string,
  now: Date,
): Promise<FilePreview | null> {
  if (!isUuid(id)) return null;
  const row = await db.fileImport.findFirst({
    where: { id, userId, status: "PREVIEW", expiresAt: { gt: now } },
  });
  if (!row) return null;
  const { rows, balance, invoice } = fromStored(row.preview);
  const kind = row.statementKind as StatementKind;

  const kinds = importAccountKinds(kind);
  const usable = (await listUsableAccounts(db, userId)).filter(
    (a) => a.via === "WALLET" && kinds.includes(a.kind),
  );
  const accounts: ImportAccountOption[] = usable.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind as ImportAccountOption["kind"],
    walletName: a.walletName,
    cardLastFours: a.cards.map((c) => c.lastFour),
  }));

  // "Aprendido": um arquivo do mesmo banco e final que já entrou numa destas contas
  const learned = row.accountLastFour
    ? await db.fileImport.findMany({
        where: {
          householdId: row.householdId,
          status: "IMPORTED",
          statementKind: row.statementKind,
          accountLastFour: row.accountLastFour,
          bankId: row.bankId,
          accountId: { in: accounts.map((a) => a.id) },
        },
        distinct: ["accountId"],
        select: { accountId: true },
      })
    : [];
  const learnedIds = new Set(learned.map((l) => l.accountId));
  const suggestion = suggestImportAccount({
    kind,
    lastFour: row.accountLastFour,
    candidates: accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      cardLastFours: a.cardLastFours,
      learned: learnedIds.has(a.id),
    })),
  });

  const previous = await db.fileImport.findFirst({
    where: { householdId: row.householdId, sha256: row.sha256, status: "IMPORTED" },
    orderBy: { importedAt: "desc" },
    select: { importedAt: true, account: { select: { name: true } } },
  });

  return {
    id: row.id,
    format: row.kind,
    profile: row.profile,
    fileName: row.fileName,
    statementKind: kind,
    institution: row.institution,
    lastFour: row.accountLastFour,
    period:
      row.periodFrom && row.periodTo
        ? { from: civilFromDbDate(row.periodFrom), to: civilFromDbDate(row.periodTo) }
        : null,
    balance,
    rows,
    invoice: invoice ? invoiceCheck(invoice, rows) : null,
    skipped: row.skippedCount,
    expiresAt: row.expiresAt,
    alreadyImported: previous?.importedAt
      ? { at: previous.importedAt, accountName: previous.account?.name ?? null }
      : null,
    accounts,
    suggestion,
  };
}

export type FileFormat = "OFX" | "PDF";

/**
 * O estado de cada linha do arquivo NA CONTA escolhida (nova, Meu Pluggy, já importada) e o
 * lançamento que já a cobre: o mesmo id do mesmo formato, um recebido do Meu Pluggy ou (M09.4)
 * a mesma compra vinda do OUTRO formato (o OFX do mês e depois o PDF da fatura).
 */
export async function matchPreviewRows(
  db: PrismaClient | Prisma.TransactionClient,
  accountId: string,
  rows: readonly PreviewRow[],
  format: FileFormat,
): Promise<{ state: ImportRowState; matchedId: string | null }[]> {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.occurredOn).sort();
  const period = {
    gte: dbDateFromCivil(dates[0]!),
    lte: dbDateFromCivil(dates.at(-1)!),
  };
  const existing = { id: true, occurredOn: true, amount: true } as const;
  // Em sequência (dentro de uma transação interativa, o Prisma não roda em paralelo)
  const imported = await db.transaction.findMany({
    where: { accountId, source: format, externalId: { in: rows.map((r) => r.externalId) } },
    select: { externalId: true },
  });
  const fromPluggy = await db.transaction.findMany({
    where: { accountId, source: "OPEN_FINANCE", deletedAt: null, occurredOn: period },
    select: existing,
  });
  const fromOtherFiles = await db.transaction.findMany({
    where: {
      accountId,
      source: format === "OFX" ? "PDF" : "OFX",
      deletedAt: null,
      occurredOn: period,
    },
    select: existing,
  });
  const asExisting = (list: typeof fromPluggy) =>
    list.map((t) => ({
      id: t.id,
      occurredOn: civilFromDbDate(t.occurredOn),
      amount: fromDbDecimal(t.amount),
    }));
  return matchImportRows({
    rows,
    importedIds: new Set(imported.map((t) => t.externalId as string)),
    fromPluggy: asExisting(fromPluggy),
    fromOtherFiles: asExisting(fromOtherFiles),
  });
}

/** Só os estados de matchPreviewRows (a tela e as contagens). */
export async function classifyPreviewRows(
  db: PrismaClient | Prisma.TransactionClient,
  accountId: string,
  rows: readonly PreviewRow[],
  format: FileFormat = "OFX",
): Promise<ImportRowState[]> {
  return (await matchPreviewRows(db, accountId, rows, format)).map((m) => m.state);
}

// ── 3. Importar ou cancelar ────────────────────────────────────────────────────

export type FileImportResult = {
  id: string;
  created: number;
  pluggy: number;
  alreadyImported: number;
  skipped: number;
  /** PDF: a fatura do cartão em que as compras entraram (nula no OFX) */
  statementId: string | null;
};

/**
 * Importa a conferência na conta do crachá. Tudo numa transação: a conferência passa de
 * PREVIEW para IMPORTED por UPDATE condicional (duas abas apertando "Importar" dão um sucesso e
 * um FILE_PREVIEW_EXPIRED, nunca as linhas em dobro), e a chave única (conta, origem, id) segura
 * o resto.
 *
 * PDF da fatura: a fatura do cartão (CardStatement) do vencimento impresso é criada ou
 * atualizada com o total, o mínimo e os encargos (IOF, juros), e cada compra nova ou já
 * existente (a mesma do Meu Pluggy ou do OFX) passa a apontar para ela. A fatura que o Meu
 * Pluggy já trouxe vale mais: o PDF só liga as compras, não troca total nem encargos.
 */
export async function importFilePreview(
  db: PrismaClient,
  input: { grant: AccountGrant; importId: string; now: Date },
  ctx: RequestContext,
): Promise<FileImportResult> {
  const { grant, importId, now } = input;
  if (grant.via !== "WALLET") throw new DomainError("NOT_FOUND");
  if (!isUuid(importId)) throw new DomainError("FILE_PREVIEW_EXPIRED");
  const row = await db.fileImport.findFirst({
    where: {
      id: importId,
      userId: grant.userId,
      householdId: grant.account.householdId,
      status: "PREVIEW",
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      kind: true,
      statementKind: true,
      accountLastFour: true,
      preview: true,
      skippedCount: true,
    },
  });
  if (!row) throw new DomainError("FILE_PREVIEW_EXPIRED");
  if (!importAccountKinds(row.statementKind as StatementKind).includes(grant.account.kind)) {
    throw new DomainError("FILE_ACCOUNT_KIND_MISMATCH");
  }
  const format = row.kind;
  const { rows, invoice } = fromStored(row.preview);
  if (invoice && grant.account.kind !== "CREDIT_CARD") {
    throw new DomainError("FILE_ACCOUNT_KIND_MISMATCH");
  }

  // A conta com os cartões (o final do extrato do cartão escolhe o cartão e o ambiente)
  const account = await db.financialAccount.findUniqueOrThrow({
    where: { id: grant.account.id },
    select: {
      id: true,
      walletId: true,
      holderId: true,
      kind: true,
      closingDay: true,
      dueDay: true,
      cards: {
        where: { archivedAt: null },
        select: { id: true, lastFour: true, holderId: true, importWalletId: true },
      },
    },
  });
  const fileLastFour = row.accountLastFour;
  const personalWallets = await personalWalletsOf(db, grant.account.householdId);
  const isCard = account.kind === "CREDIT_CARD";
  // Extrato do cartão: o final do arquivo (o titular, quase sempre). Final desconhecido fica
  // sem cartão e com o final em providerCardLastFour, como na busca (M09.2)
  const card = isCard ? cardForLastFour(account.cards, fileLastFour) : null;
  const destination = importWalletFor({ account, card, personalWallets });

  // A cascata vista por quem vai ver o lançamento (skill `categorizacao`)
  const viewer = destination.viewerId ?? account.holderId ?? grant.userId;
  const suggesters = defaultSuggesters(db, await authorizeScope(db, viewer, "view"));

  return db.$transaction(async (tx) => {
    const claimed = await tx.fileImport.updateMany({
      where: { id: row.id, status: "PREVIEW", expiresAt: { gt: now } },
      data: { status: "IMPORTED", importedAt: now, accountId: account.id, preview: Prisma.DbNull },
    });
    if (claimed.count !== 1) throw new DomainError("FILE_PREVIEW_EXPIRED");

    const matches = await matchPreviewRows(tx, account.id, rows, format);
    const states = matches.map((m) => m.state);
    const fresh = rows.filter((_, i) => states[i] === "NEW");
    const statementId = invoice ? await saveInvoice(tx, account, invoice) : null;
    const creates: Prisma.TransactionCreateManyInput[] = [];
    for (const t of fresh) {
      const kind = t.amount < 0n ? "expense" : "income";
      const suggestion = await runCascade(suggesters, { description: t.description, kind });
      creates.push({
        householdId: grant.account.householdId,
        walletId: destination.walletId,
        accountId: account.id,
        cardId: card?.id ?? null,
        method: importedMethod(account.kind, t.paymentHint, t.amount),
        categoryId: suggestion?.categoryId ?? null,
        categorizedBy: suggestion ? suggestion.source : null,
        amount: toDbDecimal(t.amount),
        occurredOn: dbDateFromCivil(t.occurredOn),
        description: t.description,
        status: "PENDING",
        source: format,
        externalId: t.externalId,
        fileImportId: row.id,
        statementId,
        providerInstallmentNumber: t.installment?.number ?? null,
        providerInstallmentCount: t.installment?.count ?? null,
        providerCardLastFour: isCard ? fileLastFour : null,
      });
    }
    const result =
      creates.length > 0
        ? await tx.transaction.createMany({ data: creates, skipDuplicates: true })
        : { count: 0 };
    if (statementId) {
      // A mesma compra que já estava na conta (Meu Pluggy, OFX) entra na fatura do PDF, se
      // ainda não estiver em nenhuma; a do Meu Pluggy já ligada à fatura do banco fica onde está
      const covered = matches.map((m) => m.matchedId).filter((id): id is string => id !== null);
      if (covered.length > 0) {
        await tx.transaction.updateMany({
          where: { id: { in: covered }, accountId: account.id, statementId: null },
          data: { statementId },
        });
      }
    }
    const check = invoice ? invoiceCheck(invoice, rows) : null;
    const counts = {
      created: result.count,
      pluggy: states.filter((s) => s === "PLUGGY").length,
      // Uma linha que outra aba gravou no meio do caminho também conta como já importada
      alreadyImported:
        states.filter((s) => s === "IMPORTED").length + (creates.length - result.count),
      skipped: row.skippedCount,
    };
    await tx.fileImport.update({
      where: { id: row.id },
      data: {
        createdCount: counts.created,
        pluggyCount: counts.pluggy,
        alreadyImportedCount: counts.alreadyImported,
        statementId,
        invoiceDifference: check ? toDbDecimal(check.difference) : null,
      },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.account.householdId,
        action: "file.imported",
        entity: "file_import",
        entityId: row.id,
        // Só ids e contagens: nunca valor, descrição, nome do arquivo ou final
        metadata: {
          accountId: account.id,
          kind: format,
          ...counts,
          ...(check ? { statementId, invoiceMatches: check.matches } : {}),
        },
      },
      ctx,
    );
    return { id: row.id, ...counts, statementId };
  });
}

/**
 * A fatura do PDF no cartão: a do vencimento impresso (pelo ciclo da conta, ou pelo fechamento
 * impresso). Nova: CLOSED, origem PDF. Já existente e vinda do Meu Pluggy: não muda (o banco vale
 * mais). Já existente de outra origem (a do M04, sem total; ou um PDF anterior): o total, o
 * mínimo e os encargos passam a ser os do PDF, e uma fatura ainda aberta passa a fechada.
 */
async function saveInvoice(
  tx: Prisma.TransactionClient,
  account: { id: string; closingDay: number | null; dueDay: number | null },
  invoice: FileInvoice,
): Promise<string> {
  const cycle =
    account.closingDay !== null && account.dueDay !== null
      ? { closingDay: account.closingDay, dueDay: account.dueDay }
      : null;
  const statement = statementForDueDate(invoice.dueDate, cycle, invoice.closingDate);
  const referenceMonth = dbDateFromCivil(`${statement.referenceMonth}-01`);
  const current = await tx.cardStatement.findUnique({
    where: { accountId_referenceMonth: { accountId: account.id, referenceMonth } },
    select: { id: true, source: true, status: true },
  });
  if (current?.source === "OPEN_FINANCE") return current.id;
  const data = {
    closingDate: dbDateFromCivil(statement.closingDate),
    dueDate: dbDateFromCivil(statement.dueDate),
    total: toDbDecimal(invoice.total),
    minimumPayment: invoice.minimum === null ? null : toDbDecimal(invoice.minimum),
    source: "PDF" as const,
    externalId: null,
  };
  const saved = current
    ? await tx.cardStatement.update({
        where: { id: current.id },
        data: { ...data, ...(current.status === "OPEN" ? { status: "CLOSED" as const } : {}) },
        select: { id: true },
      })
    : await tx.cardStatement.create({
        data: { accountId: account.id, referenceMonth, status: "CLOSED", ...data },
        select: { id: true },
      });
  await tx.statementCharge.deleteMany({ where: { statementId: saved.id } });
  if (invoice.charges.length > 0) {
    await tx.statementCharge.createMany({
      data: invoice.charges.map((c) => ({
        statementId: saved.id,
        accountId: account.id,
        kind: c.kind,
        amount: toDbDecimal(c.amount),
      })),
    });
  }
  return saved.id;
}

/** "Cancelar": apaga a conferência de quem enviou. Já importada ou de outra pessoa: nada. */
export async function cancelFilePreview(
  db: PrismaClient,
  userId: string,
  id: string,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await db.fileImport.deleteMany({ where: { id, userId, status: "PREVIEW" } });
  return result.count === 1;
}

// ── O histórico ────────────────────────────────────────────────────────────────

export type FileImportSummary = {
  id: string;
  format: FileFormat;
  fileName: string;
  accountName: string;
  statementKind: StatementKind;
  lastFour: string | null;
  period: { from: CivilDate; to: CivilDate } | null;
  created: number;
  pluggy: number;
  alreadyImported: number;
  importedAt: Date;
  /** PDF: a fatura em que as compras entraram e a diferença vista na conferência (0 = confere) */
  invoice: { statementId: string | null; dueDate: CivilDate | null; difference: Cents } | null;
};

/** Os arquivos importados nas contas que a pessoa VÊ, do mais novo para o mais antigo. */
export async function listFileImports(
  db: PrismaClient,
  scope: WalletScope<"view">,
  only?: { id: string },
): Promise<FileImportSummary[]> {
  if (!scope.householdId || scope.walletIds.length === 0) return [];
  const rows = await db.fileImport.findMany({
    where: {
      ...(only ? { id: only.id } : {}),
      householdId: scope.householdId,
      status: "IMPORTED",
      account: { walletId: { in: [...scope.walletIds] } },
    },
    orderBy: { importedAt: "desc" },
    take: FILE_HISTORY_LIMIT,
    select: {
      id: true,
      kind: true,
      fileName: true,
      statementKind: true,
      accountLastFour: true,
      periodFrom: true,
      periodTo: true,
      createdCount: true,
      pluggyCount: true,
      alreadyImportedCount: true,
      importedAt: true,
      statementId: true,
      invoiceDifference: true,
      statement: { select: { dueDate: true } },
      account: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    format: r.kind,
    fileName: r.fileName,
    accountName: r.account?.name ?? "",
    statementKind: r.statementKind as StatementKind,
    lastFour: r.accountLastFour,
    period:
      r.periodFrom && r.periodTo
        ? { from: civilFromDbDate(r.periodFrom), to: civilFromDbDate(r.periodTo) }
        : null,
    created: r.createdCount,
    pluggy: r.pluggyCount,
    alreadyImported: r.alreadyImportedCount,
    importedAt: r.importedAt as Date,
    invoice:
      r.invoiceDifference !== null
        ? {
            statementId: r.statementId,
            dueDate: r.statement ? civilFromDbDate(r.statement.dueDate) : null,
            difference: fromDbDecimal(r.invoiceDifference),
          }
        : null,
  }));
}

/** Um arquivo importado (o aviso "31 lançamentos entraram"), se a pessoa vê a conta dele. */
export async function fileImportFor(
  db: PrismaClient,
  scope: WalletScope<"view">,
  id: string,
): Promise<FileImportSummary | null> {
  if (!isUuid(id)) return null;
  return (await listFileImports(db, scope, { id }))[0] ?? null;
}

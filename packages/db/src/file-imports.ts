// Importar extrato (M09.3, ADR-013): o arquivo OFX que a pessoa manda vira Recebidos, como os do
// Meu Pluggy, e ganha a revisão do M09.2 de graça. Três passos, cada um curto:
//
//   createFilePreview   o arquivo já foi LIDO (parseOfx) e descartado; grava só o resumo, a
//                       impressão digital e as linhas lidas, para a pessoa conferir (1 hora)
//   filePreviewFor      a conferência: o resumo, as contas possíveis, a sugerida, o aviso de
//                       "este arquivo já foi importado" e o estado de cada linha na conta escolhida
//   importFilePreview   "Importar N lançamentos": confere tudo DE NOVO e grava, numa transação,
//                       só as linhas novas (PENDING, origem OFX), com a cascata de categoria
//   cancelFilePreview   "Cancelar": apaga a conferência (nada foi gravado)
//
// Sem duplicar (classifyImportRows, @fintrack/core):
//   já importado            o mesmo id (FITID) já entrou nesta conta por outro arquivo
//   já veio pelo Meu Pluggy a conta tem um recebido do banco com o mesmo valor e a mesma data
//
// Quem importa: quem EDITA a carteira da conta (authorizeAccountUse pela porta WALLET). O
// portador de um adicional não importa a fatura inteira: veria compras que não são dele.
import {
  cardForLastFour,
  centsToDecimal,
  civilFromDbDate,
  classifyImportRows,
  dbDateFromCivil,
  decimalToCents,
  importAccountKinds,
  importedMethod,
  importWalletFor,
  isCivilDate,
  runCascade,
  suggestImportAccount,
  type Cents,
  type CivilDate,
  type ImportAccountSuggestion,
  type ImportRowState,
  type PaymentHint,
  type StatementKind,
} from "@fintrack/core";
import type { OfxStatement } from "@fintrack/importers";
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
type StoredPreview = { rows: StoredRow[]; balance: { a: string; on: string } | null };

const HINTS = new Set<PaymentHint>(["PIX", "BOLETO", "TRANSFER", null]);

function toStored(statement: OfxStatement): StoredPreview {
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
  };
}

/** Lê de volta o que createFilePreview gravou (e recusa o que não tiver esse formato). */
function fromStored(value: Prisma.JsonValue | null): {
  rows: PreviewRow[];
  balance: { amount: Cents; on: CivilDate } | null;
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
  return { rows, balance };
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
    statement: OfxStatement;
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
      kind: "OFX",
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
  const text = base === "" ? "extrato.ofx" : base;
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
  fileName: string;
  statementKind: StatementKind;
  institution: string | null;
  lastFour: string | null;
  period: { from: CivilDate; to: CivilDate } | null;
  balance: { amount: Cents; on: CivilDate } | null;
  rows: PreviewRow[];
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
  const { rows, balance } = fromStored(row.preview);
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
    skipped: row.skippedCount,
    expiresAt: row.expiresAt,
    alreadyImported: previous?.importedAt
      ? { at: previous.importedAt, accountName: previous.account?.name ?? null }
      : null,
    accounts,
    suggestion,
  };
}

/** O estado de cada linha do arquivo NA CONTA escolhida (nova, Meu Pluggy, já importada). */
export async function classifyPreviewRows(
  db: PrismaClient | Prisma.TransactionClient,
  accountId: string,
  rows: readonly PreviewRow[],
): Promise<ImportRowState[]> {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.occurredOn).sort();
  // Em sequência (dentro de uma transação interativa, o Prisma não roda em paralelo)
  const imported = await db.transaction.findMany({
    where: { accountId, source: "OFX", externalId: { in: rows.map((r) => r.externalId) } },
    select: { externalId: true },
  });
  const fromPluggy = await db.transaction.findMany({
    where: {
      accountId,
      source: "OPEN_FINANCE",
      deletedAt: null,
      occurredOn: { gte: dbDateFromCivil(dates[0]!), lte: dbDateFromCivil(dates.at(-1)!) },
    },
    select: { occurredOn: true, amount: true },
  });
  return classifyImportRows({
    rows,
    importedIds: new Set(imported.map((t) => t.externalId as string)),
    fromPluggy: fromPluggy.map((t) => ({
      occurredOn: civilFromDbDate(t.occurredOn),
      amount: fromDbDecimal(t.amount),
    })),
  });
}

// ── 3. Importar ou cancelar ────────────────────────────────────────────────────

export type FileImportResult = {
  id: string;
  created: number;
  pluggy: number;
  alreadyImported: number;
  skipped: number;
};

/**
 * Importa a conferência na conta do crachá. Tudo numa transação: a conferência passa de
 * PREVIEW para IMPORTED por UPDATE condicional (duas abas apertando "Importar" dão um sucesso e
 * um FILE_PREVIEW_EXPIRED, nunca as linhas em dobro), e a chave única (conta, OFX, id) segura o
 * resto.
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
  const { rows } = fromStored(row.preview);

  // A conta com os cartões (o final do extrato do cartão escolhe o cartão e o ambiente)
  const account = await db.financialAccount.findUniqueOrThrow({
    where: { id: grant.account.id },
    select: {
      id: true,
      walletId: true,
      holderId: true,
      kind: true,
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

    const states = await classifyPreviewRows(tx, account.id, rows);
    const fresh = rows.filter((_, i) => states[i] === "NEW");
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
        source: "OFX",
        externalId: t.externalId,
        fileImportId: row.id,
        providerInstallmentNumber: t.installment?.number ?? null,
        providerInstallmentCount: t.installment?.count ?? null,
        providerCardLastFour: isCard ? fileLastFour : null,
      });
    }
    const result =
      creates.length > 0
        ? await tx.transaction.createMany({ data: creates, skipDuplicates: true })
        : { count: 0 };
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
        metadata: { accountId: account.id, kind: "OFX", ...counts },
      },
      ctx,
    );
    return { id: row.id, ...counts };
  });
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
  fileName: string;
  accountName: string;
  statementKind: StatementKind;
  lastFour: string | null;
  period: { from: CivilDate; to: CivilDate } | null;
  created: number;
  pluggy: number;
  alreadyImported: number;
  importedAt: Date;
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
      fileName: true,
      statementKind: true,
      accountLastFour: true,
      periodFrom: true,
      periodTo: true,
      createdCount: true,
      pluggyCount: true,
      alreadyImportedCount: true,
      importedAt: true,
      account: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
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

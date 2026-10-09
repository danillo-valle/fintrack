"use server";

// Server Actions de lançamentos (M07). Toda action é um endpoint público (qualquer um pode
// chamá-la com um POST, sem a tela), então cada uma, nesta ordem (skill nova-feature):
//   1. confere a sessão (requireUser)
//   2. valida a entrada (zod)
//   3. pega os crachás: carteira (edit), conta (uso), lançamento (edit), escopo (view)
//   4. chama a operação do @fintrack/db
import {
  archiveRecurrence,
  confirmTransaction,
  createFixedExpense,
  createInstallmentPurchase,
  createRecurrence,
  createTransaction,
  createTransfer,
  deleteTransaction,
  exportTransactions,
  generateRecurrences,
  prisma,
  restoreTransaction,
  suggestCategory,
  updateTransaction,
} from "@fintrack/db";
import { centsToDecimal, type CategorySuggestion } from "@fintrack/core";
import { revalidatePath } from "next/cache";
import {
  AccessError,
  requestContext,
  requireAccountUse,
  requireHouseholdAccess,
  requireScope,
  requireTransactionAccess,
  requireWalletAccess,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireRecentAuth, requireUser } from "@/lib/auth/session";
import type { Session } from "@/lib/auth";
import {
  exportSchema,
  generateSchema,
  newEntrySchema,
  recurrenceIdSchema,
  recurrenceSchema,
  suggestSchema,
  transactionIdSchema,
  transactionSchema,
  transferSchema,
} from "../schemas";

const LIST = "/lancamentos";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

/** O crachá do lar para criar regra, se a pessoa pediu "sempre categorizar assim". */
async function ruleGrantIfAsked(session: Session, asked: boolean) {
  if (!asked) return null;
  try {
    return { grant: await requireHouseholdAccess(session, "manage_categories") };
  } catch (error) {
    if (error instanceof AccessError) return null; // sem lar ou sem papel: grava sem a regra
    throw error;
  }
}

// ── Sugestão de categoria (enquanto a pessoa digita) ────────────────────────────

/** A sugestão da cascata para a descrição. Não grava nada; a gravação roda a cascata de novo. */
export async function suggestCategoryAction(input: {
  description: string;
  kind: "expense" | "income";
}): Promise<Pick<CategorySuggestion, "categoryId" | "reason" | "source"> | null> {
  const session = await requireUser();
  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) return null;
  const scope = await requireScope(session, "view");
  const suggestion = await suggestCategory(prisma, scope, parsed.data);
  return suggestion
    ? { categoryId: suggestion.categoryId, reason: suggestion.reason, source: suggestion.source }
    : null;
}

// ── Lançar, editar, excluir ─────────────────────────────────────────────────────

/** Estado do lançamento rápido: além do aviso, o lançamento criado (para o "desfazer"). */
export type EntryState = ActionState & {
  created: {
    id: string;
    amount: string;
    kind: "expense" | "income";
    description: string;
    /** "Desfazer" só vale para o lançamento simples; parcelas e fixas se desfazem na lista */
    undoable: boolean;
    /** Para o aviso: "em 3 parcelas", "todo mês" */
    detail: string | null;
  } | null;
  /** Muda a cada envio que deu certo: o formulário usa para se limpar */
  version: number;
};

/**
 * O novo lançamento (M07; tipo da despesa no M07.4). Variável é o lançamento de sempre; parcelada
 * vira N lançamentos, um por fatura (createInstallmentPurchase); fixa cria a recorrência e o
 * lançamento deste mês (createFixedExpense). As três passam pelos mesmos crachás.
 */
export async function createTransactionAction(
  prev: EntryState,
  formData: FormData,
): Promise<EntryState> {
  const session = await requireUser();
  const parsed = newEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error), created: null, version: prev.version };
  const data = parsed.data;

  let created: EntryState["created"] = null;
  const result = await runAction(async () => {
    const wallet = await requireWalletAccess(session, data.walletId, "edit");
    const account = await requireAccountUse(session, data.accountId);
    const ctx = await requestContext();
    const options = {
      scope: await requireScope(session, "view"),
      rememberRule: await ruleGrantIfAsked(session, data.rememberRule),
    };
    const base = {
      amount: centsToDecimal(data.amount),
      kind: data.kind,
      description: data.description,
    };
    if (data.expenseType === "installment" && data.installments !== undefined) {
      const { transactionIds } = await createInstallmentPurchase(
        prisma,
        wallet,
        account,
        { ...data, cents: data.amount, count: data.installments, purchasedOn: data.occurredOn },
        options,
        ctx,
      );
      created = {
        ...base,
        id: transactionIds[0]!,
        undoable: false,
        detail: `em ${data.installments} parcelas`,
      };
    } else if (data.expenseType === "fixed" && data.dueDay !== undefined) {
      const { transactionId } = await createFixedExpense(
        prisma,
        wallet,
        account,
        { ...data, kind: data.fixedKind, cents: data.amount, dayOfMonth: data.dueDay },
        ctx,
      );
      created = { ...base, id: transactionId, undoable: false, detail: "todo mês" };
    } else {
      const { id } = await createTransaction(
        prisma,
        wallet,
        account,
        { ...data, cents: data.amount },
        options,
        ctx,
      );
      created = { ...base, id, undoable: true, detail: null };
    }
  });
  revalidatePath(LIST);
  return result.error
    ? { ...result, created: null, version: prev.version }
    : { ...result, created, version: prev.version + 1 };
}

export async function updateTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const id = transactionIdSchema.safeParse(Object.fromEntries(formData));
  const parsed = transactionSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return invalid(id.error);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, id.data.transactionId, "edit");
    const target = await requireWalletAccess(session, data.walletId, "edit");
    const account = await requireAccountUse(session, data.accountId);
    await updateTransaction(
      prisma,
      grant,
      target,
      account,
      { ...data, cents: data.amount },
      {
        scope: await requireScope(session, "view"),
        rememberRule: await ruleGrantIfAsked(session, data.rememberRule),
      },
      await requestContext(),
    );
    return "Lançamento salvo.";
  });
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${id.data.transactionId}`);
  return result;
}

/** Exclusão lógica. A tela mostra o aviso com "Desfazer", que chama restoreTransactionAction. */
export async function deleteTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = transactionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, parsed.data.transactionId, "edit");
    await deleteTransaction(prisma, grant, await requestContext());
    return "Lançamento excluído.";
  });
  revalidatePath(LIST);
  return result;
}

export async function restoreTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = transactionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, parsed.data.transactionId, "edit", {
      includeDeleted: true,
    });
    await restoreTransaction(prisma, grant, await requestContext());
    return "Lançamento de volta.";
  });
  revalidatePath(LIST);
  return result;
}

/** Agendado → aconteceu. */
export async function confirmTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = transactionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, parsed.data.transactionId, "edit");
    await confirmTransaction(prisma, grant);
    return "Confirmado.";
  });
  revalidatePath(LIST);
  return result;
}

// ── Transferência ───────────────────────────────────────────────────────────────

export async function createTransferAction(
  prev: EntryState,
  formData: FormData,
): Promise<EntryState> {
  const session = await requireUser();
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error), created: null, version: prev.version };
  const data = parsed.data;
  const result = await runAction(async () => {
    const from = await requireAccountUse(session, data.fromAccountId);
    const to = await requireAccountUse(session, data.toAccountId);
    await createTransfer(prisma, from, to, { ...data, cents: data.amount });
    return "Transferência registrada. Ela não conta como gasto nem como receita.";
  });
  revalidatePath(LIST);
  return { ...result, created: null, version: result.error ? prev.version : prev.version + 1 };
}

// ── Recorrências ────────────────────────────────────────────────────────────────

export async function createRecurrenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = recurrenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const result = await runAction(async () => {
    const wallet = await requireWalletAccess(session, data.walletId, "edit");
    const account = await requireAccountUse(session, data.accountId);
    await createRecurrence(
      prisma,
      wallet,
      account,
      { ...data, cents: data.amount },
      await requestContext(),
    );
    return 'Recorrência criada. Use "Lançar as deste mês" para gerar o lançamento agendado.';
  });
  revalidatePath(`${LIST}/recorrencias`);
  return result;
}

export async function archiveRecurrenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = recurrenceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const wallet = await requireWalletAccess(session, parsed.data.walletId, "edit");
    await archiveRecurrence(prisma, wallet, parsed.data.recurrenceId, await requestContext());
    return "Recorrência encerrada. Os lançamentos já gerados continuam.";
  });
  revalidatePath(`${LIST}/recorrencias`);
  return result;
}

export async function generateRecurrencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const { created } = await generateRecurrences(
      prisma,
      scope,
      parsed.data.month,
      await requestContext(),
    );
    return created === 0
      ? "Nada novo: as recorrências deste mês já estavam lançadas."
      : `${created} ${created === 1 ? "lançamento agendado criado" : "lançamentos agendados criados"}.`;
  });
  revalidatePath(LIST);
  revalidatePath(`${LIST}/recorrencias`);
  return result;
}

// ── Exportação ─────────────────────────────────────────────────────────────────

export type ExportState = ActionState & { file: { name: string; content: string } | null };

/**
 * Exporta CSV de uma carteira. Ação sensível: pede uma prova recente de identidade (senha,
 * código ou passkey nos últimos 10 minutos); sem ela, vai para /reautenticar e volta.
 */
export async function exportTransactionsAction(
  _prev: ExportState,
  formData: FormData,
): Promise<ExportState> {
  const session = await requireRecentAuth(`${LIST}/exportar`);
  const parsed = exportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error), file: null };
  const { walletId, from, to } = parsed.data;
  let file: ExportState["file"] = null;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "export");
    const { csv, rows } = await exportTransactions(
      prisma,
      grant,
      { from, to },
      await requestContext(),
    );
    file = { name: `fintrack-${slug(grant.wallet.name)}-${from}-a-${to}.csv`, content: csv };
    return `Arquivo pronto: ${rows} ${rows === 1 ? "lançamento" : "lançamentos"}.`;
  });
  return { ...result, file: result.error ? null : file };
}

/** "Casa da Ana" → "casa-da-ana" (nome de arquivo sem acento nem espaço). */
function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "carteira"
  );
}

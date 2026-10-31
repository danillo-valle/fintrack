"use server";

// Server Actions da coleta bancária (M09.1). Toda action é um endpoint público, então cada uma,
// nesta ordem (skill nova-feature):
//   1. confere a sessão (requireUser) e, para mexer em credenciais e contas, uma prova de
//      identidade dos últimos 10 minutos (requireRecentAuth): conectar banco é ação sensível
//   2. valida a entrada (zod)
//   3. pega o crachá (a conexão é SEMPRE a de quem está logado; o lançamento, pelo id)
//   4. chama a operação do @fintrack/db
// Client ID, Client Secret e Item ID nunca vão para log nem para a resposta.
import {
  createCategory,
  DomainError,
  linkAccounts,
  markTransfer,
  openSecret,
  prisma,
  recordSyncRequest,
  saveCredentials,
  SecretKeyError,
  setTransactionCategory,
  setTransactionLabel,
  unmarkTransfer,
} from "@fintrack/db";
import { isProviderError, type PluggyProvider } from "@fintrack/importers";
import { todayCivil } from "@fintrack/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AccessError,
  requestContext,
  requireHouseholdAccess,
  requireScope,
  requireTransactionAccess,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireRecentAuth, requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import { logger } from "@/lib/logger";
import { providerErrorMessage } from "../messages";
import {
  credentialsInput,
  credentialsSchema,
  markTransferSchema,
  parseLinkForm,
  setCategorySchema,
  setLabelSchema,
} from "../schemas";
import { enqueueSync } from "./jobs";
import { connectionKeyring } from "./keyring";
import { pluggyWith } from "./provider";
import { bankAccountsNow, myConnectionGrant } from "./queries";

const CONNECTIONS = "/ajustes/conexoes";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

/** Erro da Pluggy vira frase; os outros continuam subindo (runAction ou a tela de erro). */
function providerFailure(error: unknown, userId: string): ActionState | null {
  if (!isProviderError(error)) return null;
  logger.warn({ event: "bank.provider_rejected", code: error.code, userId }, "a Pluggy recusou");
  return { error: providerErrorMessage(error.code), success: null };
}

// ── Passo 1: credenciais ────────────────────────────────────────────────────────

/**
 * "Testar e continuar": confere Client ID, Client Secret e cada Item ID na Pluggy ANTES de gravar
 * (credencial errada não fica no banco). Segredo em branco = testa com o que já estava gravado.
 */
export async function saveCredentialsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRecentAuth(`${CONNECTIONS}/credenciais`);
  const parsed = credentialsSchema.safeParse(credentialsInput(formData));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  let failure: ActionState | null = null;
  const result = await runAction(async () => {
    const grant = await myConnectionGrant(session);
    if (!grant) throw new AccessError("NO_HOUSEHOLD");
    const keyring = connectionKeyring();
    let secret = data.clientSecret;
    let storedClientId: string | null = null;
    if (grant.connectionId) {
      const row = await prisma.providerConnection.findUnique({
        where: { id: grant.connectionId },
        select: { clientId: true, secretCiphertext: true },
      });
      storedClientId = row?.clientId ?? null;
      if (!secret && row?.secretCiphertext) {
        try {
          secret = openSecret(keyring, grant.connectionId, row.secretCiphertext);
        } catch (error) {
          // A chave do servidor mudou e não decifra mais o gravado: pede o segredo de novo
          if (!(error instanceof SecretKeyError)) throw error;
        }
      }
    }
    if (!secret) throw new DomainError("CONNECTION_SECRET_REQUIRED");
    const clientId = data.clientId ?? storedClientId;
    if (!clientId) throw new DomainError("CONNECTION_SECRET_REQUIRED");
    const provider: PluggyProvider = pluggyWith({ clientId, clientSecret: secret });
    try {
      await provider.verifyCredentials();
      for (const itemId of data.itemIds) await provider.getItem(itemId);
    } catch (error) {
      failure = providerFailure(error, session.user.id);
      if (failure) return;
      throw error;
    }
    await saveCredentials(
      prisma,
      grant,
      { clientId, clientSecret: data.clientSecret, itemIds: data.itemIds },
      keyring,
      await requestContext(),
    );
    logger.info(
      { event: "bank.credentials_saved", userId: session.user.id, banks: data.itemIds.length },
      "credenciais gravadas",
    );
  });
  if (failure) return failure;
  if (result.error) return result;
  revalidatePath(CONNECTIONS);
  redirect(`${CONNECTIONS}/ligar`);
}

// ── Passo 2: ligar as contas ────────────────────────────────────────────────────

/**
 * "Salvar e buscar agora": grava a ligação de cada conta do banco e a data de corte, e põe a
 * primeira busca na fila. As contas do banco são buscadas DE NOVO aqui: a tela não decide quais
 * contas existem.
 */
export async function linkAccountsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRecentAuth(`${CONNECTIONS}/ligar`);
  const parsed = parseLinkForm(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };

  let failure: ActionState | null = null;
  let connectionId: string | null = null;
  const result = await runAction(async () => {
    const grant = await myConnectionGrant(session);
    if (!grant?.connectionId) throw new DomainError("CONNECTION_NOT_READY");
    connectionId = grant.connectionId;
    let bank;
    try {
      bank = await bankAccountsNow(grant);
    } catch (error) {
      failure = providerFailure(error, session.user.id);
      if (failure) return;
      throw error;
    }
    await linkAccounts(
      prisma,
      grant,
      {
        bank,
        choices: parsed.data.choices,
        cardWallets: parsed.data.cardWallets,
        importFrom: parsed.data.importFrom,
        today: todayCivil(),
      },
      await requestContext(),
    );
  });
  if (failure) return failure;
  if (result.error || !connectionId) return result;
  await enqueueSync({ connectionId, trigger: "MANUAL", requestedById: session.user.id });
  revalidatePath(CONNECTIONS);
  redirect(`${CONNECTIONS}/sincronizacoes`);
}

// ── Buscar agora ────────────────────────────────────────────────────────────────

/**
 * Põe uma busca na fila (o worker executa em segundos; a página mostra quando terminar). Sem
 * parâmetros: o formulário só tem o botão, e a conexão é sempre a de quem está logado.
 */
export async function requestSyncAction(): Promise<ActionState> {
  const session = await requireUser();
  let queued = false;
  const result = await runAction(async () => {
    const grant = await myConnectionGrant(session);
    if (!grant?.connectionId) throw new DomainError("CONNECTION_NOT_READY");
    await recordSyncRequest(prisma, grant, await requestContext());
    queued = await enqueueSync({
      connectionId: grant.connectionId,
      trigger: "MANUAL",
      requestedById: session.user.id,
    });
  });
  if (result.error) return result;
  revalidatePath(`${CONNECTIONS}/sincronizacoes`);
  return {
    error: null,
    success: queued
      ? "Busca pedida. Em alguns segundos, recarregue para ver o resultado."
      : "Já há uma busca na fila. Em alguns segundos, recarregue para ver o resultado.",
  };
}

// ── Categoria em um clique ──────────────────────────────────────────────────────

/** Estado da escolha de categoria: além do aviso, a categoria gravada (para a linha mudar). */
export type CategoryState = ActionState & { categoryId: string | null };

/**
 * Grava a categoria de um lançamento (recebido do banco ou não) sem abrir a edição. Uma categoria
 * nova (o texto da busca) é criada antes, no lar. "Sempre categorizar assim" cria a regra.
 */
export async function setCategoryAction(
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  const session = await requireUser();
  const parsed = setCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error), categoryId: null };
  const data = parsed.data;

  let chosen: string | null = null;
  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, data.transactionId, "edit");
    const ctx = await requestContext();
    let categoryId = data.categoryId;
    if (!categoryId && data.newCategory) {
      const household = await requireHouseholdAccess(session, "manage_categories");
      const current = await prisma.transaction.findUniqueOrThrow({
        where: { id: grant.transaction.id },
        select: { amount: true },
      });
      const created = await createCategory(
        prisma,
        household,
        { name: data.newCategory, kind: current.amount.isNegative() ? "EXPENSE" : "INCOME" },
        ctx,
      );
      categoryId = created.id;
    }
    if (!categoryId) throw new DomainError("CATEGORY_INVALID");
    const rememberRule = data.rememberRule
      ? { grant: await requireHouseholdAccess(session, "manage_categories") }
      : null;
    await setTransactionCategory(prisma, grant, categoryId, { rememberRule }, ctx);
    await financeChanged(session);
    chosen = categoryId;
    return data.rememberRule
      ? "Categoria salva. As próximas iguais já chegam assim."
      : "Categoria salva.";
  });
  if (!result.error) {
    revalidatePath("/lancamentos");
    revalidatePath("/carteiras/conta/[accountId]", "page");
  }
  return { ...result, categoryId: chosen };
}

/**
 * O "O que foi" (M13.2) de um lançamento do banco, num clique: na revisão e na página do cartão.
 * Numa parcela, vale para as outras parcelas da mesma compra. O texto nunca vai para log.
 */
export async function setLabelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  const parsed = setLabelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireTransactionAccess(session, parsed.data.transactionId, "edit");
    const count = await setTransactionLabel(
      prisma,
      grant,
      parsed.data.label || null,
      await requestContext(),
    );
    if (!parsed.data.label) return "O que foi apagado: fica o texto do banco.";
    return count > 1 ? `Salvo nas ${count} parcelas desta compra.` : "Salvo.";
  });
  if (!result.error) {
    revalidatePath("/lancamentos", "layout");
    revalidatePath("/carteiras/conta/[accountId]", "page");
  }
  return result;
}

/**
 * "É transferência" de um lado só (M13.2): o outro lado é de alguém do lar (que você não vê) ou de
 * uma conta sua fora do FinTrack. O recebido continua na revisão, sem categoria, e sai das somas
 * ao ser confirmado. "Desmarcar" volta a pedir a categoria.
 */
export async function markTransferAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = markTransferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const ctx = await requestContext();
    if (input.intent === "unmark") {
      await unmarkTransfer(prisma, scope, input.transactionId, ctx);
      return "Desmarcado: escolha a categoria.";
    }
    await markTransfer(
      prisma,
      scope,
      { transactionId: input.transactionId, peer: input.peer },
      ctx,
    );
    return input.peer === "HOUSEHOLD"
      ? "Marcado como transferência para alguém do lar. Confirme para tirar das somas."
      : "Marcado como transferência para uma conta sua fora do FinTrack. Confirme para tirar das somas.";
  });
  if (!result.error) {
    revalidatePath("/lancamentos", "layout");
    revalidatePath("/carteiras/conta/[accountId]", "page");
  }
  return result;
}

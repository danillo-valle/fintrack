"use server";

// Server Actions da revisão dos recebidos (M09.2). Mesma ordem de sempre (skill nova-feature):
// sessão → zod → escopo/crachá de quem está logado → operação do @fintrack/db (com auditoria).
// A tela só sugere; as regras do par e do lote são conferidas DE NOVO no @fintrack/db.
//
// Toda confirmação muda as somas (o recebido passa a contar): chama financeChanged.
import {
  authorizeAccountView,
  confirmBulk,
  confirmPair,
  confirmReceived,
  createCard,
  linkRefund,
  prisma,
  rejectPair,
  undoMatch,
  undoReview,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AccessError,
  requestContext,
  requireScope,
  requireWalletAccess,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import {
  explainedConfirmSchema,
  pairSchema,
  registerFinalSchema,
  reviewSchema,
  undoSchema,
} from "../schemas";

const REVIEW_PATH = "/lancamentos/recebidos";

/** O que o aviso "Desfazer" precisa para desfazer a última decisão. */
export type ReviewUndo = { kind: "review"; ids: string[] } | { kind: "match"; matchId: string };
export type ReviewState = ActionState & { undo: ReviewUndo | null };

const failed = (error: string): ReviewState => ({ error, success: null, undo: null });

function refreshReviewPages() {
  revalidatePath(REVIEW_PATH);
  revalidatePath("/lancamentos");
  revalidatePath("/carteiras/conta/[accountId]", "page");
}

const confirmedSentence = (n: number) =>
  n === 1
    ? "1 recebido confirmado. Já entra nas somas."
    : `${n} recebidos confirmados. Já entram nas somas.`;

/**
 * Os botões da revisão: Confirmar (na linha), Confirmar os N (em lote), Não é o mesmo e Ligar
 * ao original. Um `intent` por formulário; todos voltam com o aviso e, quando dá, o "Desfazer".
 */
export async function reviewAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const session = await requireUser();
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed("Não deu para entender o pedido. Recarregue a página.");
  const input = parsed.data;

  let undo: ReviewUndo | null = null;
  let changedSums = false;
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const ctx = await requestContext();
    switch (input.intent) {
      case "confirm": {
        const { ids } = await confirmReceived(
          prisma,
          scope,
          { transactionId: input.transactionId, walletId: input.walletId },
          ctx,
        );
        undo = { kind: "review", ids };
        changedSums = true;
        return confirmedSentence(1);
      }
      case "bulk": {
        const { ids } = await confirmBulk(
          prisma,
          scope,
          { accountId: input.accountId, statementId: input.statementId },
          ctx,
        );
        if (ids.length === 0)
          return "Nada a confirmar: os que têm categoria já foram confirmados ou têm par sugerido.";
        undo = { kind: "review", ids };
        changedSums = true;
        return confirmedSentence(ids.length);
      }
      case "reject": {
        await rejectPair(prisma, scope, { receivedId: input.receivedId, ownId: input.ownId }, ctx);
        return "Certo: esse par não volta a ser sugerido. O recebido continua na lista.";
      }
      case "refund": {
        const { matchId } = await linkRefund(
          prisma,
          scope,
          { receivedId: input.receivedId, originalId: input.ownId },
          ctx,
        );
        undo = { kind: "match", matchId };
        changedSums = true;
        return "Estorno ligado à compra. Os dois já entram nas somas e se anulam.";
      }
    }
  });
  if (result.error) return { ...result, undo: null };
  if (changedSums) await financeChanged(session);
  refreshReviewPages();
  return { ...result, undo };
}

/** O "Desfazer" do aviso: volta para Recebidos o que acabou de ser confirmado, juntado ou ligado. */
export async function undoReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = undoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Não deu para desfazer. Recarregue a página.", success: null };
  const input = parsed.data;
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const ctx = await requestContext();
    if (input.kind === "review") await undoReview(prisma, scope, input.ids, ctx);
    else await undoMatch(prisma, scope, input.matchId, ctx);
    return "Desfeito: voltou para Recebidos.";
  });
  if (!result.error) {
    await financeChanged(session);
    refreshReviewPages();
  }
  return result;
}

/**
 * "Confirmar par" (o modal E2-Par): fica UM lançamento, o do banco, com o seu lado. Volta para a
 * revisão com ?juntado=<id da decisão>, de onde o aviso oferece o "Desfazer".
 */
export async function confirmPairAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = pairSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Não deu para entender o pedido. Recarregue a página.", success: null };
  let matchId: string | null = null;
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    ({ matchId } = await confirmPair(prisma, scope, parsed.data, await requestContext()));
  });
  if (result.error || !matchId) return result;
  await financeChanged(session);
  refreshReviewPages();
  redirect(`${REVIEW_PATH}?juntado=${matchId}`);
}

/**
 * "Confirmar" no "Por que essa categoria?" (M10.1): confirma o recebido com a categoria e o
 * ambiente que ele tem. Volta para a revisão com ?confirmado=<id>, de onde o aviso oferece o
 * "Desfazer" (o mesmo do Confirmar da linha).
 */
export async function confirmExplainedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = explainedConfirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: "Não deu para entender o pedido. Recarregue a página.", success: null };
  let confirmed: string | null = null;
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const { ids } = await confirmReceived(prisma, scope, parsed.data, await requestContext());
    confirmed = ids[0] ?? null;
  });
  if (result.error || !confirmed) return result;
  await financeChanged(session);
  refreshReviewPages();
  redirect(`${REVIEW_PATH}?confirmado=${confirmed}`);
}

/**
 * "Cadastrar e reorganizar" (prancha E2-Finais): cadastra o cartão do final que o banco mandou e
 * leva os recebidos dele para o cartão e o ambiente do portador. A bandeira é a dos outros
 * cartões da conta (é a mesma fatura).
 */
export async function registerFinalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = registerFinalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      error: parsed.error.issues[0]?.message ?? "Confira o que foi digitado.",
      success: null,
    };
  const input = parsed.data;
  let moved: number | null = null;
  const result = await runAction(async () => {
    const view = await authorizeAccountView(prisma, session.user.id, input.accountId);
    if (!view.ok) throw new AccessError("NOT_FOUND");
    const grant = await requireWalletAccess(
      session,
      view.grant.wallet.wallet.id,
      "manage_accounts",
    );
    const [sibling, account] = await Promise.all([
      prisma.paymentCard.findFirst({
        where: { accountId: input.accountId },
        orderBy: { createdAt: "asc" },
        select: { brand: true },
      }),
      prisma.financialAccount.findUniqueOrThrow({
        where: { id: input.accountId },
        select: { holderId: true },
      }),
    ]);
    const card = await createCard(
      prisma,
      grant,
      input.accountId,
      {
        nickname: input.nickname,
        brand: sibling?.brand ?? "Cartão",
        lastFour: input.lastFour,
        form: "PHYSICAL",
        // Adicional = de outra pessoa (lança com ele sem ver o resto da fatura, regra do M04)
        isAdditional: input.holderId !== account.holderId,
        holderId: input.holderId,
      },
      await requestContext(),
    );
    moved = card.rerouted;
  });
  if (result.error || moved === null) return result;
  revalidatePath("/ajustes/contas");
  refreshReviewPages();
  redirect(`/ajustes/contas/${input.accountId}?movidos=${moved}`);
}

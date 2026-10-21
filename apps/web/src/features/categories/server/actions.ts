"use server";

// Server Actions de categorias e regras (M07): sessão → zod → crachá "manage_categories" do
// lar → operação (com auditoria). As duas pessoas do lar organizam.
import {
  createCategory,
  createRule,
  deleteRule,
  prisma,
  setCategoryArchived,
  setLocalAi,
  trainNow,
  type TrainOutcome,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import {
  requestContext,
  requireHouseholdAccess,
  requireScope,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import { classifierPort } from "@/lib/ml/classifier";
import {
  archiveCategorySchema,
  categorySchema,
  localAiSwitchSchema,
  ruleIdSchema,
  ruleSchema,
} from "../schemas";

const PAGE = "/ajustes/categorias";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

export async function createCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    await createCategory(prisma, grant, parsed.data, await requestContext());
    return `Categoria "${parsed.data.name}" criada.`;
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

export async function setCategoryArchivedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = archiveCategorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const archived = parsed.data.archived === "true";
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    await setCategoryArchived(
      prisma,
      grant,
      parsed.data.categoryId,
      archived,
      await requestContext(),
    );
    return archived ? "Categoria arquivada." : "Categoria restaurada.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

export async function createRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    await createRule(prisma, grant, parsed.data, await requestContext());
    return "Regra criada. Ela já vale para as próximas sugestões.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

export async function deleteRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = ruleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    await deleteRule(prisma, grant, parsed.data.ruleId, await requestContext());
    return "Regra apagada.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

// ── Classificador (M10.1) ───────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Treinar agora" (Ajustes › Categorização): treina o modelo de cada carteira que a pessoa vê,
 * se os exemplos mudaram, e preenche os recebidos sem categoria. Não muda somas (recebido fica
 * fora delas até confirmar): não chama financeChanged. O treino da madrugada faz o mesmo.
 */
export async function trainNowAction(): Promise<ActionState> {
  const session = await requireUser();
  const port = classifierPort(session.user.id);
  if (!port) {
    return { error: "O classificador não está ligado neste servidor.", success: null };
  }
  let outcomes: TrainOutcome[] = [];
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    const scope = await requireScope(session, "view");
    outcomes = await trainNow(prisma, port, grant, scope, await requestContext());
  });
  revalidatePath("/ajustes/categorizacao");
  revalidatePath("/lancamentos/recebidos");
  if (result.error) return result;
  return trainingSummary(outcomes);
}

/** A frase do resultado: "Treino feito: 2 carteiras treinadas, 1 sem mudança." */
function trainingSummary(outcomes: readonly TrainOutcome[]): ActionState {
  const count = (status: TrainOutcome["status"]) =>
    outcomes.filter((o) => o.status === status).length;
  if (count("FAILED") > 0 && count("TRAINED") + count("UNCHANGED") === 0) {
    return {
      error: "O classificador não respondeu. Tente de novo em alguns minutos.",
      success: null,
    };
  }
  const filled = outcomes.reduce((n, o) => n + (o.status === "TRAINED" ? o.filled : 0), 0);
  const parts = [
    count("TRAINED") > 0
      ? plural(count("TRAINED"), "carteira treinada", "carteiras treinadas")
      : null,
    count("UNCHANGED") > 0 ? `${count("UNCHANGED")} sem mudança` : null,
    count("TOO_FEW") > 0 ? `${count("TOO_FEW")} com menos de 20 exemplos` : null,
    filled > 0 ? plural(filled, "recebido ganhou categoria", "recebidos ganharam categoria") : null,
  ].filter(Boolean);
  return {
    error: null,
    success: parts.length > 0 ? `Treino feito: ${parts.join(", ")}.` : "Nada para treinar.",
  };
}

// ── IA local (M10.2b, ADR-016) ──────────────────────────────────────────────────

/**
 * O interruptor (Ajustes › Categorização): liga ou desliga a IA local do lar. Só quem mexe nas
 * categorias do lar. Não muda somas nem categorias: a próxima noite é que trabalha.
 */
export async function setLocalAiAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = localAiSwitchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const enabled = parsed.data.enabled === "true";
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    await setLocalAi(prisma, grant, enabled, await requestContext());
    return enabled
      ? "IA local ligada. Ela trabalha na próxima madrugada."
      : "IA local desligada. O que já sugeriu continua esperando o seu Confirmar.";
  });
  revalidatePath("/ajustes/categorizacao");
  revalidatePath("/lancamentos/recebidos");
  return result;
}

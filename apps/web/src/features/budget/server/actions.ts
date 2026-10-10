"use server";

// Server Actions do orçamento (M08). Mesma ordem de sempre (skill nova-feature): sessão,
// entrada (zod), crachá da carteira ("edit": dono ou editor), operação do @fintrack/db.
// Depois de gravar, financeChanged joga fora o cache das somas do lar (lib/finance-cache.ts).
import { copyBudgets, setBudget, undoCopyBudgets, prisma } from "@fintrack/db";
import { addMonthsToKey, sumCents } from "@fintrack/core";
import { revalidatePath } from "next/cache";
import { requestContext, requireWalletAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import { formatBRL } from "@/lib/money";
import { budgetFormSchema, copyBudgetsSchema, parseShares, undoCopySchema } from "../schemas";

const PAGE = "/orcamento";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

/**
 * O orçado de uma categoria. Com "Dividir por pessoa", o valor da categoria é a SOMA das partes
 * (calculada aqui; o total que a tela mostra é só ajuda). Valor zero sem divisão tira o orçado.
 */
export async function saveBudgetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const form = Object.fromEntries(formData);
  const parsed = budgetFormSchema.safeParse(form);
  if (!parsed.success) return invalid(parsed.error);
  const shares = parsed.data.split ? parseShares(form) : [];
  if (typeof shares === "string") return { error: shares, success: null };
  const cents = parsed.data.split ? sumCents(shares.map((s) => s.cents)) : parsed.data.amount;

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "edit");
    const { removed } = await setBudget(
      prisma,
      grant,
      { categoryId: parsed.data.categoryId, month: parsed.data.month, cents, shares },
      await requestContext(),
    );
    return removed ? "Orçado tirado da categoria." : `Orçado de ${formatBRL(cents)} salvo.`;
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

/** O resultado da cópia, para o aviso com "Desfazer". */
export type CopyState = ActionState & {
  copied: { categoryIds: string[]; copiedAt: string; walletId: string; month: string } | null;
};

/** "Copiar de setembro": só o que falta no mês, nunca sobrescreve. */
export async function copyBudgetsAction(_prev: CopyState, formData: FormData): Promise<CopyState> {
  const session = await requireUser();
  const parsed = copyBudgetsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...invalid(parsed.error), copied: null };
  const { walletId, month } = parsed.data;

  let copied: CopyState["copied"] = null;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "edit");
    const outcome = await copyBudgets(
      prisma,
      grant,
      addMonthsToKey(month, -1),
      month,
      await requestContext(),
    );
    copied =
      outcome.copied > 0
        ? {
            categoryIds: outcome.copiedCategoryIds,
            copiedAt: new Date().toISOString(),
            walletId,
            month,
          }
        : null;
    const news = outcome.copied === 1 ? "1 categoria nova" : `${outcome.copied} categorias novas`;
    const kept =
      outcome.kept === 0
        ? ""
        : outcome.kept === 1
          ? " A outra já tinha valor e ficou como estava."
          : ` As outras ${outcome.kept} já tinham valor e ficaram como estavam.`;
    return outcome.copied === 0
      ? "Nada a copiar: todas as categorias do mês anterior já têm valor neste mês."
      : `Copiado do mês anterior: ${news}.${kept}`;
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return { ...result, copied: result.error ? null : copied };
}

/** O "Desfazer" do aviso da cópia: apaga só o que a cópia criou e ninguém mudou depois. */
export async function undoCopyBudgetsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = undoCopySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "edit");
    await undoCopyBudgets(
      prisma,
      grant,
      parsed.data.month,
      parsed.data.categoryIds,
      new Date(parsed.data.copiedAt),
      await requestContext(),
    );
    return "Cópia desfeita.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  return result;
}

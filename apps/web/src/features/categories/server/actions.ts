"use server";

// Server Actions de categorias e regras (M07): sessão → zod → crachá "manage_categories" do
// lar → operação (com auditoria). As duas pessoas do lar organizam.
import { createCategory, createRule, deleteRule, prisma, setCategoryArchived } from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { requestContext, requireHouseholdAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { archiveCategorySchema, categorySchema, ruleIdSchema, ruleSchema } from "../schemas";

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
  revalidatePath(PAGE);
  return result;
}

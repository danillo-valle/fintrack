// Leituras da tela de categorias e regras (M07). As categorias são do lar inteiro.
import "server-only";
import { canInHousehold } from "@fintrack/core";
import { listCategories, listRules, prisma } from "@fintrack/db";
import { AccessError, requireHouseholdAccess } from "@/lib/access";
import type { Session } from "@/lib/auth";

/** Categorias (com as arquivadas) e regras do lar, ou null se a pessoa ainda não tem lar. */
export async function getCategoriesPage(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    const [categories, rules] = await Promise.all([
      listCategories(prisma, grant, { includeArchived: true }),
      listRules(prisma, grant),
    ]);
    return { categories, rules, canManage: canInHousehold(grant.role, "manage_categories") };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "NO_HOUSEHOLD") return null;
    throw error;
  }
}

// Leituras da tela de categorias e regras (M07). As categorias são do lar inteiro.
import "server-only";
import { canInHousehold, todayCivil } from "@fintrack/core";
import {
  findCleanups,
  listCategories,
  listRules,
  prisma,
  undoableCleanups,
  type CategoryCleanupView,
} from "@fintrack/db";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
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

/** Uma categoria que parece transferência, com os pares para revisar (a tela lê só o tipo). */
export type CleanupCandidate = CategoryCleanupView;

/**
 * A limpeza das categorias que eram transferência (M13.3b, ADR-026): as que parecem transferência
 * (com os pares para revisar) e as limpezas que ainda dá para desfazer. Só para quem mexe nas
 * categorias do lar; nos lançamentos das carteiras que a pessoa edita.
 */
export async function getCleanups(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "manage_categories");
    const scope = await requireScope(session, "edit");
    const [candidates, undoable] = await Promise.all([
      findCleanups(prisma, grant, scope, todayCivil()),
      undoableCleanups(prisma, grant),
    ]);
    return { candidates, undoable };
  } catch (error) {
    if (error instanceof AccessError) return { candidates: [], undoable: [] };
    throw error;
  }
}

/** Editar categoria (M13.2): a categoria do lar, ou null (404 igual para id de fora ou inventado). */
export async function getEditCategoryPage(session: Session, categoryId: string) {
  const page = await getCategoriesPage(session);
  if (!page?.canManage) return null;
  const category = page.categories.find((c) => c.id === categoryId);
  return category ? { category } : null;
}

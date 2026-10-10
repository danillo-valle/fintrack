// O cache das agregações do painel (M08, Cache Components): o que muda o dinheiro do lar avisa
// aqui, e o painel, o orçamento, o fluxo de caixa e a evolução recalculam na próxima leitura.
//
// As somas pesadas ("use cache" em features/budget/server/data.ts) levam a etiqueta do lar.
// Quem lança, edita, exclui, marca um cartão como conjunto ou muda um orçado chama
// financeChanged(session) dentro da Server Action: o updateTag faz quem mudou ver a mudança na
// mesma hora (read-your-own-writes), e a outra pessoa do lar também, na próxima abertura.
import "server-only";
import { updateTag } from "next/cache";
import { requireScope } from "./access";
import type { Session } from "./auth";

/** A etiqueta do cache das agregações de um lar. */
export function financeTag(householdId: string): string {
  return `financas:${householdId}`;
}

/** Chamar depois de toda mudança de dinheiro, só dentro de Server Action. */
export async function financeChanged(session: Session): Promise<void> {
  const scope = await requireScope(session, "view");
  if (scope.householdId) updateTag(financeTag(scope.householdId));
}

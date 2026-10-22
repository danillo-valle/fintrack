// O cache das agregações do painel (M08, Cache Components): o que muda o dinheiro do lar avisa
// aqui, e o painel, o orçamento, o fluxo de caixa e a evolução recalculam na próxima leitura.
//
// As somas pesadas ("use cache" em features/budget/server/data.ts) levam a etiqueta do lar.
// Quem lança, edita, exclui, marca um cartão como conjunto ou muda um orçado chama
// financeChanged(session) dentro da Server Action: o updateTag faz quem mudou ver a mudança na
// mesma hora (read-your-own-writes), e a outra pessoa do lar também, na próxima abertura.
import "server-only";
import { revalidateTag, updateTag } from "next/cache";
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

/**
 * O mesmo aviso, fora de uma Server Action (M11: o Confirmar do bot roda na fila). Ninguém do lar
 * está esperando a resposta: a próxima leitura do painel calcula de novo (expire 0, sem servir a
 * soma velha). Fora de uma requisição o Next pode recusar; aí vale o prazo curto do cache das
 * somas (cacheLife "minutes"), e o log registra.
 */
export function financeChangedInBackground(householdId: string): boolean {
  try {
    revalidateTag(financeTag(householdId), { expire: 0 });
    return true;
  } catch {
    return false;
  }
}

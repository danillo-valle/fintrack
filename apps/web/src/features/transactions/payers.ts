// "Pago por" na tela (M07.4): a opção de cada pessoa do lar (e do Compartilhado) e como achar a
// opção de um lançamento. A regra de QUEM pagou está no core (resolvePayer); aqui é só a cara.
import { SHARED_PAYER_PARAM, type Payer } from "@fintrack/core";

/** Uma opção de "Pago por": a pessoa (ou Compartilhado), as iniciais e a cor. */
export type PayerOption = {
  /** O valor do filtro na URL: o id da pessoa ou "compartilhado" */
  param: string;
  name: string;
  initials: string;
  tone: 1 | 2 | 3 | 4 | 5;
};

/** A opção de quem pagou um lançamento; nula quando não dá para saber (sem titular nem portador). */
export function payerOptionFor(payer: Payer, options: readonly PayerOption[]): PayerOption | null {
  if (payer.kind === "unknown") return null;
  const param = payer.kind === "shared" ? SHARED_PAYER_PARAM : payer.userId;
  return options.find((o) => o.param === param) ?? null;
}

// O que a tela mostra de cada cartão (M13.1, prancha L-Contas): quem usa (com as iniciais e a cor
// do "Pago por"), e para onde vão as compras que vêm do banco quando não é o ambiente da conta.
// Puro: a lista de Contas e cartões e a página da conta montam o cartão do mesmo jeito.

import { firstNameOf, type HouseholdPerson } from "@fintrack/core";

export type CardRow = {
  id: string;
  nickname: string;
  brand: string;
  lastFour: string;
  form: "PHYSICAL" | "VIRTUAL" | "VIRTUAL_TEMPORARY";
  isAdditional: boolean;
  sharedPurchases: boolean;
  archivedAt: Date | null;
  holderId: string | null;
  holder: { name: string } | null;
  importWallet: { name: string; kind: "PERSONAL" | "SHARED" } | null;
};

export type CardView = {
  id: string;
  nickname: string;
  brand: string;
  lastFour: string;
  form: CardRow["form"];
  isAdditional: boolean;
  sharedPurchases: boolean;
  archived: boolean;
  /** Quem usa: o nome inteiro para ler, o primeiro para a etiqueta, as iniciais e a cor */
  holder: { name: string; firstName: string; initials: string; tone: 1 | 2 | 3 | 4 } | null;
  /**
   * Onde entram as compras do banco, quando NÃO é o ambiente da conta: o escolhido no cartão, ou
   * o pessoal de quem usa um cartão de outra pessoa (a regra padrão, importWalletFor). Nulo = o
   * ambiente da conta, que já está escrito em cima. `personal`: é o ambiente pessoal de alguém.
   */
  destination: { name: string; personal: boolean } | null;
};

export function cardView(
  card: CardRow,
  accountHolderId: string | null,
  people: readonly HouseholdPerson[],
): CardView {
  const person = people.find((p) => p.userId === card.holderId) ?? null;
  const holderName = person?.name ?? card.holder?.name ?? null;
  const otherPerson = card.holderId !== null && card.holderId !== accountHolderId;
  return {
    id: card.id,
    nickname: card.nickname,
    brand: card.brand,
    lastFour: card.lastFour,
    form: card.form,
    isAdditional: card.isAdditional,
    sharedPurchases: card.sharedPurchases,
    archived: card.archivedAt !== null,
    holder: holderName
      ? {
          name: holderName,
          firstName: person?.firstName ?? firstNameOf(holderName),
          initials: person?.initials ?? "?",
          tone: person?.tone ?? 1,
        }
      : null,
    destination: card.importWallet
      ? { name: card.importWallet.name, personal: card.importWallet.kind === "PERSONAL" }
      : otherPerson && holderName
        ? { name: `pessoal de ${firstNameOf(holderName)}`, personal: true }
        : null,
  };
}

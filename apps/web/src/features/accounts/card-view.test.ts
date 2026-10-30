import { describe, expect, it } from "vitest";
import type { HouseholdPerson } from "@fintrack/core";
import { cardView, type CardRow } from "./card-view";

const LIA: HouseholdPerson = {
  userId: "u-lia",
  name: "Lia Moura",
  firstName: "Lia",
  initials: "LM",
  tone: 1,
};
const CAIO: HouseholdPerson = {
  userId: "u-caio",
  name: "Caio Moura",
  firstName: "Caio",
  initials: "CM",
  tone: 4,
};

function row(patch: Partial<CardRow> = {}): CardRow {
  return {
    id: "c1",
    nickname: "Master da Lia",
    brand: "Mastercard",
    lastFour: "0001",
    form: "PHYSICAL",
    isAdditional: false,
    sharedPurchases: false,
    archivedAt: null,
    holderId: LIA.userId,
    holder: { name: LIA.name },
    importWallet: null,
    ...patch,
  };
}

describe("cardView", () => {
  it("o cartão do titular: as iniciais e a cor dele, sem destino (é o ambiente da conta)", () => {
    const view = cardView(row(), LIA.userId, [LIA, CAIO]);
    expect(view.holder).toEqual({ name: "Lia Moura", firstName: "Lia", initials: "LM", tone: 1 });
    expect(view.destination).toBeNull();
    expect(view.archived).toBe(false);
  });

  it("o adicional de outra pessoa: o padrão é o pessoal dela", () => {
    const view = cardView(
      row({ holderId: CAIO.userId, holder: { name: CAIO.name }, isAdditional: true }),
      LIA.userId,
      [LIA, CAIO],
    );
    expect(view.holder?.tone).toBe(4);
    expect(view.destination).toEqual({ name: "pessoal de Caio", personal: true });
  });

  it("o ambiente escolhido no cartão vence a regra padrão, também no cartão do titular", () => {
    const casa = { name: "Casa", kind: "SHARED" as const };
    expect(cardView(row({ importWallet: casa }), LIA.userId, [LIA]).destination).toEqual({
      name: "Casa",
      personal: false,
    });
    expect(
      cardView(
        row({ holderId: CAIO.userId, holder: { name: CAIO.name }, importWallet: casa }),
        LIA.userId,
        [LIA, CAIO],
      ).destination?.name,
    ).toBe("Casa");
  });

  it("portador que saiu do lar: o nome que o banco ainda tem, com '?' e a primeira cor", () => {
    const view = cardView(row({ holderId: "u-saiu", holder: { name: "Ana Souza" } }), LIA.userId, [
      LIA,
    ]);
    expect(view.holder).toEqual({ name: "Ana Souza", firstName: "Ana", initials: "?", tone: 1 });
  });

  it("sem portador: nada de pessoa e nada de destino; arquivado vem marcado", () => {
    const view = cardView(
      row({ holderId: null, holder: null, archivedAt: new Date() }),
      LIA.userId,
      [LIA],
    );
    expect(view.holder).toBeNull();
    expect(view.destination).toBeNull();
    expect(view.archived).toBe(true);
  });
});

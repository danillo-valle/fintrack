// Contas e cartões (M07): o cartão de crédito exige fechamento e vencimento; cartão só 4 dígitos.
import { describe, expect, it } from "vitest";
import { accountSchema, cardSchema } from "./schemas";

const W = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d";

describe("accountSchema", () => {
  it("conta corrente: dias ignorados (nulos) e saldo inicial em centavos", () => {
    expect(
      accountSchema.parse({
        walletId: W,
        name: "Conta",
        kind: "CHECKING",
        initialBalance: "1234.56",
      }),
    ).toMatchObject({
      closingDay: null,
      dueDay: null,
      initialBalance: 123456n,
    });
  });

  it("cartão sem os dias, ou com os dois iguais: recusa", () => {
    expect(
      accountSchema.safeParse({ walletId: W, name: "Cartão", kind: "CREDIT_CARD" }).success,
    ).toBe(false);
    expect(
      accountSchema.safeParse({
        walletId: W,
        name: "Cartão",
        kind: "CREDIT_CARD",
        closingDay: "5",
        dueDay: "5",
      }).success,
    ).toBe(false);
    expect(
      accountSchema.parse({
        walletId: W,
        name: "Cartão",
        kind: "CREDIT_CARD",
        closingDay: "5",
        dueDay: "12",
      }),
    ).toMatchObject({ closingDay: 5, dueDay: 12 });
  });
});

describe("cardSchema", () => {
  const card = {
    walletId: W,
    accountId: W,
    nickname: "Master",
    brand: "Mastercard",
    lastFour: "1001",
    form: "PHYSICAL",
  };

  it("válido com os 4 finais", () => {
    expect(cardSchema.parse(card)).toMatchObject({ lastFour: "1001", isAdditional: false });
  });

  it.each(["123", "12345", "1234 5678 9012 3456", "12a4"])(
    "recusa %j (nunca mais que os 4 finais)",
    (lastFour) => {
      expect(cardSchema.safeParse({ ...card, lastFour }).success).toBe(false);
    },
  );
});

import { describe, expect, it } from "vitest";
import { flowAmount, flowOf } from "./flow";

describe("flowOf (ADR-025)", () => {
  it("na conta, pelo sinal", () => {
    expect(flowOf({ amount: 985000n, accountKind: "CHECKING" })).toBe("income");
    expect(flowOf({ amount: -3840n, accountKind: "CHECKING" })).toBe("expense");
    expect(flowOf({ amount: 1234n, accountKind: "SAVINGS" })).toBe("income");
    expect(flowOf({ amount: -2000n, accountKind: "MEAL_VOUCHER" })).toBe("expense");
  });

  it("no cartão, tudo é saída: o estorno abate a fatura", () => {
    expect(flowOf({ amount: -5590n, accountKind: "CREDIT_CARD" })).toBe("expense");
    expect(flowOf({ amount: 5000n, accountKind: "CREDIT_CARD" })).toBe("expense");
    expect(flowAmount({ amount: 5000n, accountKind: "CREDIT_CARD" })).toEqual({
      flow: "expense",
      cents: -5000n,
    });
  });

  it("o valor que soma é sempre positivo para o caso comum", () => {
    expect(flowAmount({ amount: -3840n, accountKind: "CHECKING" }).cents).toBe(3840n);
    expect(flowAmount({ amount: 985000n, accountKind: "CHECKING" }).cents).toBe(985000n);
  });
});

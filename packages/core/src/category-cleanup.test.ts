import { describe, expect, it } from "vitest";
import { cleanupCandidates, cleanupSince, planCleanup, type CleanupRow } from "./category-cleanup";
import { decimalToCents } from "./money";

const brl = decimalToCents;

const row = (r: Partial<CleanupRow> & Pick<CleanupRow, "id">): CleanupRow => ({
  accountId: "corrente",
  accountKind: "CHECKING",
  amount: brl("-500.00"),
  occurredOn: "2026-10-05",
  categoryId: "resgate",
  locked: false,
  ...r,
});

// "Resgate Poupança": o dinheiro sai da poupança e entra na corrente, as duas com a categoria
const resgates = [
  row({ id: "p1", accountId: "poupanca", accountKind: "SAVINGS", amount: brl("-500.00") }),
  row({ id: "c1", amount: brl("500.00"), occurredOn: "2026-10-06" }),
  row({
    id: "p2",
    accountId: "poupanca",
    accountKind: "SAVINGS",
    amount: brl("-200.00"),
    occurredOn: "2026-09-10",
  }),
  row({ id: "c2", amount: brl("200.00"), occurredOn: "2026-09-10", categoryId: null }),
  row({ id: "s1", amount: brl("300.00"), occurredOn: "2026-08-01" }),
];

describe("a limpeza das categorias que eram transferência (ADR-026)", () => {
  it("olha os últimos 6 meses, o de hoje incluído", () => {
    expect(cleanupSince("2026-11-04")).toBe("2026-06-01");
  });

  it("os pares (o outro lado pode estar sem categoria) e o que fica de um lado só", () => {
    const plan = planCleanup("resgate", resgates);
    // Do par de datas mais próximas para o mais distante, como na revisão
    expect(plan.pairs.map((p) => [p.outId, p.inId])).toEqual([
      ["p2", "c2"],
      ["p1", "c1"],
    ]);
    expect(plan.oneSided).toEqual(["s1"]);
    expect(plan.members).toBe(4);
  });

  it("aparece com pelo menos dois que têm o outro lado, e eles são a metade ou mais", () => {
    expect(cleanupCandidates(resgates)).toMatchObject([{ categoryId: "resgate", paired: 3 }]);
    const mercado = [
      ...resgates,
      ...["m1", "m2", "m3", "m4", "m5", "m6", "m7"].map((id) =>
        row({ id, categoryId: "resgate", amount: brl("-37.40"), occurredOn: "2026-10-20" }),
      ),
    ];
    expect(cleanupCandidates(mercado)).toEqual([]);
  });

  it("compra no cartão não é transferência, nem fica de um lado só; parcela e estorno ficam de fora", () => {
    const rows = [
      row({ id: "k1", accountId: "cartao", accountKind: "CREDIT_CARD", amount: brl("-80.00") }),
      row({ id: "x1", amount: brl("80.00") }),
      row({ id: "pa", locked: true, amount: brl("-50.00") }),
      row({ id: "pb", accountId: "poupanca", accountKind: "SAVINGS", amount: brl("50.00") }),
    ];
    const plan = planCleanup("resgate", rows);
    expect(plan.pairs).toEqual([]);
    expect(plan.oneSided).toEqual(["x1", "pb"]);
  });

  it("o pagamento da fatura entra no cartão como par", () => {
    const rows = [
      row({ id: "o", amount: brl("-900.00") }),
      row({
        id: "f",
        accountId: "cartao",
        accountKind: "CREDIT_CARD",
        amount: brl("900.00"),
        categoryId: null,
      }),
    ];
    expect(planCleanup("resgate", rows).pairs).toMatchObject([
      { outId: "o", inId: "f", billPayment: true },
    ]);
  });
});

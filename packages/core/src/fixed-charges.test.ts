import { describe, expect, it } from "vitest";
import {
  fixedArrivals,
  fixedChargeKey,
  missingFixedCharges,
  type FixedCharge,
} from "./fixed-charges";
import { decimalToCents } from "./money";

const brl = decimalToCents;

const charge = (c: Partial<FixedCharge>): FixedCharge => ({
  month: "2026-10",
  cashOn: "2026-10-02",
  walletId: "lia",
  categoryId: "assinaturas",
  payer: "lia",
  description: "NETFLIX.COM",
  label: null,
  recurrenceId: null,
  expense: brl("55.90"),
  ...c,
});

describe("as fixas que ainda vão chegar (ADR-026)", () => {
  it("a mesma fixa: o mesmo comerciante no mesmo ambiente, mesmo com o texto mudando", () => {
    expect(fixedChargeKey(charge({ description: "NETFLIX.COM" }))).toBe(
      fixedChargeKey(charge({ description: "Netflix.com 1234567" })),
    );
    expect(fixedChargeKey(charge({ walletId: "casa" }))).not.toBe(fixedChargeKey(charge({})));
    expect(fixedChargeKey(charge({ recurrenceId: "r1" }))).toBe("r:r1");
  });

  it("a do mês passado que ainda não chegou entra pelo valor e no dia de lá", () => {
    const charges = [
      charge({ description: "NETFLIX.COM", cashOn: "2026-10-02" }),
      charge({ description: "ACADEMIA FORMA", cashOn: "2026-10-15", expense: brl("119.90") }),
      charge({ month: "2026-11", cashOn: "2026-11-02", description: "NETFLIX.COM" }),
    ];
    expect(missingFixedCharges(charges, "2026-11")).toEqual([
      {
        month: "2026-11",
        date: "2026-11-15",
        walletId: "lia",
        categoryId: "assinaturas",
        payer: "lia",
        expense: brl("119.90"),
        source: "last-month",
        name: "ACADEMIA FORMA",
      },
    ]);
    expect(fixedArrivals(charges, "2026-11")).toBe(1);
  });

  it("duas cobranças da mesma fixa no mês passado: uma só, a mais recente", () => {
    const charges = [
      charge({ cashOn: "2026-10-02", expense: brl("39.90") }),
      charge({ cashOn: "2026-10-28", expense: brl("55.90"), label: "Netflix da família" }),
    ];
    const missing = missingFixedCharges(charges, "2026-11");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ expense: brl("55.90"), name: "Netflix da família" });
  });

  it("a recorrência do app não conta aqui (ela mesma diz o que falta)", () => {
    const charges = [charge({ recurrenceId: "aluguel", description: "Aluguel" })];
    expect(missingFixedCharges(charges, "2026-11")).toEqual([]);
    expect(fixedArrivals([charge({ month: "2026-11", recurrenceId: "aluguel" })], "2026-11")).toBe(
      1,
    );
  });

  it("o dia 31 vira o último dia de um mês mais curto", () => {
    const charges = [charge({ month: "2026-01", cashOn: "2026-01-31" })];
    expect(missingFixedCharges(charges, "2026-02")[0]?.date).toBe("2026-02-28");
  });
});

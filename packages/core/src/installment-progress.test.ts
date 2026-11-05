import { describe, expect, it } from "vitest";
import { installmentsInProgress } from "./installment-progress";

describe("installmentsInProgress (M13.3a)", () => {
  it("do banco: a 2/5 chegou na fatura de novembro; faltam 3, termina em fevereiro", () => {
    const [notebook] = installmentsInProgress(
      [
        { key: "nb", number: 1, count: 5, amount: -64000n, dueDate: "2026-10-09" },
        { key: "nb", number: 2, count: 5, amount: -64000n, dueDate: "2026-11-09" },
      ],
      "2026-11-03",
    );
    expect(notebook).toEqual({
      key: "nb",
      number: 2,
      count: 5,
      perParcel: 64000n,
      remainingCount: 3,
      remaining: 192000n,
      endsIn: "2027-02",
    });
  });

  it("do FinTrack: as futuras já gravadas não contam como chegadas", () => {
    const parcels = [1, 2, 3, 4].map((n) => ({
      key: "g",
      number: n,
      count: 4,
      amount: -12370n,
      dueDate: `2026-${String(9 + n).padStart(2, "0")}-09`,
    }));
    const [tenis] = installmentsInProgress(parcels, "2026-11-03");
    expect(tenis).toMatchObject({
      number: 2,
      remainingCount: 2,
      remaining: 24740n,
      endsIn: "2027-01",
    });
  });

  it("a última parcela já é a de agora: some da lista", () => {
    expect(
      installmentsInProgress(
        [{ key: "z", number: 3, count: 3, amount: -9764n, dueDate: "2026-11-09" }],
        "2026-11-03",
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { accountBalance } from "./balance";

describe("accountBalance (M13.3a)", () => {
  it("conta ligada: o saldo do banco, e o do começo do período sem o que se mexeu", () => {
    // Banco: R$ 7.212,35 hoje. Desde 1º: salário +9.850, débitos −4.454,08, poupança −500, Caio −800
    const b = accountBalance({
      bank: 721235n,
      initial: 0n,
      upToToday: 999999n,
      sinceStart: 985000n - 445408n - 50000n - 80000n,
    });
    expect(b).toEqual({ source: "bank", today: 721235n, atStart: 311643n, change: 409592n });
  });

  it("conta manual: o saldo inicial mais os lançamentos até hoje", () => {
    expect(
      accountBalance({ bank: null, initial: 100000n, upToToday: -25000n, sinceStart: -5000n }),
    ).toEqual({ source: "computed", today: 75000n, atStart: 80000n, change: -5000n });
  });
});

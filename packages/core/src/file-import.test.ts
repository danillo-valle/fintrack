import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyImportRows,
  matchImportRows,
  importAccountKinds,
  installmentFromDescription,
  paymentHintFromText,
  suggestImportAccount,
  type ImportAccountCandidate,
} from "./file-import";

describe("installmentFromDescription", () => {
  it.each([
    ["LOJA DO BAIRRO PARC 03/06", { number: 3, count: 6 }],
    ["LOJA PARC03/06", { number: 3, count: 6 }],
    ["ELETRO CASA PARCELA 2 DE 10", { number: 2, count: 10 }],
    ["ELETRO CASA parc. 1/12", { number: 1, count: 12 }],
  ])("lê %s", (text, expected) => {
    expect(installmentFromDescription(text)).toEqual(expected);
  });

  it.each(["PADARIA 10/12", "MERCADO", "PARC 07/06", "PARC 1/1", "PARC 0/3"])(
    "não inventa parcela em %s",
    (text) => {
      expect(installmentFromDescription(text)).toBeNull();
    },
  );
});

describe("paymentHintFromText", () => {
  it("reconhece PIX, boleto e transferência", () => {
    expect(paymentHintFromText("DEBIT", "PIX ENVIADO MARIA")).toBe("PIX");
    expect(paymentHintFromText("PAYMENT", "PAGTO BOLETO CONDOMINIO")).toBe("BOLETO");
    expect(paymentHintFromText("XFER", "ENVIO PARA POUPANCA")).toBe("TRANSFER");
    expect(paymentHintFromText("DEBIT", "TED RECEBIDA")).toBe("TRANSFER");
  });

  it("sem pista, null", () => {
    expect(paymentHintFromText("DEBIT", "MERCADO BOM PRECO")).toBeNull();
    expect(paymentHintFromText(null, "PIXEL ARTE")).toBeNull();
  });
});

describe("classifyImportRows", () => {
  const row = (externalId: string, occurredOn: string, amount: bigint) => ({
    externalId,
    occurredOn,
    amount,
  });

  it("já importado vem antes de já veio pelo Meu Pluggy", () => {
    const states = classifyImportRows({
      rows: [row("a", "2026-10-01", -100n), row("b", "2026-10-01", -100n)],
      importedIds: new Set(["a"]),
      fromPluggy: [{ occurredOn: "2026-10-01", amount: -100n }],
    });
    expect(states).toEqual(["IMPORTED", "PLUGGY"]);
  });

  it("cada recebido do Meu Pluggy cobre uma linha só", () => {
    const states = classifyImportRows({
      rows: [row("a", "2026-10-02", -850n), row("b", "2026-10-02", -850n)],
      importedIds: new Set(),
      fromPluggy: [{ occurredOn: "2026-10-02", amount: -850n }],
    });
    expect(states).toEqual(["PLUGGY", "NEW"]);
  });

  it("valor igual em outro dia, ou outro valor no mesmo dia, é novo", () => {
    const states = classifyImportRows({
      rows: [row("a", "2026-10-03", -850n), row("b", "2026-10-02", -851n)],
      importedIds: new Set(),
      fromPluggy: [{ occurredOn: "2026-10-02", amount: -850n }],
    });
    expect(states).toEqual(["NEW", "NEW"]);
  });

  it("propriedade: nunca marca mais PLUGGY do que há recebidos", () => {
    const amount = fc.constantFrom(-100n, -250n, 300n);
    const day = fc.constantFrom("2026-10-01", "2026-10-02");
    fc.assert(
      fc.property(
        fc.array(fc.record({ occurredOn: day, amount }), { maxLength: 12 }),
        fc.array(fc.record({ occurredOn: day, amount }), { maxLength: 12 }),
        (rows, fromPluggy) => {
          const states = classifyImportRows({
            rows: rows.map((r, i) => ({ ...r, externalId: String(i) })),
            importedIds: new Set(),
            fromPluggy,
          });
          expect(states.filter((s) => s === "PLUGGY").length).toBeLessThanOrEqual(
            fromPluggy.length,
          );
        },
      ),
    );
  });
});

describe("suggestImportAccount", () => {
  const account = (
    id: string,
    kind: ImportAccountCandidate["kind"],
    extra: Partial<ImportAccountCandidate> = {},
  ): ImportAccountCandidate => ({ id, kind, cardLastFours: [], learned: false, ...extra });

  it("extrato de conta só entra em corrente ou poupança", () => {
    expect(importAccountKinds("BANK")).toEqual(["CHECKING", "SAVINGS"]);
    expect(importAccountKinds("CREDIT_CARD")).toEqual(["CREDIT_CARD"]);
  });

  it("a conta que já recebeu o mesmo banco e final vem primeiro", () => {
    expect(
      suggestImportAccount({
        kind: "BANK",
        lastFour: "4321",
        candidates: [account("c1", "CHECKING"), account("c2", "CHECKING", { learned: true })],
      }),
    ).toEqual({ accountId: "c2", reason: "LEARNED" });
  });

  it("cartão pelo final de um cartão ativo", () => {
    expect(
      suggestImportAccount({
        kind: "CREDIT_CARD",
        lastFour: "0002",
        candidates: [
          account("m", "CREDIT_CARD", { cardLastFours: ["0001"] }),
          account("v", "CREDIT_CARD", { cardLastFours: ["0002", "0003"] }),
          account("c", "CHECKING"),
        ],
      }),
    ).toEqual({ accountId: "v", reason: "CARD_LAST_FOUR" });
  });

  it("a única conta do tipo certo", () => {
    expect(
      suggestImportAccount({
        kind: "BANK",
        lastFour: null,
        candidates: [account("c", "CHECKING"), account("m", "CREDIT_CARD")],
      }),
    ).toEqual({ accountId: "c", reason: "ONLY_ONE" });
  });

  it("empate ou nenhuma: sem sugestão", () => {
    expect(
      suggestImportAccount({
        kind: "BANK",
        lastFour: "4321",
        candidates: [account("c1", "CHECKING"), account("c2", "SAVINGS")],
      }),
    ).toBeNull();
    expect(
      suggestImportAccount({ kind: "CREDIT_CARD", lastFour: "0002", candidates: [] }),
    ).toBeNull();
  });
});

describe("matchImportRows (M09.4: o outro formato de arquivo)", () => {
  const row = (externalId: string, occurredOn: string, amount: bigint) => ({
    externalId,
    occurredOn,
    amount,
  });

  it("o PDF da fatura depois do OFX do mês: a mesma compra é 'já importado'", () => {
    const matches = matchImportRows({
      rows: [row("p:a", "2026-10-04", -8840n), row("p:b", "2026-10-05", -100n)],
      importedIds: new Set(),
      fromPluggy: [],
      fromOtherFiles: [{ id: "ofx-1", occurredOn: "2026-10-04", amount: -8840n }],
    });
    expect(matches).toEqual([
      { state: "IMPORTED", matchedId: "ofx-1" },
      { state: "NEW", matchedId: null },
    ]);
  });

  it("o Meu Pluggy vem antes do outro arquivo, e cada um cobre uma linha", () => {
    const matches = matchImportRows({
      rows: [row("p:a", "2026-10-04", -500n), row("p:b", "2026-10-04", -500n)],
      importedIds: new Set(),
      fromPluggy: [{ id: "pl-1", occurredOn: "2026-10-04", amount: -500n }],
      fromOtherFiles: [{ id: "ofx-1", occurredOn: "2026-10-04", amount: -500n }],
    });
    expect(matches.map((m) => m.matchedId)).toEqual(["pl-1", "ofx-1"]);
    expect(matches.map((m) => m.state)).toEqual(["PLUGGY", "IMPORTED"]);
  });
});

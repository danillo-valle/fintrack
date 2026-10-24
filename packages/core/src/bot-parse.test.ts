import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  looksLikeCardNumber,
  parseBotMessage,
  parseBrazilianAmount,
  type BotParseContext,
} from "./bot-parse";

// Dados sintéticos: o lar dos testes (Lia e Caio, ambientes e cartões inventados)
const CASA = "0193f000-0000-7000-8000-00000000c001";
const LIA = "0193f000-0000-7000-8000-00000000c002";
const VISA = "0193f000-0000-7000-8000-00000000c101";
const MASTER = "0193f000-0000-7000-8000-00000000c102";

const ctx: BotParseContext = {
  today: "2026-10-21",
  wallets: [
    { id: CASA, name: "Casa" },
    { id: LIA, name: "Lia" },
  ],
  cards: [
    { id: VISA, name: "Visa da Casa" },
    { id: MASTER, name: "Master da Lia" },
  ],
};

const ok = (text: string) => {
  const result = parseBotMessage(text, ctx);
  if (!result.ok) throw new Error(`esperava ler "${text}", veio ${result.error}`);
  return result.entry;
};
const error = (text: string) => {
  const result = parseBotMessage(text, ctx);
  if (result.ok) throw new Error(`esperava recusar "${text}"`);
  return result.error;
};

describe("parseBrazilianAmount", () => {
  it.each([
    ["42,90", 4290n],
    ["42", 4200n],
    ["R$42,90", 4290n],
    ["1.234,56", 123456n],
    ["1.234", 123400n],
    ["42.90", 4290n],
    ["0,5", 50n],
  ])("%s → %s centavos", (token, cents) => {
    expect(parseBrazilianAmount(token)).toBe(cents);
  });

  it.each(["42,901", "4.2", "abc", "12a", "1,234.56", "-5"])("%s não é valor", (token) => {
    expect(parseBrazilianAmount(token)).toBeNull();
  });
});

describe("parseBotMessage: o que o bot entende", () => {
  it("o exemplo da tela: valor e descrição, hoje, sem forma", () => {
    expect(ok("gastei 42,90 no mercado")).toEqual({
      cents: 4290n,
      description: "Mercado",
      occurredOn: "2026-10-21",
      method: null,
      installments: null,
      walletIds: [],
      cardIds: [],
    });
  });

  it("data, forma e ambiente em qualquer ordem", () => {
    const entry = ok("35 farmácia ontem no pix na Lia");
    expect(entry).toMatchObject({
      cents: 3500n,
      description: "Farmácia",
      occurredOn: "2026-10-20",
      method: "PIX",
      walletIds: [LIA],
      cardIds: [],
    });
  });

  it("parcelas e cartão pelo apelido: sempre crédito", () => {
    expect(ok("tênis 600 em 3x no master")).toMatchObject({
      cents: 60000n,
      description: "Tênis",
      installments: 3,
      method: "CREDIT",
      cardIds: [MASTER],
    });
    expect(ok("geladeira 3.200,00 parcelado em 10 vezes")).toMatchObject({
      cents: 320000n,
      installments: 10,
      method: "CREDIT",
    });
    expect(ok("sofá 1500 12 vezes").installments).toBe(12);
  });

  it("'dia 19' e '19/10' não viram valor", () => {
    expect(ok("uber 18,50 dia 19 na Lia")).toMatchObject({
      cents: 1850n,
      description: "Uber",
      occurredOn: "2026-10-19",
      walletIds: [LIA],
    });
    expect(ok("padaria 12,40 19/10").occurredOn).toBe("2026-10-19");
    expect(ok("padaria 12,40 19/10/2025").occurredOn).toBe("2025-10-19");
  });

  it("'dia 25' depois de hoje é o mês passado; '25/12' sem ano no futuro é o ano passado", () => {
    expect(ok("luz 210 dia 25").occurredOn).toBe("2026-09-25");
    expect(ok("presente 80 25/12").occurredOn).toBe("2025-12-25");
  });

  it("'dia 31' num mês de 30 dias é recusado", () => {
    expect(parseBotMessage("luz 210 dia 31", { ...ctx, today: "2026-12-05" })).toEqual({
      ok: false,
      error: "BAD_DATE",
    });
  });

  it("crédito, débito e cartão", () => {
    expect(ok("almoço 38 no crédito").method).toBe("CREDIT");
    expect(ok("almoço 38 no débito").method).toBe("DEBIT");
    expect(ok("almoço 38 no cartão").method).toBe("CREDIT");
    expect(ok("almoço 38 no visa").cardIds).toEqual([VISA]);
  });

  it("'no mercado' não é cartão nem ambiente", () => {
    const entry = ok("comprei 99,90 no mercado");
    expect(entry.cardIds).toEqual([]);
    expect(entry.walletIds).toEqual([]);
    expect(entry.description).toBe("Mercado");
  });

  it("palavra que casa com dois cartões fica ambígua (a pessoa escolhe por botão)", () => {
    const two: BotParseContext = {
      ...ctx,
      cards: [
        { id: VISA, name: "Visa da Casa" },
        { id: MASTER, name: "Visa da Lia" },
      ],
    };
    const result = parseBotMessage("padaria 12 no visa", two);
    expect(result.ok && result.entry.cardIds).toEqual([VISA, MASTER]);
  });

  it("R$ separado do número", () => {
    expect(ok("mercado R$ 42,90").cents).toBe(4290n);
  });
});

describe("parseBotMessage: o que o bot recusa", () => {
  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["paguei o mercado", "NO_AMOUNT"],
    ["2 pães 10", "MANY_AMOUNTS"],
    ["mercado 0", "ZERO_AMOUNT"],
    ["mercado 0,00", "ZERO_AMOUNT"],
    ["luz 210 32/10", "BAD_DATE"],
    ["luz 210 dia 0", "BAD_DATE"],
    ["tv 2000 em 30x", "BAD_INSTALLMENTS"],
    ["tv 2000 1x", "BAD_INSTALLMENTS"],
    ["42,90", "NO_DESCRIPTION"],
    ["gastei 42,90 no", "NO_DESCRIPTION"],
  ])("%j → %s", (text, expected) => {
    expect(error(text)).toBe(expected);
  });

  it("só o nome de um ambiente ou cartão no lugar da descrição: diz o que entendeu (M12.0)", () => {
    expect(parseBotMessage("gastei 1 na lia", ctx)).toEqual({
      ok: false,
      error: "NAME_ONLY",
      walletIds: [LIA],
      cardIds: [],
    });
    expect(parseBotMessage("gastei 1 no visa", ctx)).toEqual({
      ok: false,
      error: "NAME_ONLY",
      walletIds: [],
      cardIds: [VISA],
    });
    // Com descrição, segue normal
    expect(ok("gastei 1 no visa padaria").description).toBe("Padaria");
  });

  it("data no futuro", () => {
    expect(error("luz 210 22/10/2026")).toBe("FUTURE_DATE");
  });

  it("mensagem longa demais nem é lida", () => {
    expect(error(`mercado 42 ${"x".repeat(400)}`)).toBe("TOO_LONG");
  });

  it("número de cartão é recusado antes de qualquer coisa, com ou sem separadores", () => {
    // Montado na hora: nenhum arquivo do repositório tem 16 dígitos seguidos (ADR-018)
    const digits = "4".padEnd(16, "0");
    const spaced = digits.replace(/(\d{4})(?=\d)/g, "$1 ");
    const dashed = digits.replace(/(\d{4})(?=\d)/g, "$1-");
    expect(error(`${digits} compra online 99`)).toBe("CARD_NUMBER");
    expect(error(`compra ${spaced} 99`)).toBe("CARD_NUMBER");
    expect(error(`compra ${dashed} 99`)).toBe("CARD_NUMBER");
  });
});

describe("looksLikeCardNumber", () => {
  it("13 a 19 dígitos, mesmo separados", () => {
    expect(looksLikeCardNumber("1".repeat(13))).toBe(true);
    expect(looksLikeCardNumber("1".repeat(19))).toBe(true);
    expect(
      looksLikeCardNumber(`${"1".repeat(4)} ${"2".repeat(4)} ${"3".repeat(4)} ${"4".repeat(4)}`),
    ).toBe(true);
  });
  it("valores, datas e telefones curtos não", () => {
    expect(looksLikeCardNumber("mercado 1.234,56 19/10/2026")).toBe(false);
    expect(looksLikeCardNumber("ligar 4199999")).toBe(false);
  });

  it("propriedade: qualquer sequência de 13 a 19 dígitos com espaços é recusada", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 13, maxLength: 19 }),
        fc.array(fc.constantFrom("", " ", "-", "."), { minLength: 19, maxLength: 19 }),
        (digits, seps) => {
          const text = digits.map((d, i) => `${d}${i < digits.length - 1 ? seps[i] : ""}`).join("");
          expect(parseBotMessage(`compra ${text} 10`, ctx)).toEqual({
            ok: false,
            error: "CARD_NUMBER",
          });
        },
      ),
    );
  });
});

describe("propriedade: o valor lido é o valor escrito", () => {
  it("qualquer valor de 0,01 a 99.999,99 escrito com vírgula volta igual", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 9_999_999n }), (cents) => {
        const units = (cents / 100n).toString();
        const rest = (cents % 100n).toString().padStart(2, "0");
        const entry = ok(`mercado ${units},${rest}`);
        expect(entry.cents).toBe(cents);
      }),
    );
  });
});

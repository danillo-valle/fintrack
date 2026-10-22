import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  askCardMessage,
  chooseBotPayment,
  chooseBotWallet,
  type BotOptions,
  BOT_FIXED_MESSAGES,
  BOT_STOP_AT,
  BOT_WARN_AT,
  botDayLabel,
  botMonth,
  botPhase,
  brl,
  buttonTitle,
  confirmedMessage,
  decodeAction,
  encodeAction,
  formatLinkCode,
  linkBlocked,
  linkedMessage,
  notUnderstoodMessage,
  parseLinkCommand,
  phoneLastFour,
  proposalMessage,
  replyAllowed,
  warningDue,
  warningMessage,
  type BotAction,
  type BotMessage,
} from "./bot";

const DRAFT = "0193f000-0000-7000-8000-0000000d0001";
const CARD = "0193f000-0000-7000-8000-00000000c101";

describe("vínculo", () => {
  it("lê 'vincular 482 913' com ou sem espaço, ponto ou hífen", () => {
    expect(parseLinkCommand("vincular 482 913")).toBe("482913");
    expect(parseLinkCommand("  Vincular 482913 ")).toBe("482913");
    expect(parseLinkCommand("vincular 482-913")).toBe("482913");
    expect(parseLinkCommand("vincular 48291")).toBeNull();
    expect(parseLinkCommand("gastei 42 no mercado")).toBeNull();
    expect(formatLinkCode("482913")).toBe("482 913");
  });

  it("cinco erros numa hora bloqueiam o número por 24 h", () => {
    const now = new Date("2026-10-21T20:00:00Z");
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    expect(linkBlocked([1, 2, 3, 4].map(minutesAgo), now)).toBe(false);
    expect(linkBlocked([1, 2, 3, 4, 5].map(minutesAgo), now)).toBe(true);
    // Espalhados por mais de uma hora: não bloqueia
    expect(linkBlocked([1, 20, 40, 70, 90].map(minutesAgo), now)).toBe(false);
    // A 5ª falha foi há 23 h (as cinco dentro de uma hora): ainda bloqueado
    const h = 60;
    expect(
      linkBlocked(
        [23 * h + 50, 23 * h + 40, 23 * h + 30, 23 * h + 20, 23 * h].map(minutesAgo),
        now,
      ),
    ).toBe(true);
    // Há 25 h: liberado
    expect(
      linkBlocked(
        [25 * h + 50, 25 * h + 40, 25 * h + 30, 25 * h + 20, 25 * h].map(minutesAgo),
        now,
      ),
    ).toBe(false);
  });

  it("do número, só os 4 últimos dígitos", () => {
    expect(phoneLastFour("+55 41 90000-0001")).toBe("0001");
    expect(() => phoneLastFour("123")).toThrow();
  });
});

describe("respostas grátis", () => {
  it("fases: normal até 849, só o essencial de 850 a 899, parado em 900", () => {
    expect(botPhase(0)).toBe("NORMAL");
    expect(botPhase(BOT_WARN_AT - 1)).toBe("NORMAL");
    expect(botPhase(BOT_WARN_AT)).toBe("ESSENTIAL");
    expect(botPhase(BOT_STOP_AT - 1)).toBe("ESSENTIAL");
    expect(botPhase(BOT_STOP_AT)).toBe("STOPPED");
  });

  it("no essencial, a proposta sai e o 'Lançado' não", () => {
    expect(replyAllowed(BOT_WARN_AT, "PROPOSAL")).toBe(true);
    expect(replyAllowed(BOT_WARN_AT, "ASK")).toBe(true);
    expect(replyAllowed(BOT_WARN_AT, "CONFIRMED")).toBe(false);
    expect(replyAllowed(BOT_WARN_AT, "UNDONE")).toBe(false);
    expect(replyAllowed(BOT_WARN_AT - 1, "CONFIRMED")).toBe(true);
  });

  it("propriedade: nenhuma resposta sai com 900 ou mais", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: BOT_STOP_AT, max: 100_000 }),
        fc.constantFrom(
          "PROPOSAL",
          "ASK",
          "LINKED",
          "NOT_UNDERSTOOD",
          "WARNING",
          "CONFIRMED",
          "CANCELLED",
          "UNDONE",
          "EXPIRED",
        ) as fc.Arbitrary<Parameters<typeof replyAllowed>[1]>,
        (used, kind) => {
          expect(replyAllowed(used, kind)).toBe(false);
        },
      ),
    );
  });

  it("o aviso sai uma vez, na resposta que chega a 850", () => {
    expect(warningDue(BOT_WARN_AT - 2, false)).toBe(false);
    expect(warningDue(BOT_WARN_AT - 1, false)).toBe(true);
    expect(warningDue(BOT_WARN_AT - 1, true)).toBe(false);
    expect(warningDue(BOT_WARN_AT + 10, false)).toBe(true);
    expect(warningDue(BOT_STOP_AT, false)).toBe(false);
  });

  it("o mês vira à meia-noite de São Paulo, não à de UTC", () => {
    // 31/10 às 23:30 em São Paulo = 1º/11 às 02:30 UTC
    expect(botMonth(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10");
    expect(botMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });
});

describe("botões", () => {
  it("ida e volta de cada ação", () => {
    const actions: BotAction[] = [
      { kind: "CONFIRM", draftId: DRAFT },
      { kind: "CANCEL", draftId: DRAFT },
      { kind: "UNDO", draftId: DRAFT },
      { kind: "PICK_CARD", draftId: DRAFT, cardId: CARD },
      { kind: "PICK_WALLET", draftId: DRAFT, walletId: CARD },
    ];
    for (const action of actions) expect(decodeAction(encodeAction(action))).toEqual(action);
  });

  it("id que não é nosso: nulo (o clique é ignorado)", () => {
    for (const id of ["", "c:abc", `z:${DRAFT}`, `c:${DRAFT}:${CARD}`, `k:${DRAFT}`, `c:${DRAFT} `])
      expect(decodeAction(id)).toBeNull();
  });

  it("título de botão: até 20 caracteres", () => {
    expect(buttonTitle("Visa da Casa")).toBe("Visa da Casa");
    expect(buttonTitle("Cartão virtual das assinaturas")).toHaveLength(20);
  });
});

describe("textos", () => {
  const view = {
    cents: 4290n,
    title: "Mercado",
    occurredOn: "2026-10-21",
    today: "2026-10-21",
    method: "crédito" as const,
    payWith: "Visa da Casa",
    walletName: "Casa",
    installments: null,
    installmentCents: null,
  };

  it("a proposta da prancha G-ZapProposta", () => {
    expect(proposalMessage(view, DRAFT)).toEqual({
      header: "Lançar assim?",
      body: "R$ 42,90 · Mercado\nHoje, 21/10 · crédito, Visa da Casa\nAmbiente: Casa",
      buttons: [
        { id: `c:${DRAFT}`, title: "Confirmar" },
        { id: `x:${DRAFT}`, title: "Cancelar" },
      ],
    });
  });

  it("parcelado mostra a parcela", () => {
    const message = proposalMessage(
      { ...view, cents: 60000n, installments: 3, installmentCents: 20000n },
      DRAFT,
    );
    expect(message.body.split("\n")[0]).toBe("R$ 600,00 em 3x de R$ 200,00 · Mercado");
  });

  it("dia: hoje, ontem, outro dia, outro ano", () => {
    expect(botDayLabel("2026-10-21", "2026-10-21")).toBe("Hoje, 21/10");
    expect(botDayLabel("2026-10-20", "2026-10-21")).toBe("Ontem, 20/10");
    expect(botDayLabel("2026-10-02", "2026-10-21")).toBe("02/10");
    expect(botDayLabel("2025-12-25", "2026-10-21")).toBe("25/12/2025");
  });

  it("brl", () => {
    expect(brl(4290n)).toBe("R$ 42,90");
    expect(brl(123456789n)).toBe("R$ 1.234.567,89");
    expect(brl(5n)).toBe("R$ 0,05");
  });

  it("botões de cartão: no máximo 3, títulos curtos", () => {
    const cards = ["Visa da Casa", "Master da Lia", "Cartão virtual das assinaturas", "Outro"].map(
      (nickname, i) => ({ id: CARD.replace(/1$/, String(i)), nickname }),
    );
    const message = askCardMessage({ cents: 1850n, title: "Transporte" }, DRAFT, cards);
    expect(message.buttons).toHaveLength(3);
    expect(message.buttons?.every((b) => b.title.length <= 20)).toBe(true);
  });

  // Privacidade (ADR-018): nenhuma resposta tem 4 dígitos seguidos (o final do cartão), saldo,
  // total ou orçamento. Os únicos números são o valor, a data e as parcelas que a pessoa mandou.
  it("nenhum texto do bot tem final de cartão nem fala de saldo, total ou orçamento", () => {
    const all: BotMessage[] = [
      proposalMessage(view, DRAFT),
      proposalMessage({ ...view, installments: 3, installmentCents: 1430n }, DRAFT),
      askCardMessage(view, DRAFT, [{ id: CARD, nickname: "Visa da Casa" }]),
      confirmedMessage({ cents: 4290n, title: "Mercado", installments: null }, DRAFT),
      linkedMessage("Lia", "Casa"),
      warningMessage(),
      ...BOT_FIXED_MESSAGES,
      ...(
        [
          "EMPTY",
          "TOO_LONG",
          "CARD_NUMBER",
          "NO_AMOUNT",
          "MANY_AMOUNTS",
          "ZERO_AMOUNT",
          "AMOUNT_TOO_BIG",
          "BAD_DATE",
          "FUTURE_DATE",
          "BAD_INSTALLMENTS",
          "NO_DESCRIPTION",
          "NO_ACCOUNT",
          "NOT_A_TEXT",
        ] as const
      ).map(notUnderstoodMessage),
    ];
    for (const message of all) {
      const text = `${message.header ?? ""} ${message.body} ${(message.buttons ?? []).map((b) => b.title).join(" ")}`;
      expect(text).not.toMatch(/(?<![\d.,/])\d{4}(?![\d.,/])/);
      expect(text.toLowerCase()).not.toMatch(/saldo|orçad|orcad|total|final \d/);
    }
  });
});

describe("para onde vai o lançamento", () => {
  const W1 = "0193f000-0000-7000-8000-00000000c001";
  const W2 = "0193f000-0000-7000-8000-00000000c002";
  const ACC_CREDIT = "0193f000-0000-7000-8000-00000000a001";
  const ACC_CHECKING = "0193f000-0000-7000-8000-00000000a002";
  const VISA = "0193f000-0000-7000-8000-00000000c101";
  const MASTER = "0193f000-0000-7000-8000-00000000c102";
  const DEBIT_CARD = "0193f000-0000-7000-8000-00000000c103";
  const options: BotOptions = {
    walletIds: [W1, W2],
    cards: [
      { id: VISA, nickname: "Visa da Casa", accountId: ACC_CREDIT, credit: true },
      { id: MASTER, nickname: "Master da Lia", accountId: ACC_CREDIT, credit: true },
      { id: DEBIT_CARD, nickname: "Débito Aurora", accountId: ACC_CHECKING, credit: false },
    ],
    debitAccountIds: [ACC_CHECKING],
  };
  const none = { walletId: null, debitAccountId: null, creditCardId: null };
  const prefs = { walletId: W1, debitAccountId: ACC_CHECKING, creditCardId: VISA };

  it("ambiente: o citado, senão o padrão, senão pergunta", () => {
    expect(chooseBotWallet([W2], prefs, options)).toEqual({ kind: "WALLET", walletId: W2 });
    expect(chooseBotWallet([], prefs, options)).toEqual({ kind: "WALLET", walletId: W1 });
    expect(chooseBotWallet([], none, options)).toEqual({ kind: "ASK", walletIds: [W1, W2] });
    expect(chooseBotWallet([], none, { ...options, walletIds: [W2] })).toEqual({
      kind: "WALLET",
      walletId: W2,
    });
    // Um ambiente que a pessoa não edita mais não vale, nem citado nem como padrão
    expect(chooseBotWallet([], prefs, { ...options, walletIds: [W2] })).toEqual({
      kind: "WALLET",
      walletId: W2,
    });
  });

  it("sem forma: o cartão de crédito padrão", () => {
    expect(
      chooseBotPayment({ method: null, installments: null, cardIds: [] }, prefs, options),
    ).toEqual({ kind: "PAY", method: "CREDIT", accountId: ACC_CREDIT, cardId: VISA });
  });

  it("pix e débito: a conta padrão, sem cartão", () => {
    expect(
      chooseBotPayment({ method: "PIX", installments: null, cardIds: [] }, prefs, options),
    ).toEqual({ kind: "PAY", method: "PIX", accountId: ACC_CHECKING, cardId: null });
  });

  it("cartão citado manda; o de débito vira débito; parcelado no débito não dá", () => {
    expect(
      chooseBotPayment({ method: "CREDIT", installments: null, cardIds: [MASTER] }, prefs, options),
    ).toEqual({ kind: "PAY", method: "CREDIT", accountId: ACC_CREDIT, cardId: MASTER });
    expect(
      chooseBotPayment({ method: null, installments: null, cardIds: [DEBIT_CARD] }, none, options),
    ).toEqual({ kind: "PAY", method: "DEBIT", accountId: ACC_CHECKING, cardId: DEBIT_CARD });
    expect(
      chooseBotPayment({ method: "CREDIT", installments: 3, cardIds: [DEBIT_CARD] }, none, options),
    ).toEqual({ kind: "NONE" });
  });

  it("crédito sem padrão e dois cartões: pergunta qual", () => {
    expect(
      chooseBotPayment({ method: "CREDIT", installments: null, cardIds: [] }, none, options),
    ).toEqual({ kind: "ASK", cardIds: [VISA, MASTER] });
  });

  it("nada que sirva: pede os padrões", () => {
    const empty: BotOptions = { walletIds: [W1], cards: [], debitAccountIds: [] };
    expect(
      chooseBotPayment({ method: null, installments: null, cardIds: [] }, none, empty),
    ).toEqual({
      kind: "NONE",
    });
  });
});

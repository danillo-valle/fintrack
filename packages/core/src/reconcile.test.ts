import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bulkConfirmable,
  cardForLastFour,
  descriptionSimilarity,
  pairCandidate,
  pairedFields,
  pairKey,
  suggestPairs,
  suggestRefunds,
  unregisteredFinals,
  type OwnForMatch,
  type ReceivedForMatch,
  type RefundTarget,
} from "./reconcile";

const received = (over: Partial<ReceivedForMatch> = {}): ReceivedForMatch => ({
  id: "r1",
  accountId: "card",
  cardId: "c-0001",
  amount: -4590n,
  occurredOn: "2026-10-08",
  description: "PADARIA SAO JOAO",
  installment: null,
  ...over,
});

const own = (over: Partial<OwnForMatch> = {}): OwnForMatch => ({
  id: "o1",
  accountId: "card",
  cardId: "c-0001",
  amount: -4590n,
  occurredOn: "2026-10-06",
  description: "Padaria do bairro",
  installment: null,
  ...over,
});

describe("descriptionSimilarity", () => {
  it("compara a loja, sem acento, número ou ruído do banco", () => {
    expect(descriptionSimilarity("PADARIA SÃO JOÃO 02/10", "Padaria São João")).toBe(1);
    expect(descriptionSimilarity("UBER *TRIP 1234", "Uber para o trabalho")).toBeCloseTo(1 / 3);
    expect(descriptionSimilarity("NETFLIX.COM", "Padaria")).toBe(0);
  });

  it("palavra colada pelo banco conta pelo começo", () => {
    expect(descriptionSimilarity("UBERTRIP", "Uber")).toBe(1);
  });

  it("sem loja (só números) não se parece com nada", () => {
    expect(descriptionSimilarity("123456", "123456")).toBe(0);
  });
});

describe("pairCandidate", () => {
  it("mesmo valor e datas a até 5 dias: o mesmo gasto", () => {
    expect(pairCandidate(received(), own())).toMatchObject({ kind: "SAME", daysApart: 2 });
    expect(pairCandidate(received(), own({ occurredOn: "2026-10-13" }))).toMatchObject({
      daysApart: 5,
    });
  });

  it("6 dias, 1 centavo ou outra conta: não é par", () => {
    expect(pairCandidate(received(), own({ occurredOn: "2026-10-02" }))).toBeNull();
    expect(pairCandidate(received(), own({ amount: -4591n }))).toBeNull();
    expect(pairCandidate(received(), own({ accountId: "outra" }))).toBeNull();
  });

  it("a descrição não decide: lojas diferentes com o mesmo valor e dia ainda são candidatas", () => {
    expect(pairCandidate(received(), own({ description: "Farmácia" }))).toMatchObject({
      kind: "SAME",
      similarity: 0,
    });
  });

  it("parcela: o 3 de 6 do banco com a sua parcela 3 de 6, sem olhar a data", () => {
    const parcel = { number: 3, count: 6 };
    expect(
      pairCandidate(
        received({ installment: parcel, occurredOn: "2026-12-05" }),
        own({ installment: parcel, occurredOn: "2026-10-01" }),
      ),
    ).toMatchObject({ kind: "INSTALLMENT", daysApart: 65 });
  });

  it("parcelas de números diferentes nunca são par, nem no mesmo dia", () => {
    expect(
      pairCandidate(
        received({ installment: { number: 3, count: 6 } }),
        own({ installment: { number: 4, count: 6 }, occurredOn: "2026-10-08" }),
      ),
    ).toBeNull();
  });

  it("parcela que só um lado conhece: vale a regra do mesmo gasto (5 dias)", () => {
    expect(pairCandidate(received({ installment: { number: 1, count: 3 } }), own())).toMatchObject({
      kind: "SAME",
    });
    expect(
      pairCandidate(
        received({ installment: { number: 1, count: 3 } }),
        own({ occurredOn: "2026-09-01" }),
      ),
    ).toBeNull();
  });
});

describe("suggestPairs", () => {
  it("dois cafés iguais no mesmo dia: um par para cada, ninguém fica com dois", () => {
    const pairs = suggestPairs(
      [
        received({ id: "r1", amount: -800n, description: "CAFE" }),
        received({ id: "r2", amount: -800n, description: "CAFE" }),
      ],
      [
        own({ id: "o1", amount: -800n, description: "Café" }),
        own({ id: "o2", amount: -800n, description: "Café" }),
      ],
    );
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map((p) => p.receivedId))).toEqual(new Set(["r1", "r2"]));
    expect(new Set(pairs.map((p) => p.ownId))).toEqual(new Set(["o1", "o2"]));
  });

  it("a descrição mais parecida ganha; depois a data mais próxima", () => {
    const pairs = suggestPairs(
      [received({ id: "r1", description: "DROGARIA SP" })],
      [
        own({ id: "farmacia", description: "Drogaria SP", occurredOn: "2026-10-04" }),
        own({ id: "padaria", description: "Padaria", occurredOn: "2026-10-08" }),
      ],
    );
    expect(pairs).toEqual([expect.objectContaining({ ownId: "farmacia" })]);

    const byDate = suggestPairs(
      [received({ id: "r1", description: "UBER" })],
      [
        own({ id: "longe", description: "Uber", occurredOn: "2026-10-04" }),
        own({ id: "perto", description: "Uber", occurredOn: "2026-10-07" }),
      ],
    );
    expect(byDate).toEqual([expect.objectContaining({ ownId: "perto", daysApart: 1 })]);
  });

  it('par recusado ("Não é o mesmo") não volta; o próximo candidato entra no lugar', () => {
    const pairs = suggestPairs(
      [received({ id: "r1" })],
      [own({ id: "o1" }), own({ id: "o2", occurredOn: "2026-10-04" })],
      new Set([pairKey("r1", "o1")]),
    );
    expect(pairs).toEqual([expect.objectContaining({ ownId: "o2" })]);
  });

  it("a parcela certa vence um gasto comum do mesmo valor", () => {
    const parcel = { number: 2, count: 3 };
    const pairs = suggestPairs(
      [received({ installment: parcel })],
      [own({ id: "comum" }), own({ id: "parcela", installment: parcel, occurredOn: "2026-08-01" })],
    );
    expect(pairs).toEqual([expect.objectContaining({ ownId: "parcela", kind: "INSTALLMENT" })]);
  });

  it("propriedade: cada lado aparece em no máximo um par, e todo par obedece às regras", () => {
    const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-10-${String(d).padStart(2, "0")}`);
    const amount = fc.constantFrom(-800n, -1500n, -4590n);
    fc.assert(
      fc.property(
        fc.array(fc.record({ amount, occurredOn: day }), { maxLength: 8 }),
        fc.array(fc.record({ amount, occurredOn: day }), { maxLength: 8 }),
        (rs, os) => {
          const rec = rs.map((r, i) => received({ ...r, id: `r${i}` }));
          const mine = os.map((o, i) => own({ ...o, id: `o${i}` }));
          const pairs = suggestPairs(rec, mine);
          expect(new Set(pairs.map((p) => p.receivedId)).size).toBe(pairs.length);
          expect(new Set(pairs.map((p) => p.ownId)).size).toBe(pairs.length);
          for (const p of pairs) {
            const r = rec.find((x) => x.id === p.receivedId) as ReceivedForMatch;
            const o = mine.find((x) => x.id === p.ownId) as OwnForMatch;
            expect(r.amount).toBe(o.amount);
            expect(p.daysApart).toBeLessThanOrEqual(5);
          }
        },
      ),
    );
  });
});

describe("suggestRefunds", () => {
  const purchase = (over: Partial<RefundTarget> = {}): RefundTarget => ({
    id: "p1",
    accountId: "card",
    amount: -12990n,
    occurredOn: "2026-09-20",
    description: "LOJA CALCADOS CENTRO",
    ...over,
  });
  const credit = received({
    id: "e1",
    amount: 12990n,
    occurredOn: "2026-10-08",
    description: "ESTORNO LOJA CALCADOS CENTRO",
  });

  it("crédito do mesmo valor e da mesma loja, até 90 dias depois da compra", () => {
    expect(suggestRefunds([credit], [purchase()])).toEqual([
      expect.objectContaining({ receivedId: "e1", ownId: "p1", kind: "REFUND", daysApart: 18 }),
    ]);
  });

  it("outra loja, outro valor, compra depois do crédito ou mais de 90 dias: não é estorno", () => {
    expect(suggestRefunds([credit], [purchase({ description: "Mercado" })])).toEqual([]);
    expect(suggestRefunds([credit], [purchase({ amount: -12900n })])).toEqual([]);
    expect(suggestRefunds([credit], [purchase({ occurredOn: "2026-10-09" })])).toEqual([]);
    expect(suggestRefunds([credit], [purchase({ occurredOn: "2026-07-09" })])).toEqual([]);
    expect(suggestRefunds([received({ amount: -12990n })], [purchase()])).toEqual([]);
  });

  it("estorno recusado não volta", () => {
    expect(suggestRefunds([credit], [purchase()], new Set([pairKey("e1", "p1")]))).toEqual([]);
  });

  it("duas compras iguais: o estorno vai para a mais recente", () => {
    const pairs = suggestRefunds(
      [credit],
      [purchase({ id: "antiga", occurredOn: "2026-08-01" }), purchase({ id: "recente" })],
    );
    expect(pairs).toEqual([expect.objectContaining({ ownId: "recente" })]);
  });
});

describe("pairedFields", () => {
  const ownSide = {
    walletId: "w-casa",
    cardId: "c-0001",
    description: "Mercado da semana",
    categoryId: "cat-mercado",
    categorizedBy: "MANUAL",
    notes: "com a Lia",
    installmentGroupId: null,
    installmentNumber: null,
    recurrenceId: "rec-1",
    transferId: null,
  };

  it("fica o seu: descrição, categoria, ambiente, observação e recorrência", () => {
    expect(
      pairedFields({ cardId: "c-0002", categoryId: "cat-x", categorizedBy: "RULE" }, ownSide),
    ).toEqual({ ...ownSide, cardId: "c-0002", categorizationConfidence: null });
  });

  it("a confiança acompanha quem decidiu a categoria (M10.1)", () => {
    const bank = {
      cardId: null,
      categoryId: "cat-x",
      categorizedBy: "CLASSIFIER",
      categorizationConfidence: 92,
    };
    expect(pairedFields(bank, { ...ownSide, categoryId: null, categorizedBy: null })).toMatchObject(
      { categorizedBy: "CLASSIFIER", categorizationConfidence: 92 },
    );
    expect(pairedFields(bank, ownSide)).toMatchObject({
      categorizedBy: "MANUAL",
      categorizationConfidence: null,
    });
  });

  it("sem a sua categoria, fica a sugestão do recebido; sem o final do banco, o seu cartão", () => {
    expect(
      pairedFields(
        { cardId: null, categoryId: "cat-x", categorizedBy: "RULE" },
        { ...ownSide, categoryId: null, categorizedBy: null },
      ),
    ).toMatchObject({ cardId: "c-0001", categoryId: "cat-x", categorizedBy: "RULE" });
  });

  it("transferência nunca tem categoria", () => {
    expect(
      pairedFields(
        { cardId: null, categoryId: "cat-x", categorizedBy: "RULE" },
        { ...ownSide, categoryId: null, categorizedBy: null, transferId: "t-1" },
      ),
    ).toMatchObject({ categoryId: null, categorizedBy: null, transferId: "t-1" });
  });
});

describe("bulkConfirmable", () => {
  it("só os que têm categoria e não têm par sugerido", () => {
    const rows = [
      { id: "a", categoryId: "cat" },
      { id: "b", categoryId: null },
      { id: "c", categoryId: "cat" },
      { id: "d", categoryId: null, transferId: "t" },
    ];
    expect(bulkConfirmable(rows, new Set(["c"])).map((r) => r.id)).toEqual(["a", "d"]);
  });
});

describe("cardForLastFour", () => {
  const titular = { id: "t", lastFour: "0001" };
  const adicional = { id: "a", lastFour: "0002" };

  it("final cadastrado: o cartão desse final", () => {
    expect(cardForLastFour([titular, adicional], "0002")).toBe(adicional);
  });

  it("final que não está cadastrado fica sem cartão, mesmo com um cartão só", () => {
    expect(cardForLastFour([titular], "0099")).toBeNull();
  });

  it("sem final: o cartão único da conta; com dois, nenhum", () => {
    expect(cardForLastFour([titular], null)).toBe(titular);
    expect(cardForLastFour([titular, adicional], null)).toBeNull();
  });
});

describe("unregisteredFinals", () => {
  it("agrupa os finais que não estão cadastrados, do mais recente ao mais antigo", () => {
    expect(
      unregisteredFinals(
        [
          { lastFour: "0001", amount: -100n, occurredOn: "2026-10-01" },
          { lastFour: "0007", amount: -500n, occurredOn: "2026-10-02" },
          { lastFour: "0007", amount: -250n, occurredOn: "2026-10-05" },
          { lastFour: "0003", amount: -900n, occurredOn: "2026-10-03" },
          { lastFour: null, amount: -10n, occurredOn: "2026-10-09" },
        ],
        ["0001"],
      ),
    ).toEqual([
      { lastFour: "0007", count: 2, total: -750n, lastSeen: "2026-10-05" },
      { lastFour: "0003", count: 1, total: -900n, lastSeen: "2026-10-03" },
    ]);
  });
});

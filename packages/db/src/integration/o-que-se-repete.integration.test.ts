// M13.3c contra o Postgres (ADR-027): a fixa que chega vira previsão e toma o lugar da prevista, a
// marca Variável a tira, a escolha da pessoa no lançamento (Repete todo mês, Tipo da receita), o
// valor e o dia (Mudar o valor), a parcela dita pela pessoa e a que continua sozinha, as parcelas
// previstas e os Próximos meses, e os CHECKs novos.
//
// Rode com: pnpm test:integration
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeScope,
  authorizeTransaction,
  authorizeWallet,
  DomainError,
  type WalletScope,
} from "../access";
import { recurrencePlans } from "../dashboard";
import {
  accountForecast,
  arrivalsVsExpected,
  billPayers,
  cardForecast,
  forecastItems,
  upcoming,
} from "../forecast";
import { installmentPlans, setTransactionInstallment } from "../installments";
import { updateRecurrence } from "../recurrences";
import { keepRecentLinked, linkRecurring, recurringChoice, setRecurring } from "../recurring";
import {
  auditActions,
  createTestCategories,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  insertTransaction,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DomainError))
    throw new Error(`esperava DomainError, veio ${String(error)}`);
  return error.code;
}

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
let viewScope: WalletScope<"view">;

beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
  viewScope = await authorizeScope(prisma, h.holder.id, "view");
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

async function editGrant(id: string, userId = h.holder.id) {
  const access = await authorizeTransaction(prisma, userId, id, "edit");
  if (!access.ok) throw new Error("sem acesso");
  return access.grant;
}

async function viewGrant(id: string) {
  const access = await authorizeTransaction(prisma, h.holder.id, id, "view");
  if (!access.ok) throw new Error("sem acesso");
  return access.grant;
}

/** Liga como a revisão e a busca ligam: numa transação, sem autor (a busca) ou com. */
const link = (ids: string[], actorId: string | null = null) =>
  prisma.$transaction((tx) => linkRecurring(tx, ids, actorId, TEST_CTX));

/** Uma saída fixa pela categoria (ADR-026), confirmada. */
async function fixedCharge(occurredOn: string, amount = "-129.00", description = "ACADEMIA FORMA") {
  await prisma.category.update({
    where: { id: cats.mercado.id },
    data: { defaultNature: "FIXED" },
  });
  return insertTransaction(h, { amount, occurredOn, description, categoryId: cats.mercado.id });
}

describe("a fixa que chega vira previsão (ADR-027)", () => {
  it("a primeira cria a recorrência do banco; a do mês seguinte se liga a ela", async () => {
    const october = await fixedCharge("2026-10-28");
    expect(await link([october.id])).toEqual({ linked: 1, created: 1, unlinked: 0 });
    const series = await prisma.recurrence.findFirstOrThrow({
      where: { householdId: h.householdId },
    });
    expect(series).toMatchObject({
      origin: "BANK",
      amountRule: "LAST",
      dayRule: "DAY",
      dayOfMonth: 28,
      kind: "FIXED_BILL",
      accountId: h.checking.id,
      categoryId: cats.mercado.id,
      endsOn: null,
    });
    expect(series.matchKey).toBeTruthy();
    expect(series.startsOn.toISOString().slice(0, 10)).toBe("2026-10-01");

    const november = await fixedCharge("2026-11-27", "-135.00", "ACADEMIA FORMA 4432");
    expect(await link([november.id])).toEqual({ linked: 1, created: 0, unlinked: 0 });
    const linked = await prisma.transaction.findMany({
      where: { recurrenceId: series.id },
      select: { id: true },
    });
    expect(linked.map((t) => t.id).toSorted()).toEqual([october.id, november.id].toSorted());
    expect(await auditActions(h.householdId)).toContain("recurrence.created");
  });

  it("o recebido ainda na revisão não cria; a marca Variável à mão desliga e não religa", async () => {
    const pending = await fixedCharge("2026-10-28");
    await prisma.transaction.update({ where: { id: pending.id }, data: { status: "PENDING" } });
    expect(await link([pending.id])).toEqual({ linked: 0, created: 0, unlinked: 0 });

    await prisma.transaction.update({ where: { id: pending.id }, data: { status: "CONFIRMED" } });
    await link([pending.id]);
    await prisma.transaction.update({ where: { id: pending.id }, data: { nature: "VARIABLE" } });
    expect(await link([pending.id])).toEqual({ linked: 0, created: 0, unlinked: 1 });
    expect(await link([pending.id])).toEqual({ linked: 0, created: 0, unlinked: 0 });
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.recurrenceId).toBeNull();
  });

  it("a busca diária liga o que ficou para trás nos últimos dois meses", async () => {
    const old = await fixedCharge("2026-08-01");
    const recent = await fixedCharge("2026-10-28");
    const counts = await keepRecentLinked(prisma, h.householdId, "2026-11-05");
    expect(counts.created).toBe(1);
    const rows = await prisma.transaction.findMany({
      where: { id: { in: [old.id, recent.id] } },
      select: { id: true, recurrenceId: true },
    });
    expect(rows.find((r) => r.id === old.id)?.recurrenceId).toBeNull();
    expect(rows.find((r) => r.id === recent.id)?.recurrenceId).not.toBeNull();
  });

  it("o mês do banco só se realiza com a cobrança conferida, e o valor é o último", async () => {
    const october = await fixedCharge("2026-10-28", "-129.00");
    await link([october.id]);
    const november = await fixedCharge("2026-11-27", "-140.00");
    await link([november.id]);
    await prisma.transaction.update({ where: { id: november.id }, data: { status: "PENDING" } });
    const [plan] = await recurrencePlans(prisma, viewScope, ["2026-11", "2026-12"]);
    expect(plan?.origin).toBe("BANK");
    expect(plan?.materialized).toEqual(new Set(["2026-10"]));
    expect(plan?.amount).toBe(-12900n);
  });
});

describe("a escolha da pessoa no lançamento", () => {
  it("Tipo da receita: Fixa cria a da entrada com o 5º dia útil e a média; Variável para", async () => {
    const salary = await insertTransaction(h, {
      amount: "9850.00",
      occurredOn: "2026-11-06",
      description: "SALARIO EMPRESA EXEMPLO",
    });
    // A entrada nunca vira previsão sozinha
    expect(await link([salary.id])).toEqual({ linked: 0, created: 0, unlinked: 0 });
    await setRecurring(
      prisma,
      await editGrant(salary.id),
      {
        repeats: true,
        settings: {
          amountRule: "AVERAGE_3",
          fixed: null,
          dayRule: "BUSINESS_DAY",
          day: 5,
          endsOn: null,
        },
      },
      TEST_CTX,
    );
    const series = await prisma.recurrence.findFirstOrThrow({
      where: { householdId: h.householdId },
    });
    expect(series).toMatchObject({
      kind: "INCOME",
      origin: "BANK",
      amountRule: "AVERAGE_3",
      dayRule: "BUSINESS_DAY",
      dayOfMonth: 5,
    });
    const choice = await recurringChoice(prisma, await viewGrant(salary.id));
    expect(choice).toMatchObject({ allowed: true, income: true, repeats: true });
    if (!choice.allowed) throw new Error("devia permitir");
    expect(choice.lastArrivals).toEqual([{ occurredOn: "2026-11-06", amount: 985000n }]);

    // Dezembro: o 5º dia útil é 07/12
    const items = await forecastItems(prisma, viewScope, ["2026-12"], "2026-11-06");
    expect(items.map((i) => [i.title, i.date, i.amount])).toEqual([
      ["SALARIO EMPRESA EXEMPLO", "2026-12-07", 985000n],
    ]);

    await setRecurring(prisma, await editGrant(salary.id), { repeats: false }, TEST_CTX);
    const stopped = await prisma.recurrence.findUniqueOrThrow({ where: { id: series.id } });
    expect(stopped.archivedAt).not.toBeNull();
    const actions = await auditActions(h.householdId);
    expect(actions).toEqual(
      expect.arrayContaining(["recurrence.created", "recurrence.updated", "recurrence.archived"]),
    );
  });

  it("Fixa numa saída cria a recorrência mesmo antes da revisão, com o valor fixo", async () => {
    const charge = await insertTransaction(h, {
      amount: "-212.48",
      occurredOn: "2026-11-02",
      description: "CONTA LUZ COPEL",
    });
    await prisma.transaction.update({ where: { id: charge.id }, data: { status: "PENDING" } });
    await setRecurring(
      prisma,
      await editGrant(charge.id),
      {
        repeats: true,
        settings: { amountRule: "FIXED", fixed: 20000n, dayRule: "DAY", day: 2, endsOn: null },
      },
      TEST_CTX,
    );
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: charge.id },
      include: { recurrence: true },
    });
    expect(row.nature).toBe("FIXED");
    expect(row.recurrence?.amount.toString()).toBe("-200");
    expect(row.recurrence?.amountRule).toBe("FIXED");
  });

  it("recusa a regra que não vale, a transferência e o lançamento de outra carteira", async () => {
    const charge = await fixedCharge("2026-11-02");
    await link([charge.id]);
    const bad = {
      repeats: true as const,
      settings: {
        amountRule: "LAST" as const,
        fixed: null,
        dayRule: "BUSINESS_DAY" as const,
        day: 24,
        endsOn: null,
      },
    };
    expect(await codeOf(setRecurring(prisma, await editGrant(charge.id), bad, TEST_CTX))).toBe(
      "RECURRENCE_RULE_INVALID",
    );
    const transfer = await insertTransaction(h, {
      amount: "-100.00",
      occurredOn: "2026-11-02",
      description: "TRANSF",
      transferId: "0195f5a0-0000-7000-8000-000000000001",
    });
    expect(
      await codeOf(
        setRecurring(prisma, await editGrant(transfer.id), { repeats: false }, TEST_CTX),
      ),
    ).toBe("RECURRENCE_NOT_ALLOWED");

    const series = await prisma.recurrence.findFirstOrThrow({
      where: { householdId: h.householdId },
    });
    // O crachá da carteira da parceira não alcança a recorrência da Casa (IDOR): 404
    const partnerWallet = await authorizeWallet(prisma, h.partner.id, h.partnerWallet.id, "edit");
    if (!partnerWallet.ok) throw new Error("sem acesso");
    expect(
      await codeOf(
        updateRecurrence(prisma, partnerWallet.grant, series.id, bad.settings, TEST_CTX),
      ),
    ).toBe("NOT_FOUND");
  });

  it("Mudar o valor grava a regra e o dia, sem o valor na auditoria", async () => {
    const charge = await fixedCharge("2026-11-02");
    await link([charge.id]);
    const series = await prisma.recurrence.findFirstOrThrow({
      where: { householdId: h.householdId },
    });
    const wallet = await authorizeWallet(prisma, h.holder.id, series.walletId, "edit");
    if (!wallet.ok) throw new Error("sem acesso");
    await updateRecurrence(
      prisma,
      wallet.grant,
      series.id,
      { amountRule: "FIXED", fixed: 15000n, dayRule: "DAY", day: 10, endsOn: "2026-12-31" },
      TEST_CTX,
    );
    const updated = await prisma.recurrence.findUniqueOrThrow({ where: { id: series.id } });
    expect(updated.amount.toString()).toBe("-150");
    expect(updated.dayOfMonth).toBe(10);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "recurrence.updated" },
    });
    expect(JSON.stringify(log.metadata)).not.toContain("150");
  });
});

describe("a parcela dita pela pessoa e as previstas", () => {
  it("Parcelada: 2 de 5; a do mês seguinte vira 3 de 5; as que faltam ficam previstas", async () => {
    const november = await insertTransaction(h, {
      accountId: h.card.id,
      method: "CREDIT",
      amount: "-640.00",
      occurredOn: "2026-10-31",
      description: "NOTEBOOK LOJA TEC",
    });
    await setTransactionInstallment(
      prisma,
      await editGrant(november.id),
      { number: 2, count: 5 },
      TEST_CTX,
    );
    const december = await insertTransaction(h, {
      accountId: h.card.id,
      method: "CREDIT",
      amount: "-640.00",
      occurredOn: "2026-11-30",
      description: "NOTEBOOK LOJA TEC",
    });
    await link([december.id]);
    const continued = await prisma.transaction.findUniqueOrThrow({ where: { id: december.id } });
    expect([
      continued.providerInstallmentNumber,
      continued.providerInstallmentCount,
      continued.installmentByPerson,
    ]).toEqual([3, 5, true]);

    const plans = await installmentPlans(prisma, viewScope, "2026-12-01");
    expect(plans.map((p) => [p.number, p.count, p.dueDate])).toEqual([
      [4, 5, "2027-01-09"],
      [5, 5, "2027-02-09"],
    ]);
    expect(await auditActions(h.householdId)).toContain("transaction.installment_set");
  });

  it("recusa a parcela onde o banco já disse, e números fora do lugar", async () => {
    const parcel = await insertTransaction(h, {
      accountId: h.card.id,
      method: "CREDIT",
      amount: "-50.00",
      occurredOn: "2026-10-10",
      description: "LOJA 02/06",
    });
    await prisma.transaction.update({
      where: { id: parcel.id },
      data: { providerInstallmentNumber: 2, providerInstallmentCount: 6 },
    });
    expect(
      await codeOf(
        setTransactionInstallment(
          prisma,
          await editGrant(parcel.id),
          { number: 3, count: 6 },
          TEST_CTX,
        ),
      ),
    ).toBe("INSTALLMENT_NOT_ALLOWED");
    const other = await insertTransaction(h, {
      amount: "-50.00",
      occurredOn: "2026-10-10",
      description: "OUTRA",
    });
    expect(
      await codeOf(
        setTransactionInstallment(
          prisma,
          await editGrant(other.id),
          { number: 6, count: 5 },
          TEST_CTX,
        ),
      ),
    ).toBe("INSTALLMENT_NOT_ALLOWED");
  });

  it("Próximos meses: o salário, a fixa da conta e a fatura com a assinatura do cartão", async () => {
    const salary = await insertTransaction(h, {
      accountId: h.checking.id,
      amount: "9000.00",
      occurredOn: "2026-11-01",
      description: "SALARIO EMPRESA EXEMPLO",
    });
    await setRecurring(
      prisma,
      await editGrant(salary.id),
      {
        repeats: true,
        settings: { amountRule: "LAST", fixed: null, dayRule: "DAY", day: 1, endsOn: null },
      },
      TEST_CTX,
    );
    const rent = await fixedCharge("2026-11-01", "-2800.00", "ALUGUEL APTO");
    const spotify = await insertTransaction(h, {
      accountId: h.card.id,
      method: "CREDIT",
      amount: "-21.90",
      occurredOn: "2026-11-02",
      description: "SPOTIFY",
      categoryId: cats.mercado.id,
    });
    await link([rent.id, spotify.id]);
    const { months } = await upcoming(prisma, viewScope, "2026-11-05");
    expect(months[0]).toEqual({
      month: "2026-12",
      income: 900000n,
      account: 280000n,
      // a do dia 02/11 está na fatura que fechou em 03/11 e vence em 09/11; a de 02/12 vence em 09/12
      card: 2190n,
      left: 900000n - 280000n - 2190n,
    });
    expect(months).toHaveLength(4);
  });

  it("o que chegou diferente do previsto e a conta que paga o cartão", async () => {
    const make = (occurredOn: string, amount: string) =>
      insertTransaction(h, { amount, occurredOn, description: "SALARIO EMPRESA EXEMPLO" });
    const september = await make("2026-09-01", "10120.00");
    await setRecurring(
      prisma,
      await editGrant(september.id),
      {
        repeats: true,
        settings: { amountRule: "AVERAGE_3", fixed: null, dayRule: "DAY", day: 1, endsOn: null },
      },
      TEST_CTX,
    );
    const october = await make("2026-10-01", "9850.00");
    const november = await make("2026-11-01", "9850.00");
    await link([october.id, november.id]);
    const rows = await arrivalsVsExpected(prisma, viewScope, h.checking.id, "2026-11");
    // previsto de novembro: a média de setembro e outubro
    expect(rows).toEqual([
      expect.objectContaining({ transactionId: november.id, amount: 985000n, expected: 998500n }),
    ]);

    const transferId = "0195f5a0-0000-7000-8000-000000000002";
    await insertTransaction(h, {
      accountId: h.checking.id,
      amount: "-500.00",
      occurredOn: "2026-11-09",
      description: "PAGTO FATURA",
      transferId,
    });
    await insertTransaction(h, {
      accountId: h.card.id,
      amount: "500.00",
      occurredOn: "2026-11-09",
      description: "PAGAMENTO RECEBIDO",
      transferId,
    });
    expect((await billPayers(prisma, viewScope)).get(h.card.id)).toBe(h.checking.id);
  });
});

describe("os CHECKs do ADR-027", () => {
  const base = () => ({
    householdId: h.householdId,
    walletId: h.home.id,
    accountId: h.checking.id,
    method: "PIX" as const,
    amount: "-10.00",
    description: "Teste",
    kind: "FIXED_BILL" as const,
    dayOfMonth: 5,
    startsOn: new Date("2026-10-01T00:00:00Z"),
  });

  it("a do banco tem a chave; a do app só tem valor fixo; dia útil até 23", async () => {
    expect(
      await dbError(prisma.recurrence.create({ data: { ...base(), origin: "BANK" } })),
    ).toContain("recurrence_origin_check");
    expect(
      await dbError(prisma.recurrence.create({ data: { ...base(), matchKey: "academia" } })),
    ).toContain("recurrence_origin_check");
    expect(
      await dbError(prisma.recurrence.create({ data: { ...base(), amountRule: "LAST" } })),
    ).toContain("recurrence_origin_check");
    expect(
      await dbError(
        prisma.recurrence.create({
          data: { ...base(), dayRule: "BUSINESS_DAY", dayOfMonth: 24 },
        }),
      ),
    ).toContain("recurrence_origin_check");
  });

  it("a parcela dita pela pessoa tem os dois números", async () => {
    const row = await insertTransaction(h, {
      amount: "-10.00",
      occurredOn: "2026-10-10",
      description: "X",
    });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: row.id }, data: { installmentByPerson: true } }),
      ),
    ).toContain("transaction_installment_by_person_check");
  });
});

describe("a conta e o cartão olhando para a frente", () => {
  it("o mês da conta tem o salário e a fatura que ela paga; o cartão, a assinatura e o ciclo", async () => {
    const salary = await insertTransaction(h, {
      amount: "5000.00",
      occurredOn: "2026-11-02",
      description: "SALARIO EMPRESA EXEMPLO",
    });
    await setRecurring(
      prisma,
      await editGrant(salary.id),
      {
        repeats: true,
        settings: { amountRule: "LAST", fixed: null, dayRule: "DAY", day: 2, endsOn: null },
      },
      TEST_CTX,
    );
    const spotify = await fixedCharge("2026-11-02", "-21.90", "SPOTIFY");
    await prisma.transaction.update({
      where: { id: spotify.id },
      data: { accountId: h.card.id, method: "CREDIT" },
    });
    await link([spotify.id]);
    const transferId = "0195f5a0-0000-7000-8000-000000000003";
    await insertTransaction(h, {
      amount: "-100.00",
      occurredOn: "2026-11-09",
      description: "PAGTO FATURA",
      transferId,
    });
    await insertTransaction(h, {
      accountId: h.card.id,
      amount: "100.00",
      occurredOn: "2026-11-09",
      description: "PAGAMENTO RECEBIDO",
      transferId,
    });

    const [december] = await accountForecast(
      prisma,
      viewScope,
      h.checking.id,
      ["2026-12"],
      "2026-11-05",
    );
    expect(december?.items.map((i) => [i.title, i.amount])).toEqual([
      ["SALARIO EMPRESA EXEMPLO", 500000n],
    ]);
    expect(december?.bills).toEqual([
      expect.objectContaining({
        cardAccountId: h.card.id,
        dueDate: "2026-12-09",
        forecast: 2190n,
      }),
    ]);

    const card = await cardForecast(prisma, viewScope, h.card.id, "2026-11-05");
    expect(card.cycle).toEqual({ closingDay: 3, dueDay: 9 });
    expect(card.items.every((i) => i.accountId === h.card.id && i.source === "recurrence")).toBe(
      true,
    );
    expect(card.items[0]?.cashDate).toBe("2026-12-09");
  });
});

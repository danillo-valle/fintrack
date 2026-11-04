// M13.3a (ADR-025): toda compra no cartão tem fatura, e conta no vencimento dela.
//
// Prova que o gatilho e a função do banco escolhem a mesma fatura que o @fintrack/core, que a data
// de caixa e a entrada/saída concordam entre o SQL, o WHERE da lista e o core, e que as datas que
// o banco manda para a fatura aberta passam a valer.
import {
  addDays,
  civilFromDbDate,
  flowOf,
  statementFor,
  statementWindow,
  type CardCycle,
} from "@fintrack/core";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeScope } from "../access";
import { accountBalances } from "../balances";
import { monthAsRange } from "../cash";
import { spendingRows, statementWindows } from "../dashboard";
import { alignOpenStatement, statementsDueIn } from "../statements";
import { listTransactions, sumTransactions } from "../transactions";
import {
  createTestHousehold,
  deleteTestHousehold,
  insertTransaction,
  prisma,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
beforeEach(async () => {
  h = await createTestHousehold();
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

/** Um cartão novo (sem fatura nenhuma) com o ciclo pedido. */
async function cardWith(cycle: CardCycle) {
  return prisma.financialAccount.create({
    data: {
      householdId: h.householdId,
      walletId: h.holderWallet.id,
      holderId: h.holder.id,
      name: `Cartão ${cycle.closingDay}/${cycle.dueDay}`,
      kind: "CREDIT_CARD",
      closingDay: cycle.closingDay,
      dueDay: cycle.dueDay,
    },
  });
}

async function purchase(accountId: string, occurredOn: string, amount = "-10.00") {
  const row = await insertTransaction(h, {
    accountId,
    walletId: h.holderWallet.id,
    amount,
    occurredOn,
    description: "COMPRA",
    method: "CREDIT",
  });
  return prisma.transaction.findUniqueOrThrow({
    where: { id: row.id },
    select: {
      id: true,
      statement: { select: { id: true, referenceMonth: true, closingDate: true, dueDate: true } },
    },
  });
}

describe("toda compra no cartão tem fatura (gatilho transaction_card_statement)", () => {
  it("a função do banco escolhe a mesma fatura que o core, dia a dia, em qualquer ciclo", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        fc.array(fc.integer({ min: 0, max: 420 }), { minLength: 1, maxLength: 12 }),
        async (closingDay, dueDay, offsets) => {
          fc.pre(closingDay !== dueDay);
          const cycle = { closingDay, dueDay };
          const card = await cardWith(cycle);
          try {
            // Em qualquer ordem: as faturas criadas no caminho valem para as compras seguintes
            for (const offset of offsets) {
              const day = addDays("2026-01-01", offset);
              const { statement } = await purchase(card.id, day);
              const expected = statementFor(day, cycle);
              expect(statement, day).not.toBeNull();
              expect({
                referenceMonth: civilFromDbDate(statement!.referenceMonth).slice(0, 7),
                closingDate: civilFromDbDate(statement!.closingDate),
                dueDate: civilFromDbDate(statement!.dueDate),
              }).toEqual(expected);
            }
          } finally {
            await prisma.transaction.deleteMany({ where: { accountId: card.id } });
            await prisma.cardStatement.deleteMany({ where: { accountId: card.id } });
            await prisma.financialAccount.delete({ where: { id: card.id } });
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("a transferência fica sem fatura; a fatura escolhida por quem grava continua", async () => {
    const transfer = await insertTransaction(h, {
      accountId: h.card.id,
      amount: "1940.00",
      occurredOn: "2026-10-09",
      description: "PAGAMENTO",
      method: "TRANSFER",
      transferId: crypto.randomUUID(),
    });
    expect(transfer.statementId).toBeNull();

    const chosen = await prisma.cardStatement.create({
      data: {
        accountId: h.card.id,
        referenceMonth: new Date("2026-12-01T00:00:00Z"),
        closingDate: new Date("2026-12-03T00:00:00Z"),
        dueDate: new Date("2026-12-09T00:00:00Z"),
      },
    });
    const row = await prisma.transaction.create({
      data: {
        householdId: h.householdId,
        walletId: h.holderWallet.id,
        accountId: h.card.id,
        method: "CREDIT",
        amount: "-50.00",
        occurredOn: new Date("2026-10-10T00:00:00Z"),
        description: "PARCELA",
        statementId: chosen.id,
      },
    });
    expect(row.statementId).toBe(chosen.id);
  });

  it("as datas do banco para a fatura aberta valem mais que o ciclo", async () => {
    // O cartão do fixture fecha dia 3 e vence dia 9; o banco diz que esta fecha em 05/11 e
    // vence em 12/11. A compra de 04/11 (pelo ciclo, já da fatura seguinte) fica nesta
    const before = await purchase(h.card.id, "2026-11-04");
    expect(civilFromDbDate(before.statement!.dueDate)).toBe("2026-12-09");
    await purchase(h.card.id, "2026-10-20");
    await alignOpenStatement(
      prisma,
      h.card,
      { closeDate: "2026-11-05", dueDate: "2026-11-12" },
      "2026-10-21",
    );
    const moved = await prisma.transaction.findUniqueOrThrow({
      where: { id: before.id },
      select: { statement: { select: { closingDate: true, dueDate: true } } },
    });
    expect(civilFromDbDate(moved.statement!.dueDate)).toBe("2026-11-12");
    const after = await purchase(h.card.id, "2026-11-04");
    expect(civilFromDbDate(after.statement!.dueDate)).toBe("2026-11-12");
    const fifth = await purchase(h.card.id, "2026-11-05");
    expect(civilFromDbDate(fifth.statement!.dueDate)).toBe("2026-12-09");
    // Rodar de novo com as mesmas datas não muda nada
    await alignOpenStatement(
      prisma,
      h.card,
      { closeDate: "2026-11-05", dueDate: "2026-11-12" },
      "2026-10-21",
    );
    const november = await statementsDueIn(prisma, [h.card.id], "2026-11", "2026-10-21");
    expect(november.map((s) => [s.dueDate, s.amount])).toEqual([["2026-11-12", 3000n]]);
  });

  it("o período de cada fatura gravada é o do core (statementWindow)", async () => {
    const a = await purchase(h.card.id, "2026-10-10");
    const b = await purchase(h.card.id, "2026-11-10");
    const windows = await statementWindows(prisma, [a.statement!.id, b.statement!.id]);
    expect(windows.get(b.statement!.id)).toEqual(
      statementWindow({
        closingDate: civilFromDbDate(b.statement!.closingDate),
        previousClosingDate: civilFromDbDate(a.statement!.closingDate),
      }),
    );
    expect(windows.get(a.statement!.id)).toEqual({ start: "2026-10-03", end: "2026-11-02" });
  });
});

describe("data de caixa e entrada/saída (ADR-025)", () => {
  it("lista, totais, painel e core concordam: o estorno no cartão abate a saída", async () => {
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    await insertTransaction(h, { amount: "9850.00", occurredOn: "2026-11-01", description: "SAL" });
    await insertTransaction(h, { amount: "-38.40", occurredOn: "2026-11-02", description: "PAD" });
    await purchase(h.card.id, "2026-10-20", "-200.00"); // vence 09/11
    await purchase(h.card.id, "2026-10-25", "50.00"); // estorno, vence 09/11
    await purchase(h.card.id, "2026-11-04", "-99.00"); // vence 09/12

    const filters = { periods: [monthAsRange("2026-11")] };
    const totals = await sumTransactions(prisma, scope, filters);
    expect(totals).toMatchObject({ income: 985000n, expense: -18840n, count: 4 });
    const { items } = await listTransactions(prisma, scope, filters);
    for (const item of items) expect(item.cashOn.slice(0, 7)).toBe("2026-11");
    const byFlow = (flow: "income" | "expense") =>
      items
        .filter((i) => flowOf({ amount: i.amount, accountKind: i.account.kind }) === flow)
        .reduce((sum, i) => sum + i.amount, 0n);
    expect(byFlow("income")).toBe(totals.income);
    expect(byFlow("expense")).toBe(totals.expense);

    const rows = await spendingRows(prisma, scope, {
      from: "2026-11",
      to: "2026-12",
      today: "2026-11-05",
    });
    const sum = (month: string, key: "expense" | "income") =>
      rows.filter((r) => r.month === month).reduce((s, r) => s + r[key], 0n);
    expect(sum("2026-11", "expense")).toBe(18840n);
    expect(sum("2026-11", "income")).toBe(985000n);
    expect(sum("2026-12", "expense")).toBe(9900n);
    // O variável do cartão fica na janela da fatura dele; o das contas, na janela do mês
    expect(new Set(rows.filter((r) => r.month === "2026-11").map((r) => r.window)).size).toBe(2);

    // Só as contas, só os cartões: as duas partes somam o mês
    const accounts = await sumTransactions(prisma, scope, { ...filters, side: "accounts" });
    const cards = await sumTransactions(prisma, scope, { ...filters, side: "cards" });
    expect(accounts.expense + cards.expense).toBe(totals.expense);
    expect(cards).toMatchObject({ income: 0n, expense: -15000n, count: 2 });
  });
});

describe("o saldo das contas (accountBalances)", () => {
  it("manual: o inicial mais tudo até hoje; o começo do período sem o que se mexeu nele", async () => {
    await prisma.financialAccount.update({
      where: { id: h.checking.id },
      data: { initialBalance: "1000.00" },
    });
    await insertTransaction(h, { amount: "-100.00", occurredOn: "2026-10-20", description: "A" });
    await insertTransaction(h, { amount: "9850.00", occurredOn: "2026-11-01", description: "SAL" });
    // A transferência para a poupança também sai da conta
    await insertTransaction(h, {
      amount: "-500.00",
      occurredOn: "2026-11-02",
      description: "POUPANCA",
      method: "TRANSFER",
      transferId: crypto.randomUUID(),
    });
    // O que vem depois de hoje não entra; o apagado também não
    await insertTransaction(h, { amount: "-70.00", occurredOn: "2026-11-20", description: "AG" });
    await insertTransaction(h, {
      amount: "-5.00",
      occurredOn: "2026-11-02",
      description: "APAGADO",
      deletedAt: new Date(),
    });
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    const accounts = await accountBalances(prisma, scope, {
      today: "2026-11-03",
      periodStart: "2026-11-01",
    });
    expect(accounts.map((a) => a.kind)).not.toContain("CREDIT_CARD");
    const checking = accounts.find((a) => a.id === h.checking.id);
    expect(checking?.balance).toEqual({
      source: "computed",
      today: 1025000n,
      atStart: 90000n,
      change: 935000n,
    });
  });

  it("ligada: o saldo do banco manda", async () => {
    const connection = await prisma.providerConnection.create({
      data: { userId: h.holder.id, walletId: h.holderWallet.id, provider: "PLUGGY" },
    });
    await prisma.financialAccount.update({
      where: { id: h.checking.id },
      data: { connectionId: connection.id, externalId: "ext-corrente" },
    });
    await prisma.accountBalance.create({
      data: { accountId: h.checking.id, balance: "7212.35", asOf: new Date() },
    });
    await insertTransaction(h, { amount: "9850.00", occurredOn: "2026-11-01", description: "SAL" });
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    const [checking] = (
      await accountBalances(prisma, scope, { today: "2026-11-03", periodStart: "2026-11-01" })
    ).filter((a) => a.id === h.checking.id);
    expect(checking?.linked).toBe(true);
    expect(checking?.balance).toMatchObject({ source: "bank", today: 721235n, atStart: -263765n });
  });
});

// As travas gerais do banco, provadas contra o PostgreSQL de verdade. As que separam
// "quem paga" de "de quem é" estão em ownership.integration.test.ts.
//
// Por que testar o banco, se o código também vai validar? Porque o código muda, tem bug e
// pode ser chamado por um caminho esquecido (um script, um importador, uma action nova).
// Uma regra no banco vale para TODOS os caminhos. Cada teste abaixo tenta gravar algo
// errado e confere que o banco recusou, e pela regra certa (o nome do CHECK ou da chave).
//
// Rode com: pnpm test:integration   (precisa do Postgres no ar: pnpm db:up)
import { randomUUID } from "node:crypto";
import { dbDateFromCivil } from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromDbDecimalOrNull, toDbDecimal } from "../money";
import {
  createTestHousehold,
  dbError,
  deleteTestHousehold,
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

/** Dados mínimos de um lançamento válido na conta corrente pessoal. */
function tx(overrides: Record<string, unknown> = {}) {
  return {
    householdId: h.householdId,
    walletId: h.holderWallet.id,
    accountId: h.checking.id,
    method: "DEBIT" as const,
    amount: toDbDecimal(-4990n),
    occurredOn: dbDateFromCivil("2026-10-02"),
    description: "Mercado",
    ...overrides,
  };
}

describe("lançamento: idempotência da importação", () => {
  it("o mesmo externalId da mesma origem na mesma conta entra uma vez só", async () => {
    const imported = tx({ source: "OPEN_FINANCE", externalId: "pluggy-123" });
    await prisma.transaction.create({ data: imported });
    const error = await dbError(prisma.transaction.create({ data: imported }));
    expect(error).toMatch(/transaction_accountId_source_externalId_key|Unique constraint/);
  });

  it("lançamentos manuais (sem externalId) não colidem entre si", async () => {
    await prisma.transaction.create({ data: tx() });
    await prisma.transaction.create({ data: tx() });
    expect(await prisma.transaction.count({ where: { accountId: h.checking.id } })).toBe(2);
  });

  it("o mesmo externalId em outra conta é outro lançamento", async () => {
    await prisma.transaction.create({ data: tx({ source: "OFX", externalId: "FITID-1" }) });
    await prisma.transaction.create({
      data: tx({ accountId: h.card.id, method: "CREDIT", source: "OFX", externalId: "FITID-1" }),
    });
    expect(await prisma.transaction.count({ where: { externalId: "FITID-1" } })).toBe(2);
  });

  it("excluído logicamente continua ocupando a chave: reimportar não ressuscita duplicado", async () => {
    const imported = tx({ source: "OPEN_FINANCE", externalId: "pluggy-9" });
    const first = await prisma.transaction.create({ data: imported });
    await prisma.transaction.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    const error = await dbError(prisma.transaction.create({ data: imported }));
    expect(error).toMatch(/externalId|Unique constraint/);
  });
});

describe("lançamento: CHECKs", () => {
  it("valor zero é recusado", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: tx({ amount: toDbDecimal(0n) }) }),
    );
    expect(error).toMatch(/transaction_amount_not_zero_check/);
  });

  it("importado sem externalId é recusado", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: tx({ source: "OPEN_FINANCE" }) }),
    );
    expect(error).toMatch(/transaction_external_id_check/);
  });

  it("número de parcela sem grupo é recusado", async () => {
    const error = await dbError(prisma.transaction.create({ data: tx({ installmentNumber: 2 }) }));
    expect(error).toMatch(/transaction_installment_check/);
  });

  it("descrição vazia é recusada", async () => {
    const error = await dbError(prisma.transaction.create({ data: tx({ description: "" }) }));
    expect(error).toMatch(/transaction_description_length_check/);
  });
});

describe("conta e fatura: CHECKs", () => {
  it("cartão sem dia de fechamento é recusado", async () => {
    const error = await dbError(
      prisma.financialAccount.create({
        data: {
          householdId: h.householdId,
          walletId: h.holderWallet.id,
          name: "Cartão",
          kind: "CREDIT_CARD",
          dueDay: 5,
        },
      }),
    );
    expect(error).toMatch(/financial_account_card_days_check/);
  });

  it("conta corrente com dia de fechamento é recusada", async () => {
    const error = await dbError(
      prisma.financialAccount.create({
        data: {
          householdId: h.householdId,
          walletId: h.holderWallet.id,
          name: "Conta",
          kind: "CHECKING",
          closingDay: 3,
          dueDay: 10,
        },
      }),
    );
    expect(error).toMatch(/financial_account_card_days_check/);
  });

  it("fatura que vence antes de fechar é recusada", async () => {
    const error = await dbError(
      prisma.cardStatement.create({
        data: {
          accountId: h.card.id,
          referenceMonth: dbDateFromCivil("2026-10-01"),
          closingDate: dbDateFromCivil("2026-10-25"),
          dueDate: dbDateFromCivil("2026-10-05"),
        },
      }),
    );
    expect(error).toMatch(/card_statement_dates_check/);
  });
});

describe("orçamento", () => {
  async function category() {
    return prisma.category.create({
      data: { householdId: h.household.id, name: `Mercado ${randomUUID()}`, kind: "EXPENSE" },
    });
  }

  it("mês fora do dia 1 é recusado", async () => {
    const { id: categoryId } = await category();
    const error = await dbError(
      prisma.budget.create({
        data: {
          householdId: h.householdId,
          walletId: h.home.id,
          categoryId,
          month: dbDateFromCivil("2026-10-15"),
          amount: toDbDecimal(80000n),
        },
      }),
    );
    expect(error).toMatch(/budget_month_first_day_check/);
  });

  it("dois orçamentos para a mesma categoria no mesmo mês são recusados", async () => {
    const { id: categoryId } = await category();
    const data = {
      householdId: h.householdId,
      walletId: h.home.id,
      categoryId,
      month: dbDateFromCivil("2026-10-01"),
      amount: toDbDecimal(80000n),
    };
    await prisma.budget.create({ data });
    const error = await dbError(prisma.budget.create({ data }));
    expect(error).toMatch(/budget_walletId_categoryId_month_key|Unique constraint/);
  });
});

describe("dinheiro e datas no banco", () => {
  it("NUMERIC soma exato: 0,10 + 0,20 = 0,30 (com number daria 0,30000000000000004)", async () => {
    await prisma.transaction.create({ data: tx({ amount: toDbDecimal(10n) }) });
    await prisma.transaction.create({ data: tx({ amount: toDbDecimal(20n) }) });
    const { _sum } = await prisma.transaction.aggregate({
      where: { accountId: h.checking.id },
      _sum: { amount: true },
    });
    expect(fromDbDecimalOrNull(_sum.amount)).toBe(30n);
  });

  it("valor acima de NUMERIC(14,2) estoura no banco", async () => {
    const error = await dbError(
      prisma.$executeRaw`UPDATE "financial_account" SET "initialBalance" = 1000000000000 WHERE id = ${h.checking.id}::uuid`,
    );
    expect(error).toMatch(/numeric field overflow|22003/);
  });

  it("o dia 31 continua dia 31, qualquer que seja o fuso do processo", async () => {
    // O vitest.integration.config.mts roda este arquivo com TZ=America/Sao_Paulo de propósito
    const created = await prisma.transaction.create({
      data: tx({ occurredOn: dbDateFromCivil("2026-10-31") }),
    });
    const rows = await prisma.$queryRaw<{ day: string }[]>`
      SELECT to_char("occurredOn", 'YYYY-MM-DD') AS day FROM "transaction" WHERE id = ${created.id}::uuid`;
    expect(rows[0]?.day).toBe("2026-10-31");
  });
});

describe("apagar em cascata", () => {
  it("apagar o grupo apaga categorias pai e filha juntas (NoAction confere no fim)", async () => {
    const parent = await prisma.category.create({
      data: { householdId: h.household.id, name: "Moradia", kind: "EXPENSE" },
    });
    await prisma.category.create({
      data: { householdId: h.household.id, name: "Aluguel", kind: "EXPENSE", parentId: parent.id },
    });
    await prisma.household.delete({ where: { id: h.household.id } });
    expect(await prisma.category.count({ where: { householdId: h.household.id } })).toBe(0);
  });

  it("apagar só a categoria pai, com filhas, é recusado", async () => {
    const parent = await prisma.category.create({
      data: { householdId: h.household.id, name: "Transporte", kind: "EXPENSE" },
    });
    await prisma.category.create({
      data: { householdId: h.household.id, name: "Ônibus", kind: "EXPENSE", parentId: parent.id },
    });
    const error = await dbError(prisma.category.delete({ where: { id: parent.id } }));
    expect(error).toMatch(/category_parentId_fkey|Foreign key constraint/);
  });

  it("apagar o login da pessoa mantém os lançamentos e esvazia autor e titular (SetNull)", async () => {
    const created = await prisma.transaction.create({ data: tx({ createdById: h.holder.id }) });
    await prisma.user.delete({ where: { id: h.holder.id } });
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: created.id } });
    expect(kept.createdById).toBeNull();
    const account = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: h.checking.id },
    });
    expect(account.holderId).toBeNull();
    expect(await prisma.householdMember.count({ where: { userId: h.holder.id } })).toBe(0);
  });
});

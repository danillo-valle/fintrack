// "Quem paga" × "de quem é": as regras que separam a conta (e o cartão) do ambiente.
//
// O caso da vida real que motivou o modelo: a parceira compra no mercado com o cartão
// ADICIONAL dela, que cai na fatura da titular, e o gasto é da "Casa". O banco precisa
// aceitar isso e, ao mesmo tempo, recusar o que não faz sentido: conta ou ambiente de outro
// grupo, cartão de outra conta, crédito fora de cartão, gente de fora num ambiente.
//
// Rode com: pnpm test:integration   (precisa do Postgres no ar: pnpm db:up)
import { dbDateFromCivil } from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toDbDecimal } from "../money";
import {
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let other: TestHousehold;
beforeEach(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
});
afterEach(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
});

/** Compra de R$ 49,90 no mercado, pelo adicional da parceira, para a Casa. */
function purchase(overrides: Record<string, unknown> = {}) {
  return {
    householdId: h.householdId,
    walletId: h.home.id,
    accountId: h.card.id,
    cardId: h.additionalCard.id,
    method: "CREDIT" as const,
    amount: toDbDecimal(-4990n),
    occurredOn: dbDateFromCivil("2026-10-02"),
    description: "Mercado",
    createdById: h.partner.id,
    ...overrides,
  };
}

describe("quem paga × de quem é", () => {
  it("aceita a compra da Casa no adicional da parceira, que cai na fatura da titular", async () => {
    const created = await prisma.transaction.create({ data: purchase() });
    const read = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.id },
      include: { account: true, card: true, wallet: true },
    });
    expect(read.wallet.name).toBe("Casa"); // de quem é
    expect(read.account.holderId).toBe(h.holder.id); // quem paga a fatura
    expect(read.card?.holderId).toBe(h.partner.id); // quem passou o cartão
  });

  it("a fatura da titular soma as compras de todos os cartões dela, de qualquer ambiente", async () => {
    await prisma.transaction.create({ data: purchase() });
    await prisma.transaction.create({
      data: purchase({
        walletId: h.holderWallet.id,
        cardId: h.holderCard.id,
        amount: toDbDecimal(-1000n),
      }),
    });
    const byAccount = await prisma.transaction.aggregate({
      where: { accountId: h.card.id },
      _sum: { amount: true },
    });
    const byWallet = await prisma.transaction.aggregate({
      where: { walletId: h.home.id },
      _sum: { amount: true },
    });
    expect(byAccount._sum.amount?.toString()).toBe("-59.9"); // a fatura: as duas compras
    expect(byWallet._sum.amount?.toString()).toBe("-49.9"); // a Casa: só a dela
  });

  it("recusa ambiente de outro grupo", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ walletId: other.home.id }) }),
    );
    expect(error).toMatch(/transaction_walletId_householdId_fkey|Foreign key constraint/);
  });

  it("recusa conta de outro grupo", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ accountId: other.card.id, cardId: null }) }),
    );
    expect(error).toMatch(/transaction_accountId_householdId_fkey|Foreign key constraint/);
  });

  it("recusa cartão que não é daquela conta", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ cardId: other.additionalCard.id }) }),
    );
    expect(error).toMatch(/transaction_cardId_accountId_fkey|Foreign key constraint/);
  });

  it("recusa categoria de outro grupo", async () => {
    const foreign = await prisma.category.create({
      data: { householdId: other.householdId, name: "Mercado", kind: "EXPENSE" },
    });
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ categoryId: foreign.id }) }),
    );
    expect(error).toMatch(/transaction_categoryId_householdId_fkey|Foreign key constraint/);
  });

  it("recusa a compra apontando para a fatura de outro cartão", async () => {
    const otherStatement = await prisma.cardStatement.create({
      data: {
        accountId: other.card.id,
        referenceMonth: dbDateFromCivil("2026-10-01"),
        closingDate: dbDateFromCivil("2026-10-03"),
        dueDate: dbDateFromCivil("2026-10-09"),
      },
    });
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ statementId: otherStatement.id }) }),
    );
    expect(error).toMatch(/transaction_statementId_accountId_fkey|Foreign key constraint/);
  });
});

describe("forma de pagamento combina com a conta (gatilho)", () => {
  it("recusa crédito na conta corrente", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ accountId: h.checking.id, cardId: null }) }),
    );
    expect(error).toMatch(/transaction_method_matches_account/);
  });

  it("recusa PIX lançado na conta do cartão (o pagamento da fatura é transferência)", async () => {
    const error = await dbError(
      prisma.transaction.create({ data: purchase({ cardId: null, method: "PIX" }) }),
    );
    expect(error).toMatch(/transaction_method_matches_account/);
  });

  it("aceita o pagamento da fatura: transferência da conta corrente para a conta do cartão", async () => {
    const transferId = crypto.randomUUID();
    const leg = {
      householdId: h.householdId,
      walletId: h.holderWallet.id,
      method: "PIX" as const,
      transferId,
    };
    const day = dbDateFromCivil("2026-10-09");
    await prisma.transaction.createMany({
      data: [
        {
          ...leg,
          accountId: h.checking.id,
          amount: toDbDecimal(-59900n),
          occurredOn: day,
          description: "Pagamento fatura",
        },
        {
          ...leg,
          accountId: h.card.id,
          amount: toDbDecimal(59900n),
          occurredOn: day,
          description: "Pagamento fatura",
        },
      ],
    });
    expect(await prisma.transaction.count({ where: { transferId } })).toBe(2);
  });

  it("vale-refeição: aceita VOUCHER e a recarga (DEPOSIT); recusa VOUCHER em outra conta", async () => {
    const base = {
      householdId: h.householdId,
      walletId: h.partnerWallet.id,
      occurredOn: dbDateFromCivil("2026-10-02"),
    };
    await prisma.transaction.create({
      data: {
        ...base,
        accountId: h.voucher.id,
        method: "VOUCHER",
        amount: toDbDecimal(-3500n),
        description: "Almoço",
      },
    });
    await prisma.transaction.create({
      data: {
        ...base,
        accountId: h.voucher.id,
        method: "DEPOSIT",
        amount: toDbDecimal(80000n),
        description: "Recarga",
      },
    });
    const error = await dbError(
      prisma.transaction.create({
        data: {
          ...base,
          accountId: h.checking.id,
          method: "VOUCHER",
          amount: toDbDecimal(-3500n),
          description: "Almoço",
        },
      }),
    );
    expect(error).toMatch(/transaction_method_matches_account/);
  });

  it("recusa cartão com forma de pagamento que não usa cartão (CHECK)", async () => {
    // Num cartão de débito da conta corrente, para isolar o CHECK: na conta do cartão de
    // crédito, o gatilho recusaria antes (gatilhos BEFORE rodam antes dos CHECKs).
    const debitCard = await prisma.paymentCard.create({
      data: {
        accountId: h.checking.id,
        holderId: h.holder.id,
        nickname: "Débito",
        brand: "Visa",
        lastFour: "3333",
        form: "PHYSICAL",
      },
    });
    const error = await dbError(
      prisma.transaction.create({
        data: purchase({ accountId: h.checking.id, cardId: debitCard.id, method: "PIX" }),
      }),
    );
    expect(error).toMatch(/transaction_card_method_check/);
  });
});

describe("ambientes e cartões", () => {
  it("só membro do grupo entra num ambiente do grupo", async () => {
    const error = await dbError(
      prisma.walletMember.create({
        data: {
          householdId: h.householdId,
          walletId: h.home.id,
          userId: other.holder.id,
          role: "VIEWER",
        },
      }),
    );
    expect(error).toMatch(/wallet_member_householdId_userId_fkey|Foreign key constraint/);
  });

  it("quem sai do grupo sai de todos os ambientes dele", async () => {
    await prisma.householdMember.delete({
      where: { householdId_userId: { householdId: h.householdId, userId: h.partner.id } },
    });
    expect(await prisma.walletMember.count({ where: { userId: h.partner.id } })).toBe(0);
  });

  it("recusa o número completo do cartão: só os 4 últimos dígitos", async () => {
    const card = {
      accountId: h.card.id,
      nickname: "Novo",
      brand: "Visa",
      form: "VIRTUAL" as const,
    };
    for (const lastFour of ["1003 4567", "54a8", "123"]) {
      const error = await dbError(prisma.paymentCard.create({ data: { ...card, lastFour } }));
      expect(error).toMatch(/payment_card_last_four_check|too long|value too long/);
    }
  });

  it("cartão com compras não pode ser apagado: arquiva", async () => {
    await prisma.transaction.create({ data: purchase() });
    const error = await dbError(prisma.paymentCard.delete({ where: { id: h.additionalCard.id } }));
    expect(error).toMatch(/transaction_cardId_accountId_fkey|Foreign key constraint/);
    const archived = await prisma.paymentCard.update({
      where: { id: h.additionalCard.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.archivedAt).not.toBeNull();
  });

  it("apagar o grupo apaga tudo dele, mesmo com cartões e categorias em uso", async () => {
    const category = await prisma.category.create({
      data: { householdId: h.householdId, name: "Mercado", kind: "EXPENSE" },
    });
    await prisma.transaction.create({ data: purchase({ categoryId: category.id }) });
    await prisma.household.delete({ where: { id: h.household.id } });
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(0);
    expect(await prisma.paymentCard.count({ where: { accountId: h.card.id } })).toBe(0);
  });
});

describe("recorrências", () => {
  function recurrence(overrides: Record<string, unknown> = {}) {
    return {
      householdId: h.householdId,
      walletId: h.home.id,
      accountId: h.checking.id,
      kind: "FIXED_BILL" as const,
      method: "DEBIT" as const,
      description: "Internet",
      amount: toDbDecimal(-11990n),
      dayOfMonth: 18,
      startsOn: dbDateFromCivil("2026-01-01"),
      ...overrides,
    };
  }

  it("aceita conta fixa e assinatura no cartão virtual; o lançamento aponta para ela", async () => {
    const internet = await prisma.recurrence.create({ data: recurrence() });
    const netflix = await prisma.recurrence.create({
      data: recurrence({
        kind: "SUBSCRIPTION",
        accountId: h.card.id,
        cardId: h.holderCard.id,
        method: "CREDIT",
        description: "Streaming",
        amount: toDbDecimal(-5590n),
        dayOfMonth: 12,
      }),
    });
    const tx = await prisma.transaction.create({
      data: purchase({
        recurrenceId: netflix.id,
        source: "RECURRENCE",
        externalId: `${netflix.id}:2026-10`,
      }),
    });
    expect(tx.recurrenceId).toBe(netflix.id);
    expect(internet.kind).toBe("FIXED_BILL");
  });

  it("recusa dia 32, valor zero e fim antes do início", async () => {
    for (const bad of [
      { dayOfMonth: 32 },
      { amount: toDbDecimal(0n) },
      { endsOn: dbDateFromCivil("2025-12-31") },
    ]) {
      const error = await dbError(prisma.recurrence.create({ data: recurrence(bad) }));
      expect(error).toMatch(/recurrence_rules_check/);
    }
  });

  it("apagar a recorrência mantém os lançamentos que ela gerou", async () => {
    const internet = await prisma.recurrence.create({ data: recurrence() });
    const tx = await prisma.transaction.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        accountId: h.checking.id,
        method: "DEBIT",
        amount: toDbDecimal(-11990n),
        occurredOn: dbDateFromCivil("2026-10-18"),
        description: "Internet",
        status: "SCHEDULED",
        source: "RECURRENCE",
        externalId: `${internet.id}:2026-10`,
        recurrenceId: internet.id,
      },
    });
    await prisma.recurrence.delete({ where: { id: internet.id } });
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(kept.recurrenceId).toBeNull();
    expect(kept.status).toBe("SCHEDULED");
  });
});

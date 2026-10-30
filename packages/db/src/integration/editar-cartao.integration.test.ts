// Editar cartão (M13.1) contra o Postgres: o que muda, quem pode, a regra do ambiente de entrada
// e os recebidos que vão para o lugar novo.
//
// Rode com: pnpm test:integration
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeWallet, DomainError, type WalletGrant } from "../access";
import { householdWalletOptions, updateCard, type CardUpdateInput } from "../accounts";
import {
  createLoosePerson,
  createTestHousehold,
  deletePeople,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
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

async function manage(userId: string, walletId: string): Promise<WalletGrant<"manage_accounts">> {
  const access = await authorizeWallet(prisma, userId, walletId, "manage_accounts");
  if (!access.ok) throw new Error(`esperava manage_accounts, veio ${access.reason}`);
  return access.grant;
}

/** O cartão adicional da parceira como está no fixture, com as mudanças pedidas. */
function input(patch: Partial<CardUpdateInput> = {}): CardUpdateInput {
  return {
    nickname: "Adicional",
    brand: "Mastercard",
    form: "PHYSICAL",
    holderId: h.partner.id,
    isAdditional: true,
    sharedPurchases: false,
    importWalletId: null,
    ...patch,
  };
}

/** Um recebido do banco no cartão adicional, no ambiente pedido. */
function received(walletId: string, status: "PENDING" | "CONFIRMED" = "PENDING") {
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId,
      accountId: h.card.id,
      cardId: h.additionalCard.id,
      method: "CREDIT",
      amount: "-12.34",
      occurredOn: new Date("2026-10-10T00:00:00Z"),
      description: "compra sintética",
      status,
      source: "OPEN_FINANCE",
      externalId: `ext-${randomUUID()}`,
      providerCardLastFour: "2222",
    },
  });
}

describe("editar cartão", () => {
  it("muda apelido, tipo, portador e conjunta; o final não muda; audita só os nomes dos campos", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    await updateCard(
      prisma,
      grant,
      h.holderCard.id,
      {
        nickname: "Master da casa",
        brand: "Mastercard",
        form: "VIRTUAL",
        holderId: h.partner.id,
        isAdditional: true,
        sharedPurchases: true,
        importWalletId: h.home.id,
      },
      TEST_CTX,
    );
    const card = await prisma.paymentCard.findUniqueOrThrow({ where: { id: h.holderCard.id } });
    expect([
      card.nickname,
      card.form,
      card.holderId,
      card.isAdditional,
      card.sharedPurchases,
      card.importWalletId,
      card.lastFour,
    ]).toEqual(["Master da casa", "VIRTUAL", h.partner.id, true, true, h.home.id, "1111"]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "card.updated" },
    });
    const metadata = audit.metadata as { changed: string[]; moved: number };
    expect(metadata.changed.toSorted()).toEqual(
      [
        "form",
        "holderId",
        "importWalletId",
        "isAdditional",
        "nickname",
        "sharedPurchases",
      ].toSorted(),
    );
    // Nada de final, apelido ou nome de pessoa na auditoria
    expect(JSON.stringify(audit.metadata)).not.toMatch(/1111|Master da casa|parceira/);
  });

  it("cartão de outra carteira, arquivado ou inventado: NOT_FOUND igual (IDOR)", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    const otherCard = await prisma.paymentCard.findFirstOrThrow({
      where: { account: { householdId: other.householdId } },
    });
    await prisma.paymentCard.update({
      where: { id: h.additionalCard.id },
      data: { archivedAt: new Date() },
    });
    for (const id of [otherCard.id, h.additionalCard.id, randomUUID()]) {
      const error = await updateCard(prisma, grant, id, input(), TEST_CTX).catch((e) => e);
      expect((error as DomainError).code).toBe("NOT_FOUND");
    }
    // E o cartão de fora continua como estava
    const after = await prisma.paymentCard.findUniqueOrThrow({ where: { id: otherCard.id } });
    expect(after.holderId).toBe(otherCard.holderId);
  });

  it("portador de fora do lar: recusa e nada muda", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    const outsider = await createLoosePerson("fora");
    try {
      const error = await updateCard(
        prisma,
        grant,
        h.additionalCard.id,
        input({ holderId: outsider.id }),
        TEST_CTX,
      ).catch((e) => e);
      expect((error as DomainError).code).toBe("CARD_HOLDER_OUTSIDE_HOUSEHOLD");
    } finally {
      await deletePeople([outsider.id]);
    }
    const card = await prisma.paymentCard.findUniqueOrThrow({ where: { id: h.additionalCard.id } });
    expect(card.holderId).toBe(h.partner.id);
  });

  it("ambiente de entrada: só um do lar, ativo, de que o portador participa", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    // O pessoal do titular não tem a parceira (a portadora)
    const without = await updateCard(
      prisma,
      grant,
      h.additionalCard.id,
      input({ importWalletId: h.holderWallet.id }),
      TEST_CTX,
    ).catch((e) => e);
    expect((without as DomainError).code).toBe("CARD_WALLET_WITHOUT_HOLDER");
    // Um ambiente de outro lar responde como inexistente
    const foreign = await updateCard(
      prisma,
      grant,
      h.additionalCard.id,
      input({ importWalletId: other.home.id }),
      TEST_CTX,
    ).catch((e) => e);
    expect((foreign as DomainError).code).toBe("NOT_FOUND");
    // Arquivado também
    await prisma.wallet.update({ where: { id: h.home.id }, data: { archivedAt: new Date() } });
    const archived = await updateCard(
      prisma,
      grant,
      h.additionalCard.id,
      input({ importWalletId: h.home.id }),
      TEST_CTX,
    ).catch((e) => e);
    expect((archived as DomainError).code).toBe("NOT_FOUND");
  });

  it("os recebidos não confirmados vão para o ambiente novo; os confirmados e os movidos à mão ficam", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    // Padrão do adicional da parceira: o pessoal dela
    const pending = await received(h.partnerWallet.id);
    const confirmed = await received(h.partnerWallet.id, "CONFIRMED");
    const movedByHand = await received(h.holderWallet.id);
    const result = await updateCard(
      prisma,
      grant,
      h.additionalCard.id,
      input({ sharedPurchases: true, importWalletId: h.home.id }),
      TEST_CTX,
    );
    expect(result.moved).toBe(1);
    const walletOf = async (id: string) =>
      (await prisma.transaction.findUniqueOrThrow({ where: { id } })).walletId;
    expect(await walletOf(pending.id)).toBe(h.home.id);
    expect(await walletOf(confirmed.id)).toBe(h.partnerWallet.id);
    expect(await walletOf(movedByHand.id)).toBe(h.holderWallet.id);

    // Voltar ao padrão leva de volta
    const back = await updateCard(prisma, grant, h.additionalCard.id, input(), TEST_CTX);
    expect(back.moved).toBe(1);
    expect(await walletOf(pending.id)).toBe(h.partnerWallet.id);
  });

  it("escolher o ambiente que o padrão já dá grava o padrão (nulo)", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    // O adicional da parceira: o padrão é o pessoal dela
    await updateCard(
      prisma,
      grant,
      h.additionalCard.id,
      input({ importWalletId: h.partnerWallet.id }),
      TEST_CTX,
    );
    const card = await prisma.paymentCard.findUniqueOrThrow({ where: { id: h.additionalCard.id } });
    expect(card.importWalletId).toBeNull();
  });

  it("nada mudou: grava a auditoria com a lista vazia e não move nada", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    const pending = await received(h.partnerWallet.id);
    const result = await updateCard(prisma, grant, h.additionalCard.id, input(), TEST_CTX);
    expect(result.moved).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "card.updated" },
    });
    expect((audit.metadata as { changed: string[] }).changed).toEqual([]);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: pending.id } })).walletId,
    ).toBe(h.partnerWallet.id);
  });

  it("a lista de ambientes de entrada traz quem participa de cada um", async () => {
    const options = await householdWalletOptions(prisma, h.householdId);
    const casa = options.find((w) => w.id === h.home.id);
    expect(casa?.memberIds.toSorted()).toEqual([h.holder.id, h.partner.id].toSorted());
    expect(options.some((w) => w.id === other.home.id)).toBe(false);
  });
});

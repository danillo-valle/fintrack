// Peças comuns dos testes de integração: criam um grupo completo e isolado para cada teste
// e o apagam no fim. Cada teste usa ids e e-mails próprios, então os testes podem rodar
// juntos e no mesmo banco do desenvolvimento sem esbarrar nos dados do seed nem do E2E.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../index";

export { prisma };

/**
 * Um grupo mínimo com a estrutura da vida real:
 *   pessoas: titular (dono do cartão) e parceira (portadora do adicional)
 *   ambientes: pessoal da titular, pessoal da parceira e "Casa" (compartilhado)
 *   contas: conta corrente da titular; fatura do cartão da titular (fecha 3, vence 9) com
 *           um cartão físico dela e um adicional da parceira; vale-refeição da parceira
 */
export type TestHousehold = Awaited<ReturnType<typeof createTestHousehold>>;

export async function createTestHousehold() {
  const tag = randomUUID().slice(0, 8);
  const [holder, partner] = await Promise.all(
    ["titular", "parceira"].map((who) =>
      prisma.user.create({
        data: { id: randomUUID(), name: `${who} ${tag}`, email: `it-${who}-${tag}@fintrack.test` },
      }),
    ),
  );
  if (!holder || !partner) throw new Error("falha ao criar as pessoas do teste");

  const household = await prisma.household.create({
    data: {
      name: `Grupo ${tag}`,
      members: {
        create: [
          { userId: holder.id, role: "OWNER" },
          { userId: partner.id, role: "MEMBER" },
        ],
      },
    },
  });
  const householdId = household.id;

  const wallet = (name: string, kind: "PERSONAL" | "SHARED", userIds: string[]) =>
    prisma.wallet.create({
      data: {
        householdId,
        name,
        kind,
        createdById: userIds[0] ?? null,
        // householdId não vai aqui: o Prisma copia do ambiente (faz parte da chave composta)
        members: { create: userIds.map((userId) => ({ userId, role: "OWNER" as const })) },
      },
    });
  const holderWallet = await wallet("Titular", "PERSONAL", [holder.id]);
  const partnerWallet = await wallet("Parceira", "PERSONAL", [partner.id]);
  const home = await wallet("Casa", "SHARED", [holder.id, partner.id]);

  const checking = await prisma.financialAccount.create({
    data: {
      householdId,
      walletId: holderWallet.id,
      holderId: holder.id,
      name: "Conta",
      kind: "CHECKING",
    },
  });
  const card = await prisma.financialAccount.create({
    data: {
      householdId,
      walletId: holderWallet.id,
      holderId: holder.id,
      name: "Cartão Master",
      kind: "CREDIT_CARD",
      closingDay: 3,
      dueDay: 9,
    },
  });
  const voucher = await prisma.financialAccount.create({
    data: {
      householdId,
      walletId: partnerWallet.id,
      holderId: partner.id,
      name: "Vale",
      kind: "MEAL_VOUCHER",
    },
  });
  const holderCard = await prisma.paymentCard.create({
    data: {
      accountId: card.id,
      holderId: holder.id,
      nickname: "Físico",
      brand: "Mastercard",
      lastFour: "1111",
      form: "PHYSICAL",
    },
  });
  const additionalCard = await prisma.paymentCard.create({
    data: {
      accountId: card.id,
      holderId: partner.id,
      nickname: "Adicional",
      brand: "Mastercard",
      lastFour: "2222",
      form: "PHYSICAL",
      isAdditional: true,
    },
  });
  return {
    tag,
    householdId,
    holder,
    partner,
    household,
    holderWallet,
    partnerWallet,
    home,
    checking,
    card,
    voucher,
    holderCard,
    additionalCard,
  };
}

/** Apaga o grupo (e, em cascata, tudo dele) e as pessoas de teste. */
export async function deleteTestHousehold(h: TestHousehold | undefined) {
  if (!h) return;
  await prisma.household.deleteMany({ where: { id: h.household.id } });
  await prisma.user.deleteMany({ where: { id: { in: [h.holder.id, h.partner.id] } } });
}

/**
 * Espera a promessa falhar com um erro do banco e devolve a mensagem completa,
 * para o teste conferir QUAL regra recusou (o nome do CHECK, da chave ou do gatilho).
 */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    // O erro do Prisma traz a causa do driver; juntamos tudo num texto só para procurar
    return JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error);
  }
  throw new Error("Era para o banco recusar, mas a operação passou");
}

/** Cliente "pg" direto, para testes que precisam de BEGIN/ROLLBACK na mão. */
export async function withPgClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ── Peças do M06 (permissões) ─────────────────────────────────────────────────

/** Contexto de requisição falso: a auditoria grava IP e navegador. */
export const TEST_CTX = { ip: "203.0.113.7", userAgent: "vitest" };

/** Uma pessoa avulsa, sem lar (para testar convite e "gente de fora"). */
export async function createLoosePerson(label: string) {
  const tag = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: { id: randomUUID(), name: `${label} ${tag}`, email: `it-${label}-${tag}@fintrack.test` },
  });
}

/** Apaga pessoas avulsas (e, em cascata, os lares em que só elas estavam não somem: limpe antes). */
export async function deletePeople(ids: string[]) {
  await prisma.householdMember.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Eventos de auditoria de um lar, do mais antigo para o mais novo. */
export async function auditActions(householdId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { householdId },
    orderBy: { id: "asc" },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

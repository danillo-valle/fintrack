// Limite de tentativas para as nossas próprias actions (a reautenticação).
//
// O limite do Better Auth (rateLimit no auth.ts) vale para as requisições a /api/auth/*.
// Uma Server Action que confere senha chama o Better Auth por dentro, sem passar por esse
// limite. Sem um limite aqui, quem roubasse o cookie poderia testar senhas sem parar.
//
// Usa a tabela rateLimit que o próprio Better Auth criou, com chaves de prefixo próprio.
import { prisma } from "@fintrack/db";
import { randomUUID } from "node:crypto";

export type AttemptRule = { max: number; windowMs: number };

/** Quantas falhas ainda restam na janela atual (0 = bloqueado até a janela acabar). */
export async function remainingAttempts(key: string, rule: AttemptRule, now = Date.now()) {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || now - Number(row.lastRequest) > rule.windowMs) return rule.max;
  return Math.max(0, rule.max - row.count);
}

/** Registra uma falha. A janela recomeça se a anterior já acabou. */
export async function recordFailure(key: string, rule: AttemptRule, now = Date.now()) {
  const row = await prisma.rateLimit.findUnique({ where: { key } });
  if (!row || now - Number(row.lastRequest) > rule.windowMs) {
    await prisma.rateLimit.upsert({
      where: { key },
      create: { id: randomUUID(), key, count: 1, lastRequest: BigInt(now) },
      update: { count: 1, lastRequest: BigInt(now) },
    });
    return;
  }
  await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
}

/** Zera o contador depois de um acerto. */
export async function clearFailures(key: string) {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

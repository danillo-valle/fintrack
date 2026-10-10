/*
  Warnings:

  - A unique constraint covering the columns `[id,householdId]` on the table `budget` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "budget_share" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "userId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_share_householdId_userId_idx" ON "budget_share"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_share_budgetId_userId_key" ON "budget_share"("budgetId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_id_householdId_key" ON "budget"("id", "householdId");

-- AddForeignKey
ALTER TABLE "budget_share" ADD CONSTRAINT "budget_share_budgetId_householdId_fkey" FOREIGN KEY ("budgetId", "householdId") REFERENCES "budget"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_share" ADD CONSTRAINT "budget_share_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M08). O schema.prisma não sabe escrever CHECK nem índice parcial; o
-- Prisma não as enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/orcamento.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- A parte de uma pessoa nunca é negativa (zero vale: "o Caio não gasta com isto")
ALTER TABLE "budget_share" ADD CONSTRAINT "budget_share_amount_check"
  CHECK ("amount" >= 0);

-- Um Compartilhado por orçado. A chave única (budgetId, userId) não pega este caso: no Postgres,
-- dois nulos não colidem. O índice parcial vale só para as linhas com userId nulo.
CREATE UNIQUE INDEX "budget_share_shared_once" ON "budget_share"("budgetId") WHERE "userId" IS NULL;

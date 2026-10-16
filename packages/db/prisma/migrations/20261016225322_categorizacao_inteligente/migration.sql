-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "categorization_source" ADD VALUE 'PROVIDER';
ALTER TYPE "categorization_source" ADD VALUE 'CLASSIFIER';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "categorizationConfidence" SMALLINT;

-- CreateTable
CREATE TABLE "classifier_model" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "exampleCount" INTEGER NOT NULL,
    "categoryCount" SMALLINT NOT NULL,
    "trainingHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classifier_model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classifier_model_walletId_key" ON "classifier_model"("walletId");

-- CreateIndex
CREATE INDEX "classifier_model_householdId_idx" ON "classifier_model"("householdId");

-- AddForeignKey
ALTER TABLE "classifier_model" ADD CONSTRAINT "classifier_model_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifier_model" ADD CONSTRAINT "classifier_model_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M10.1, ADR-015). Cada uma tem um teste em
-- packages/db/src/integration/classificador.integration.test.ts que tenta quebrá-la.
-- Os valores novos do enum ('PROVIDER', 'CLASSIFIER') não podem ser usados nesta mesma transação
-- (o Postgres recusa um valor de enum recém-criado antes do commit): por isso "<> 'MANUAL'".
-- ═════════════════════════════════════════════════════════════════════════════

-- A confiança é da camada automática que decidiu: de 0 a 100, nunca numa escolha da pessoa
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_categorization_confidence_check"
  CHECK ("categorizationConfidence" IS NULL OR (
    "categorizationConfidence" BETWEEN 0 AND 100
    AND "categorizedBy" IS NOT NULL AND "categorizedBy" <> 'MANUAL'));

-- Um modelo só existe com exemplos bastantes (o serviço recusa menos de 20 ou uma categoria só)
ALTER TABLE "classifier_model" ADD CONSTRAINT "classifier_model_counts_check"
  CHECK ("exampleCount" >= 20 AND "categoryCount" >= 2 AND "categoryCount" <= "exampleCount");

-- A impressão digital do treino é um SHA-256 em hexadecimal minúsculo
ALTER TABLE "classifier_model" ADD CONSTRAINT "classifier_model_training_hash_check"
  CHECK ("trainingHash" ~ '^[0-9a-f]{64}$');

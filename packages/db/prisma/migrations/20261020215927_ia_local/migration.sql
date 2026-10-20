-- CreateEnum
CREATE TYPE "local_ai_outcome" AS ENUM ('SUGGESTED', 'NEW_CATEGORY', 'NO_SUGGESTION', 'BLOCKED', 'INVALID');

-- AlterEnum
ALTER TYPE "categorization_source" ADD VALUE 'LLM';

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "localAiEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "local_ai_attempt" (
    "transactionId" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "outcome" "local_ai_outcome" NOT NULL,
    "proposedName" TEXT,
    "proposedParentId" UUID,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_ai_attempt_pkey" PRIMARY KEY ("transactionId")
);

-- CreateIndex
CREATE INDEX "local_ai_attempt_householdId_attemptedAt_idx" ON "local_ai_attempt"("householdId", "attemptedAt");

-- AddForeignKey
ALTER TABLE "local_ai_attempt" ADD CONSTRAINT "local_ai_attempt_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_ai_attempt" ADD CONSTRAINT "local_ai_attempt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_ai_attempt" ADD CONSTRAINT "local_ai_attempt_proposedParentId_householdId_fkey" FOREIGN KEY ("proposedParentId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M10.2b, ADR-016). Cada uma tem um teste em
-- packages/db/src/integration/ia-local.integration.test.ts que tenta quebrá-la.
-- O valor novo 'LLM' de categorization_source não é usado aqui (o Postgres recusa um valor de
-- enum recém-acrescentado antes do commit); o tipo local_ai_outcome é novo, e esse pode.
-- ═════════════════════════════════════════════════════════════════════════════

-- A proposta de categoria nova existe só num NEW_CATEGORY, e todo NEW_CATEGORY tem nome
ALTER TABLE "local_ai_attempt" ADD CONSTRAINT "local_ai_attempt_proposal_check"
  CHECK (("outcome" = 'NEW_CATEGORY') = ("proposedName" IS NOT NULL)
    AND ("proposedParentId" IS NULL OR "outcome" = 'NEW_CATEGORY'));

-- O nome proposto: de 1 a 3 palavras, só letras (com acento) e um espaço entre elas, até 30
-- caracteres. O mesmo padrão que o schema da IA impõe (services/ml/app/ia_local.py, NOME_NOVO)
ALTER TABLE "local_ai_attempt" ADD CONSTRAINT "local_ai_attempt_proposed_name_check"
  CHECK ("proposedName" IS NULL OR (
    char_length("proposedName") <= 30
    AND "proposedName" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ]{2,20}( [A-Za-zÀ-ÖØ-öø-ÿ]{1,20}){0,2}$'));

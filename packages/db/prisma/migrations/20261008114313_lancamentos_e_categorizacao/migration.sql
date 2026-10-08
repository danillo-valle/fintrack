-- CreateEnum
CREATE TYPE "categorization_source" AS ENUM ('MANUAL', 'RULE', 'HISTORY');

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "categorizedBy" "categorization_source";

-- CreateTable
CREATE TABLE "categorization_example" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "transactionId" UUID,
    "description" TEXT NOT NULL,
    "isExpense" BOOLEAN NOT NULL,
    "fromCategoryId" UUID,
    "fromSource" "categorization_source",
    "toCategoryId" UUID NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorization_example_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categorization_example_householdId_createdAt_idx" ON "categorization_example"("householdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "categorization_example_transactionId_idx" ON "categorization_example"("transactionId");

-- CreateIndex
CREATE INDEX "categorization_example_toCategoryId_idx" ON "categorization_example"("toCategoryId");

-- CreateIndex
CREATE INDEX "categorization_example_fromCategoryId_idx" ON "categorization_example"("fromCategoryId");

-- CreateIndex
CREATE INDEX "categorization_example_createdById_idx" ON "categorization_example"("createdById");

-- AddForeignKey
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_toCategoryId_householdId_fkey" FOREIGN KEY ("toCategoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_fromCategoryId_householdId_fkey" FOREIGN KEY ("fromCategoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M07). O schema.prisma não sabe escrever CHECK; o Prisma não as
-- enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/lancamentos.integration.test.ts que tenta quebrá-la.
-- Todas valem para os dados que já existem (seed e produção): só acrescentam.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Lançamento ───────────────────────────────────────────────────────────────

-- "Quem categorizou" só existe se houver categoria. (O contrário pode faltar: lançamentos
-- anteriores ao M07 têm categoria e categorizedBy nulo.)
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_categorized_by_check"
  CHECK ("categorizedBy" IS NULL OR "categoryId" IS NOT NULL);

-- Transferência não tem categoria: é dinheiro que só mudou de conta, não gasto nem receita.
-- (O seed do M04 já grava as transferências assim.)
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_category_check"
  CHECK ("transferId" IS NULL OR "categoryId" IS NULL);

-- ── Exemplo de treino ────────────────────────────────────────────────────────

-- A descrição como a do lançamento: de 1 a 200 caracteres
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_description_check"
  CHECK (char_length("description") BETWEEN 1 AND 200);

-- Um exemplo registra uma CORREÇÃO: a categoria escolhida é diferente da que estava
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_change_check"
  CHECK ("fromCategoryId" IS NULL OR "fromCategoryId" <> "toCategoryId");

-- Quem tinha decidido só existe se havia uma categoria antes
ALTER TABLE "categorization_example" ADD CONSTRAINT "categorization_example_source_check"
  CHECK ("fromSource" IS NULL OR "fromCategoryId" IS NOT NULL);

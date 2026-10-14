-- CreateEnum
CREATE TYPE "match_kind" AS ENUM ('SAME', 'INSTALLMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('CONFIRMED', 'REJECTED', 'UNDONE');

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "providerCardLastFour" CHAR(4),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "transaction_match" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "receivedId" UUID NOT NULL,
    "ownId" UUID NOT NULL,
    "kind" "match_kind" NOT NULL,
    "status" "match_status" NOT NULL,
    "receivedBefore" JSONB,
    "ownBefore" JSONB,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "transaction_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_match_receivedId_idx" ON "transaction_match"("receivedId");

-- CreateIndex
CREATE INDEX "transaction_match_ownId_idx" ON "transaction_match"("ownId");

-- CreateIndex
CREATE INDEX "transaction_match_householdId_decidedAt_idx" ON "transaction_match"("householdId", "decidedAt" DESC);

-- CreateIndex
CREATE INDEX "transaction_mergedIntoId_idx" ON "transaction"("mergedIntoId");

-- CreateIndex
CREATE INDEX "transaction_reversalOfId_idx" ON "transaction"("reversalOfId");

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_receivedId_fkey" FOREIGN KEY ("receivedId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_ownId_fkey" FOREIGN KEY ("ownId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M09.2, ADR-012). O schema.prisma não sabe escrever CHECK; o Prisma não
-- as enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/revisao.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- O final do cartão que o banco mandou: só os 4 últimos dígitos, nunca o número completo
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_provider_card_last_four_check"
  CHECK ("providerCardLastFour" IS NULL OR "providerCardLastFour" ~ '^[0-9]{4}$');

-- Quem revisou só existe junto com quando (a pessoa apagada vira nulo, o quando fica)
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_reviewed_check"
  CHECK ("reviewedById" IS NULL OR "reviewedAt" IS NOT NULL);

-- O seu lançamento juntado ao recebido fica apagado, e nunca aponta para si mesmo
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_merged_check"
  CHECK ("mergedIntoId" IS NULL OR ("deletedAt" IS NOT NULL AND "mergedIntoId" <> "id"));

-- Um par liga dois lançamentos diferentes
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_sides_check"
  CHECK ("receivedId" <> "ownId");

-- "Desfeito" anda junto com o momento em que foi desfeito
ALTER TABLE "transaction_match" ADD CONSTRAINT "transaction_match_undone_check"
  CHECK (("status" = 'UNDONE') = ("undoneAt" IS NOT NULL));

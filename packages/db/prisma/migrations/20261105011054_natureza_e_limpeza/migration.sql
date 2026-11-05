-- CreateEnum
CREATE TYPE "expense_nature" AS ENUM ('FIXED', 'VARIABLE');

-- AlterTable
ALTER TABLE "category" ADD COLUMN     "defaultNature" "expense_nature" NOT NULL DEFAULT 'VARIABLE';

-- AlterTable
ALTER TABLE "category_rule" ADD COLUMN     "nature" "expense_nature";

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "nature" "expense_nature";

-- CreateTable
CREATE TABLE "category_cleanup" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "before" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "category_cleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_cleanup_householdId_createdAt_idx" ON "category_cleanup"("householdId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "category_cleanup" ADD CONSTRAINT "category_cleanup_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_cleanup" ADD CONSTRAINT "category_cleanup_categoryId_householdId_fkey" FOREIGN KEY ("categoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_cleanup" ADD CONSTRAINT "category_cleanup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══ Regras escritas à mão (M13.3b, ADR-026): o Prisma não gera CHECK ═══

-- A marca fixa/variável só existe numa despesa que não é parcela nem transferência: a parcela é
-- sempre parcela, e a transferência não é gasto
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_nature_check" CHECK (
  "nature" IS NULL
  OR ("installmentGroupId" IS NULL AND "providerInstallmentCount" IS NULL AND "transferId" IS NULL)
);

-- A limpeza sempre trata pelo menos um lançamento, e o Desfazer vem depois dela
ALTER TABLE "category_cleanup" ADD CONSTRAINT "category_cleanup_count_check" CHECK ("transactionCount" > 0);
ALTER TABLE "category_cleanup" ADD CONSTRAINT "category_cleanup_undone_check" CHECK (
  "undoneAt" IS NULL OR "undoneAt" >= "createdAt"
);

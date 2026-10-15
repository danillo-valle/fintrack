-- CreateEnum
CREATE TYPE "file_import_kind" AS ENUM ('OFX');

-- CreateEnum
CREATE TYPE "file_import_status" AS ENUM ('PREVIEW', 'IMPORTED');

-- CreateEnum
CREATE TYPE "file_statement_kind" AS ENUM ('BANK', 'CREDIT_CARD');

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "fileImportId" UUID;

-- CreateTable
CREATE TABLE "file_import" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" TEXT,
    "accountId" UUID,
    "kind" "file_import_kind" NOT NULL,
    "status" "file_import_status" NOT NULL DEFAULT 'PREVIEW',
    "sha256" CHAR(64) NOT NULL,
    "fileName" TEXT NOT NULL,
    "statementKind" "file_statement_kind" NOT NULL,
    "institution" TEXT,
    "bankId" TEXT,
    "accountLastFour" CHAR(4),
    "periodFrom" DATE,
    "periodTo" DATE,
    "rowCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "pluggyCount" INTEGER NOT NULL DEFAULT 0,
    "alreadyImportedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "preview" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "file_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_import_householdId_sha256_idx" ON "file_import"("householdId", "sha256");

-- CreateIndex
CREATE INDEX "file_import_householdId_createdAt_idx" ON "file_import"("householdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "file_import_userId_idx" ON "file_import"("userId");

-- CreateIndex
CREATE INDEX "file_import_accountId_idx" ON "file_import"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "file_import_id_householdId_key" ON "file_import"("id", "householdId");

-- CreateIndex
CREATE INDEX "transaction_fileImportId_idx" ON "transaction"("fileImportId");

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_accountId_householdId_fkey" FOREIGN KEY ("accountId", "householdId") REFERENCES "financial_account"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_fileImportId_householdId_fkey" FOREIGN KEY ("fileImportId", "householdId") REFERENCES "file_import"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M09.3, ADR-013). O schema.prisma não sabe escrever CHECK; o Prisma não
-- as enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/importar-extrato.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- A impressão digital é um SHA-256 em hexadecimal minúsculo
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- O nome do arquivo, como a pessoa mandou, cabe na tela
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_file_name_check"
  CHECK (char_length("fileName") BETWEEN 1 AND 120);

-- Da conta ou do cartão, só os 4 últimos dígitos (nunca o número inteiro)
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_last_four_check"
  CHECK ("accountLastFour" IS NULL OR "accountLastFour" ~ '^[0-9]{4}$');

-- Contagens nunca negativas
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_counts_check"
  CHECK ("rowCount" >= 0 AND "createdCount" >= 0 AND "pluggyCount" >= 0
     AND "alreadyImportedCount" >= 0 AND "skippedCount" >= 0);

-- Importado tem conta e data, e não guarda mais as linhas; em conferência, nada disso
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_status_check"
  CHECK (
    ("status" = 'IMPORTED' AND "accountId" IS NOT NULL AND "importedAt" IS NOT NULL AND "preview" IS NULL)
    OR ("status" = 'PREVIEW' AND "importedAt" IS NULL)
  );

-- O período, quando existe, tem as duas pontas em ordem
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_period_check"
  CHECK (("periodFrom" IS NULL) = ("periodTo" IS NULL) AND ("periodFrom" IS NULL OR "periodFrom" <= "periodTo"));

-- Só uma linha que veio de arquivo OFX aponta para o arquivo
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_file_import_check"
  CHECK ("fileImportId" IS NULL OR "source" = 'OFX');

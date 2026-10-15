-- AlterEnum
ALTER TYPE "file_import_kind" ADD VALUE 'PDF';

-- AlterTable
ALTER TABLE "file_import" ADD COLUMN     "invoiceDifference" DECIMAL(14,2),
ADD COLUMN     "profile" TEXT,
ADD COLUMN     "statementId" UUID;

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_import_statementId_idx" ON "file_import"("statementId");

-- AddForeignKey
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "card_statement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M09.4, ADR-014). Cada uma tem um teste em
-- packages/db/src/integration/fatura-pdf.integration.test.ts que tenta quebrá-la.
-- O 'PDF' novo do enum não pode ser usado nesta mesma transação (o Postgres recusa um valor de
-- enum recém-criado antes do commit): por isso as regras dizem "<> 'OFX'".
-- ═════════════════════════════════════════════════════════════════════════════

-- Perfil, diferença da fatura e a fatura do cartão são coisas do PDF; o OFX não tem
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_pdf_fields_check"
  CHECK ("kind" <> 'OFX' OR ("profile" IS NULL AND "invoiceDifference" IS NULL AND "statementId" IS NULL));

-- O nome do perfil cabe na tela
ALTER TABLE "file_import" ADD CONSTRAINT "file_import_profile_check"
  CHECK ("profile" IS NULL OR char_length("profile") BETWEEN 1 AND 60);

-- A linha que veio de arquivo aponta para o arquivo: agora OFX ou PDF (era só OFX, M09.3)
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_file_import_check";
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_file_import_check"
  CHECK ("fileImportId" IS NULL OR "source" IN ('OFX', 'PDF'));

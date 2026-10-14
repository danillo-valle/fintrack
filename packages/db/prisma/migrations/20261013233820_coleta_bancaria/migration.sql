/*
  Warnings:

  - A unique constraint covering the columns `[userId,provider]` on the table `provider_connection` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "sync_trigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "statement_charge_kind" AS ENUM ('IOF', 'LATE_INTEREST', 'LATE_FEE', 'REMUNERATIVE_INTEREST', 'OTHER');

-- AlterTable
ALTER TABLE "payment_card" ADD COLUMN     "importWalletId" UUID;

-- AlterTable
ALTER TABLE "provider_connection" ADD COLUMN     "importFrom" DATE;

-- AlterTable
ALTER TABLE "sync_run" ADD COLUMN     "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemsUnchanged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "trigger" "sync_trigger" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "originalAmount" DECIMAL(14,2),
ADD COLUMN     "originalCurrency" CHAR(3),
ADD COLUMN     "providerCategory" TEXT,
ADD COLUMN     "providerInstallmentCount" SMALLINT,
ADD COLUMN     "providerInstallmentNumber" SMALLINT;

-- CreateTable
CREATE TABLE "provider_item" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "institution" TEXT,
    "bankUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balance" (
    "accountId" UUID NOT NULL,
    "balance" DECIMAL(14,2),
    "creditLimit" DECIMAL(14,2),
    "availableCredit" DECIMAL(14,2),
    "closeDate" DATE,
    "dueDate" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "asOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_balance_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "statement_charge" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "statement_charge_kind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_payment" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "paidOn" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_item_connectionId_externalId_key" ON "provider_item"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "statement_charge_statementId_idx" ON "statement_charge"("statementId");

-- CreateIndex
CREATE INDEX "statement_charge_accountId_idx" ON "statement_charge"("accountId");

-- CreateIndex
CREATE INDEX "statement_payment_statementId_idx" ON "statement_payment"("statementId");

-- CreateIndex
CREATE INDEX "statement_payment_accountId_idx" ON "statement_payment"("accountId");

-- CreateIndex
CREATE INDEX "payment_card_importWalletId_idx" ON "payment_card"("importWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connection_userId_provider_key" ON "provider_connection"("userId", "provider");

-- AddForeignKey
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_importWalletId_fkey" FOREIGN KEY ("importWalletId") REFERENCES "wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_item" ADD CONSTRAINT "provider_item_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_charge" ADD CONSTRAINT "statement_charge_statementId_accountId_fkey" FOREIGN KEY ("statementId", "accountId") REFERENCES "card_statement"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_charge" ADD CONSTRAINT "statement_charge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_payment" ADD CONSTRAINT "statement_payment_statementId_accountId_fkey" FOREIGN KEY ("statementId", "accountId") REFERENCES "card_statement"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_payment" ADD CONSTRAINT "statement_payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M09.1, ADR-011). O schema.prisma não sabe escrever CHECK; o Prisma não
-- as enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/coleta-bancaria.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- O Item ID da Pluggy: só letras, números e hífen (é um UUID), de 8 a 64 caracteres. A pessoa
-- cola o código; texto estranho (espaço, URL, script) é recusado pelo próprio banco.
ALTER TABLE "provider_item" ADD CONSTRAINT "provider_item_external_id_check"
  CHECK ("externalId" ~ '^[A-Za-z0-9-]{8,64}$');

-- Contadores da sincronização nunca negativos
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_import_counters_check"
  CHECK ("itemsUnchanged" >= 0 AND "itemsSkipped" >= 0);

-- Limite e disponível do cartão nunca negativos; moeda com 3 letras maiúsculas
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_credit_check"
  CHECK (("creditLimit" IS NULL OR "creditLimit" >= 0)
     AND ("availableCredit" IS NULL OR "availableCredit" >= 0));
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Compra em outra moeda: valor e moeda originais andam juntos
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_original_amount_check"
  CHECK (("originalAmount" IS NULL) = ("originalCurrency" IS NULL)
     AND ("originalCurrency" IS NULL OR "originalCurrency" ~ '^[A-Z]{3}$'));

-- A categoria que o banco devolve: de 1 a 100 caracteres
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_provider_category_check"
  CHECK ("providerCategory" IS NULL OR char_length(btrim("providerCategory")) BETWEEN 1 AND 100);

-- A parcela informada pelo banco: os dois números juntos, 1 <= número <= total, total de 2 a 99
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_provider_installment_check"
  CHECK (("providerInstallmentNumber" IS NULL) = ("providerInstallmentCount" IS NULL)
     AND ("providerInstallmentCount" IS NULL
          OR ("providerInstallmentCount" BETWEEN 2 AND 99
              AND "providerInstallmentNumber" BETWEEN 1 AND "providerInstallmentCount")));

-- Encargo da fatura nunca negativo; pagamento sempre positivo
ALTER TABLE "statement_charge" ADD CONSTRAINT "statement_charge_amount_check"
  CHECK ("amount" >= 0);
ALTER TABLE "statement_payment" ADD CONSTRAINT "statement_payment_amount_check"
  CHECK ("amount" > 0);

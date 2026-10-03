-- CreateEnum
CREATE TYPE "account_kind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'MEAL_VOUCHER', 'CASH');

-- CreateEnum
CREATE TYPE "card_form" AS ENUM ('PHYSICAL', 'VIRTUAL', 'VIRTUAL_TEMPORARY');

-- CreateEnum
CREATE TYPE "category_kind" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "rule_match" AS ENUM ('CONTAINS', 'STARTS_WITH', 'EQUALS');

-- CreateEnum
CREATE TYPE "household_role" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "wallet_kind" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "wallet_role" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "provider_kind" AS ENUM ('PLUGGY');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('ACTIVE', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('PENDING', 'SCHEDULED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "transaction_source" AS ENUM ('MANUAL', 'OFX', 'PDF', 'OPEN_FINANCE', 'BOT', 'RECURRENCE');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CREDIT', 'DEBIT', 'PIX', 'BOLETO', 'TRANSFER', 'DEPOSIT', 'CASH', 'WITHDRAWAL', 'VOUCHER');

-- CreateEnum
CREATE TYPE "statement_status" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- CreateEnum
CREATE TYPE "recurrence_kind" AS ENUM ('FIXED_BILL', 'SUBSCRIPTION', 'INCOME');

-- CreateTable
CREATE TABLE "financial_account" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "holderId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "account_kind" NOT NULL,
    "institution" TEXT,
    "initialBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(14,2),
    "closingDay" SMALLINT,
    "dueDay" SMALLINT,
    "connectionId" UUID,
    "externalId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_card" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "holderId" TEXT,
    "nickname" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "lastFour" CHAR(4) NOT NULL,
    "form" "card_form" NOT NULL,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "kind" "category_kind" NOT NULL,
    "color" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rule" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "match" "rule_match" NOT NULL DEFAULT 'CONTAINS',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_member" (
    "householdId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "household_role" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_member_pkey" PRIMARY KEY ("householdId","userId")
);

-- CreateTable
CREATE TABLE "wallet" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "wallet_kind" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_member" (
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "wallet_role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_member_pkey" PRIMARY KEY ("walletId","userId")
);

-- CreateTable
CREATE TABLE "provider_connection" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" UUID NOT NULL,
    "provider" "provider_kind" NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'ACTIVE',
    "clientId" TEXT,
    "secretCiphertext" BYTEA,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "sync_status" NOT NULL DEFAULT 'RUNNING',
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "householdId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "cardId" UUID,
    "method" "payment_method" NOT NULL,
    "categoryId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredOn" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "status" "transaction_status" NOT NULL DEFAULT 'CONFIRMED',
    "source" "transaction_source" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "statementId" UUID,
    "installmentGroupId" UUID,
    "installmentNumber" SMALLINT,
    "recurrenceId" UUID,
    "transferId" UUID,
    "reversalOfId" UUID,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_statement" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "closingDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "total" DECIMAL(14,2),
    "minimumPayment" DECIMAL(14,2),
    "status" "statement_status" NOT NULL DEFAULT 'OPEN',
    "source" "transaction_source" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_group" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "installmentCount" SMALLINT NOT NULL,
    "purchasedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "cardId" UUID,
    "categoryId" UUID,
    "kind" "recurrence_kind" NOT NULL,
    "method" "payment_method" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "dayOfMonth" SMALLINT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_account_householdId_idx" ON "financial_account"("householdId");

-- CreateIndex
CREATE INDEX "financial_account_walletId_idx" ON "financial_account"("walletId");

-- CreateIndex
CREATE INDEX "financial_account_holderId_idx" ON "financial_account"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_id_householdId_key" ON "financial_account"("id", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_connectionId_externalId_key" ON "financial_account"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "payment_card_accountId_idx" ON "payment_card"("accountId");

-- CreateIndex
CREATE INDEX "payment_card_holderId_idx" ON "payment_card"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_card_id_accountId_key" ON "payment_card"("id", "accountId");

-- CreateIndex
CREATE INDEX "category_parentId_idx" ON "category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "category_id_householdId_key" ON "category"("id", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "category_householdId_name_key" ON "category"("householdId", "name");

-- CreateIndex
CREATE INDEX "category_rule_householdId_priority_idx" ON "category_rule"("householdId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "budget_walletId_categoryId_month_key" ON "budget"("walletId", "categoryId", "month");

-- CreateIndex
CREATE INDEX "household_member_userId_idx" ON "household_member"("userId");

-- CreateIndex
CREATE INDEX "wallet_householdId_idx" ON "wallet"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_id_householdId_key" ON "wallet"("id", "householdId");

-- CreateIndex
CREATE INDEX "wallet_member_userId_idx" ON "wallet_member"("userId");

-- CreateIndex
CREATE INDEX "provider_connection_userId_idx" ON "provider_connection"("userId");

-- CreateIndex
CREATE INDEX "provider_connection_walletId_idx" ON "provider_connection"("walletId");

-- CreateIndex
CREATE INDEX "sync_run_connectionId_startedAt_idx" ON "sync_run"("connectionId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_householdId_createdAt_idx" ON "audit_log"("householdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "transaction_walletId_occurredOn_idx" ON "transaction"("walletId", "occurredOn" DESC);

-- CreateIndex
CREATE INDEX "transaction_accountId_occurredOn_idx" ON "transaction"("accountId", "occurredOn");

-- CreateIndex
CREATE INDEX "transaction_cardId_idx" ON "transaction"("cardId");

-- CreateIndex
CREATE INDEX "transaction_statementId_idx" ON "transaction"("statementId");

-- CreateIndex
CREATE INDEX "transaction_categoryId_idx" ON "transaction"("categoryId");

-- CreateIndex
CREATE INDEX "transaction_recurrenceId_idx" ON "transaction"("recurrenceId");

-- CreateIndex
CREATE INDEX "transaction_transferId_idx" ON "transaction"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_accountId_source_externalId_key" ON "transaction"("accountId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_installmentGroupId_installmentNumber_key" ON "transaction"("installmentGroupId", "installmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "card_statement_id_accountId_key" ON "card_statement"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "card_statement_accountId_referenceMonth_key" ON "card_statement"("accountId", "referenceMonth");

-- CreateIndex
CREATE INDEX "installment_group_accountId_idx" ON "installment_group"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "installment_group_id_accountId_key" ON "installment_group"("id", "accountId");

-- CreateIndex
CREATE INDEX "recurrence_householdId_idx" ON "recurrence"("householdId");

-- CreateIndex
CREATE INDEX "recurrence_walletId_idx" ON "recurrence"("walletId");

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_categoryId_householdId_fkey" FOREIGN KEY ("categoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_categoryId_householdId_fkey" FOREIGN KEY ("categoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_member" ADD CONSTRAINT "wallet_member_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_member" ADD CONSTRAINT "wallet_member_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_member" ADD CONSTRAINT "wallet_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_accountId_householdId_fkey" FOREIGN KEY ("accountId", "householdId") REFERENCES "financial_account"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_cardId_accountId_fkey" FOREIGN KEY ("cardId", "accountId") REFERENCES "payment_card"("id", "accountId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_categoryId_householdId_fkey" FOREIGN KEY ("categoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_statementId_accountId_fkey" FOREIGN KEY ("statementId", "accountId") REFERENCES "card_statement"("id", "accountId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_installmentGroupId_accountId_fkey" FOREIGN KEY ("installmentGroupId", "accountId") REFERENCES "installment_group"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_group" ADD CONSTRAINT "installment_group_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_group" ADD CONSTRAINT "installment_group_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_group" ADD CONSTRAINT "installment_group_accountId_householdId_fkey" FOREIGN KEY ("accountId", "householdId") REFERENCES "financial_account"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_walletId_householdId_fkey" FOREIGN KEY ("walletId", "householdId") REFERENCES "wallet"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_accountId_householdId_fkey" FOREIGN KEY ("accountId", "householdId") REFERENCES "financial_account"("id", "householdId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_cardId_accountId_fkey" FOREIGN KEY ("cardId", "accountId") REFERENCES "payment_card"("id", "accountId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_categoryId_householdId_fkey" FOREIGN KEY ("categoryId", "householdId") REFERENCES "category"("id", "householdId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- REGRAS ESCRITAS À MÃO (M04)
-- O schema.prisma não sabe escrever CHECK nem gatilho. Estas linhas foram coladas no fim
-- da migração que o Prisma gerou com "migrate dev --create-only", ANTES de aplicá-la.
-- O Prisma não apaga nada disto nas próximas migrações: ele simplesmente não enxerga.
-- Os testes de packages/db/src/integration/ provam cada regra contra o banco de verdade.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Lançamento ───────────────────────────────────────────────────────────────

-- Valor zero não é lançamento (e quase sempre esconde um erro de conversão)
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_amount_not_zero_check"
  CHECK ("amount" <> 0);

-- Descrição de 1 a 200 caracteres
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_description_length_check"
  CHECK (char_length("description") BETWEEN 1 AND 200);

-- O que veio de fora precisa do id da origem: é ele que impede importar duas vezes
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_external_id_check"
  CHECK ("source" = 'MANUAL' OR "externalId" IS NOT NULL);

-- Parcela: grupo e número andam juntos, e a contagem começa em 1
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_installment_check"
  CHECK (("installmentGroupId" IS NULL) = ("installmentNumber" IS NULL)
         AND ("installmentNumber" IS NULL OR "installmentNumber" >= 1));

-- Um estorno não estorna a si mesmo
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_reversal_check"
  CHECK ("reversalOfId" IS NULL OR "reversalOfId" <> "id");

-- Com cartão, a forma de pagamento é crédito, débito ou vale (PIX e boleto não usam cartão)
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_card_method_check"
  CHECK ("cardId" IS NULL OR "method" IN ('CREDIT', 'DEBIT', 'VOUCHER'));

-- ── Conta ────────────────────────────────────────────────────────────────────

-- Cartão tem fechamento e vencimento; conta corrente, poupança e dinheiro, não
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_card_days_check"
  CHECK (("kind" = 'CREDIT_CARD' AND "closingDay" IS NOT NULL AND "dueDay" IS NOT NULL)
      OR ("kind" <> 'CREDIT_CARD' AND "closingDay" IS NULL AND "dueDay" IS NULL));

-- Dias de 1 a 31, e o vencimento num dia diferente do fechamento
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_day_range_check"
  CHECK (("closingDay" IS NULL OR "closingDay" BETWEEN 1 AND 31)
     AND ("dueDay" IS NULL OR "dueDay" BETWEEN 1 AND 31)
     AND ("closingDay" IS NULL OR "closingDay" <> "dueDay"));

-- Limite do cartão não é negativo
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_credit_limit_check"
  CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);

-- ── Cartão: nunca o número completo ──────────────────────────────────────────

-- Só os 4 últimos dígitos. Um número inteiro colado aqui por engano é recusado.
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_last_four_check"
  CHECK ("lastFour" ~ '^[0-9]{4}$');

-- Apelido e bandeira com tamanho razoável
ALTER TABLE "payment_card" ADD CONSTRAINT "payment_card_text_check"
  CHECK (char_length("nickname") BETWEEN 1 AND 60 AND char_length("brand") BETWEEN 2 AND 30);

-- ── Ambiente, categoria e regra ──────────────────────────────────────────────

-- Moeda no formato ISO 4217: três letras maiúsculas (BRL)
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- Nome de categoria de 1 a 60 caracteres, e categoria não é filha de si mesma
ALTER TABLE "category" ADD CONSTRAINT "category_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 60);
ALTER TABLE "category" ADD CONSTRAINT "category_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Padrão da regra: de 2 a 100 caracteres, já em minúsculas (a comparação é sem maiúsculas)
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_pattern_check"
  CHECK (char_length("pattern") BETWEEN 2 AND 100 AND "pattern" = lower("pattern"));

-- ── Orçamento e fatura ───────────────────────────────────────────────────────

-- Orçamento: valor planejado não negativo, e o mês guardado sempre como dia 1
ALTER TABLE "budget" ADD CONSTRAINT "budget_amount_check"
  CHECK ("amount" >= 0);
ALTER TABLE "budget" ADD CONSTRAINT "budget_month_first_day_check"
  CHECK (EXTRACT(DAY FROM "month") = 1);

-- Fatura: mês de referência no dia 1 e vencimento depois do fechamento
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_month_first_day_check"
  CHECK (EXTRACT(DAY FROM "referenceMonth") = 1);
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_dates_check"
  CHECK ("dueDate" > "closingDate");
ALTER TABLE "card_statement" ADD CONSTRAINT "card_statement_minimum_check"
  CHECK ("minimumPayment" IS NULL OR "minimumPayment" >= 0);

-- Compra parcelada: de 2 a 99 parcelas e valor diferente de zero
ALTER TABLE "installment_group" ADD CONSTRAINT "installment_group_count_check"
  CHECK ("installmentCount" BETWEEN 2 AND 99);
ALTER TABLE "installment_group" ADD CONSTRAINT "installment_group_amount_check"
  CHECK ("totalAmount" <> 0);

-- ── Recorrência ───────────────────────────────────────────────────────────────

-- Dia do mês de 1 a 31, valor diferente de zero, fim depois do início, cartão só no crédito/débito/vale
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_rules_check"
  CHECK ("dayOfMonth" BETWEEN 1 AND 31
     AND "amount" <> 0
     AND ("endsOn" IS NULL OR "endsOn" >= "startsOn")
     AND ("cardId" IS NULL OR "method" IN ('CREDIT', 'DEBIT', 'VOUCHER'))
     AND char_length("description") BETWEEN 1 AND 200);

-- ── Sincronização ────────────────────────────────────────────────────────────

-- Rodando = sem fim; terminada = com fim, depois do início; contadores nunca negativos
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_finished_check"
  CHECK ((("status" = 'RUNNING') = ("finishedAt" IS NULL))
     AND ("finishedAt" IS NULL OR "finishedAt" >= "startedAt"));
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_counters_check"
  CHECK ("itemsCreated" >= 0 AND "itemsUpdated" >= 0);

-- ── Forma de pagamento combina com o tipo da conta ────────────────────────────
-- Esta regra olha DUAS tabelas (o lançamento e a conta), e um CHECK só enxerga a própria
-- linha. Por isso é um gatilho: antes de gravar um lançamento, ele busca o tipo da conta e
-- recusa as quatro combinações impossíveis:
--   1. crédito (CREDIT) fora de uma conta de cartão de crédito
--   2. na conta do cartão, algo que não seja compra no crédito ou um lado de transferência
--      (o pagamento da fatura entra como transferência, feita por PIX, boleto ou débito)
--   3. vale (VOUCHER) fora de uma conta de vale-refeição; e, nela, só vale, depósito
--      (a recarga do empregador) ou transferência
--   4. fatura (statementId) em conta que não é de cartão de crédito
CREATE FUNCTION "transaction_method_matches_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kind "account_kind";
  is_transfer boolean := NEW."transferId" IS NOT NULL;
BEGIN
  SELECT "financial_account"."kind" INTO kind FROM "financial_account" WHERE "id" = NEW."accountId";

  IF (NEW."method" = 'CREDIT' AND kind <> 'CREDIT_CARD')
     OR (kind = 'CREDIT_CARD' AND NEW."method" <> 'CREDIT' AND NOT is_transfer)
     OR (NEW."method" = 'VOUCHER' AND kind <> 'MEAL_VOUCHER')
     OR (kind = 'MEAL_VOUCHER' AND NEW."method" NOT IN ('VOUCHER', 'DEPOSIT') AND NOT is_transfer)
     OR (NEW."statementId" IS NOT NULL AND kind <> 'CREDIT_CARD') THEN
    RAISE EXCEPTION 'transaction_method_matches_account: forma de pagamento % não combina com a conta do tipo %',
      NEW."method", kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transaction_method_matches_account"
  BEFORE INSERT OR UPDATE OF "method", "accountId", "statementId", "transferId" ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION "transaction_method_matches_account"();

-- ── Auditoria: só acrescenta ─────────────────────────────────────────────────
-- Um gatilho recusa UPDATE, DELETE e TRUNCATE na audit_log, venha de onde vier: um bug no
-- app ou uma consulta digitada à mão não apagam o rastro. (Quem administra o banco ainda
-- pode desligar o gatilho; a proteção é contra erro e contra o app, não contra o DBA.)
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log só aceita INSERT (tentativa de %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();

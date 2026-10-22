-- CreateEnum
CREATE TYPE "bot_message_kind" AS ENUM ('TEXT', 'BUTTON', 'OTHER');

-- CreateEnum
CREATE TYPE "bot_message_outcome" AS ENUM ('PROPOSED', 'ASKED', 'CONFIRMED', 'CANCELLED', 'UNDONE', 'NOT_UNDERSTOOD', 'CARD_NUMBER', 'LINKED', 'BAD_CODE', 'UNKNOWN_NUMBER', 'BOT_OFF', 'STALE');

-- CreateEnum
CREATE TYPE "bot_draft_status" AS ENUM ('OPEN', 'CONFIRMED', 'CANCELLED', 'UNDONE');

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "botDisabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "bot_link" (
    "userId" TEXT NOT NULL,
    "householdId" UUID NOT NULL,
    "phoneHash" CHAR(64) NOT NULL,
    "phoneLastFour" CHAR(4) NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "bot_link_code" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "codeSealed" BYTEA,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_preference" (
    "userId" TEXT NOT NULL,
    "householdId" UUID NOT NULL,
    "walletId" UUID,
    "debitAccountId" UUID,
    "creditCardId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_preference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "bot_message" (
    "id" UUID NOT NULL,
    "wamid" TEXT NOT NULL,
    "householdId" UUID,
    "userId" TEXT,
    "phoneHash" CHAR(64) NOT NULL,
    "kind" "bot_message_kind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" "bot_message_outcome",
    "bodyCiphertext" BYTEA,
    "draftId" UUID,

    CONSTRAINT "bot_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_draft" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" UUID,
    "accountId" UUID,
    "cardId" UUID,
    "method" "payment_method" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "installmentCount" SMALLINT,
    "categoryId" UUID,
    "status" "bot_draft_status" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "transactionId" UUID,
    "installmentGroupId" UUID,

    CONSTRAINT "bot_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_reply_count" (
    "phoneNumberId" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_reply_count_pkey" PRIMARY KEY ("phoneNumberId","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_link_phoneHash_key" ON "bot_link"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "bot_link_householdId_userId_key" ON "bot_link"("householdId", "userId");

-- CreateIndex
CREATE INDEX "bot_link_code_householdId_userId_idx" ON "bot_link_code"("householdId", "userId");

-- CreateIndex
CREATE INDEX "bot_link_code_codeHash_idx" ON "bot_link_code"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "bot_preference_householdId_userId_key" ON "bot_preference"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_message_wamid_key" ON "bot_message"("wamid");

-- CreateIndex
CREATE INDEX "bot_message_householdId_createdAt_idx" ON "bot_message"("householdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bot_message_phoneHash_createdAt_idx" ON "bot_message"("phoneHash", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bot_message_createdAt_idx" ON "bot_message"("createdAt");

-- CreateIndex
CREATE INDEX "bot_draft_householdId_userId_status_idx" ON "bot_draft"("householdId", "userId", "status");

-- CreateIndex
CREATE INDEX "bot_draft_transactionId_idx" ON "bot_draft"("transactionId");

-- CreateIndex
CREATE INDEX "bot_draft_installmentGroupId_idx" ON "bot_draft"("installmentGroupId");

-- AddForeignKey
ALTER TABLE "bot_link" ADD CONSTRAINT "bot_link_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_link_code" ADD CONSTRAINT "bot_link_code_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_preference" ADD CONSTRAINT "bot_preference_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_draft" ADD CONSTRAINT "bot_draft_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_draft" ADD CONSTRAINT "bot_draft_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_draft" ADD CONSTRAINT "bot_draft_installmentGroupId_fkey" FOREIGN KEY ("installmentGroupId") REFERENCES "installment_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M11, ADR-018). Cada uma tem um teste em
-- packages/db/src/integration/bot.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- O número nunca é gravado: só o HMAC (64 hexadecimais) e os 4 últimos dígitos
ALTER TABLE "bot_link" ADD CONSTRAINT "bot_link_phone_check"
  CHECK ("phoneHash" ~ '^[0-9a-f]{64}$' AND "phoneLastFour" ~ '^[0-9]{4}$');

-- O código: a busca pelo SHA-256, usado só antes de vencer; o cifrado (para a tela) some no uso
ALTER TABLE "bot_link_code" ADD CONSTRAINT "bot_link_code_check"
  CHECK ("codeHash" ~ '^[0-9a-f]{64}$' AND "expiresAt" > "createdAt"
    AND ("usedAt" IS NULL OR ("usedAt" <= "expiresAt" AND "codeSealed" IS NULL)));

-- A mensagem: o wamid tem tamanho de id, o número só como HMAC, e o texto cifrado some quando
-- a fila lê (lida = sem texto; na fila = sem resultado)
ALTER TABLE "bot_message" ADD CONSTRAINT "bot_message_check"
  CHECK (char_length("wamid") BETWEEN 1 AND 200
    AND "phoneHash" ~ '^[0-9a-f]{64}$'
    AND ("processedAt" IS NULL OR "bodyCiphertext" IS NULL)
    AND (("processedAt" IS NULL) = ("outcome" IS NULL)));

-- O rascunho: só despesa (valor positivo), pelo crédito, débito ou pix; descrição de 1 a 200;
-- parcelas de 2 a 24 e só no crédito
ALTER TABLE "bot_draft" ADD CONSTRAINT "bot_draft_values_check"
  CHECK ("amount" > 0
    AND "method" IN ('CREDIT', 'DEBIT', 'PIX')
    AND char_length(btrim("description")) BETWEEN 1 AND 200
    AND ("installmentCount" IS NULL OR ("installmentCount" BETWEEN 2 AND 24 AND "method" = 'CREDIT')));

-- A decisão: aberto não tem data de decisão; o resto tem. Confirmado tem ambiente, conta e o
-- lançamento (ou o grupo da compra parcelada) que nasceu dele
ALTER TABLE "bot_draft" ADD CONSTRAINT "bot_draft_status_check"
  CHECK ((("status" = 'OPEN') = ("decidedAt" IS NULL))
    AND ("status" <> 'CONFIRMED' OR ("walletId" IS NOT NULL AND "accountId" IS NOT NULL)));

-- A conta do mês: AAAA-MM e de 0 a 1000 (a cota grátis da Meta; o app para em 900)
ALTER TABLE "bot_reply_count" ADD CONSTRAINT "bot_reply_count_check"
  CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "used" BETWEEN 0 AND 1000);

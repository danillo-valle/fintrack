-- CreateEnum
CREATE TYPE "bot_channel" AS ENUM ('WHATSAPP', 'TELEGRAM');

-- AlterTable
ALTER TABLE "bot_link_code" ADD COLUMN     "usedChannel" "bot_channel";

-- AlterTable
ALTER TABLE "bot_message" ADD COLUMN     "channel" "bot_channel" NOT NULL DEFAULT 'WHATSAPP';

-- AlterTable
ALTER TABLE "bot_reply_count" ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureCode" INTEGER,
ADD COLUMN     "lastSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "bot_telegram_link" (
    "userId" TEXT NOT NULL,
    "householdId" UUID NOT NULL,
    "chatHash" CHAR(64) NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_telegram_link_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_telegram_link_chatHash_key" ON "bot_telegram_link"("chatHash");

-- CreateIndex
CREATE UNIQUE INDEX "bot_telegram_link_householdId_userId_key" ON "bot_telegram_link"("householdId", "userId");

-- AddForeignKey
ALTER TABLE "bot_telegram_link" ADD CONSTRAINT "bot_telegram_link_householdId_userId_fkey" FOREIGN KEY ("householdId", "userId") REFERENCES "household_member"("householdId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M12.0b, ADR-019). Cada uma tem um teste em
-- packages/db/src/integration/bot-telegram.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- A conta do Telegram nunca é gravada: só o HMAC do id da conversa (64 hexadecimais)
ALTER TABLE "bot_telegram_link" ADD CONSTRAINT "bot_telegram_link_chat_check"
  CHECK ("chatHash" ~ '^[0-9a-f]{64}$');

-- O canal do código só existe depois do uso
ALTER TABLE "bot_link_code" ADD CONSTRAINT "bot_link_code_channel_check"
  CHECK ("usedChannel" IS NULL OR "usedAt" IS NOT NULL);

-- O id da mensagem do Telegram começa com "tg:" e só ele: os ids dos dois canais nunca colidem
ALTER TABLE "bot_message" ADD CONSTRAINT "bot_message_channel_check"
  CHECK (("channel" = 'TELEGRAM') = ("wamid" LIKE 'tg:%'));

-- A última recusa da Meta tem código e hora juntos
ALTER TABLE "bot_reply_count" ADD CONSTRAINT "bot_reply_count_failure_check"
  CHECK (("lastFailureAt" IS NULL) = ("lastFailureCode" IS NULL));

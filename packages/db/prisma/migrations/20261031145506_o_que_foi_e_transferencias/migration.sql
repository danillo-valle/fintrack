-- CreateEnum
CREATE TYPE "transfer_peer" AS ENUM ('HOUSEHOLD', 'EXTERNAL');

-- AlterEnum
ALTER TYPE "match_kind" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "label" TEXT,
ADD COLUMN     "transferPeer" "transfer_peer";

-- ── Regras que o Prisma não escreve (M13.2, adendo do ADR-012) ────────────────
-- "O que foi": o nome que a pessoa dá a um lançamento do banco. Vazio não existe (sem nome é nulo).
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_label_length_check"
  CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 200);

-- O outro lado de uma transferência marcada de um lado só só existe numa transferência.
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transfer_peer_check"
  CHECK ("transferPeer" IS NULL OR "transferId" IS NOT NULL);

-- CreateEnum
CREATE TYPE "recurrence_origin" AS ENUM ('APP', 'BANK');

-- CreateEnum
CREATE TYPE "recurrence_amount_rule" AS ENUM ('FIXED', 'LAST', 'AVERAGE_3');

-- CreateEnum
CREATE TYPE "recurrence_day_rule" AS ENUM ('DAY', 'BUSINESS_DAY');

-- AlterTable
ALTER TABLE "recurrence" ADD COLUMN     "amountRule" "recurrence_amount_rule" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "dayRule" "recurrence_day_rule" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "matchKey" TEXT,
ADD COLUMN     "origin" "recurrence_origin" NOT NULL DEFAULT 'APP';

-- AlterTable
ALTER TABLE "transaction" ADD COLUMN     "installmentByPerson" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "recurrence_accountId_matchKey_idx" ON "recurrence"("accountId", "matchKey");

-- ═══ Regras escritas à mão (M13.3c, ADR-027): o Prisma não gera CHECK ═══

-- A recorrência do banco sempre tem a chave do comerciante, e só ela tem; a do app tem o valor
-- gravado (o último e a média vêm das cobranças que o banco traz); o N-ésimo dia útil vai até 23
-- (nenhum mês tem mais dias úteis que isso)
ALTER TABLE "recurrence" ADD CONSTRAINT "recurrence_origin_check" CHECK (
  ("origin" = 'BANK') = ("matchKey" IS NOT NULL)
  AND ("origin" = 'BANK' OR "amountRule" = 'FIXED')
  AND ("matchKey" IS NULL OR char_length("matchKey") BETWEEN 1 AND 100)
  AND ("dayRule" = 'DAY' OR "dayOfMonth" BETWEEN 1 AND 23)
);

-- A parcela dita pela pessoa só existe com a parcela (número e total) preenchida
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_installment_by_person_check" CHECK (
  NOT "installmentByPerson"
  OR ("providerInstallmentNumber" IS NOT NULL AND "providerInstallmentCount" IS NOT NULL)
);

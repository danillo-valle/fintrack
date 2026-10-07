-- CreateTable
CREATE TABLE "household_invite" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "email" TEXT NOT NULL,
    "role" "household_role" NOT NULL DEFAULT 'MEMBER',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "household_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_invite_tokenHash_key" ON "household_invite"("tokenHash");

-- CreateIndex
CREATE INDEX "household_invite_householdId_createdAt_idx" ON "household_invite"("householdId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "household_invite_createdById_idx" ON "household_invite"("createdById");

-- CreateIndex
CREATE INDEX "household_invite_acceptedById_idx" ON "household_invite"("acceptedById");

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Regras coladas à mão (M06). O schema.prisma não sabe escrever CHECK; o Prisma não as
-- enxerga e não tenta desfazê-las depois. Cada uma tem um teste em
-- packages/db/src/integration/permissoes.integration.test.ts que tenta quebrá-la.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Convite ──────────────────────────────────────────────────────────────────

-- O banco guarda só o SHA-256 do segredo do link, em hexadecimal minúsculo (64 caracteres).
-- Recusa, por exemplo, gravar o segredo em texto puro por engano.
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- E-mail já normalizado (sem espaços nas pontas, minúsculas), com @ e tamanho de e-mail.
-- A aceitação compara com o e-mail da conta normalizado do mesmo jeito.
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_email_check"
  CHECK ("email" = lower(btrim("email"))
     AND char_length("email") BETWEEN 3 AND 254
     AND position('@' IN "email") > 1);

-- O prazo termina depois da criação
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_expiry_check"
  CHECK ("expiresAt" > "createdAt");

-- Um convite não é aceito E cancelado ao mesmo tempo
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_state_check"
  CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL);

-- Quem aceitou só existe se houve aceitação. (O contrário pode faltar: se a conta de quem
-- aceitou for apagada, acceptedById vira NULL e a data de aceitação fica de histórico.)
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_acceptor_check"
  CHECK ("acceptedById" IS NULL OR "acceptedAt" IS NOT NULL);

-- ── Nomes que aparecem na tela ───────────────────────────────────────────────

-- Nome do lar e da carteira: de 1 a 60 caracteres, sem ser só espaço.
-- (As telas já validam com zod; o banco é a última linha de defesa.)
ALTER TABLE "household" ADD CONSTRAINT "household_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);

#!/usr/bin/env bash
# Gera (ou atualiza) as tabelas do Better Auth no schema do Prisma, a partir do auth.ts.
# Rode de novo sempre que mudar um plugin ou um campo extra no auth.ts; depois, crie a
# migração com: pnpm db:migrate --name descricao-da-mudanca
#
# Uso (na raiz do repositório): bash scripts/gerar-schema-auth.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# O CLI lê o auth.ts, que valida as variáveis de ambiente: carrega o .env da raiz
if [ ! -f .env ]; then
  echo "Falta o arquivo .env na raiz. Crie com: cp .env.example .env" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

# Versão do CLI igual à do better-auth instalado no app (lida do package.json)
VERSION=$(node -p 'require("./apps/web/node_modules/better-auth/package.json").version')
AUTH_SCHEMA=packages/db/prisma/schema/auth.prisma
echo "Better Auth $VERSION: gerando as tabelas em $AUTH_SCHEMA"

# --config  onde está a configuração do Better Auth
# --output  o arquivo do schema com as tabelas do login (desde o M04, o schema é uma pasta:
#           o domínio fica nos outros arquivos de packages/db/prisma/schema/)
# -y        não pergunta antes de sobrescrever
pnpm dlx "auth@$VERSION" generate \
  --config apps/web/src/lib/auth.ts \
  --output "$AUTH_SCHEMA" \
  -y

cat <<'NOTA'

Nota (M04): se apareceu o aviso de que householdMemberships, walletMemberships ou outras
listas do User "rejeitam inserts" (columns reject every insert), pode ignorar. São listas de
relação do Prisma, não colunas da tabela "user"; o CLI do Better Auth 1.7.7 confunde as duas.
A conferência abaixo (prisma validate) é a que vale.

NOTA

# Formata o schema no padrão do Prisma (alinha as colunas) e confere a pasta inteira
pnpm --filter @fintrack/db exec prisma format
pnpm --filter @fintrack/db exec prisma validate

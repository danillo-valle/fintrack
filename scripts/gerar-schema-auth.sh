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
echo "Better Auth $VERSION: gerando as tabelas em packages/db/prisma/schema.prisma"

# --config  onde está a configuração do Better Auth
# --output  o schema do Prisma, que o CLI reescreve mantendo o generator e o datasource
# -y        não pergunta antes de sobrescrever
pnpm dlx "auth@$VERSION" generate \
  --config apps/web/src/lib/auth.ts \
  --output packages/db/prisma/schema.prisma \
  -y

# Formata o schema no padrão do Prisma (alinha as colunas)
pnpm --filter @fintrack/db exec prisma format

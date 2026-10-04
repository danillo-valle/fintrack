# Imagens de produção do FinTrack. Um Dockerfile, duas imagens ("alvos"):
#
#   web      o app Next.js no modo standalone: só o server.js e os arquivos que ele usa,
#            rodando como usuário sem privilégios (node, uid 1000).
#   migrate  o pacote @fintrack/db com o Prisma CLI: aplica as migrações (prisma migrate deploy)
#            antes de cada troca de versão e, quando pedido de propósito, roda o seed sintético.
#
# Quem constrói: o job "imagem" do CI (.github/workflows/ci.yml), que publica as duas no GHCR
# (ghcr.io/danillo-valle/fintrack-web e fintrack-migrate) a cada merge na main.
#
# Construir à mão, no servidor (útil para testar antes de abrir o PR):
#   docker build --target web     --build-arg APP_VERSION=$(git rev-parse HEAD) -t fintrack-web:local .
#   docker build --target migrate -t fintrack-migrate:local .
#
# Multi-stage: cada "FROM ... AS nome" é um estágio. Os estágios de build têm compilador, pnpm
# e todo o node_modules; a imagem final copia só o resultado. Ferramenta de build que não está
# na imagem final é ferramenta que um invasor não encontra lá.

ARG NODE_VERSION=24

# ── 1. base: Node.js e o pnpm na versão exata do projeto ─────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    # O lefthook (hooks de Git) não tem o que fazer dentro do container: sem .git
    LEFTHOOK=0
WORKDIR /app
# Só o package.json, para ler o campo "packageManager" ("pnpm@12.8.1")
COPY package.json ./
# npm install -g pnpm@<versão do packageManager>: a mesma do seu servidor e do CI
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" \
 && pnpm --version

# ── 2. deps: baixa os pacotes olhando SÓ o lockfile ─────────────────────────────────────────
# Enquanto o pnpm-lock.yaml não mudar, o Docker reaproveita esta camada pronta (cache) e o build
# pula o download. O --mount=type=cache guarda a "loja" do pnpm entre um build e outro.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=fintrack-pnpm-store,target=/pnpm-store \
    pnpm fetch --store-dir /pnpm-store

# ── 3. build: instala do cache (sem internet para pacotes) e gera o app ──────────────────────
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=fintrack-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm-store
# Commit que está sendo construído; o /api/health devolve este valor
ARG APP_VERSION=dev
# O build do Next.js carrega a configuração do Better Auth, que confere as variáveis de ambiente
# (src/lib/env.ts). Aqui não há banco nem e-mail: são valores de mentira, só para o build passar,
# e existem só durante este RUN (não ficam gravados em camada nenhuma da imagem).
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" \
    BETTER_AUTH_URL="http://localhost:3000" \
    ALLOWED_EMAILS="build@fintrack.invalid" \
    EMAIL_FROM="FinTrack <build@fintrack.invalid>" \
    SMTP_HOST="localhost" \
    SMTP_PORT="1025" \
    APP_VERSION="${APP_VERSION}" \
    pnpm turbo run build --filter=@fintrack/web

# ── 4. web: a imagem que vai para produção ──────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS web
ARG APP_VERSION=dev
# Etiquetas padrão OCI: o GHCR liga a imagem ao repositório (source), e o deploy lê a revisão
LABEL org.opencontainers.image.source="https://github.com/danillo-valle/fintrack" \
      org.opencontainers.image.title="fintrack-web" \
      org.opencontainers.image.description="FinTrack: app web (Next.js standalone)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${APP_VERSION}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Escuta em todas as interfaces DO CONTAINER; quem decide o que chega aqui é a rede do compose
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
# O standalone já traz o node_modules mínimo. Os arquivos ficam com dono root e o app roda como
# "node": o processo lê o próprio código, mas não consegue alterá-lo.
COPY --from=build /app/apps/web/.next/standalone ./
# O server.js serve sozinho os arquivos estáticos se eles estiverem nestas pastas
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# O Docker pergunta ao app, a cada 30 s, se ele está bem (a mesma rota que o deploy e o monitor usam)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# ── 5. migrate: o Prisma CLI com as migrações (e o seed) ────────────────────────────────────
# Instala SÓ o @fintrack/db e o que ele usa (core, config): nada do app web nem do Playwright.
# O "prisma generate" lê o prisma.config.ts, que exige um DATABASE_URL: de mentira, só aqui.
# O de verdade chega quando o container roda (env_file do compose de produção).
# Parte da "base" (sem o node_modules completo que o estágio deps materializa) e reaproveita
# a loja de pacotes do cache: só baixa da internet o que ainda não estiver lá.
FROM base AS migrate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core packages/core
COPY packages/config packages/config
COPY packages/db packages/db
RUN --mount=type=cache,id=fintrack-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm-store --filter "@fintrack/db..." \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @fintrack/db db:generate
ARG APP_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/danillo-valle/fintrack" \
      org.opencontainers.image.title="fintrack-migrate" \
      org.opencontainers.image.description="FinTrack: migrações do banco (Prisma)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${APP_VERSION}"
WORKDIR /app/packages/db
# Os programas do pacote (prisma, tsx) direto no PATH. Sem "pnpm exec": o pnpm 12 confere as
# dependências do workspace antes de rodar e, como esta imagem tem só o @fintrack/db, tentaria
# reinstalar tudo (e falharia: o usuário node não grava em /app).
ENV PATH=/app/packages/db/node_modules/.bin:$PATH
USER node
# Padrão: aplica as migrações pendentes e sai. Para o seed (só com confirmação explícita):
#   fintrack-compose run --rm -e SEED_TARGET_HOST=db migrate prisma db seed
CMD ["prisma", "migrate", "deploy"]

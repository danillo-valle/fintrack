# FinTrack

[![CI](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml/badge.svg)](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml)

Controle financeiro pessoal e da casa: ambientes pessoais e compartilhados, cartões com
adicionais, orçamento e importação de extratos e faturas. Construído em 12 módulos, cada um
acompanhado por uma [milestone](https://github.com/danillo-valle/fintrack/milestones).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · pnpm + Turborepo ·
PostgreSQL 17 + Prisma 7 · Better Auth (2FA, passkeys) · Vitest · Playwright + axe · Python (M09)

## Rodando localmente

Pré-requisitos: Node 24 (veja `.node-version`), pnpm (versão em `package.json`) e Docker.

```bash
cp .env.example .env   # e preencha o que está marcado com TROQUE
pnpm install           # instala dependências e os hooks de Git
pnpm db:up             # Postgres e Mailpit (e-mails de teste em http://localhost:8025)
pnpm db:deploy         # cria as tabelas
pnpm db:seed           # casa fictícia com 24 meses de dados sintéticos
pnpm dev               # http://localhost:3000
pnpm check             # lint, tipos, testes e build, igual ao CI
pnpm e2e               # testes de ponta a ponta
pnpm test:integration  # regras do banco contra o Postgres
```

## Estrutura

```
apps/web/          app Next.js
packages/core/     regras puras: dinheiro em centavos, datas, fatura do cartão
packages/db/       schema, migrações, seed e cliente do Prisma
packages/config/   configuração compartilhada de TypeScript
docs/adr/          decisões de arquitetura
docs/modelo-de-dados.md  diagrama das tabelas
samples/           dados sintéticos para testes (nunca dados reais)
```

## Proteções

- Hooks locais bloqueiam segredos, arquivos de extrato ou fatura e mensagens de commit fora do padrão.
- O CI repete as verificações e procura segredos em todo o histórico.
- A branch `main` só aceita pull request com CI verde.
- Cadastro fechado, 2FA obrigatório, passkeys, limite de tentativas e reautenticação antes de
  ações sensíveis ([ADR-003](docs/adr/0003-autenticacao.md)).
- Dinheiro exato (`NUMERIC(14,2)` e centavos em `bigint`), importação idempotente e auditoria que
  só acrescenta, garantidos no próprio banco ([ADR-004](docs/adr/0004-modelo-de-dados.md)).

## Licença

MIT

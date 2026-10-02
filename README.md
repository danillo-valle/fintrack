# FinTrack

[![CI](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml/badge.svg)](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml)

Controle financeiro da casa para duas pessoas: carteiras pessoais, uma carteira conjunta,
orçamento e importação de extratos e faturas. Construído em 12 módulos, cada um
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
pnpm dev               # http://localhost:3000
pnpm check             # lint, tipos, testes e build, igual ao CI
pnpm e2e               # testes de ponta a ponta
```

## Estrutura

```
apps/web/          app Next.js
packages/db/       schema, migrações e cliente do Prisma
packages/config/   configuração compartilhada de TypeScript
docs/adr/          decisões de arquitetura
samples/           dados sintéticos para testes (nunca dados reais)
```

## Proteções

- Hooks locais bloqueiam segredos, arquivos de extrato ou fatura e mensagens de commit fora do padrão.
- O CI repete as verificações e procura segredos em todo o histórico.
- A branch `main` só aceita pull request com CI verde.
- Cadastro fechado, 2FA obrigatório, passkeys, limite de tentativas e reautenticação antes de
  ações sensíveis ([ADR-003](docs/adr/0003-autenticacao.md)).

## Licença

MIT

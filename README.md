# FinTrack

[![CI](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml/badge.svg)](https://github.com/danillo-valle/fintrack/actions/workflows/ci.yml)

Controle financeiro da casa para duas pessoas: carteiras pessoais, uma carteira conjunta,
orçamento e importação de extratos e faturas. Construído em 12 módulos, cada um
acompanhado por uma [milestone](https://github.com/danillo-valle/fintrack/milestones).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · pnpm + Turborepo · Vitest ·
Playwright · PostgreSQL + Prisma (M04) · Better Auth (M03) · Python (M09)

## Rodando localmente

Pré-requisitos: Node 24 (veja `.node-version`) e pnpm (versão em `package.json`).

```bash
pnpm install     # instala dependências e os hooks de Git
pnpm dev         # http://localhost:3000
pnpm check       # lint, tipos, testes e build, igual ao CI
```

## Estrutura

```
apps/web/          app Next.js
packages/config/   configuração compartilhada de TypeScript
docs/adr/          decisões de arquitetura
samples/           dados sintéticos para testes (nunca dados reais)
```

## Proteções

- Hooks locais bloqueiam segredos, arquivos de extrato ou fatura e mensagens de commit fora do padrão.
- O CI repete as verificações e procura segredos em todo o histórico.
- A branch `main` só aceita pull request com CI verde.

## Licença

MIT

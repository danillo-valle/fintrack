# FinTrack

Controle financeiro da casa para duas pessoas: carteiras pessoais e uma conjunta.
Projeto de portfólio construído em módulos (M00 a M12); cada módulo é uma milestone no GitHub.

## Stack

- Monorepo com pnpm workspaces e Turborepo
- `apps/web`: Next.js 16 (App Router), React 19, TypeScript estrito, Tailwind CSS v4
- Testes: Vitest (unitários) e Playwright (ponta a ponta, a partir do M02)
- Próximos módulos: PostgreSQL + Prisma 7 (M04), Better Auth (M03), serviço Python em `services/ml` (M09)

Regras específicas do Next.js 16: @apps/web/AGENTS.md

## Comandos

- `pnpm dev` inicia o app em http://localhost:3000
- `pnpm check` roda lint, tipos, testes e build (o mesmo que o CI)
- `pnpm --filter @fintrack/web test` roda só os testes do app web
- `pnpm format` formata tudo com Prettier

Rode `pnpm check` antes de dizer que uma tarefa está pronta.

## Estrutura

- `apps/web/src/app/` rotas (páginas e rotas de API)
- `apps/web/src/features/<nome>/` uma pasta por funcionalidade, com `server/`, `ui/` e `schemas.ts`
- `apps/web/src/lib/` utilitários compartilhados
- `packages/config/` configuração compartilhada de TypeScript
- `docs/adr/` decisões de arquitetura
- `samples/` única pasta com arquivos .ofx, .pdf ou .csv, e só sintéticos

## Regras que não se negociam

- Dinheiro nunca é `number`. Use `Decimal` (a partir do M04).
- Acesso ao banco só dentro de `features/*/server/` ou `lib/`; o ESLint bloqueia o resto.
- Nenhum dado financeiro real, `.env` ou segredo em arquivo versionado.
- Código e identificadores em inglês; textos da interface, commits, PRs e documentação em português.
- Não use `any` nem `console.log`.

## Como trabalhar

- Uma branch por tarefa, a partir da `main` atualizada: `tipo/mNN-descricao-curta`.
- Commits no padrão Conventional Commits (veja a skill `commit-e-pr`).
- A `main` só recebe código por pull request com CI verde.
- Ao encontrar uma decisão de arquitetura, proponha um ADR em `docs/adr/` antes de implementar.

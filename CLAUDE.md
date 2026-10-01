# FinTrack

Controle financeiro da casa para duas pessoas: carteiras pessoais e uma conjunta.
Projeto de portfólio construído em módulos (M00 a M12); cada módulo é uma milestone no GitHub.

## Stack

- Monorepo com pnpm workspaces e Turborepo
- `apps/web`: Next.js 16 (App Router), React 19, TypeScript estrito, Tailwind CSS v4
- Interface: shadcn/ui (base Radix, estilo Nova), ícones lucide-react, tema com next-themes
- Testes: Vitest (unitários), Playwright + axe (ponta a ponta e acessibilidade)
- Próximos módulos: PostgreSQL + Prisma 7 (M04), Better Auth (M03), serviço Python em `services/ml` (M09)

Regras específicas do Next.js 16: @apps/web/AGENTS.md

## Comandos

- `pnpm dev` inicia o app em http://localhost:3000
- `pnpm check` roda lint, tipos, testes e build (o mesmo que o CI)
- `pnpm --filter @fintrack/web test` roda só os testes do app web
- `pnpm e2e` roda os testes de ponta a ponta (sobe o app sozinho, se não estiver rodando)
- `bash scripts/lighthouse-a11y.sh` mede a acessibilidade com o Lighthouse (precisa do `pnpm dev`)
- `pnpm format` formata tudo com Prettier

Rode `pnpm check` antes de dizer que uma tarefa está pronta.

## Estrutura

- `apps/web/src/app/` rotas (páginas e rotas de API)
- `apps/web/src/features/<nome>/` uma pasta por funcionalidade, com `server/`, `ui/` e `schemas.ts`
- `apps/web/src/components/ui/` componentes do shadcn/ui
- `apps/web/src/components/{layout,money,feedback}/` componentes próprios do FinTrack
- `apps/web/src/lib/` utilitários compartilhados (`money.ts`, `dates.ts`)
- `apps/web/e2e/` testes Playwright
- `/dev/ui` catálogo de componentes (só em desenvolvimento)
- `packages/config/` configuração compartilhada de TypeScript
- `docs/adr/` decisões de arquitetura
- `samples/` única pasta com arquivos .ofx, .pdf ou .csv, e só sintéticos

## Regras que não se negociam

- Dinheiro nunca é `number`. Use `Decimal` (a partir do M04).
- Acesso ao banco só dentro de `features/*/server/` ou `lib/`; o ESLint bloqueia o resto.
- Nenhum dado financeiro real, `.env` ou segredo em arquivo versionado.
- Código e identificadores em inglês; textos da interface, commits, PRs e documentação em português.
- Não use `any` nem `console.log`.
- Cores só por token do tema (`text-income`, `bg-muted`); nunca cor fixa.
- Para qualquer trabalho de interface, siga a skill `ui-componentes`.

## Como trabalhar

- Uma branch por tarefa, a partir da `main` atualizada: `tipo/mNN-descricao-curta`.
- Commits no padrão Conventional Commits (veja a skill `commit-e-pr`).
- A `main` só recebe código por pull request com CI verde.
- Ao encontrar uma decisão de arquitetura, proponha um ADR em `docs/adr/` antes de implementar.

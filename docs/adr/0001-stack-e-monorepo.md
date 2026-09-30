# ADR-001: Stack principal e organização em monorepo

- **Status:** aceita
- **Data:** 2026-10-01
- **Módulo:** M01

## Contexto

O FinTrack é um app web de finanças da casa para duas pessoas, construído como projeto
de portfólio. Precisa de interface web responsiva, API, banco relacional, autenticação
forte e, a partir do M09, um serviço Python para ler faturas em PDF. O objetivo
secundário é praticar a stack mais pedida em vagas de desenvolvimento no Brasil.

## Decisão

1. **Next.js 16 com TypeScript estrito** como app principal (interface e API no mesmo projeto).
2. **Monorepo com pnpm workspaces e Turborepo**, com `apps/` para aplicações e
   `packages/` para código compartilhado.
3. **PostgreSQL com Prisma ORM 7.x fixado**, porque o adaptador do Better Auth ainda
   exige o Prisma Client, que o Prisma 8 substituiu.
4. **Qualidade garantida por máquina**: hooks locais (lefthook) e CI no GitHub Actions
   com os mesmos comandos; a `main` só aceita PR com CI verde.

## Alternativas consideradas

- **FastAPI + React separados** (especificação de 22/09): mais peças para operar e dois
  pipelines; o Python fica restrito ao que faz melhor (PDF e classificador).
- **Repositórios separados por serviço**: dificulta mudanças que atravessam app e
  pacotes, e esconde a evolução do projeto em vários lugares.
- **Nx em vez de Turborepo**: mais recursos, mais conceitos. Turborepo basta para este tamanho.

## Consequências

- Um único `pnpm check` valida tudo; o cache do Turborepo evita repetir trabalho.
- Versões fixadas (Node no `.node-version`, pnpm no `packageManager`, Prisma 7) exigem
  revisão periódica; o Dependabot abre PRs semanais.
- Migrar para o Prisma 8 vira um módulo de manutenção quando o Better Auth suportar.

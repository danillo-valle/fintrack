# FinTrack

Controle financeiro pessoal e da casa: cada pessoa tem o seu ambiente, e ambientes compartilhados
("Casa") juntam gastos de várias pessoas. Feito para qualquer número de usuários.
Projeto de portfólio construído em módulos (M00 a M12); cada módulo é uma milestone no GitHub.

## Stack

- Monorepo com pnpm workspaces e Turborepo
- `apps/web`: Next.js 16 (App Router), React 19, TypeScript estrito, Tailwind CSS v4
- Interface: shadcn/ui (base Radix, estilo Nova), ícones lucide-react, tema com next-themes
- Testes: Vitest (unitários), Playwright + axe (ponta a ponta e acessibilidade)
- Banco: PostgreSQL 17 (container do `compose.yml`) com Prisma ORM 7 em `packages/db` (fixado no 7.x)
- Regras puras de dinheiro, datas e cartão em `packages/core` (sem I/O; testes de propriedade com fast-check)
- Autenticação: Better Auth (e-mail e senha, 2FA TOTP obrigatório, passkeys, Google opcional)
- Produção (M05): servidor de casa com Docker Compose, Caddy e Cloudflare Tunnel; imagens no GHCR;
  deploy puxado pelo servidor; backup cifrado com age (ADR-005, `docs/operacao/runbook.md`)
- Próximos módulos: lar e permissões (M06), lançamentos (M07), serviço Python em `services/ml` (M09)

Regras específicas do Next.js 16: @apps/web/AGENTS.md

## Comandos

- `pnpm db:up` sobe o Postgres e o Mailpit (e-mails de teste em http://localhost:8025)
- `pnpm dev` inicia o app em http://localhost:3000
- `pnpm db:migrate --name descricao` cria e aplica uma migração; `pnpm db:studio` abre o banco no navegador
- `pnpm db:seed` grava a casa fictícia (24 meses); `pnpm db:reset` apaga o banco, migra e roda o seed (só a pessoa roda)
- `pnpm test:integration` prova as regras do banco (CHECKs, chaves, gatilho) contra o Postgres
- `bash scripts/gerar-schema-auth.sh` atualiza as tabelas do Better Auth depois de mudar o `auth.ts`
- `pnpm check` roda lint, tipos, testes e build (o mesmo que o CI)
- `pnpm --filter @fintrack/web test` roda só os testes do app web
- `pnpm e2e` roda os testes de ponta a ponta (sobe o app sozinho, se não estiver rodando)
- `bash scripts/lighthouse-a11y.sh` mede a acessibilidade com o Lighthouse (precisa do `pnpm dev`)
- `pnpm format` formata tudo com Prettier
- `docker build --target web .` constrói a imagem de produção; `bash deploy/bin/smoke-test <url>` confere uma instância
- Produção (no servidor): `sudo -u fintrack fintrack-status` e o runbook (`docs/operacao/runbook.md`)

Rode `pnpm check` antes de dizer que uma tarefa está pronta.

## Estrutura

- `apps/web/src/app/` rotas (páginas e rotas de API)
- `apps/web/src/features/<nome>/` uma pasta por funcionalidade, com `server/`, `ui/` e `schemas.ts`
- `apps/web/src/components/ui/` componentes do shadcn/ui
- `apps/web/src/components/{layout,money,feedback}/` componentes próprios do FinTrack
- `apps/web/src/lib/` utilitários compartilhados (`money.ts`, `dates.ts`, `auth.ts`, `auth-client.ts`, `env.ts`)
- `apps/web/src/lib/auth/` regras de acesso: `session.ts` (requireUser), `routes.ts`, `reauth.ts`
- `apps/web/src/features/auth/` telas e actions de login, 2FA, passkeys e sessões
- `apps/web/src/proxy.ts` redireciona quem não tem sessão (conveniência, não barreira)
- `packages/core/` regras puras: `money.ts` (centavos, rateio, parcelas), `dates.ts`, `card.ts`
- `packages/db/` schema em pasta (`prisma/schema/`), migrações, seed, cliente e `money.ts` (Decimal ⇄ centavos)
- `docs/modelo-de-dados.md` diagrama das tabelas (conferido por teste)
- `apps/web/e2e/` testes Playwright
- `/dev/ui` catálogo de componentes (só em desenvolvimento)
- `packages/config/` configuração compartilhada de TypeScript e ESLint (com a trava de dinheiro)
- `docs/adr/` decisões de arquitetura
- `samples/` única pasta com arquivos .ofx, .pdf, .csv ou planilhas (.xlsx, .xlsm...), e só sintéticos
- `Dockerfile` imagens `web` e `migrate`; `deploy/` produção (compose, Caddyfile, scripts, systemd)
- `docs/operacao/runbook.md` o que fazer em cada situação da produção

## Regras que não se negociam

- Dinheiro nunca é `number`: `bigint` em centavos no código, `Decimal(14,2)` no banco. Veja o ADR-004.
- Lançamento separa "quem paga" (conta, cartão, forma de pagamento) de "de quem é" (ambiente = `Wallet`).
- Cartão: só os 4 últimos dígitos. Nunca número completo, validade ou CVV em lugar nenhum.
- Mudança no banco: siga a skill `prisma-migration`. Nunca edite migração aplicada; nunca rode reset sem a pessoa pedir.
- Acesso ao banco só dentro de `features/*/server/` ou `lib/`; o ESLint bloqueia o resto.
- Toda página de `(app)` e toda Server Action começam com `await requireUser()`; siga a skill `auth-guard`.
- Variáveis de ambiente novas: no `.env.example` (sem valor real), no `src/lib/env.ts` (validação), no `globalPassThroughEnv` do `turbo.json` e no `deploy/env/app.env.example`; avise no PR que o valor de produção vai em `/srv/fintrack/app.env` antes do merge.
- Log no servidor só pelo `logger` (`src/lib/logger.ts`), com `event`; migração para produção sempre aditiva. Siga a skill `deploy-e-operacao`.
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

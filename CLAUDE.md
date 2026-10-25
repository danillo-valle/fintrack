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
- Lar, carteiras e permissões (M06): matriz de papéis pura, crachá tipado e auditoria (ADR-006, `docs/permissoes.md`)
- Lançamentos, contas e categorias (M07): lançamento rápido, lista com filtros na URL e cursor, transferência,
  recorrências, CSV com reautenticação, cascata de categorização pronta para IA (ADR-007)
- Orçamento e painel (M08): orçado por ambiente e por pessoa, previsto no ritmo do mês, fluxo de caixa de 6 meses,
  evolução mês a mês; todo número leva à lista; somas com `"use cache"` e etiqueta por lar (ADR-010)
- Coleta bancária (M09.1): Meu Pluggy com credenciais cifradas, busca diária na fila pg-boss (no próprio
  Postgres), tudo do banco entra como Recebido e fica fora das somas até a revisão; fatura aberta calculada
  e fechada conferida ao centavo (ADR-011)
- Revisão e reconciliação (M09.2): recebidos confirmados um a um ou em lote, par com o seu lançamento
  (mesmo valor, até 5 dias; a parcela pelo número), estorno ligado à compra, "Desfazer" e o final de
  cartão que o banco mandou e não está cadastrado (ADR-012)
- Importar extrato (M09.3): arquivo OFX (1.x e 2.x) lido na memória e descartado, conferência antes de
  gravar, conta sugerida pelo final, nada duplicado (o mesmo id ou o que já veio pelo Meu Pluggy) (ADR-013)
- Fatura em PDF (M09.4): serviço Python `services/ml` (FastAPI, pdfplumber, uv) só na rede interna, com
  token curto do Better Auth (JWKS); leitor genérico com perfis, senha pedida na hora e nunca guardada,
  a fatura conferida ao centavo e gravada com os encargos; mesma conferência do OFX (ADR-014)
- Categorização inteligente (M10.1): a cascata regras → histórico → categoria do banco → classificador
  (scikit-learn no `services/ml`, um modelo por carteira, treino às 03:15 e "Treinar agora"), a etiqueta
  de quem sugeriu com a confiança, "Por que essa categoria?" e Ajustes › Categorização com o percentual
  sem IA; conjunto rotulado sintético e eval no CI (mínimo 85 %) (ADR-015)
- Medição do LLM local (M10.2a): `services/ml/bench/` (fora da imagem) sobe o llama-server num container
  com teto no servidor de casa e mede a tabela do ADR-007 com itens sintéticos; a decisão vem num ADR
- IA local (M10.2b, ADR-016): Qwen2.5 3B no llama-server, container `llm` só das 04:40 às 06:45
  (timers `fintrack-llm-*`), rede interna que só o `ml` alcança; fila `local-ai-nightly` das 04:45
  às 06:40, até 200 por lar por noite, só nas cargas do banco que ficaram sem categoria; filtro antes
  do LLM, resposta presa por schema; propõe categoria nova ("Criar e aplicar"); desligada por padrão
- Resumo do mês (M10.3, ADR-017): no topo do Início, até três observações por regras puras
  (`packages/core/src/month-summary.ts`: orçado que estoura, acima do costume, conta fixa nova), na
  hora, no cache do M08; do dia 1 ao 5, o mês anterior fechado; cada número leva à lista
- Bot do WhatsApp (M11.1, ADR-018): webhook `/api/whatsapp/webhook` com assinatura sobre o corpo cru,
  mensagem uma vez só (wamid) e fila `bot-message`; vínculo por código de 6 dígitos (10 min, prova
  de identidade recente); leitor determinístico (`packages/core/src/bot-parse.ts`, sem LLM); a
  mensagem vira rascunho (`bot_draft`) e o Confirmar cria o lançamento pelo caminho do formulário
  (`source BOT`); número só como HMAC, texto cifrado e apagado ao ler; respostas grátis contadas
  (aviso em 850, para em 900); Ajustes › Bot do WhatsApp e Recebidos › Do WhatsApp. Sem as
  variáveis `WHATSAPP_*`, o bot fica desligado no servidor
- Bot na Meta (M11.2 e M12.0, adendos do ADR-018): número de produção (só responde; nenhum template
  nem forma de pagamento), app em modo de desenvolvimento, token permanente do usuário do sistema, a
  conta assinada no app (`subscribed_apps`), Graph API `v26.0`; recusa da Meta no log só como código
  (`bot.send_failed`, `META_ERROR_HINTS`); o runbook tem o passo a passo e os códigos
- Bot pelo Telegram (M12.0b, ADR-019): segundo canal do mesmo bot (Ajustes › Bot de lançamento, um
  cartão por canal); webhook `/api/telegram/webhook` com o segredo do cabeçalho antes do corpo; vínculo
  pelo `/start <código>` do link "Abrir no Telegram"; a conta só como HMAC (`bot_telegram_link`); a
  resposta a um toque edita a mensagem do botão; o número de cartão sai da conversa. Sem as variáveis
  `TELEGRAM_*`, o Telegram fica desligado no servidor
- Segurança contínua (M12.1, ADR-020): OWASP Top 10:2025 item por item em `docs/seguranca/owasp-top10-2025.md`;
  ZAP passivo contra a imagem no CI (sem sessão e com conta de teste, `scripts/zap/`) e OSV-Scanner nos dois
  lockfiles, os dois barrando o PR; CSP com `<style>` só por nonce ou hash; ações do CI presas pelo commit;
  tentativas recusadas do login no log (`auth.*`) e na seção "Segurança" do `fintrack-status`

Regras específicas do Next.js 16: @apps/web/AGENTS.md

## Comandos

- `pnpm db:up` sobe o Postgres e o Mailpit (e-mails de teste em http://localhost:8025)
- `pnpm dev` inicia o app em http://localhost:3000
- `pnpm db:migrate --name descricao` cria e aplica uma migração; `pnpm db:studio` abre o banco no navegador
- `pnpm db:seed` grava a casa fictícia (24 meses); `pnpm db:reset` apaga o banco, migra e roda o seed (só a pessoa roda)
- `SEED_VIEWER_EMAIL=<conta de teste> pnpm db:seed` põe uma conta de TESTE na casa fictícia (ver o painel com 24 meses)
- `pnpm test:integration` prova as regras do banco (CHECKs, chaves, gatilho) contra o Postgres
- `bash scripts/gerar-schema-auth.sh` atualiza as tabelas do Better Auth depois de mudar o `auth.ts`
- `pnpm check` roda lint, tipos, testes e build (o mesmo que o CI)
- `pnpm --filter @fintrack/web test` roda só os testes do app web
- `pnpm e2e` roda os testes de ponta a ponta (sobe o app, a Pluggy de mentira, o serviço Python, a Cloud API do
  WhatsApp e o Telegram de mentira, se não estiverem rodando)
- `pnpm ml:dev` sobe o serviço Python (fatura em PDF e classificador) em http://127.0.0.1:8001 (precisa do
  uv; `pnpm --filter @fintrack/ml test` roda o pytest, `pnpm --filter @fintrack/ml eval` o eval do
  classificador; os modelos do desenvolvimento ficam em `services/ml/.modelos`, fora do Git)
- `pnpm pluggy:fake` sobe a Pluggy de mentira (banco sintético) em http://127.0.0.1:8787, para o `pnpm dev`
- `pnpm whatsapp:fake` sobe a Cloud API do WhatsApp de mentira em http://127.0.0.1:8789 (o papel da Meta e
  da pessoa que escreve para o bot; veja a skill `bot-whatsapp`)
- `pnpm telegram:fake` sobe o Telegram de mentira em http://127.0.0.1:8790 (o papel da Bot API e da pessoa)
- `bash scripts/zap/varrer.sh http://localhost:3000 relatorios-zap [cookie]` roda a varredura passiva do ZAP
  (a mesma do CI; precisa do Docker e do build de produção no ar, não do `pnpm dev`: runbook, "Segurança")
- `bash scripts/lighthouse-a11y.sh` mede a acessibilidade com o Lighthouse (precisa do `pnpm dev`)
- `pnpm format` formata tudo com Prettier
- `docker build --target web .` constrói a imagem de produção; `bash deploy/bin/smoke-test <url>` confere uma instância
- Produção (no servidor): `sudo -u fintrack fintrack-status` e o runbook (`docs/operacao/runbook.md`)

Rode `pnpm check` antes de dizer que uma tarefa está pronta.

## Estrutura

- `apps/web/src/app/` rotas (páginas e rotas de API)
- `apps/web/src/features/<nome>/` uma pasta por funcionalidade, com `server/`, `ui/` e `schemas.ts`
- `apps/web/src/components/ui/` componentes do shadcn/ui
- `apps/web/src/components/{layout,money,feedback,visual}/` componentes próprios do FinTrack;
  `components/layout/sidebar/` o menu lateral (estado, alça, itens)
- `apps/web/src/lib/` utilitários compartilhados (`money.ts`, `dates.ts`, `auth.ts`, `auth-client.ts`, `env.ts`)
- `apps/web/src/lib/auth/` regras de acesso: `session.ts` (requireUser), `routes.ts`, `reauth.ts`
- `apps/web/src/features/auth/` telas e actions de login, 2FA, passkeys e sessões
- `apps/web/src/lib/access.ts` ponto único de autorização: `requireWalletAccess`, `requireHouseholdAccess`, `runAction`
- `apps/web/src/features/{households,wallets}/` lar, convites e carteiras (M06)
- `apps/web/src/features/transactions/` lançar, listar (filtros na URL, cursor, totais), transferir, recorrências,
  exportar (M07); `features/{accounts,categories}/` contas, cartões, categorias e regras
- `apps/web/src/features/budget/` Início (painel), Orçamento, Fluxo de caixa, Evolução e "Editar valores" (M08):
  `links.ts` (o caminho de cada número até a lista), `server/data.ts` (somas com cache), `server/queries.ts`
- `apps/web/src/features/bank/` conexões bancárias (M09.1): credenciais, ligar contas, fila de busca
  (`server/jobs.ts`), página do cartão, recebidos e a categoria em um clique (`ui/category-picker.tsx`);
  a revisão do M09.2 em `server/review.ts`, `server/review-actions.ts` e `ui/review/`; o extrato OFX
  do M09.3 e a fatura em PDF do M09.4 em `server/imports.ts`, `server/import-actions.ts` e `ui/import/`
- `apps/web/src/lib/finance-cache.ts` etiqueta do cache das somas e `financeChanged` (chamado por toda action de dinheiro)
- `apps/web/src/lib/labels.ts` nomes em português de formas de pagamento, tipos de conta etc.
- `apps/web/src/proxy.ts` redireciona quem não tem sessão (conveniência, não barreira)
- `packages/core/` regras puras: `money.ts` (centavos, rateio, parcelas), `dates.ts`, `card.ts`, `access.ts` (matriz de papéis),
  `transactions.ts` (sinal, forma × conta, cursor, recorrência), `categorization.ts` (cascata), `csv.ts`,
  `payer.ts` ("Pago por", M07.4), `budget.ts` (previsto, orçado × realizado, divisão), `dashboard.ts` (somas por
  recorte, evolução) e `cashflow.ts` (fluxo de caixa) do M08
- `packages/db/` schema em pasta (`prisma/schema/`), migrações, seed, cliente, `money.ts` (Decimal ⇄ centavos),
  `access.ts` (crachás), `households.ts`, `wallets.ts` e `audit.ts` (operações com auditoria),
  `transactions.ts`, `accounts.ts`, `categories.ts` (camadas da cascata) e `recurrences.ts` (M07),
  `installments.ts` (compra parcelada, M07.4), `budgets.ts` (orçado, divisão, cópia) e `dashboard.ts` (somas do painel, M08)
- `packages/importers/` os provedores de dados do banco (`TransactionProvider`, Meu Pluggy, JSON com
  dinheiro exato), o leitor de OFX (`ofx/`, M09.3), o cliente do serviço de PDF (`pdf/`, M09.4) e, em
  `testing/`, o banco sintético e a Pluggy de mentira
- `services/ml/` o serviço Python (M09.4): `app/fatura.py` (leitor), `app/perfis.py` (um perfil por banco),
  `app/auth.py` (token pelo JWKS), `app/estrutura.py` (a estrutura de um PDF real, sem valores); do M10.1:
  `app/classificador.py` (modelo por carteira, trava da evidência, armazém), `app/avaliar.py` (eval e bloco do
  README) e `scripts/gerar_rotulado.py` (o conjunto sintético em `samples/categorizacao/`); do M10.2a:
  `bench/` (a medição do LLM local: prompt e schema, conjuntos, monitor, relatório e `medir-llm.sh`)
- `packages/db/src/` do M09.1: `connection-secret.ts` (AES-256-GCM), `connections.ts` (credenciais e ligação),
  `sync.ts` (a busca idempotente) e `statements.ts` (faturas); `packages/core/src/sync.ts` as regras puras;
  do M09.2: `packages/db/src/review.ts` (fila, par, estorno, lote, desfazer) e `packages/core/src/reconcile.ts`;
  do M09.3: `packages/db/src/file-imports.ts` (conferência e importação) e `packages/core/src/file-import.ts`
- `apps/web/src/features/bot/` o bot (M11; o Telegram no M12.0b): webhooks, fila, Ajustes › Bot de lançamento,
  o código de vínculo e as propostas em Recebidos; `apps/web/src/lib/whatsapp/` o protocolo da Meta e o canal;
  `apps/web/src/lib/telegram/` o protocolo e o canal do Telegram; `apps/web/src/lib/bot/` as chaves e o erro de canal;
  `apps/web/src/lib/jobs.ts` o pg-boss e todas as filas do app; `packages/db/src/bot.ts` e
  `packages/core/src/bot{,-parse}.ts` as regras
- `docs/permissoes.md` quem pode fazer o quê (conferido por teste)
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
- Formulário com Server Action: a action vai direta do `useActionState` para o `<form action>`, sem função em volta
  (senão o clique antes do React carregar se perde). Use o `ActionForm`; veja a skill `ui-componentes`.
- Formulário que só funciona com o React (envio no `onSubmit`, como o cliente do Better Auth) usa o `ClientForm`:
  sai com `method="post"`, para um clique antes do React não pôr senha, e-mail ou código na URL (M10.0).
  Nenhum `<form>` cru sem `action` ou `method`.
- Tudo que toca uma carteira ou o lar passa pelo crachá (`requireWalletAccess`/`requireHouseholdAccess`);
  recurso de outra pessoa responde 404. Funcionalidade nova: siga a skill `nova-feature` (e `teste-e2e`).
- Categorização (sugestão, regras, camadas de IA): siga a skill `categorizacao`. A sugestão só lê as carteiras
  que quem pede consegue ver (o classificador só pergunta aos modelos dessas carteiras); LLM nunca no caminho
  do lançamento. Modelo treinado com dado real só no volume da produção; descrição nunca em log.
- Variáveis de ambiente novas: no `.env.example` (sem valor real), no `src/lib/env.ts` (validação), no `globalPassThroughEnv` do `turbo.json` e no `deploy/env/app.env.example`; avise no PR que o valor de produção vai em `/srv/fintrack/app.env` antes do merge.
- Log no servidor só pelo `logger` (`src/lib/logger.ts`), com `event`; migração para produção sempre aditiva. Siga a skill `deploy-e-operacao`.
- Nenhum dado financeiro real, `.env` ou segredo em arquivo versionado.
- Bot (WhatsApp e Telegram): siga a skill `bot-whatsapp`. O webhook confere a assinatura antes de ler o JSON e responde
  igual para tudo; nenhum LLM no caminho do bot; a resposta nunca mostra final de cartão, saldo ou outro
  lançamento; número só como HMAC, texto nunca em log; o lançamento nasce no Confirmar, pelo caminho do
  formulário.
- Segurança: siga a skill `seguranca`. Mudança que mexe num item do OWASP atualiza o documento no mesmo PR;
  exceção no ZAP ou no OSV só com o motivo e a prova; SQL só parametrizado; nada de `unsafe-inline` em script ou
  `<style>` de produção.
- Dados do banco: siga a skill `importador`. Resposta de banco em teste é sintética, escrita à mão; nenhum
  teste chama a Pluggy de verdade; Client ID, Client Secret e tokens nunca em log, Git ou navegador.
- Código e identificadores em inglês; textos da interface, commits, PRs e documentação em português.
- Não use `any` nem `console.log`.
- Cores só por token do tema (`text-income`, `bg-muted`); nunca cor fixa.
- Todo número do painel leva aos lançamentos que o compõem (`MoneyLink` + `transactionsHref`), e a lista soma o
  mesmo valor (E2E). Toda action que muda dinheiro chama `financeChanged` (cache das somas, ADR-010).
- Para qualquer trabalho de interface, siga a skill `ui-componentes` (visual "Elétrico", ADR-008: vidro só
  na moldura, contraste conferido pelo `theme-contrast.test.ts`, novo lançamento em modal de rota).
  A referência visual é o canvas "FinTrack Visual" (linhas C.2 a G): tela nova é desenhada lá antes do código.
- Mudança nova entra como estrutura, não como remendo: peça visual repetida vira componente em
  `components/visual/`, peça de domínio fica em `features/<nome>/ui/`, regra de negócio vai para
  `packages/core` (com teste). Se a peça nova muda quem a chama, atualize toda a cadeia de chamadas.

## Como trabalhar

- Uma branch por tarefa, a partir da `main` atualizada: `tipo/mNN-descricao-curta`.
- Commits no padrão Conventional Commits (veja a skill `commit-e-pr`).
- A `main` só recebe código por pull request com CI verde.
- Ao encontrar uma decisão de arquitetura, proponha um ADR em `docs/adr/` antes de implementar.

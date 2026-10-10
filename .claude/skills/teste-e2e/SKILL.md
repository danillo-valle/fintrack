---
name: teste-e2e
description: Como escrever e rodar os testes de ponta a ponta do FinTrack com Playwright (explorar com o Playwright MCP, gravar como spec versionado com seletores por papel, IDOR, várias pessoas, axe e foco). Use ao criar ou mudar arquivos em apps/web/e2e, ao reproduzir um bug pelo navegador, ou quando uma tela nova precisar de teste.
---

# Testes de ponta a ponta

Referência: `apps/web/e2e/permissoes.spec.ts` (M06) e `apps/web/e2e/helpers.ts`.

## Explorar primeiro, gravar depois

1. Com `pnpm dev` no ar, use o **Playwright MCP** (registrado no `.mcp.json`) para abrir a tela,
   navegar pelo snapshot de acessibilidade e reproduzir o caminho (ou o bug).
2. Transforme o que funcionou num spec em `apps/web/e2e/<assunto>.spec.ts`. O MCP é para
   descobrir; o que garante é o spec, que roda em todo PR no CI.

## Regras do spec

- **Seletores por papel e rótulo**: `getByRole("button", { name: "Aceitar convite" })`,
  `getByLabel("Nome do lar")`. Nada de classe CSS ou `nth-child`. Texto que aparece em mais de
  um lugar: `{ exact: true }` ou restrinja pela região (`getByRole("region", { name: "Pessoas" })`).
- **Abra páginas com `openPage(page, caminho)`**: espera a hidratação (nada digitado se perde).
- **Dados próprios por teste**: e-mails com `testEmail(slug, testInfo.project.name)` (desktop e
  celular rodam juntos); lares com `createHouseholdDirect` e apagados no `afterEach`
  (`deleteHouseholds`). Nunca mude o lar da Ana (`ANA_HOUSEHOLD`): ele alimenta `PAGES`.
- **Várias pessoas**: `personInNewTab(browser, email, nome, aparelho)` (`helpers.ts`): contexto
  próprio (cookies separados, como outro celular) com a conta já logada e com 2FA.
- **Dinheiro (M07)**: a Ana tem contas, categorias, uma regra e um lançamento fixos
  (`ANA_FINANCE`), para as telas entrarem em `PAGES`. Mas ela é usada por testes que rodam ao mesmo
  tempo: teste que confere SOMA ou CONTAGEM cria um lar próprio (`createHouseholdDirect` +
  `createFinanceDirect`) e compara a tela com um `SELECT` do banco.
- **Painel (M08)**: todo número com `data-cents` leva à lista; o teste abre o `href` e compara
  com `total-saidas`/`total-entradas` (`expectListMatches` em `painel.spec.ts`). Desempenho com
  24 meses: o seed com `SEED_VIEWER_EMAIL` põe uma conta de teste na casa do exemplo (só no
  desktop, porque o seed é um só).
- **Telas escondidas (Cache Components, M08)**: o Next guarda as 3 últimas telas no documento
  com `display: none`. `getByRole` já ignora o escondido; `getByLabel`, `getByText` e
  `locator(...)` não: use `.filter({ visible: true })` (o `formAlert` dos helpers já filtra).
- **Antes do React carregar (M08)**: o `data-hydrated` marca só a moldura; o conteúdo da página
  vem em Suspense e hidrata depois. O `openPage` espera também a marca do `ContentReady` (no
  `PageHeader`) virar "pronto", o que só acontece depois do commit (`waitForContent`); depois de
  navegar de outro jeito (clique num link, `goBack`) e antes de digitar, chame `waitForContent(page)`.
  Não espere pela chave `__reactFiber$`: o React a grava antes do commit. Todo `<form>` precisa
  funcionar sem o React:
  `formularios.spec.ts` confere o HTML de cada página de `PAGES` e envia um formulário com os
  pacotes de JavaScript barrados.
- **Esquema de URL por lista permitida**: para conferir para onde um link ou formulário aponta, leia o
  `protocol` de `new URL(...)` e aceite só `http:`/`https:`. Nunca `startsWith("javascript:")`: o CodeQL
  acusa (js/incomplete-url-scheme-check, alta) e trava o PR, mesmo em arquivo de teste.
- **Tempo é medido no build de produção**: limite de tempo (`toBeLessThan(ms)`) só com
  `test.skip(!PRODUCTION_BUILD, …)`. No `pnpm dev` o número mede a máquina. A suíte contra a imagem
  local (`PLAYWRIGHT_PRODUCTION=1 pnpm e2e`, passo do manual do M08) roda esses testes.
- **Deslogado**: `test.use({ storageState: NO_SESSION })`.
- **E-mail**: `clearEmails(destino)` antes, `linkFromEmail(destino, /assunto/)` depois.
- **Acessibilidade**: tela nova entra em `PAGES` (axe claro/escuro, foco, proteção); estados que
  só existem no meio de um fluxo ganham `expectNoA11yViolations(page)` no próprio teste.
- **IDOR**: para cada tela com id na URL, um teste em que outra pessoa abre a URL e recebe a
  página 404 **sem nenhum dado** no HTML (`page.content()` não contém o nome do recurso), igual
  à de um id inexistente. (O status sai 200 por causa do streaming; veja o ADR-006.)
- **Nada de** `test.only`, `test.skip` sem motivo escrito, `waitForTimeout`, aumentar timeout
  para "passar". Espere por estado visível (`toBeVisible`, `toHaveURL`).

## Rodar

```bash
pnpm e2e                                                       # tudo (sobe o app se precisar)
pnpm --filter @fintrack/web exec playwright test e2e/permissoes.spec.ts --project=desktop
pnpm --filter @fintrack/web exec playwright show-report        # relatório HTML da última execução
```

Teste instável não se conserta com retry: rode a suíte inteira várias vezes seguidas, ache a
corrida (dado compartilhado entre testes, medida antes da animação) e corrija a causa.

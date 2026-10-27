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
  navegar de outro jeito (clique num link, `goBack`, envio que troca de página) e antes de digitar,
  chame `waitForReady(page)` (moldura + conteúdo). As telas de entrada têm a mesma marca no `AuthCard`
  (M10.0). O `waitForContent` só conta a marca do que está à vista: uma tela guardada pelo
  `<Activity>` (com `display: none`) não roda efeitos e pode ficar em "carregando" para sempre. Não espere pela chave `__reactFiber$`: o React a grava antes do commit. Todo `<form>`
  precisa funcionar sem o React, ou pelo menos não vazar nada: `formularios.spec.ts` confere o HTML
  de `PAGES` e `PUBLIC_PAGES` (todo formulário declara o método; senha, e-mail ou código só por POST)
  e envia formulários com os pacotes de JavaScript barrados.
- **Esperar o servidor, não o relógio (M10.0)**: aviso, URL ou lista que só mudam depois de uma
  resposta do servidor são conferidos DEPOIS dela. Clique com `clickAndWait(botão, serverAction)`
  (Server Action) ou `clickAndWait(botão, authEndpoint("/change-password"))` (cliente do Better
  Auth); o `router.refresh()` que vem depois espera-se com `page.waitForResponse(pageData(caminho))`,
  registrado ANTES do clique; navegação depois da resposta, com `page.waitForURL(...)` e
  `waitForReady`. O `expect` fica só para o que a tela mostra quando o estado já chegou. Foi assim
  que os três E2E que só caíam na suíte inteira do N150 foram corrigidos: o trace mostrava o pedido
  ainda sem resposta (`status -1`) quando os 5 s do `expect` acabavam.
- **Diagnóstico por escopo**: um teste por vez, `--trace=retain-on-failure
--output=test-results/<nome>` (sempre dentro de `test-results/`, que o Git e o Prettier ignoram).
  Para ver a ordem dos pedidos no trace, leia o `trace.network` do zip (método, URL, status, tempo).
  O Playwright usa metade dos núcleos como workers: no N150 (4 núcleos) são 2; no laboratório de 2
  núcleos, `--workers=2` já põe o dobro de carga por núcleo.
- **Esquema de URL por lista permitida**: para conferir para onde um link ou formulário aponta, leia o
  `protocol` de `new URL(...)` e aceite só `http:`/`https:`. Nunca `startsWith("javascript:")`: o CodeQL
  acusa (js/incomplete-url-scheme-check, alta) e trava o PR, mesmo em arquivo de teste.
- **Tempo é medido no build de produção**: limite de tempo (`toBeLessThan(ms)`) só com
  `test.skip(!PRODUCTION_BUILD, …)`. No `pnpm dev` o número mede a máquina. O CI e o
  `pnpm e2e:producao` rodam contra o build de produção, então esses testes rodam em todo PR.
- **O CI roda contra o build de produção (M12.2, ADR-021)**: o servidor standalone
  (`e2e/production-server.ts`), em 3 partes (`--shard`). Teste que só faz sentido no `pnpm dev` (o
  catálogo `/dev/ui`) leva a etiqueta `@dev` (`{ tag: DEV_ONLY }`, ou `pageTags(caminho)` nos testes
  gerados de `PAGES`): o job `e2e-dev` roda só esses. Sem a etiqueta, o teste seria pulado no CI sem
  ninguém ver. As partes rodam em qualquer ordem e máquina: nenhum teste depende de outro ter
  rodado antes (dados próprios por teste, como acima).
- **A falha no CI**: o relatório juntado (artefato `relatorio-playwright`) tem o trace da 1ª tentativa
  de cada falha, também das "flaky" (que passaram na repetição). Leia o trace antes de mexer no teste
  (runbook, "O CI barrou o PR por causa do E2E").
- **Banco (M09.1)**: nenhum teste fala com a Pluggy de verdade. O `playwright.config.ts` sobe a
  Pluggy de mentira (`pnpm pluggy:fake`, porta 8787, banco sintético de
  `@fintrack/importers/testing`) e aponta o app para ela (`PLUGGY_API_URL`). Credenciais:
  `SYNTHETIC_CREDENTIALS`; bancos: `SYNTHETIC_IDS`. Referência: `coleta-bancaria.spec.ts`.
- **WhatsApp (M11)**: nenhum teste fala com a Meta. O `playwright.config.ts` sobe a Cloud API de
  mentira (`pnpm whatsapp:fake`, porta 8789) com os valores de `e2e/whatsapp.ts` (`WHATSAPP_FAKE`).
  O teste faz o papel da pessoa com `sendToBot({ from, text | button })` e lê as respostas com
  `waitForReply(phone, /regex/)`. Telefone inventado e único: `fakePhone(n, project)`. A mesma
  `wamid` de novo = a reentrega da Meta. Referência: `bot-whatsapp.spec.ts` (a assinatura errada é
  testada com a mutação: sem a conferência, o teste falha).
- **Internet (M12.2)**: nenhum teste depende dela. Todo serviço de fora tem a versão de mentira ou
  fica desligado no `env` do app no `playwright.config.ts`; a consulta de senhas vazadas (Have I
  Been Pwned, no cadastro e na troca de senha) vai com `HIBP_CHECK: "off"`, como no CI, mesmo com o
  `.env` de casa ligado. Serviço de fora novo entra ali no mesmo PR.
- **Esperar trabalho em segundo plano** (a fila do pg-boss): `expect.poll` recarregando a página,
  e dentro do poll **nada que espere** (`count()`, não `textContent()` de algo que pode não existir:
  ele fica parado até o fim do poll e a página nunca é recarregada).
- **Deslogado**: `test.use({ storageState: NO_SESSION })`.
- **E-mail**: `clearEmails(destino)` antes, `linkFromEmail(destino, /assunto/)` depois.
- **Acessibilidade (axe em todas as telas, M12.2)**: tela nova entra em `PAGES` ou `PUBLIC_PAGES` (axe
  claro/escuro, foco, CSP, proteção); tela que só existe no meio de um fluxo (precisa de um código, de
  um arquivo ou de um par) ganha `expectNoA11yViolations(page)` no teste do fluxo, com a tela à vista.
  Toda rota de `src/app` tem de cair num dos dois.
- **IDOR**: para cada tela com id na URL, um teste em que outra pessoa abre a URL e recebe a
  página 404 **sem nenhum dado** no HTML (`page.content()` não contém o nome do recurso), igual
  à de um id inexistente. (O status sai 200 por causa do streaming; veja o ADR-006.)
- **Nada de** `test.only`, `test.skip` sem motivo escrito, `waitForTimeout`, aumentar timeout
  ou `retries` para "passar". Espere pelo estado: a resposta do servidor (`clickAndWait`), a URL
  (`waitForURL`), a tela ligada (`waitForReady`), e só então o que ficou visível.

## Rodar

```bash
pnpm e2e                                                       # tudo (sobe o app se precisar)
pnpm --filter @fintrack/web exec playwright test e2e/permissoes.spec.ts --project=desktop
pnpm --filter @fintrack/web exec playwright show-report        # relatório HTML da última execução
pnpm e2e:producao                                              # build de produção + suíte inteira (como o CI)
pnpm --filter @fintrack/web exec playwright test --grep @dev   # só os testes do pnpm dev (job e2e-dev)
pnpm capturas                                                  # as capturas do README (docs/capturas)
```

Teste instável não se conserta com retry: rode a suíte inteira várias vezes seguidas, ache a
corrida (dado compartilhado entre testes, medida antes da animação) e corrija a causa.

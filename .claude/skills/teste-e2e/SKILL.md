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
- **Várias pessoas**: `browser.newContext()` por pessoa (cookies separados) e
  `createTestUser(page.request, ...)` nesse contexto (a conta já sai logada nele).
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

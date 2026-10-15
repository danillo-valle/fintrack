---
name: importador
description: Como os dados do banco entram no FinTrack (Meu Pluggy, extrato OFX; PDF no M09.4) - a interface TransactionProvider, dinheiro exato desde o JSON, a sincronização idempotente na fila pg-boss, recebidos fora das somas, faturas e o banco sintético dos testes. Use ao mexer em packages/importers, em packages/db/src/sync.ts, connections.ts, statements.ts ou file-imports.ts, em features/bank, ao criar um importador novo ou ao escrever teste com resposta de banco.
---

# Importador (dados do banco)

Decisões: `docs/adr/0011-coleta-bancaria.md`. Tabelas: `docs/modelo-de-dados.md`, seção
"Coleta bancária". Operação: `docs/operacao/runbook.md`, "Busca do banco".

## O caminho de um dado do banco

1. `packages/importers`: o provedor fala com a fonte e devolve tipos próprios
   (`ProviderAccount`, `ProviderTransaction`, `ProviderBill`). Nenhum tipo da Pluggy sai daqui.
2. `packages/db/src/sync.ts` (`runSync`): grava saldos, faturas e lançamentos numa execução
   (`SyncRun`), com a cascata de categorização e o ambiente certo de cada compra.
3. `apps/web/src/features/bank/server/jobs.ts`: a fila (pg-boss) chama o `runSync`, uma busca
   por conexão por vez. A tela só pede (`enqueueSync`); nunca roda a busca dentro da requisição.
4. Tudo chega como `PENDING` (Recebido) e fica fora das somas até a revisão.
5. A revisão (M09.2, ADR-012): `packages/core/src/reconcile.ts` sugere o par (mesma conta, mesmo
   valor, até 5 dias; a parcela pelo número), o estorno e o lote; `packages/db/src/review.ts`
   confere a regra de novo e grava a decisão (`transaction_match`), com "Desfazer". Ao juntar,
   fica o recebido (que tem o id do banco) com o lado da pessoa; o lançamento dela fica apagado
   com `mergedIntoId`. Importador novo (OFX, PDF) entra como `PENDING` e ganha a revisão de graça.
6. O cartão de cada compra vem do final (`cardForLastFour`): final desconhecido fica sem cartão
   (nunca no titular) e o final vai para `providerCardLastFour`; cadastrar o cartão reorganiza
   os recebidos (`rerouteReceived`).

## Regras que não se negociam

- **Dinheiro nunca passa por `number`**, nem no JSON: `parseExactJson` + `moneyFromText`
  (centavos `bigint`). Teste novo de valor usa texto (`"2146.35"`), não número.
- **Só os 4 últimos dígitos** (`lastFourOf`). Número completo, validade ou CVV que venham da
  fonte são descartados no adaptador, antes de qualquer gravação ou log.
- **Segredo nunca em log, auditoria, erro ou resposta**: erro da fonte vira código
  (`ProviderError`, `PROVIDER_*`); o Client Secret só é decifrado dentro da busca
  (`ProviderSource` como função), e a chave de acesso da API vive só na memória.
- **Idempotência**: toda linha importada tem `externalId` estável da fonte; a chave única é
  `(accountId, source, externalId)`. Rodar duas vezes cria zero. `CONFIRMED` nunca é alterado
  por importação; `PENDING` só muda nos campos de `importChanges`.
- **Data de corte**: nada antes de `importFrom` entra (`importWindow`).
- **Quem vê**: a cascata roda com o escopo de quem vai ver o lançamento (skill `categorizacao`);
  o adicional de outra pessoa vai para o ambiente dela (`importWalletFor`).
- **Recebido fora das somas**: consulta nova de total ou painel filtra `status <> 'PENDING'`
  (há teste de integração para a lista, os totais e o painel).

## Extrato OFX (M09.3, ADR-013)

- Leitor puro: `packages/importers/src/ofx/parse.ts` (`parseOfx`, `sniffOfx`, `fileFingerprint`).
  OFX 1 (SGML, latin-1) e 2 (XML); até 2 MB (`MAX_OFX_BYTES`); tipo pelos primeiros bytes;
  erros como código `OFX_*`, sem dado do arquivo.
- `externalId` = FITID; sem FITID ou repetido, hash estável (`h:` + 32 hex) de FITID + data +
  valor + descrição + a ordem entre as linhas iguais.
- Duas etapas (`packages/db/src/file-imports.ts`): `createFilePreview` (só o resumo, o SHA-256
  e as linhas lidas, 1 hora, só de quem enviou) e `importFilePreview` (confere de novo e grava).
  O arquivo nunca é gravado em disco, log ou auditoria.
- Sem duplicar (`classifyImportRows`, core): "já importado" (mesmo id na conta) e "já veio pelo
  Meu Pluggy" (recebido `OPEN_FINANCE` com o mesmo valor e a mesma data, um para um).
- Conta sugerida: `suggestImportAccount` (arquivo anterior do mesmo banco e final, final do
  cartão, única do tipo). Importa só quem edita a carteira da conta.
- Sem reautenticação (decisão do ADR-013): importar só acrescenta Recebidos fora das somas.

## Importador novo (PDF no M09.4)

1. Um leitor em `packages/importers/src/<fonte>/` que devolve as linhas no formato do OFX
   (`OfxTransaction`: id, data, descrição, valor, forma, parcela) e um resumo (banco, final,
   período). A conferência e a gravação do M09.3 servem de novo; não crie outro caminho.
2. `externalId`: o id da fonte; sem id, um hash estável de data + valor + descrição + ordem no
   arquivo, documentado.
3. Valor novo de `FileImportKind` (migração aditiva, skill `prisma-migration`).
4. Testes: unitário do leitor com arquivo **sintético escrito à mão** em `samples/` (a única
   pasta com .ofx, .pdf, .csv ou planilha, sem sequência de 13 a 19 dígitos fora das datas) e
   integração provando que importar duas vezes não duplica.
5. Arquivo enviado pela pessoa: tamanho máximo, tipo conferido pelo conteúdo, lido na memória e
   descartado; só o SHA-256 fica.

## Testes sem banco de verdade

- `@fintrack/importers/testing`: `syntheticBank(hoje)` (Banco Aurora e Banco Exemplo, finais
  0001 a 0003, datas relativas a hoje), `createFakePluggy` (páginas, falhas, troca do banco no
  meio) e `servePluggyFake` (HTTP, porta 8787). `SYNTHETIC_CREDENTIALS` e `SYNTHETIC_IDS`.
- A fixture gravada (`packages/importers/fixtures/pluggy/`) é **sintética**: nunca cole
  resposta de uma conexão real, nem anonimizada por script. Mudou o gerador? Regere a fixture e
  o teste confere que batem.
- Dev, CI e E2E apontam para a de mentira (`PLUGGY_API_URL=http://127.0.0.1:8787`,
  `pnpm pluggy:fake`). Só a produção fala com `https://api.pluggy.ai`.

## Conferir

```bash
pnpm --filter @fintrack/importers test
pnpm --filter @fintrack/db test:integration -- coleta-bancaria revisao importar-extrato
pnpm --filter @fintrack/web exec playwright test coleta-bancaria revisao importar-extrato
```

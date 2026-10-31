---
name: importador
description: Como os dados do banco entram no FinTrack (Meu Pluggy, extrato OFX, fatura em PDF pelo serviço Python) - a interface TransactionProvider, dinheiro exato desde o JSON, a sincronização idempotente na fila pg-boss, recebidos fora das somas, faturas e o banco sintético dos testes. Use ao mexer em packages/importers, em packages/db/src/sync.ts, connections.ts, statements.ts ou file-imports.ts, em services/ml, em features/bank, ao criar um importador novo ou ao escrever teste com resposta de banco.
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
- **Todo texto da fonte é limpo na leitura** (M12.4a): o `str` da Pluggy, o `text` do OFX e o do
  PDF passam pelo `cleanText` (sem caractere nulo, que o banco recusa, nem invisível); a
  descrição ainda passa pelo `importedDescription`. Leitor novo segue o mesmo caminho.
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
- **A descrição do banco nunca muda** (M13.2, adendo do ADR-012): é dela que a categorização, a
  busca do banco e os exemplos leem. O nome que a pessoa dá vai no `label` ("O que foi"; tela:
  `label ?? description`, `shownText`), e só em lançamento com texto de origem (`hasOriginText`:
  banco, OFX, PDF). O par do M09.2 põe a descrição da pessoa no `label`. A parcela que chega herda
  o `label` e a categoria da parcela irmã (`installmentSiblingKey`).
- **Transferência e pagamento de fatura** (M13.2): a saída e a entrada viram `TRANSFER` na revisão
  (`suggestTransfers`, `confirmTransfer`); a fatura aberta (`openStatementTotals`) já ignora quem
  tem `transferId`, e as datas dela são as da janela calculada, nunca as do saldo cru.

## Extrato OFX (M09.3, ADR-013)

- Leitor puro: `packages/importers/src/ofx/parse.ts` (`parseOfx`, `sniffOfx`, `fileFingerprint`).
  OFX 1 (SGML, latin-1) e 2 (XML); até 2 MB (`MAX_OFX_BYTES`); tipo pelos primeiros bytes;
  erros como código `OFX_*`, sem dado do arquivo.
- `externalId` = FITID; sem FITID ou repetido, hash estável (`h:` + 32 hex) de FITID + data +
  valor + descrição + a ordem entre as linhas iguais.
- Duas etapas (`packages/db/src/file-imports.ts`): `createFilePreview` (só o resumo, o SHA-256
  e as linhas lidas, 1 hora, só de quem enviou) e `importFilePreview` (confere de novo e grava).
  O arquivo nunca é gravado em disco, log ou auditoria.
- Sem duplicar (`matchImportRows`, core): "já importado" (mesmo id na conta, ou a mesma compra
  vinda do OUTRO formato, OFX ↔ PDF) e "já veio pelo Meu Pluggy" (recebido `OPEN_FINANCE` com o
  mesmo valor e a mesma data, um para um).
- Conta sugerida: `suggestImportAccount` (arquivo anterior do mesmo banco e final, final do
  cartão, única do tipo). Importa só quem edita a carteira da conta.
- Sem reautenticação (decisão do ADR-013): importar só acrescenta Recebidos fora das somas.

## Fatura em PDF (M09.4, ADR-014)

- Quem lê é o serviço Python `services/ml` (FastAPI + pdfplumber, uv): `POST /v1/faturas` com o
  corpo cru do PDF (até 5 MB, 30 páginas), token `Bearer` e, se o PDF pedir, a senha em
  `X-Pdf-Password` (base64url). Erro só como código `PDF_*`; log só com o código.
- O leitor é genérico (data no começo da linha, valor no fim) com perfis por banco em
  `app/perfis.py` (rótulos de vencimento, total, mínimo, fechamento; linhas ignoradas; nomes dos
  encargos). Perfil novo: rode `uv run python -m app.estrutura fatura.pdf` no PDF real (mostra só
  a estrutura, nenhum valor), escreva o perfil e um PDF SINTÉTICO equivalente em
  `scripts/gerar_faturas.py`; o PDF real nunca entra no Git nem no chat.
- O app: `readInvoice` (`packages/importers/src/pdf/invoice.ts`) chama o serviço com o token de
  `mlServiceToken` (plugin `jwt` do Better Auth, 2 min, só no servidor) e devolve o mesmo
  `StatementFile` do OFX, com `invoice` (vencimento, total, mínimo, encargos) e `profile`.
  Linhas sem id: `p:` + hash de data, valor, descrição e ordem.
- A senha: pedida na hora (`UploadState.pdf`), o arquivo fica só na aba e volta com ela; nunca é
  gravada nem vai para log, auditoria ou navegador (`autocomplete="off"`).
- Importar o PDF grava a fatura do cartão do vencimento (origem `PDF`, com os encargos) e liga a
  ela as compras novas e as já existentes (`statementId`). A fatura do Meu Pluggy vale mais: o
  PDF só liga as compras. A diferença vista na conferência fica em `invoiceDifference`.
- O contrato entre os dois lados é o JSON `packages/importers/fixtures/pdf/exemplo-visa-0002.json`:
  o pytest confere que o serviço o produz, e o vitest e a integração do db o usam.

## Importador novo

1. Um leitor que devolve o `StatementFile` (`packages/importers/src/statement-file.ts`): linhas
   (id, data, descrição, valor, forma, parcela) e o resumo (banco, final, período; a fatura, se
   houver). A conferência e a gravação servem de novo; não crie outro caminho.
2. `externalId`: o id da fonte; sem id, um hash estável de data + valor + descrição + ordem no
   arquivo (`stableRowIds`), com um prefixo próprio.
3. Valor novo de `FileImportKind` e de `TransactionSource`, se for o caso (migração aditiva, skill
   `prisma-migration`); confira o `transaction_file_import_check`.
4. Testes: unitário do leitor com arquivo **sintético** em `samples/` (a única pasta com .ofx,
   .pdf, .csv ou planilha, sem sequência de 13 a 19 dígitos fora das datas) e integração provando
   que importar duas vezes não duplica.
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
pnpm --filter @fintrack/ml test
pnpm --filter @fintrack/db test:integration -- coleta-bancaria revisao importar-extrato fatura-pdf
pnpm --filter @fintrack/web exec playwright test coleta-bancaria revisao importar-extrato fatura-pdf
```

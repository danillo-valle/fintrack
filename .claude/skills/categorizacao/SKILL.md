---
name: categorizacao
description: A cascata de categorização do FinTrack (regras → histórico → categoria do banco → classificador → IA local à noite, M10.2b), categorizedBy e a confiança, os exemplos de treino, o modelo por carteira e o eval. Use ao mexer em sugestão de categoria, regras, correções, importação que precisa de categoria, no classificador do services/ml, no conjunto rotulado ou ao acrescentar uma camada de IA.
---

# Categorização (cascata)

Decisões: `docs/adr/0007-lancamentos-e-categorizacao.md` e `docs/adr/0015-categorizacao-inteligente.md`.
Código: `packages/core/src/categorization.ts` (regras puras, a interface, a explicação e a medida),
`packages/db/src/categories.ts` (as camadas), `packages/db/src/classifier.ts` (treino, preenchimento e
medida), `services/ml/app/classificador.py` (o modelo) e `apps/web/src/lib/ml/classifier.ts` (a porta HTTP).

## Como funciona

1. Cada camada implementa `CategorySuggester { source; suggest(input); explain?(input) }` (use
   `suggesterFrom(source, explain)`: o `explain` diz também POR QUE não sugeriu).
2. `defaultSuggesters(db, scope, services)` é a lista, em ordem: regras → histórico → banco
   (`PROVIDER`) → classificador (`CLASSIFIER`, só se `services.classifier` existir).
3. `runCascade` devolve a primeira sugestão; `explainCascade` dá todas, camada por camada
   (DECIDED / MISSED / SKIPPED), para "Por que essa categoria?". A tela mostra; **ao gravar, o
   servidor roda de novo**.
4. `categorizedBy` = a camada, se a pessoa aceitou; `MANUAL`, se escolheu outra. Junto,
   `categorizationConfidence` (0 a 100) da camada aceita (`categorizationConfidence()` do core);
   nunca com `MANUAL` (CHECK).
5. Escolher diferente da sugestão (ou da categoria gravada) é **correção** → linha em
   `categorization_example` (de onde, quem tinha decidido, para onde). "Sempre categorizar assim"
   cria a regra na mesma transação.

## Acrescentar uma camada

1. Valor novo no enum `CategorizationSource` (migração aditiva, skill `prisma-migration`; CHECK novo
   não pode usar o valor recém-criado na mesma migração) e na union `SuggestionSource` do core
   (`SUGGESTION_SOURCES` também); frases novas em `CATEGORIZED_BY_LABEL` e `SOURCE_LABEL`, ícone
   em `SOURCE_ICON` (o TypeScript cobra os três).
2. Um `xxxSuggester(db, scope, …)` em `packages/db/src/categories.ts` com `suggesterFrom` e um
   `explainXxx` puro no core (motivo de cada "não"), devolvendo `confidence` de 0 a 100.
3. Entra em `defaultSuggesters` **depois** das regras (a regra da pessoa sempre vence).
4. Testes: unitário da camada (sem banco) e integração mostrando a ordem da cascata.
5. **LLM nunca entra no caminho do lançamento** (10 s): é um job da fila que preenche
   lançamentos sem categoria (ADR-007, seção do servidor home). A descrição é DADO, nunca
   instrução: saída só em JSON validado por schema.
6. **LLM só depois da medição** (M10.2a): `services/ml/bench/` mede no servidor (llama-server num
   container com teto, itens sintéticos de `samples/categorizacao/`) e gera a tabela do ADR-007. O
   prompt e o schema da fila são os de `app/ia_local.py` (o `bench/prompt.py` só reexporta): a
   descrição vai como valor de um JSON, sem marcadores de conversa (`limpar`), a resposta presa por
   `json_schema` (enum das categorias do tipo + `"nenhuma"`, ou a categoria nova) e conferida de
   novo por `validar`. Mudou o prompt? Rode a medição de novo.

## A IA local (M10.2b, ADR-016)

Código: `packages/core/src/local-ai.ts` (a janela, o teto, o nome proposto), `packages/db/src/local-ai.ts`
(a fila, a noite, o interruptor, a medida, o "Criar e aplicar"), `services/ml/app/ia_local.py` (o
prompt, o schema, o filtro `parece_instrucao`) e `apps/web/src/lib/ml/local-ai.ts` (a porta HTTP).

- **Não é camada síncrona**: não está em `defaultSuggesters`. A fila `local-ai-nightly`
  (`jobs.ts`) roda `runLocalAiNight` na janela; o "Por que" mostra a 5ª camada por `explainLocalAi`.
- **Só cargas do banco** (`LOCAL_AI_BULK_SOURCES`: OPEN_FINANCE, OFX, PDF); lançamento manual nunca.
- A fila é uma consulta (`localAiQueueWhere`): pendente, sem categoria, sem par, sem transferência,
  sem linha em `local_ai_attempt`, lar com `localAiEnabledAt`. Uma linha por recebido, para sempre.
- Grava com UPDATE condicional (ainda pendente e sem categoria): a escolha da pessoa vence.
- `categorizedBy = "LLM"` fica **fora do lote** (`bulkConfirmable`, `group.confirmable`): uma a uma.
- Categoria nova: a IA só propõe (`NEW_CATEGORY`, nome e mãe na `local_ai_attempt`); quem cria é a
  pessoa com o crachá `manage_categories` (`applyLocalAiProposal`). Nome trocado = `MANUAL`.
- Mudou o prompt, o schema, o filtro, o modelo ou os argumentos? Meça de novo (`services/ml/bench`)
  e passe o aceite das 30 injeções congeladas (`samples/categorizacao/llm-aceite.csv`, até 3).

## Importação do banco (M09.1, ADR-011)

- O `runSync` roda a cascata em cada lançamento novo com o escopo de **quem vai ver** aquele
  lançamento (o ambiente de destino, inclusive o pessoal de quem usou o adicional), não o do
  titular da conexão.
- Recebido (`PENDING`) categorizado por qualquer camada automática **não** vota nem treina
  (`votingWhere`): senão a sugestão errada vira exemplo de si mesma. Escolhido pela pessoa
  (`MANUAL`) ou confirmado vale.
- A categoria que o banco manda fica em `providerCategory` (só dado, até 100 caracteres) e entra na
  cascata pelo `SuggestionInput.providerCategory` (camada `PROVIDER`, M10.1): votos do que a pessoa
  escolheu para o mesmo texto do banco; sem votos, o mesmo nome (confiança 80). Nunca adivinhar
  sinônimo ("Supermercados" não é "Mercado").
- "Categoria em um clique" (`setCategoryAction`): grava `MANUAL`, registra o exemplo se for
  correção, cria a regra se pedido e pode criar a categoria pela busca (do tipo do valor).

## O classificador (M10.1, ADR-015)

- **Um modelo por carteira** (o id da carteira é o nome do modelo). O `classifierSuggester` só
  pergunta pelos modelos das carteiras do `WalletScope` de quem pede; sem modelo, nem chama o
  serviço. Nunca um modelo do lar inteiro.
- O serviço é uma **porta** (`ClassifierPort` do core). O app web implementa por HTTP
  (`lib/ml/classifier.ts`, 1,5 s na sugestão, `cascadeServices(sub)`); os testes de integração usam
  uma porta de mentira. Serviço fora: a camada some, nada falha.
- Limiar `CLASSIFIER_THRESHOLD` = 80. A confiança do serviço já vem com a **trava da evidência**
  (sem exemplo parecido da categoria, a probabilidade cai): não tire a trava para "ganhar
  cobertura".
- Treino: `trainWallet`/`trainWallets` (impressão digital SHA-256; menos de 20 exemplos ou uma
  categoria apaga o modelo; depois preenche os recebidos sem categoria da carteira). Fila
  `classifier-train-daily` às 03:15 e "Treinar agora" (`trainNow`, auditoria só com contagens).
- O modelo treinado com dado real fica **só** no volume da produção (`ML_MODEL_DIR`). Nunca no Git,
  no kit, numa imagem ou em fixture. No desenvolvimento: `services/ml/.modelos` (ignorado).
- Rede: a cascata da importação de arquivo roda ANTES da transação do banco (nada de transação
  esperando HTTP).

## Conjunto rotulado e eval

- `samples/categorizacao/rotulado.csv`: só dado INVENTADO, gerado por
  `services/ml/scripts/gerar_rotulado.py` (semente fixa). Mudou o gerador? Rode-o, depois
  `uv run python -m app.avaliar --gravar` e `pnpm format` (o README e o `app/avaliacao.json` são
  conferidos pelo pytest).
- O CI falha abaixo de 85 % de acerto (passo "Avaliação do classificador" e o pytest).

## Regras que não se negociam

- **Histórico e qualquer camada que leia lançamentos usam o `WalletScope` de quem pede**, nunca o
  lar inteiro: senão a sugestão revela o que está na carteira pessoal do outro.
- Regras sem regex (`CONTAINS`, `STARTS_WITH`, `EQUALS`): regex do usuário é risco de ReDoS.
- Compare textos com `matchText` / `merchantKey`, nunca com `toLowerCase()` solto (acento,
  pontuação e parcelas mudam o texto do mesmo comerciante).
- Categoria arquivada ou do tipo errado (despesa × receita) não é sugerida nem aceita.
- Não guarde a sugestão que veio do navegador: ela é recalculada no servidor.
- Descrição de lançamento nunca em log (nem no serviço Python, nem no erro).

## Medir

A tela Ajustes › Categorização usa `categorizationStats` (conferidos dos últimos 30 dias, mesma regra
da lista; cada número leva a `/lancamentos?quem=…`). No banco:

```sql
-- Quem decidiu as categorias dos últimos 90 dias (o "percentual sem LLM")
SELECT "categorizedBy", count(*) FROM "transaction"
WHERE "categoryId" IS NOT NULL AND "createdAt" > now() - interval '90 days'
GROUP BY 1 ORDER BY 2 DESC;
-- Correções por camada (onde a cascata mais erra)
SELECT "fromSource", count(*) FROM categorization_example GROUP BY 1;
```

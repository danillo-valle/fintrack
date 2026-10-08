# ADR-007: Lançamentos, contas e categorização preparada para IA

- **Status:** aceita
- **Data:** 2026-10-07
- **Módulo:** M07

## Contexto

O M07 é o uso diário: lançar um gasto no celular em poucos segundos e achar qualquer lançamento
depois. O modelo de dados já existia desde o M04 (`Transaction` separa quem paga, de quem é e o
que é) e o M06 criou o ponto único de acesso com crachás. Três pedidos moldam este módulo:

1. Tudo que toca uma carteira passa pelo crachá do M06: `edit` para lançar e editar, `view` para
   listar, `export` com reautenticação e auditoria para o CSV.
2. A categorização nasce com IA em mente, sem LLM ainda: regras texto → categoria (também
   criadas a partir de uma correção), sugestão pelo histórico do lar, uma interface única de
   sugestão e uma coluna opcional dizendo quem categorizou. Cada correção vira exemplo de treino.
3. Os lançamentos importados pelo Meu Pluggy no M09 precisam caber no modelo **sem
   reestruturação**.

## Decisões

### Acesso

1. **Três crachás novos** em `packages/db/src/access.ts`, com a mesma marca de tipo do M06:
   - `AccountGrant` (`authorizeAccountUse`): lançar numa conta tem **duas portas**. Quem tem
     `edit` na carteira que gere a conta usa qualquer cartão dela; quem é **portador** de um cartão
     ativo da conta (o adicional do cônjuge) lança só com o próprio cartão e não faz transferência
     com a conta. Fora das duas portas, `NOT_FOUND`.
   - `TransactionGrant<"view" | "edit">` (`authorizeTransaction`): o id vem da URL
     (`/lancamentos/0199…`), a mesma porta de IDOR das carteiras. A decisão é a da carteira do
     lançamento. Excluído só aparece com `includeDeleted` (o "desfazer").
   - `WalletScope<"view" | "edit">` (`authorizeScope`): as listas juntam várias carteiras, e
     nenhum crachá de uma carteira só serve para isso. Lista, totais, sugestão e geração de
     recorrências só aceitam um escopo, nunca uma lista de ids solta.
2. **Duas ações novas na matriz** (passo 2 da skill `nova-feature`): `manage_accounts` na
   carteira (só dono, também na pessoal) e `manage_categories` no lar (dono e membro: as
   categorias são do lar inteiro). Matriz agora com 48 + 12 linhas, conferida à mão, contra o
   Postgres e contra `docs/permissoes.md`.

### Lançar, listar, excluir

3. **Lançamento rápido em três toques**: valor, descrição, salvar. A categoria vem sugerida
   enquanto a pessoa digita; conta e carteira vêm do último lançamento; data de hoje; forma de
   pagamento padrão da conta (`defaultMethod`). O resto fica em "Mais opções".
4. **A forma de pagamento segue a regra do gatilho do banco** (`allowedMethods` no core). Um teste
   de integração confere as 45 combinações (5 tipos de conta × 9 formas) contra o gatilho
   `transaction_method_matches_account`: as duas regras não podem divergir.
5. **Filtros na URL**, com nomes em português (`?de=&ate=&carteira=&conta=&categoria=&q=&tipo=`).
   Nada da URL é confiável: valor fora do formato cai no padrão, carteira alheia vira escopo
   vazio (lista vazia, sem confirmar que a carteira existe).
6. **Um WHERE só** (`whereOf`) para lista, totais e exportação: os três nunca discordam.
   **Totais calculados no banco** (soma em `NUMERIC`), com teste que compara com a soma da lista
   ao centavo. Transferências aparecem na lista, mas não entram em entradas e saídas.
   Agendados (recorrências) entram nos totais da lista; a regra "gasto do mês" do M08, que
   ignora agendados, é outra consulta.
7. **Paginação por cursor** (keyset) em `(occurredOn DESC, id DESC)`: não pula nem repete itens
   quando alguém lança no meio da leitura e não fica mais lenta no fim. O id é `uuid(7)` (ordem
   de criação), então o desempate é estável. O cursor da URL é validado; inválido recomeça do topo.
8. **Exclusão lógica com "desfazer"** de 10 s (o `undoToast` do M02). A linha some na hora
   (`useOptimistic`) e volta sozinha se o servidor recusar. Exclusão e restauração vão para a
   auditoria. Transferência sai e volta inteira (os dois lados) e não se edita.

### Transferência, recorrência e exportação

9. **Transferência** = dois lançamentos com o mesmo `transferId`, cada um na carteira da própria
   conta, sem categoria (CHECK novo `transaction_transfer_category_check`). Pagar a fatura é uma
   transferência da conta corrente para a conta do cartão.
10. **Recorrências** geram o lançamento do mês como `SCHEDULED`, `source = RECURRENCE` e
    `externalId = "<id>:<AAAA-MM>"`. A chave única `(accountId, source, externalId)` do M04 torna a
    geração idempotente (`createMany` com `skipDuplicates`). No M07 é um botão; no M09 a fila
    (pg-boss) chama a mesma função todo dia 1º.
11. **Exportação CSV**: só o dono (`export`), prova de identidade dos últimos 10 minutos
    (`requireRecentAuth`, M03) e a leitura e a auditoria (`transactions.exported`, só período,
    quantidade e quais filtros) na **mesma transação**. Formato do Excel em português (`;`,
    vírgula decimal, BOM UTF-8) e proteção contra **injeção de fórmula** (OWASP: texto que começa
    com `= + - @ tab CR` ganha apóstrofo). Gerada por Server Action (que confere a origem do
    pedido) e baixada pelo navegador: o conteúdo nunca vai para uma URL. Limite de 20 mil linhas.
12. **O que vai para a auditoria**: o que tira dado do sistema ou muda a estrutura (excluir,
    restaurar, exportar, contas, cartões, categorias, regras, recorrências). Lançar e editar não
    (seriam milhares de linhas; o lançamento guarda quem criou e quando mudou). Nunca descrição,
    valor ou os 4 finais do cartão.

### Categorização: a cascata e o encaixe para IA

13. **Cascata com interface única** (`packages/core/src/categorization.ts`): cada camada
    implementa `CategorySuggester { source; suggest(input) }`, e `runCascade` devolve a primeira
    resposta. No M07: (1) **regras** do lar e (2) **histórico**. A lista das camadas está num lugar
    só (`defaultSuggesters` em `packages/db/src/categories.ts`): M09 e M10 acrescentam itens.
14. **Regras sem regex** (`CONTAINS`, `STARTS_WITH`, `EQUALS`): regex escrita pela pessoa pode
    travar o servidor (ReDoS). A comparação é feita em `matchText` (sem acento, minúscula,
    pontuação vira espaço). Menor prioridade vence; empate, o padrão mais longo (mais específico).
15. **Histórico só das carteiras que a pessoa vê** (`WalletScope`), nunca do lar inteiro: senão a
    sugestão contaria à outra pessoa onde ela compra (vazamento por canal lateral). A chave do
    comerciante (`merchantKey`) tira números, datas, parcelas e ruído de banco; a sugestão pede
    pelo menos 2 votos e 60% deles; olha os 2.000 lançamentos mais recentes.
16. **A tela não decide quem categorizou**: a sugestão mostrada é só ajuda. Ao gravar, o servidor
    roda a cascata de novo; se a categoria escolhida é a sugerida, `categorizedBy` = a camada
    (`RULE`, `HISTORY`); senão, `MANUAL`.
17. **Coluna opcional `transaction.categorizedBy`** (enum `CategorizationSource`: `MANUAL`, `RULE`,
    `HISTORY`). É dela que sai, no M10, o "percentual resolvido sem LLM". Valores novos chegam por
    acréscimo de enum (M09: categoria da Pluggy; M10: classificador e LLM).
18. **Toda correção vira exemplo de treino** (`categorization_example`): a sugestão trocada por
    outra no lançamento novo, ou a categoria gravada trocada na edição. Guarda a descrição, o
    sinal, de onde (`fromCategoryId`, `fromSource`) e para onde (`toCategoryId`). Aceitar a sugestão
    não é correção. "Sempre categorizar assim" cria, na mesma transação, a regra
    (`suggestRulePattern`: as primeiras palavras da descrição, que por construção combinam com ela,
    provado por teste de propriedade).

### Encaixe com o M09 (Meu Pluggy)

19. O lançamento importado entra **sem mudar nada do que existe**: `source = OPEN_FINANCE`,
    `externalId` = id da Pluggy (a chave única impede importar duas vezes), `status = PENDING`
    (área de revisão), `walletId` = a carteira da conta, `createdById` nulo. A cascata roda na
    importação como roda no lançamento; a categoria que a Pluggy devolve entra como uma camada a
    mais (valor novo de enum, ex.: `PROVIDER`), depois das regras da pessoa. Confirmar ou corrigir
    um importado é o mesmo fluxo de edição (e a correção vira exemplo). Uma conta do Meu Pluggy por
    pessoa: cada uma conecta as próprias contas, e o `AccountGrant` já separa quem lança onde.

## LLM local no servidor home (para o M10)

**O servidor:** Intel N150 (4 núcleos, sem GPU dedicada), 15 GiB de RAM, cerca de 10 GiB livres
com a produção e o desenvolvimento no ar, 4 GiB de swap.

**Referência pública** (mini PC com o mesmo N150 e 16 GB, só CPU): geração de cerca de 18 tokens/s
num modelo de 1,5 B, 9 tokens/s num de 3 B e 3,9 tokens/s num de 8 B, com 26 a 30 W de consumo; sob
carga contínua o clock cai para 2,2 GHz (aquecimento). A velocidade de leitura do prompt não foi
publicada. Fonte: [geerlingguy/ai-benchmarks, issue #12](https://github.com/geerlingguy/ai-benchmarks/issues/12).

**Estimativa para um lançamento:** prompt de 300 a 500 tokens (instruções + lista de categorias +
descrição) e resposta JSON de cerca de 20 tokens. Num modelo de 3 B, a geração sozinha leva 2 a 3 s;
a leitura do prompt em CPU pode levar vários segundos a mais. Somado à página, estoura o critério
de 10 s do lançamento e disputa CPU com a produção.

**Decisão:** um LLM local é **plausível só como camada assíncrona**, nunca no caminho do
lançamento: fila no pg-boss (M09), um worker com limite de CPU e memória no compose, um item por
vez, só para o que as regras, o histórico e o classificador não resolveram, preenchendo
lançamentos ainda sem categoria (a pessoa confirma; a correção vira exemplo). API paga e planos
grátis que treinam com os dados ficam fora (custo e privacidade). **A decisão final é do M10, num
ADR próprio, depois de medir** no próprio servidor:

| O que medir                     | Como                                                                  | Para aceitar (proposta)                 |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| Latência por item (p50 e p95)   | `llama-bench` (pp512/tg128) e o prompt real, modelos de 1–1,5 B e 3 B | p95 < 60 s na fila                      |
| Memória residente e pico        | `docker stats` com produção e dev no ar                               | < 3 GiB, sem usar swap                  |
| Impacto na produção             | p95 do `/api/health` e do lançamento com a fila rodando               | piora < 20%                             |
| Clock e temperatura sustentados | fila de 200 itens, `sensors` e frequência da CPU                      | sem travar nem desligar                 |
| Acurácia                        | eval do M10 (conjunto sintético + exemplos de correção)               | melhor que o classificador no que sobra |
| JSON válido e prompt injection  | saída com schema (gramática do llama.cpp ou `format` do Ollama)       | 100% JSON válido; descrição é dado      |
| Licença e tamanho do modelo     | página do modelo                                                      | uso pessoal grátis; download < 3 GB     |
| Energia                         | medidor de tomada durante a fila                                      | registrar no ADR                        |

## Consequências

- Esquecer a checagem numa tela nova de lançamento não compila (crachás), e a lista não tem como
  receber carteira alheia (escopo).
- A soma da lista é a soma do banco, ao centavo, provada por teste de integração e por E2E.
- O M10 encontra pronto: a interface de camadas, a coluna `categorizedBy` para medir e os exemplos
  de correção para treinar e avaliar.
- Busca por texto não ignora acentos (`ILIKE`): "pao" não acha "Pão". `unaccent`/`pg_trgm` é um
  acréscimo futuro (extensão + índice), sem mudar colunas.
- A lista pagina com "Ver mais antigos" (uma página por vez). Rolagem infinita é um acréscimo na
  tela; a consulta já é por cursor.

## Alternativas consideradas

- **Paginação por OFFSET:** simples, mas repete ou pula itens com lançamento novo no meio e fica
  lenta nas páginas do fim.
- **Confiar na sugestão que a tela manda:** a pessoa (ou um script) poderia gravar `RULE` em tudo e
  inflar a métrica do M10. A cascata roda de novo no servidor.
- **Histórico do lar inteiro na sugestão:** sugestão melhor, mas vaza o que está nas carteiras
  pessoais. Fora.
- **Exportar por uma rota GET:** um link de outro site faria o navegador baixar e registrar uma
  exportação. Server Action confere a origem.
- **Auditar todo lançamento:** milhares de linhas sem pergunta que respondam; o lançamento já tem
  `createdById` e `updatedAt`.

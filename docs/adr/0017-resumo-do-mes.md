# ADR-017: O resumo do mês: três observações por regras, sem IA

- Status: aceita
- Data: 2026-10-20
- Módulo: M10.3 (desenho no canvas, linhas F e F.3)

## Contexto

O roteiro do M10 pede um **resumo mensal com três observações, cada uma ligada a um número do
banco** (o número leva à lista, como no painel do M08). A linha F do canvas (aprovada em 16/10)
desenhou o resumo no topo do Início: "Mercado, na Casa, deve passar do orçado", "Restaurantes acima
do costume" e "Uma assinatura nova". O M10.2 trouxe um LLM local, mas só numa fila noturna e com o
risco de injeção aceito para sugestões que a pessoa confirma (ADR-016); um texto do Início escrito
por ele seria lido sem confirmação.

## Decisão

Decidido pelo Danillo em 20/10/2026 (as três recomendações), com a linha F.3 do canvas aprovada:

1. **Por regras, sem IA.** Cada observação sai de uma regra pura do `@fintrack/core`
   (`month-summary.ts`), sobre as mesmas somas do Início (`spendingRows`, orçados, recorrências).
   Nenhuma descrição vai para modelo nenhum; o texto é montado pelo app.
2. **Calculado na hora**, no mesmo cache das somas do Início (etiqueta do lar, M08): muda assim que
   um lançamento é confirmado. O subtítulo diz "Com os lançamentos confirmados até agora". Os
   recebidos que esperam revisão (inclusive os da IA local) não entram, como em todo o painel.
3. **Três tipos** (os do canvas):
   - **Orçado que deve estourar**: o previsto (gasto + agendado + recorrências + o ritmo do
     variável, a mesma projeção do M08) passa do orçado da categoria no ambiente. Peso: quanto passa.
   - **Acima do costume**: o gasto do grupo de categorias já passa da média dos 6 meses anteriores
     em mais de 20 % e em pelo menos R$ 50, com gasto em pelo menos 3 desses 6 meses. Peso: a
     diferença.
   - **Conta fixa ou assinatura nova**: uma recorrência de despesa (FIXED_BILL ou SUBSCRIPTION),
     ativa, que começou no mês. Peso: 12 meses.
4. **A escolha**: as três de maior peso em reais, **no máximo uma por grupo de categoria**. Com
   menos de três, a frase de baixo diz o que não apareceu ("nenhum orçado deve estourar e nenhuma
   conta fixa nova este mês"); sem nenhuma, "Nada fora do costume em outubro até agora".
5. **Do dia 1 ao dia 5, o mês anterior, fechado** ("Resumo de setembro", selo "Mês fechado", "o de
   outubro aparece no dia 6"), com o gasto real no lugar do previsto. No começo do mês há pouco
   dado: o "acima do costume" no dia 2 não diria nada.
6. **Os números levam às listas**: o previsto e o gasto à lista do mês da categoria; o orçado e o
   quanto passa ao Orçamento do mês; a média aos 6 meses; o mensal da assinatura aos lançamentos
   dela no mês (busca pela descrição); os 12 meses às contas fixas.

## Consequências

- Nada novo no banco: nenhuma migração. Uma consulta nova (`recurrencesStartedIn`) e um parâmetro
  novo nos links da lista (`text`, a busca na descrição).
- A seção dos números do Início passou a se chamar "Números de outubro de 2026" (o nome acessível);
  "Resumo de outubro" agora é o resumo em observações.
- O E2E monta os dados no mês do resumo (`summaryPeriod`), então vale em qualquer dia; o caso do
  mês fechado é coberto pelos testes do core e, no E2E, só nos dias 1 a 5.
- Diferenças conscientes do canvas: "Mercado, no ambiente Casa" (o nome de um ambiente pessoal é o
  de uma pessoa, e "na Danillo" não se lê); "Restaurantes 38 % acima" usa o mesmo arredondamento
  do painel (`percentVersus`).

## Alternativas consideradas

- **Texto escrito pelo LLM local**: fora. Só roda de madrugada, e o texto iria para a tela sem
  confirmação, com o risco de injeção que o ADR-016 aceitou só para sugestões confirmadas.
- **Um job por dia** que grava o resumo: o texto ficaria velho logo depois de uma confirmação, e
  seria mais uma tabela. O cache do M08 já resolve o custo.
- **Mais tipos** (abaixo do costume, parcelas que terminam, fatura acima da média): ficam para
  depois, se o Danillo quiser; a regra de escolha comporta um tipo novo sem mudar a tela.

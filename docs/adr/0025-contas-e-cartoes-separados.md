# ADR-025: Contas e cartões separados: toda compra no cartão tem fatura e conta no vencimento

- Status: aceita
- Data: 2026-11-03
- Módulo: M13.3a (canvas linha N; o M13.3 vem em três partes: a, b e c)

## Contexto

Com os dados reais (v1.0.0 em diante), o Danillo achou o lançamento unificado confuso e a
previsão de gasto fora da realidade (03/11/2026): "Lançamentos entre cartão, poupança e conta
estão gerando previsões de gastos fora da realidade"; "não quero ver lançamentos de débito junto
com lançamentos de cartão de crédito". O código mostrou três causas que se somam:

1. **A compra no cartão contava no mês da compra**, e a fatura que ela compõe vence no mês
   seguinte. O Início de novembro misturava as compras de novembro no cartão (que só saem da conta
   em dezembro) com o débito de novembro, e a fatura que vence em novembro (as compras de outubro)
   não aparecia em lugar nenhum do mês.
2. **O ritmo do mês multiplicava tudo que não era recorrência do app** (`NATURE_SQL` só chama de
   fixa a recorrência e de parcela a parcelada manual). No dia 3, com os dados do banco, o
   previsto saía cerca de 9× o gasto, inclusive de compras do cartão que já não entram no mês.
3. **O crédito no cartão (estorno, cashback) contava como entrada**, ao lado do salário.

A fatura aberta também era calculada à parte (só as compras do banco, `statementId` nulo, por um
período de datas), enquanto a fechada era uma linha de `card_statement`: duas fontes para a mesma
pergunta "quanto vem nesta fatura?".

Decidido pelo Danillo em 03/11/2026 (canvas linha N, aprovada junto com a O):

- a compra no cartão conta no **mês do vencimento** da fatura;
- **páginas separadas**: Lançamentos só com as contas (uma por vez), Cartões como item próprio do
  menu, por fatura;
- a **poupança separada** ("Guardado"); "Na conta hoje" só a conta corrente;
- o Início mostra o dinheiro de verdade e junta só os resultados.

## Decisão

1. **Toda compra no cartão tem fatura.** Um lançamento de conta de cartão de crédito que não é
   transferência sempre aponta para uma linha de `card_statement`. Quem garante é o banco: o
   gatilho `transaction_card_statement` (antes de gravar) preenche o `statementId` vazio pela função
   `fintrack_statement_for(conta, dia)`:
   - primeiro, a fatura **gravada** cujo período contém o dia: a primeira que fecha depois do dia,
     se a anterior gravada fechou até o dia (ou, sem anterior próxima, até um mês antes do
     fechamento dela). Assim as datas que o banco mandou valem mais que o ciclo cadastrado;
   - senão, a fatura do **ciclo** da conta (`statementFor` do `@fintrack/core`, escrito em SQL),
     criada aberta se ainda não existe (`(accountId, referenceMonth)` continua único).
     Um teste de integração confere, com dias e ciclos sorteados (fast-check), que a função do banco
     e a do core escolhem a mesma fatura. Os lançamentos que já existem ganham a fatura na
     migração, pela mesma função. Fatura nunca é apagada por isso: uma fatura aberta sem compra
     continua existindo e simplesmente não aparece nas telas.
2. **A data em que conta** (`cashOn`, "data de caixa") é o vencimento da fatura para o cartão e o
   próprio dia para o resto: `COALESCE(fatura.dueDate, lançamento.occurredOn)`. Não é coluna
   (calcula-se, ADR-004): uma expressão só em SQL (`CASH_ON_SQL`) e um `WHERE` só no Prisma
   (`cashOnWhere`), em `packages/db`, usados pela lista, pelos totais, pelo painel, pelo orçamento,
   pelo fluxo de caixa e pela evolução. O período da lista (`?de`, `?ate`, `?meses`) passa a filtrar
   por ela. Para as contas não muda nada (a data de caixa é o dia); para o cartão, "novembro" é a
   fatura que vence em novembro.
3. **Entrada e saída.** Na conta, entrada é o que entra e saída o que sai, como sempre. No cartão,
   tudo é saída, com sinal: o estorno e o cashback **abatem** a fatura (a saída da categoria),
   nunca viram entrada. Uma regra no core (`flowOf`) e a mesma em SQL (`FLOW_SQL`) e no Prisma
   (`typeWhere`), com um teste que confere as três. A transferência e o pagamento da fatura
   continuam fora das duas somas.
4. **O ritmo do mês por janela.** O variável só é estendido até o fim do período em que ainda entra
   compra naquele mês:
   - nas contas, o mês;
   - em cada cartão, o período da fatura que vence no mês (do fechamento anterior ao dia antes do
     fechamento dela). Fatura já fechada não cresce mais: ritmo zero.
     `projectMonth` recebe as janelas (`PaceWindow`) e soma o ritmo de cada uma pelo gasto variável
     dela. As recorrências pendentes no cartão contam no mês do vencimento da fatura em que caem
     (`cashDateFor`), como uma compra.
5. **Dinheiro de verdade × resultado.** Os saldos ("Na conta hoje", "Guardado") e as faturas
   ("Faturas a pagar", a página de Cartões) mostram o que o banco mostra: com os recebidos ainda
   não conferidos. O resultado, o gasto, o orçamento e a previsão continuam só com o que já foi
   conferido (ADR-011); a tela diz quando há recebidos fora. Cada número continua levando à lista
   com o mesmo total.
6. **As telas** (canvas linha N, 920 px de conteúdo):
   - **Lançamentos** mostra uma conta por vez (abas com as contas que não são cartão), com o saldo
     no começo do período, as entradas, as saídas e o saldo hoje (o do banco, numa conta ligada;
     senão o saldo inicial mais os lançamentos). Transferências e pagamentos de fatura aparecem na
     conta de onde saíram, marcados "fora das somas";
   - **Cartões** (`/cartoes`, item do menu): um cartão e uma fatura por vez, com o fechamento, o
     vencimento, o limite e a lista da fatura; a fatura paga diz quando e por qual conta;
   - **Do painel** (pranchas N-DoPainel e N-CelDoPainel, desenhadas no M13.3a): o número do Início
     ou do Orçamento leva à lista do recorte em duas partes (nas contas, nos cartões por fatura),
     cada uma com o seu total; a soma é o número clicado. O "gasto até hoje" é o mês inteiro pela
     data de caixa com só o que já aconteceu até hoje (`?aconteceu=`): a compra de ontem no cartão
     conta, mesmo vencendo depois;
   - **Início**: Resultado do mês (entradas nas contas, saídas = débito e Pix + faturas que vencem
     no mês, sobra), Na conta hoje (as correntes), Guardado (as poupanças), Faturas a pagar;
   - **Cabeçalho**: Período e Pago por como combos de marcar (um ou vários meses; uma ou várias
     pessoas); Filtros e CSV no canto da lista. No celular o painel do combo sobe da base da tela,
     com o Aplicar sempre à vista;
   - **Novo lançamento** com as abas Lançamento, Transferência e Recorrência (`?aba=`), os
     formulários no mesmo modal; as abas ficam no cabeçalho do modal (em tela baixa, na linha do
     título) e o seletor de dentro fica só Despesa e Receita. Os endereços antigos da transferência
     e das recorrências levam para a aba e para Fixas e parcelas por um redirecionamento HTTP
     (`next.config.ts`); o da página do cartão confere quem vê a conta e leva a Cartões;
   - **Fixas e parcelas** (`/fixas`, item do menu; prancha O-Fixas): as entradas e saídas fixas
     e as compras parceladas em andamento, a do FinTrack e a que o banco informa
     (`installmentsInProgress`: a parcela de agora é a da próxima fatura, o que falta e quando
     termina). Ajustes fica só com configuração. As previsões nos próximos meses vêm no M13.3c;
   - **Menu**: Cartões e Fixas e parcelas depois de Lançamentos; no celular, a barra fica
     Início, Lançamentos, Cartões, Orçamento e Ajustes (Carteiras passa para Ajustes no celular, e
     Fixas e parcelas abre pelo Início).
     A página antiga do cartão (`/carteiras/conta/[id]`) passa a levar para Cartões ou Lançamentos.

## Consequências

- Os números de um mês mudam de propósito: novembro passa a ter a fatura que vence em novembro, e
  as compras de novembro no cartão aparecem em dezembro (ou no mês em que a fatura delas vence).
  O orçado de uma categoria se compara com o gasto pela mesma régua.
- Toda escrita de compra no cartão (formulário, bot, Meu Pluggy, OFX, PDF, parcelada, revisão) fica
  coberta pelo gatilho; código novo não precisa lembrar de achar a fatura. Um `statementId`
  escolhido por quem grava (a fatura do banco, a do PDF) continua valendo.
- A fatura aberta e a fechada passam a ser a mesma coisa (uma linha de `card_statement`); a página
  de Cartões lê uma consulta só. A conferência ao centavo continua só nas faturas que o banco ou o
  PDF fecharam.
- Quando o banco manda as datas da fatura aberta, a busca grava essas datas na fatura e as compras
  do período passam para ela (o gatilho escolhe de novo quando o `statementId` volta a ser nulo).
- As faturas que o banco já fechou (a Bill, que só traz o vencimento) fecham no dia do mês em que o
  banco fecha a aberta (`bankBillStatement` do core), não no dia do ciclo cadastrado: se os dois
  discordam, uma compra que o banco ainda não pôs numa fatura cairia na fechada pelo período, e a
  fechada deixaria de conferir. O teste de integração da coleta confere num dia em que o ciclo
  cadastrado e o do banco discordam.
- Os testes de concordância passam a ser quatro: "Pago por", fatura do dia, data de caixa e
  entrada/saída.

## Alternativas consideradas

- **Coluna `cashOn` gravada**: indexável, mas guarda o que se calcula (ADR-004) e precisaria de
  gatilhos em três tabelas para não envelhecer (vencimento mudado, ciclo mudado, fatura trocada).
  A expressão com o `JOIN` na fatura custa pouco no tamanho de uma casa.
- **Achar a fatura no código, em cada escrita**: oito caminhos de escrita; um esquecido faria uma
  compra sumir dos meses. O gatilho cobre todos, e o teste de concordância prende a regra ao core.
- **Contar o cartão pela data da compra e mostrar a fatura à parte** (o jeito do M08): é o que
  gerava o Início misturado; o Danillo escolheu o vencimento.
- **Lançamentos com tudo e um filtro "só contas"**: o pedido foi não ver os dois juntos; o filtro
  deixaria o padrão misturado.

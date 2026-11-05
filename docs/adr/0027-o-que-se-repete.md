# ADR-027: O que se repete nos próximos meses (a fixa, o salário e as parcelas previstos)

- Status: aceita
- Data: 2026-11-05
- Módulo: M13.3c (canvas linhas N e O: N-Projecao, N-CelProjecao, O-Parcelada, O-FaturaFutura,
  O-ReceitaFixa, O-ContaPrevista, O-ProximosMeses, O-Fixas, O-CelTipo, O-CelProximos, O-CelReceita)

## Contexto

O ADR-026 deixou o previsto do mês em andamento certo: cada fixa uma vez, as parcelas uma vez e
só as variáveis no ritmo. Os meses seguintes continuavam cegos: a assinatura do cartão, o salário
e as parcelas que ainda faltam só apareciam quando chegavam. O Danillo pediu (03/11, canvas
versões 85 e 88) que a fixa carimbada fosse projetada nos próximos meses sem gerar lançamento, que
o salário tivesse um valor previsto, que as parcelas que faltam aparecessem nas próximas faturas e
que o Início mostrasse os próximos meses com o que entra e o que se repete.

Decidido por ele em 05/11: **toda fixa que chegar vira previsão sozinha** (não só a carimbada), e o
**Próximos meses toma o lugar do painel do Fluxo de caixa no Início** (a página do Fluxo continua).

## Decisões

1. **O que se repete é a recorrência, de dois jeitos** (`recurrence.origin`):
   - `APP`: o FinTrack lança (o aluguel pago à mão: "Lançar as deste mês" cria o agendado), como desde
     o M07;
   - `BANK`: o banco traz. A recorrência só **prevê** e nunca gera lançamento: a cobrança que chega é o
     lançamento. Fixas e parcelas mostra as duas juntas, com o mesmo Parar de repetir.
     Uma tabela própria para as previsões repetiria a recorrência inteira (conta, cartão, categoria, dia,
     prazo, o Parar) e dividiria o Fluxo, o Orçamento e o Início em dois caminhos.
2. **A cobrança do banco toma o lugar da prevista.** A recorrência `BANK` guarda a conta e a chave do
   comerciante (`match_key` = `merchantKey` do texto do banco). Um lançamento da mesma conta, do mesmo
   sinal e com a mesma chave ganha o `recurrenceId` ao chegar (a busca, o OFX e o PDF) e ao ser
   confirmado, lançado ou editado. O mês da recorrência `BANK` está **realizado** quando há um
   lançamento ligado CONFIRMADO, não excluído, com a data naquele mês. O recebido ainda na revisão não
   realiza: ele está fora das somas (ADR-011), e a prevista continua contando até a confirmação. (A
   `APP` segue a regra de sempre: o lançamento gerado realiza o mês, mesmo excluído.)
3. **Toda fixa que chegar vira previsão.** Uma saída fixa (`spendingNature` = fixa, não parcela, não
   transferência) confirmada e sem recorrência é ligada à recorrência `BANK` da mesma conta e chave, ou
   cria uma: o valor previsto é o último que chegou, sem prazo, por volta do dia dela, com a categoria,
   o ambiente e o cartão dela. Isso acontece ao confirmar na revisão, ao lançar, ao editar e ao marcar
   o tipo, e a busca diária faz o mesmo com os últimos dois meses (o que ficou para trás, como uma
   categoria que passou a ser fixa depois). Marcar Variável uma cobrança ligada a desliga; a recorrência
   continua até a pessoa parar. A **receita** fixa só nasce quando a pessoa marca "Tipo da receita:
   Fixa" (o salário): a categoria de receita não tem tipo padrão.
4. **O valor previsto** (`recurrence.amount_rule`): `LAST` (o último que chegou), `AVERAGE_3` (a média
   dos últimos três meses que chegaram; com menos, dos que houver) ou `FIXED` (o valor gravado). Só as
   cobranças ligadas e confirmadas contam. A `APP` é sempre `FIXED`. A regra é pura
   (`expectedAmount`, core) e o banco só soma.
5. **Quando cai** (`recurrence.day_rule`): `DAY` (o dia N; num mês mais curto, o último) ou
   `BUSINESS_DAY` (o N-ésimo dia útil: segunda a sexta, sem os feriados nacionais em que os bancos
   fecham: 1º/1, segunda e terça de Carnaval, Sexta-feira Santa, 21/4, 1º/5, Corpus Christi, 7/9,
   12/10, 2/11, 15/11, 20/11 e 25/12, com a Páscoa calculada).
6. **As parcelas que faltam entram previstas.** Da parcela mais recente de cada compra parcelada (do
   banco, pela chave das parcelas irmãs do M13.2), as que faltam entram uma por fatura seguinte, pelo
   valor da parcela, no mês do vencimento. A compra do FinTrack já tem todas as parcelas gravadas e
   não precisa de previsão. Numa compra em que o banco não disse a parcela, a pessoa diz ("Parcelada:
   2 de 5"): fica nos mesmos campos da parcela informada, com `installment_by_person`, e a busca nunca
   sobrescreve o que a pessoa disse.
7. **A fatura que ainda não abriu.** Cartões passa da última fatura gravada para as seguintes,
   calculadas pelo ciclo do cartão, sem gravar fatura nova: mostra o que já se sabe (as compras já
   feitas nela, as fixas e as parcelas previstas). Na fatura aberta, a fixa que ainda não chegou
   aparece prevista, e "Não chegou" depois do dia dela.
8. **O mês previsto na conta.** Lançamentos de uma conta, com um mês que ainda não acabou no Período,
   mostra o previsto: as receitas fixas, as saídas fixas da conta e a fatura de cada cartão que ela
   paga. No mês em andamento, o previsto fica ao lado do que chegou, com a diferença ("Previsto
   R$ 9.940,00 · chegou R$ 90,00 a menos"). A conta que paga a fatura é a de onde saiu o último
   pagamento de fatura ligado na revisão (ADR-012); sem nenhum, a fatura não aparece em conta nenhuma.
9. **Próximos meses no Início**, no lugar do painel do Fluxo: os quatro meses seguintes, com o que
   entra (as receitas previstas), as fixas da conta (fora do cartão), a fatura do cartão (o que já se
   sabe das faturas que vencem no mês) e a sobra antes das variáveis. O Fluxo de caixa e o Orçamento
   dos meses seguintes usam as mesmas recorrências e parcelas previstas.
10. **O tipo num lugar só, na página do lançamento.** A seção **Tipo** junta Fixa (Repete todo mês: o
    valor e o dia), Variável e Parcelada (a parcela e o total) numa escolha só, gravada numa
    transação (`setEntryType`): deixar de ser a parcela dita, ligar ou criar a recorrência, a marca e
    "as próximas desta loja também". O Editar lançamento deixa de ter o Fixa/Variável, para o tipo não
    ter dois lugares que discordam; a etiqueta da lista e o painel da categoria continuam (o toque
    rápido, ADR-026). A cobrança do mês seguinte da mesma conta, loja e valor de uma parcela dita vira a
    parcela seguinte sozinha. Mudar o valor de uma recorrência fica no "⋯" de Fixas e parcelas.

## Consequências

- Migração aditiva: três colunas na recorrência (com padrão), uma nula (a chave) e uma no lançamento
  (`installment_by_person`, falso). Nenhuma recorrência muda de jeito ao aplicar: as que existem são
  `APP`.
- A previsão do mês do ADR-026 (a fixa do mês passado que ainda não chegou) passa a vir quase sempre
  da recorrência `BANK`: a cobrança ligada a uma recorrência fica fora dessa conta, e a recorrência diz
  sozinha o que falta. Continua valendo para a fixa ainda sem recorrência.
- O previsto de um mês seguinte nunca inclui as variáveis: elas só existem quando acontecem.

## Alternativas consideradas

- **Prever só a fixa carimbada.** Recusada pelo Danillo: as categorias que ele marcou como fixas no
  M13.3b ficariam fora dos próximos meses até cada compra ser carimbada.
- **Gerar o lançamento previsto como agendado.** Seria contar em dobro quando a cobrança do banco
  chegasse, ou exigir apagar o agendado; a previsão é calculada e some sozinha quando a de verdade
  chega.
- **Projetar a fixa do mês passado para sempre, sem guardar nada.** Não teria como parar, mudar o valor
  ou dizer até quando; a recorrência guarda essas escolhas.

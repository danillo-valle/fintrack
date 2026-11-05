# ADR-026: Fixa ou variável em qualquer compra, o previsto do mês e as categorias que eram transferência

- Status: aceita
- Data: 2026-11-04
- Módulo: M13.3b (canvas linha N: N-FixaVariavel, N-Revisao, N-Detalhe, N-CelRevisao, N-Limpeza e o
  bloco "Previsto para" do N-Inicio)

## Contexto

O ADR-025 tirou a compra no cartão do mês errado e passou o ritmo para a janela de cada fatura.
Sobraram duas das causas da previsão "fora da realidade" que o Danillo apontou em 03/11/2026:

1. **Só a recorrência do app era fixa.** Tudo o que vem do banco é "variável", então a assinatura
   que já chegou no dia 2 entra no ritmo e é multiplicada pelos dias que faltam, como se a Netflix
   fosse cobrada de novo a cada semana.
2. **As categorias que eram transferência** ("Resgate Poupança", "Transferência", criadas antes do
   M13.2 ligar transferências na revisão) seguem contando como gasto ou receita nos lançamentos já
   confirmados.

Decidido pelo Danillo em 03/11/2026 (canvas linha N): fixa ou variável **pela categoria (o padrão)
e na compra**, com "as próximas desta loja também", **sem criar recorrência**; e uma limpeza guiada
das categorias que eram transferência. As previsões dos meses seguintes (a fixa que repete, as
parcelas projetadas, o salário previsto) ficam no M13.3c.

## Decisões

1. **O tipo da despesa sai de quatro lugares, nesta ordem** (`spendingNature` no core, `NATURE_SQL`
   no banco, com o teste de concordância):
   - parcela: a compra parcelada do FinTrack ou a parcela que o banco informa ("3 de 6"). Sempre
     parcela; ninguém troca;
   - a marca da compra (`transaction.nature`, FIXED ou VARIABLE), quando a pessoa marcou (ou uma
     regra marcou);
   - fixa, se o lançamento veio de uma recorrência do app;
   - o padrão da categoria (`category.defaultNature`, VARIABLE por padrão).
     A marca nula quer dizer "segue a categoria": trocar o padrão da categoria muda as compras que
     ninguém marcou, e as marcadas ficam como estão. Um CHECK no banco recusa marca em parcela.
2. **"As próximas desta loja também" é a regra de categoria de sempre**, que passa a levar o tipo
   (`category_rule.nature`). O mesmo texto que ela já reconhece (`suggestRulePattern`) dá à compra
   que chegar a categoria e a marca. Na edição de uma compra o campo "Sempre categorizar assim" virou
   "As próximas de X também (categoria e tipo)"; na revisão, a caixa fica embaixo do Tipo da despesa.
   Sem categoria não há regra (a regra sempre tem categoria).
3. **O previsto do mês conta cada fixa uma vez.** O previsto = o que já saiu + o que está agendado +
   as recorrências do app que faltam + **as fixas do mês passado que ainda não chegaram** (pelo valor
   do mês passado) + o ritmo, que agora é só do variável. "A mesma fixa" é o mesmo comerciante
   (`merchantKey` da descrição do banco) no mesmo ambiente; a que veio de recorrência do app já está
   nas recorrências que faltam e não conta de novo. Só no mês em andamento: nos meses seguintes, o
   M13.3c.
4. **O bloco "Previsto para {mês}" do Início** mostra as três partes (fixas, parcelas, variáveis),
   cada uma com a frase do porquê ("5 de 7 já chegaram; faltam …", "no ritmo do mês: R$ X em N dias").
   O número continua levando à lista (o recorte do ADR-025).
5. **A limpeza das categorias que eram transferência** fica em Ajustes › Categorias. Uma categoria
   aparece quando, nos lançamentos confirmados dos últimos 6 meses dela, **pelo menos dois têm o outro
   lado** numa conta do lar (mesmo valor com o sinal trocado, outra conta, até 5 dias: a regra do
   `suggestTransfers`) e eles são **pelo menos a metade** dos dela. A pessoa revisa os pares e confirma
   "Tratar os N como transferência": cada par ganha o mesmo `transferId`, os dois lados perdem a
   categoria e a marca; o que não tem o outro lado vira transferência de um lado só para uma conta da
   própria pessoa fora do FinTrack (`transferPeer EXTERNAL`). Só entram lançamentos das carteiras que a
   pessoa edita, nos dois lados. Opcionalmente a categoria é arquivada. Tudo numa transação, com o
   antes de cada lançamento guardado (`category_cleanup`): por 30 minutos, **Desfazer** devolve tudo
   como estava, inclusive a categoria desarquivada.

## Consequências

- Uma coluna em cada uma de três tabelas (todas com padrão ou nulas) e uma tabela nova: migração
  aditiva, nenhum lançamento muda ao aplicar.
- A cascata de categorização passa a devolver o tipo junto com a categoria quando a camada é a regra;
  o histórico, o banco, o classificador e a IA local continuam só com a categoria.
- As abas Fixas/Parcelas/Variáveis da fatura (ADR-025) e o Orçamento passam a enxergar o tipo novo
  sem mudança própria: todos leem `NATURE_SQL`.
- A etiqueta do tipo aparece em cada linha de despesa (Lançamentos, Cartões, o recorte) e, num toque,
  abre a escolha. A parcela mostra "Parcela" e não abre nada.

## Alternativas consideradas

- **Criar uma recorrência ao marcar fixa.** Recusada pelo Danillo: a recorrência gera lançamentos, e
  a cobrança do banco já é o lançamento. A previsão da fixa nos meses seguintes vem no M13.3c, sem
  gerar lançamento.
- **Uma tabela própria para "as próximas desta loja".** Seriam duas regras para o mesmo texto (uma de
  categoria, outra de tipo) que podiam discordar. A regra de categoria já reconhece a loja e já é
  editável e auditada.
- **Converter as categorias de transferência sozinho, na migração.** Recusada: quem decide se o PIX
  para a poupança é transferência é a pessoa, olhando os pares; e a migração não sabe de quem é cada
  lado.

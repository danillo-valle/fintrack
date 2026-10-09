# ADR-009: "Pago por", ambientes, parcelas e despesas fixas

- Status: aceita
- Data: 2026-10-09
- Módulo: M07.4 (feature entre o M07.3 e o M08; desenho no canvas C.2)

## Contexto

No ambiente compartilhado ("Casa"), as compras de um mesmo cartão podem ser de pessoas
diferentes: o casal usa cartões de cada um e um cartão de compras conjuntas. A pergunta do dia a
dia é "quem pagou isto?", e o filtro que faltava é "só as compras do Caio" ou "só as conjuntas".
Ao mesmo tempo, a pessoa precisa ver a Casa **junto** com o próprio ambiente pessoal, sem nunca
ver o pessoal da outra pessoa.

Faltavam também dois tipos de despesa da planilha antiga, que o modelo do M03 já previa
(ADR-004: o tipo é calculado, não guardado):

- **parcelada**: uma compra de R$ 300 em 3× no cartão aparece uma vez em cada fatura;
- **fixa**: a assinatura de R$ 69,90 todo mês, sem cadastrar mês a mês.

Restrições: evoluir por acréscimo (nenhuma tabela reestruturada), só os 4 últimos dígitos do
cartão, e o visual igual ao do canvas C.2.

## Decisão

- **"Pago por" é calculado, não é coluna.** Sai do que o lançamento já guarda (o "quem paga" do
  ADR-004), por uma regra pura no core (`resolvePayer`, `packages/core/src/payer.ts`):
  cartão de compras conjuntas → **Compartilhado**; cartão com portador → o portador; sem cartão
  → o titular da conta; nada disso → desconhecido (a lista mostra a letra da categoria).
  - O **filtro** usa a mesma regra escrita como `WHERE` (`payerWhere`, `packages/db`); a lista e
    os totais usam o mesmo `WHERE`. Um teste de integração confere que banco e core concordam
    linha por linha.
  - A única coluna nova é `payment_card."sharedPurchases"` (booleano, padrão falso), marcada em
    Ajustes > Contas por quem gere as contas da carteira do cartão (auditada:
    `card.shared_purchases_changed`). Por ser calculado, marcar um cartão muda o "Pago por" das
    compras antigas também, de propósito.
  - Na tela, o quadrado da frente da linha passa a ser **quem pagou** (iniciais: DV, NV, CP),
    e a categoria fica na etiqueta. As cores seguem a ordem de entrada no lar (azul, laranja,
    rosa, verde); o Compartilhado é sempre o verde-azulado. As letras usam a "tinta" do tom
    (`--chart-N-ink`), conferida a 4,5:1 sobre o próprio tom no `theme-contrast.test.ts`.
- **Ambiente.** Um seletor de links ("Tudo que vejo", os compartilhados, o pessoal) no topo de
  Lançamentos e do Início. "Tudo que vejo" é o escopo de leitura do ADR-006: o pessoal de outra
  pessoa nunca entra, porque nem existe no escopo. A frase do resumo diz o que está somando e de
  quem é o pessoal que fica de fora.
- **Parcelada** (`createInstallmentPurchase`, `packages/db/src/installments.ts`): só em cartão
  de crédito com fechamento e vencimento, de 2 a 24 parcelas. Vira N lançamentos de um
  `InstallmentGroup`, um por fatura (a fatura do mês é criada ou reaproveitada pelo único
  `(accountId, referenceMonth)`). A sobra de centavos vai na 1ª parcela (`installmentPlan`).
  Parcelas de meses futuros nascem `SCHEDULED`. A lista de cada mês mostra só a parcela daquele
  mês, com o selo "k/N".
- **Fixa** (`createFixedExpense`): cria a recorrência (conta fixa ou assinatura) **e** o
  lançamento deste mês, com o mesmo `externalId` `"<recorrência>:<AAAA-MM>"` que "Lançar as
  deste mês" usaria; por isso gerar o mês de novo não duplica.
- **No formulário**, "Tipo da despesa" (Variável, Parcelada, Fixa) fica entre a descrição e a
  categoria; "Pago por" aparece ao lado do "Pago com" como informação (não se escolhe: segue o
  cartão ou a conta). Parcelada e fixa criam mais de uma coisa, então o aviso de sucesso não
  tem "Desfazer"; excluir continua na lista.

## Consequências

- A lista ganha uma regra a mais para manter em dois lugares (core e `WHERE`); o teste de
  concordância é o que impede que divirjam.
- Uma pessoa sem titular nas contas (dado antigo) aparece com a letra da categoria até o titular
  ser cadastrado.
- A prancha do computador no canvas mostra o "Tipo da despesa" logo abaixo das abas; a do
  celular, depois da descrição. Ficou uma ordem só (a do celular), para a ordem do Tab seguir a
  ordem visual (WCAG 2.4.3) e o valor continuar sendo o primeiro campo.
- O bloco "Tipo da despesa" e a linha das parcelas aumentam o modal. Para ele continuar sem barra
  de rolagem num notebook (1280 × 720), a variante `compact` (computador com até 840 px de
  altura, só dentro do modal) aperta espaços e alturas; em telas mais altas ficam as medidas do
  canvas. Um teste E2E confere os três tipos nessa tela.
- Editar ou excluir uma compra parcelada inteira de uma vez fica para um módulo futuro; hoje cada
  parcela é um lançamento.

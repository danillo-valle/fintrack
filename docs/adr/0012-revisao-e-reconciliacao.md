# ADR-012: Revisão e reconciliação do que vem do banco

- Status: aceita
- Data: 2026-10-14
- Módulo: M09.2 (desenho no canvas, linha E.2)

## Contexto

No M09.1, tudo que o banco manda entra como **recebido** (`PENDING`) e fica fora das somas. Falta
a pessoa conferir: confirmar o que está certo, dizer que um recebido é o mesmo gasto que ela já
tinha lançado (para não contar duas vezes) e ligar o estorno à compra. Também apareceu um defeito
no M09.1: a compra de um cartão adicional ainda não cadastrado ia para o cartão do titular.

Restrições: as do ADR-011 (só grátis, só os 4 últimos dígitos, nada real em teste, Prisma 7 com
migração aditiva, WCAG 2.2 AA, visual igual ao canvas).

Combinado com o Danillo antes do código (13/10/2026, canvas E.2 aprovado):

- **par** = mesma conta, **mesmo valor ao centavo**, datas a até **5 dias**; a descrição só
  ordena as sugestões, nunca decide;
- **fica o seu** lançamento (descrição, categoria, ambiente, observação), com o **valor e a data
  do banco** e o id do banco;
- revisão **um a um e em lote** ("Confirmar os N que já têm categoria"), por fatura ou por conta;
- **parcela**: o "3 de 6" do banco com a sua parcela 3 de 6 de mesmo valor, sem olhar a data;
- **estorno**: crédito do banco do mesmo valor e da mesma loja de uma compra de até 90 dias antes;
- o patch do adicional entra no M09.2.

## Decisão

1. **Sugestão calculada, decisão gravada.** As regras ficam no `@fintrack/core`
   (`reconcile.ts`): `suggestPairs`, `suggestRefunds`, `pairedFields`, `bulkConfirmable`. A tela
   mostra a sugestão; o servidor confere a regra **de novo** antes de gravar. Só a decisão da
   pessoa vai para o banco, na tabela nova `transaction_match` (par confirmado, recusado ou
   desfeito), com o antes dos dois lados para o "Desfazer".
2. **Quem fica é o recebido.** Ao juntar, o lançamento do banco recebe o lado da pessoa e o
   lançamento dela fica apagado (`deletedAt`), apontando para ele (`mergedIntoId`). Assim o id do
   banco continua no lançamento que existe, e a próxima busca não cria outro.
3. **Um par por lado, escolha gulosa.** Cada recebido e cada lançamento seu entram em no máximo
   um par: primeiro a parcela certa, depois a descrição mais parecida, a data mais próxima e o
   mesmo cartão. Dois cafés iguais no mesmo dia viram dois pares.
4. **Concorrência por UPDATE condicional.** Confirmar só muda um recebido ainda `PENDING`; juntar
   só apaga um lançamento ainda não apagado. Duas abas: um sucesso e um "já foi conferido".
5. **Lote seguro.** O lote confirma só o que tem categoria (ou é transferência) e **não** tem par
   sugerido: confirmar um recebido que tem par contaria o gasto duas vezes.
6. **Estorno não é par.** Os dois lançamentos ficam (um anula o outro); o crédito ganha
   `reversalOfId` e o ambiente da compra. A categoria não é copiada: a regra do M07 não deixa uma
   entrada usar categoria de despesa.
7. **Adicional antes do cadastro.** O final que o banco manda fica em `providerCardLastFour`.
   Final desconhecido deixa o recebido **sem cartão** (antes ia para o titular); sem final, vale
   o cartão único da conta. Cadastrar (ou arquivar) um cartão reorganiza os recebidos daquele
   final (`rerouteReceived`); o que já foi confirmado não muda.
8. **Desfazer.** Confirmação simples ou em lote: 30 minutos, só quem confirmou. Par e estorno:
   pelo `transaction_match`, só quem decidiu, enquanto o recebido continua confirmado.

## Alternativas consideradas

- **Guardar as sugestões numa tabela:** ficariam velhas a cada busca e a cada lançamento novo.
  Calcular na hora é barato (só a janela de datas e os valores dos recebidos).
- **Ficar com o seu lançamento e apagar o recebido:** a próxima busca recriaria o recebido (a
  chave única é o id do banco), ou o seu lançamento precisaria herdar `source` e `externalId`,
  misturando "quem lançou" com "de onde veio".
- **Par por descrição parecida com valor aproximado:** erra em silêncio (dois gastos parecidos
  viram um). Valor exato e a pessoa confirmando é mais seguro.

## Consequências

- O seu lançamento juntado some das listas e das somas; o recebido confirmado passa a contar no
  lugar dele, com o valor e a data do banco.
- `transaction_match` cresce só com decisões (uma linha por par confirmado ou recusado).
- Regras novas do banco, cada uma com teste de integração: final com 4 dígitos, revisor com
  data, lançamento juntado sempre apagado, par com dois lados diferentes, "desfeito" com data.

## Revisão do M12.3b (28/10/2026)

**Continua valendo**, inteira. Nada da revisão e da reconciliação mudou depois do M09.2.

## Adendo do M13.2 (31/10/2026): transferências, pagamento de fatura e o "O que foi"

No primeiro mês de uso real, cada transferência entre as contas da pessoa entrou **duas vezes**
(a saída numa conta e a entrada na outra), o débito automático da fatura contou como gasto além
das compras do cartão, e a descrição do banco ("MERCADOLIVRE*MERCA03/03") não dizia o que foi
comprado.

1. **Par de transferência (`MatchKind` `TRANSFER`).** Dois lados do banco: uma saída e uma
   entrada do mesmo valor, em contas diferentes, com até 5 dias entre as datas, os dois em
   carteiras que a pessoa **edita**. `suggestTransfers` (`@fintrack/core`) sugere; o servidor
   confere de novo. Confirmar grava o mesmo `transferId` nos dois lados, tira a categoria e
   confirma; os dois ficam (cada conta mantém o próprio extrato) e saem das somas de gasto e de
   receita, como a transferência feita à mão desde o M07. O antes dos dois lados vai para o
   `transaction_match`, e o "Desfazer" devolve os dois. "Não é transferência" grava a recusa.
2. **Pagamento de fatura** é o par de transferência em que a entrada cai numa conta de cartão.
   Só o rótulo muda: não conta como gasto (as compras já contam pelo cartão) e não abate a fatura
   aberta.
3. **Um lado só.** Quando o outro lado não aparece para a pessoa (a conta de outra pessoa do lar,
   que ela não vê, ou uma conta fora do FinTrack), "É transferência" marca só aquele lado:
   `transferId` novo e `transferPeer` (`HOUSEHOLD` ou `EXTERNAL`, coluna nova, só com
   `transferId`). O recebido continua na revisão como quem escolheu a categoria e entra no
   "Confirmar os N"; escolher uma categoria desfaz a marca. Entre duas pessoas do lar, cada uma
   marca o próprio lado: ninguém passa a ver a conta da outra.
4. **"O que foi" (`label`, coluna nova).** A `description` continua o texto da origem (o banco,
   o OFX, o PDF ou o que a pessoa digitou num lançamento manual), e é dela que a categorização, a
   busca do banco e os exemplos de treino continuam lendo. O "O que foi" é o nome que a pessoa dá
   ao lançamento do banco: aparece em destaque, com o texto do banco embaixo, e a busca acha pelos
   dois. Nunca vai para log nem treina a categorização.
5. **O par do M09.2 deixa de apagar o texto do banco**: a descrição do lançamento da pessoa vai
   para o `label` do recebido, e a `description` do banco fica (antes, a dela substituía a do
   banco).
6. **Parcelas.** O "O que foi" e a categoria escritos numa parcela valem para as irmãs (mesma
   conta, mesmo valor, mesmo total de parcelas e a mesma descrição sem o "NN/NN",
   `installmentSiblingKey`), e a parcela que chegar depois na busca já entra com os dois.

Consequência: o vínculo de transferência entre duas pessoas do lar não mostra no pessoal de quem
enviou quanto foi para a outra pessoa; isso fica para o acerto do casal, quando vier.

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

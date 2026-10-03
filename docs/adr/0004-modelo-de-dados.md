# ADR-004: Modelo de dados, dinheiro e regras no banco

- **Status:** aceita (revisão 2)
- **Data:** 2026-10-03
- **Módulo:** M04

## Contexto

O FinTrack passa a guardar o domínio. Hoje são duas pessoas, mas o sistema precisa servir a
qualquer número de usuários. A planilha que ele substitui mostrou como o dinheiro da casa
funciona de verdade:

- Cada cartão de crédito é uma **fatura** com vários cartões dentro: o físico e o virtual do
  titular e os **adicionais** (físico e virtual) de outra pessoa, todos somando na mesma fatura.
- Muitas compras não são de quem paga: o mercado do casal sai no adicional dela, na fatura
  dele, e é gasto da casa (o "CASAL" da planilha, mais da metade das despesas variáveis).
- As pessoas querem criar **ambientes** de gasto conjunto ("Casa") quando sentirem necessidade.
- Despesas fixas, recorrentes, parceladas e variáveis viviam em abas separadas; o status
  "PAGO/ABERTO" de compras no cartão era, na verdade, o status da fatura.

Dinheiro errado por um centavo, um lançamento duplicado na importação ou um gasto no
ambiente errado tiram a confiança no sistema. O código vai ser escrito em partes, por pessoas
e por IA, ao longo de vários módulos: as regras mais importantes precisam valer mesmo quando
um caminho do código esquece delas. E cada feature futura deve ser um acréscimo, não uma
reestruturação.

## Decisão

1. **Quem paga × de quem é.** O lançamento guarda, em colunas separadas, a conta que paga
   (`accountId`), o cartão usado (`cardId`, opcional), a forma de pagamento (`method`) e o
   **ambiente** a que o gasto pertence (`walletId`). Conta e ambiente são independentes: uma
   compra da "Casa" pode sair do cartão pessoal de alguém.
2. **Grupo e ambientes.** `Household` é o grupo (qualquer número de pessoas; uma pessoa pode
   estar em vários). `Wallet` é o **ambiente**: um PERSONAL por pessoa e quantos SHARED os
   membros quiserem criar, com papéis OWNER/EDITOR/VIEWER. Só membros do grupo entram num
   ambiente do grupo (chave `(householdId, userId)` → `household_member`).
3. **Conta com titular, cartão com portador.** `FinancialAccount` tem titular (`holderId`) e
   um ambiente onde é gerida; um cartão **conjunto** é uma conta cujo ambiente é compartilhado.
   `PaymentCard` é o plástico ou o virtual: portador, bandeira (texto), formato, se é adicional
   e **só os 4 últimos dígitos**. O número completo nunca é guardado (PCI DSS; o Open Finance
   também só entrega o número mascarado). Conta de vale-refeição é um tipo próprio.
4. **Dinheiro: `NUMERIC(14,2)` no banco e `bigint` em centavos no código**, com sinal
   (negativo = saída). Conversão sempre por texto (`toDbDecimal`/`fromDbDecimal`).
   Transferências e pagamento de fatura são dois lançamentos com o mesmo `transferId`.
5. **Data do lançamento é `DATE` (`occurredOn`)**, sem hora: nenhum fuso muda a compra de mês.
6. **Recorrências** (`Recurrence`: conta fixa, assinatura, receita) geram os lançamentos do mês,
   que apontam para elas. Fixa, assinatura, parcelada e variável são **calculadas** a partir de
   `recurrenceId` e `installmentGroupId`, não guardadas. Lançamento futuro é `SCHEDULED`.
7. **Regras puras em `packages/core`**, sem I/O: soma, rateio (maior resto), parcelas, datas
   civis e fatura do cartão. Testes de exemplo e de propriedade (fast-check). Uma regra de
   ESLint (`moneyGuard`) proíbe `parseFloat`, `Number()` e `toFixed` no `core` e no `db`.
8. **Integridade no banco, não só no código:**
   - todas as ligações levam o `householdId` (chaves compostas): conta, ambiente, categoria,
     orçamento, parcela e recorrência de um lançamento são sempre do mesmo grupo;
   - o cartão é da conta do lançamento, e a fatura também (`(cardId, accountId)`,
     `(statementId, accountId)`);
   - único `(accountId, source, externalId)`: importar de novo não duplica;
   - CHECKs escritos à mão no fim da migração (o Prisma não os expressa nem os desfaz);
   - gatilho `transaction_method_matches_account`: crédito só em cartão de crédito, vale só em
     vale-refeição, fatura só em cartão (regra entre duas tabelas, que um CHECK não alcança);
   - `audit_log` só acrescenta (gatilho recusa `UPDATE`, `DELETE` e `TRUNCATE`).
     Cada regra tem teste de integração contra o Postgres (`pnpm test:integration`).
9. **Cartão e categoria em uso são arquivados, não apagados.** As chaves compostas opcionais
   usam `NoAction`: um `SetNull` zeraria também o `accountId` ou o `householdId`, obrigatórios.
10. **Schema em vários arquivos** (`packages/db/prisma/schema/`): `auth.prisma` continua do CLI
    do Better Auth; o domínio fica em `household`, `accounts`, `transactions` e `integrations`.
    O `User` ganhou só listas de relação (nenhuma coluna nova).
11. **Identificadores:** UUID v7 nas tabelas do domínio; ids do Better Auth continuam texto.
    Tabelas em snake_case, colunas em camelCase, enums em inglês (a tela traduz: `Wallet`
    aparece como "Ambiente").
12. **Seed determinístico** com a estrutura da planilha e dados inventados (Lia e Caio
    Exemplo): fatura com adicionais, cartão conjunto, vale-refeição, recorrências. Gerado por
    um plano puro (testado sem banco) e gravado numa transação; só roda com banco local.

## Regras para o modelo crescer sem reestruturar

- Feature nova entra como tabela nova, coluna opcional (ou com valor padrão) ou valor novo de
  enum. Nenhuma coluna muda de significado.
- O que pode ser calculado não é guardado (natureza da despesa, status do cartão, saldo).
- Quando uma mudança incompatível for inevitável: expandir (coluna nova), migrar os dados,
  mudar o código, e só num PR seguinte contrair (remover a antiga).

Planejadas assim, como acréscimos: investimentos; metas; limite de gastos com alerta (no
orçamento e por cartão adicional); divisão dentro do ambiente com acerto de contas (peso por
membro); mês de referência manual; anexos; importação da planilha antiga (M12).

## Alternativas consideradas

- **Lançamento sempre na carteira da conta (revisão 1 deste ADR):** simples, mas não representa
  a compra da casa feita no cartão de uma pessoa, o caso mais comum na planilha.
- **Rateio de uma compra entre vários ambientes:** mais flexível, mas toda soma passaria a ler
  uma tabela de rateio. Decidido: um ambiente por lançamento; divisão vira feature se fizer falta.
- **Número completo do cartão, cifrado:** ainda traria obrigações do PCI DSS e risco sem
  benefício; os 4 dígitos bastam para reconhecer o cartão.
- **`number` em reais:** erro de arredondamento e perda de precisão; descartado no ADR-002.
- **`timestamp` para a data do lançamento:** a mesma compra cai em dias diferentes por fuso.
- **Abas como tipos (fixa, variável, parcelada guardadas numa coluna):** duplicaria o que já se
  sabe pela recorrência e pela parcela, e as duas versões acabariam discordando.
- **Validar só no código (zod) sem CHECK nem gatilho:** um script ou importador novo poderia
  gravar dado inválido sem passar pela validação.

## Consequências

- Visibilidade (regra do M06): o ambiente decide o que cada pessoa vê. O **titular** vê a fatura
  inteira da conta dele; o **portador de um adicional** vê as próprias compras (pelo `cardId`) e
  tudo que está nos ambientes dele.
- Relatórios de gasto somam por `walletId` e filtram `transferId IS NULL`, `deletedAt IS NULL` e
  `status <> 'SCHEDULED'`; o M08 centraliza isso.
- Toda migração com CHECK, gatilho ou índice especial é criada com `migrate dev --create-only`,
  editada e só então aplicada (skill `prisma-migration`).
- O M09 usa `ProviderConnection`, `SyncRun`, `externalId`, `PaymentCard.lastFour` e
  `CardStatement` sem migração nova, exceto a cifragem do segredo.
- O Prisma 7 recusa `migrate reset` quando chamado por um agente de IA sem consentimento
  explícito: o reset do banco é sempre um comando digitado pela pessoa.

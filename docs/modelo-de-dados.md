# Modelo de dados do FinTrack

Mapa das tabelas do domínio (M04). O schema completo, comentado campo a campo, está em
`packages/db/prisma/schema/`, um arquivo por assunto. As decisões estão no
[ADR-004](adr/0004-modelo-de-dados.md).

> Este diagrama é conferido por teste: `packages/db/src/docs-sync.test.ts` falha se um modelo
> do schema não aparecer aqui. Mudou o schema? Atualize o diagrama no mesmo PR.

## A ideia central: quem paga × de quem é

Todo lançamento responde três perguntas, cada uma numa coluna diferente:

| Pergunta   | Coluna                           | Exemplo                                      |
| ---------- | -------------------------------- | -------------------------------------------- |
| Quem paga? | `accountId`, `cardId` e `method` | fatura do Cartão Master, final 1003, crédito |
| De quem é? | `walletId` (o **ambiente**)      | "Casa"                                       |
| O que é?   | `categoryId`                     | Alimentação › Mercado                        |

Por isso a compra do mercado no cartão **adicional** de uma pessoa, que cai na fatura da
**titular**, pode ser um gasto do ambiente **Casa**. A fatura soma por conta; o ambiente
soma por `walletId`. As duas somas estão certas, porque respondem perguntas diferentes.

## Diagrama

O GitHub desenha o bloco abaixo como diagrama. Leia as linhas assim: `||--o{` é "um para
muitos" (um ambiente tem zero ou mais lançamentos); `|o--o{` é "zero ou um para muitos".

```mermaid
erDiagram
    User ||--o{ HouseholdMember : "faz parte de"
    User ||--o{ WalletMember : "participa de"
    User |o--o{ FinancialAccount : "é titular de"
    User |o--o{ PaymentCard : "porta"
    User |o--o{ Transaction : "lançou"
    User ||--o{ ProviderConnection : "conectou"

    Household ||--o{ HouseholdMember : tem
    Household ||--o{ Wallet : "tem (ambientes)"
    Household ||--o{ FinancialAccount : tem
    Household ||--o{ Category : tem
    Household ||--o{ CategoryRule : tem
    HouseholdMember ||--o{ WalletMember : "só membro do grupo"
    Household ||--o{ HouseholdInvite : "convites (M06)"
    User |o--o{ HouseholdInvite : "criou / aceitou"

    Wallet ||--o{ WalletMember : "com papel"
    Wallet ||--o{ FinancialAccount : "gere"
    Wallet ||--o{ Transaction : "de quem é"
    Wallet ||--o{ Budget : planeja
    Wallet ||--o{ Recurrence : "de quem é"
    Wallet ||--o{ InstallmentGroup : "de quem é"
    Wallet ||--o{ ProviderConnection : recebe

    FinancialAccount ||--o{ PaymentCard : "tem cartões"
    FinancialAccount ||--o{ Transaction : "quem paga"
    FinancialAccount ||--o{ CardStatement : "fatura (cartão)"
    FinancialAccount ||--o{ InstallmentGroup : parcela
    FinancialAccount ||--o{ Recurrence : "debita"
    PaymentCard |o--o{ Transaction : "passado em"
    PaymentCard |o--o{ Recurrence : "assinatura em"
    ProviderConnection |o--o{ FinancialAccount : sincroniza
    ProviderConnection ||--o{ SyncRun : executa

    Category |o--o{ Category : "subcategoria de"
    Category |o--o{ Transaction : classifica
    Category ||--o{ CategoryRule : "alvo de"
    Category ||--o{ Budget : "limite de"
    Category |o--o{ Recurrence : classifica

    CardStatement |o--o{ Transaction : "inclui (competência)"
    InstallmentGroup ||--|{ Transaction : "parcelas 1..N"
    Recurrence |o--o{ Transaction : "gera (todo mês)"
    Transaction |o--o{ Transaction : "estorno de"

    Household ||--o{ CategorizationExample : "exemplos de treino (M07)"
    Category ||--o{ CategorizationExample : "corrigido para"
    Transaction |o--o{ CategorizationExample : "corrigido em"

    Household {
        uuid id PK
        string name
    }
    HouseholdMember {
        uuid householdId PK, FK
        string userId PK, FK
        enum role "OWNER | MEMBER"
    }
    HouseholdInvite {
        uuid id PK
        uuid householdId FK
        char64 tokenHash UK "SHA-256 do segredo do link"
        string email "minúsculas"
        enum role "OWNER | MEMBER"
        datetime expiresAt "72 h"
        datetime acceptedAt "uso único"
        datetime revokedAt
    }
    Wallet {
        uuid id PK
        uuid householdId FK
        enum kind "PERSONAL | SHARED"
        string name "ambiente: Casa, Viagem..."
    }
    WalletMember {
        uuid walletId PK, FK
        string userId PK, FK
        uuid householdId FK "membro do grupo"
        enum role "OWNER | EDITOR | VIEWER"
    }
    FinancialAccount {
        uuid id PK
        uuid householdId FK
        uuid walletId FK "ambiente onde é gerida"
        string holderId FK "titular"
        enum kind "CHECKING | SAVINGS | CREDIT_CARD | MEAL_VOUCHER | CASH"
        smallint closingDay "só cartão"
        smallint dueDay "só cartão"
    }
    PaymentCard {
        uuid id PK
        uuid accountId FK
        string holderId FK "portador"
        string brand "bandeira"
        char4 lastFour "só 4 dígitos"
        enum form "PHYSICAL | VIRTUAL | VIRTUAL_TEMPORARY"
        bool isAdditional
        bool sharedPurchases "compras conjuntas (M07.4)"
    }
    Category {
        uuid id PK
        uuid householdId FK
        uuid parentId FK
        enum kind "EXPENSE | INCOME"
    }
    CategoryRule {
        uuid id PK
        uuid categoryId FK
        string pattern "minúsculas"
        enum match "CONTAINS | STARTS_WITH | EQUALS"
    }
    Budget {
        uuid id PK
        uuid walletId FK
        uuid categoryId FK
        date month "sempre dia 1"
        decimal amount "14,2"
    }
    Recurrence {
        uuid id PK
        uuid walletId FK
        uuid accountId FK
        uuid cardId FK
        enum kind "FIXED_BILL | SUBSCRIPTION | INCOME"
        enum method
        decimal amount "14,2 com sinal"
        smallint dayOfMonth
    }
    Transaction {
        uuid id PK
        uuid householdId FK
        uuid walletId FK "de quem é"
        uuid accountId FK "quem paga"
        uuid cardId FK "com qual cartão"
        enum method "CREDIT | DEBIT | PIX | BOLETO | ..."
        decimal amount "14,2 com sinal"
        date occurredOn
        enum status "PENDING | SCHEDULED | CONFIRMED"
        enum source "MANUAL | OFX | PDF | OPEN_FINANCE | BOT | RECURRENCE"
        string externalId "único por conta e origem"
        uuid transferId "dois lados"
        enum categorizedBy "MANUAL | RULE | HISTORY (M07)"
        timestamp deletedAt "exclusão lógica"
    }
    CategorizationExample {
        uuid id PK
        uuid householdId FK
        uuid transactionId FK
        string description
        uuid fromCategoryId FK "o que estava"
        enum fromSource "quem tinha decidido"
        uuid toCategoryId FK "o que a pessoa escolheu"
    }
    CardStatement {
        uuid id PK
        uuid accountId FK
        date referenceMonth "competência"
        date dueDate "caixa"
        decimal total "14,2"
    }
    InstallmentGroup {
        uuid id PK
        uuid accountId FK
        decimal totalAmount "14,2"
        smallint installmentCount "2 a 99"
    }
    ProviderConnection {
        uuid id PK
        string userId FK
        enum provider "PLUGGY"
        bytes secretCiphertext "cifrado (M09)"
    }
    SyncRun {
        uuid id PK
        uuid connectionId FK
        enum status "RUNNING | SUCCEEDED | FAILED"
    }
    AuditLog {
        bigint id PK
        string actorId "sem FK"
        string action
        json metadata
    }
```

`AuditLog` não tem linhas no diagrama de propósito: não tem chave estrangeira, para o
registro sobreviver mesmo que a pessoa ou o grupo sejam apagados.

## O que é calculado, e não guardado

| Na planilha antiga                    | No FinTrack                                                      |
| ------------------------------------- | ---------------------------------------------------------------- |
| Abas "Despesas Fixas" e "Recorrentes" | lançamento com `recurrenceId` (o tipo está em `Recurrence.kind`) |
| "Despesa Parcelada", coluna "Parcela" | lançamento com `installmentGroupId` e `installmentNumber`        |
| "Despesa Variável"                    | lançamento sem recorrência e sem parcelamento                    |
| Status "PAGO" / "ABERTO" do cartão    | status da fatura (`CardStatement.status`)                        |
| Status "AGENDADO" / "REALIZADO"       | `status` SCHEDULED / CONFIRMED                                   |
| Integrante "CASAL"                    | ambiente compartilhado ("Casa")                                  |
| "Cartão Principal" e "Cartão"         | conta da fatura (`accountId`) e cartão usado (`cardId`)          |
| "Mês Referência" de compra no cartão  | `CardStatement.referenceMonth` da fatura da compra               |
| "Quem pagou" (M07.4)                  | `resolvePayer`: cartão conjunto, portador do cartão ou titular   |

## As travas que moram no banco

| Regra                                                                    | Onde                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| O mesmo lançamento importado entra uma vez só                            | único `(accountId, source, externalId)`                            |
| Conta, ambiente, categoria e parcela de um lançamento são do mesmo grupo | chaves compostas com `householdId`                                 |
| O cartão é da conta do lançamento; a fatura também                       | chaves compostas `(cardId, accountId)`, `(statementId, accountId)` |
| Só quem é do grupo entra num ambiente do grupo                           | chave `(householdId, userId)` → `household_member`                 |
| Cartão guarda só os 4 últimos dígitos                                    | CHECK `payment_card_last_four_check`                               |
| Crédito só em cartão; vale só em vale-refeição; fatura só em cartão      | gatilho `transaction_method_matches_account`                       |
| Valor nunca é zero; importado sempre tem `externalId`                    | CHECKs de `transaction`                                            |
| Cartão tem fechamento e vencimento; as outras contas, não                | CHECK `financial_account_card_days_check`                          |
| Mês de orçamento e de fatura guardado como dia 1                         | CHECKs de `budget` e `card_statement`                              |
| A auditoria só acrescenta                                                | gatilho `audit_log_append_only`                                    |
| Convite guarda só o hash do segredo; e-mail em minúsculas (M06)          | CHECKs `household_invite_token_hash_check` e `_email_check`        |
| Convite não é aceito e cancelado ao mesmo tempo; prazo depois da criação | CHECKs `household_invite_state_check` e `_expiry_check`            |
| Nome de lar e de carteira com 1 a 60 caracteres (M06)                    | CHECKs `household_name_length_check` e `wallet_name_length_check`  |
| "Quem categorizou" só existe com categoria (M07)                         | CHECK `transaction_categorized_by_check`                           |
| Transferência não tem categoria (M07)                                    | CHECK `transaction_transfer_category_check`                        |
| Exemplo de treino é uma correção de verdade (M07)                        | CHECKs `categorization_example_change_check` e `_source_check`     |

Cada regra tem um teste em `packages/db/src/integration/`, que tenta quebrá-la contra o
PostgreSQL de verdade (`pnpm test:integration`).

## Quem vê o quê (M06)

O banco garante a fronteira do grupo (nada aponta para outro lar). **Quem dentro do lar pode
fazer o quê** é decidido no código, num ponto só: `authorizeWallet` e `authorizeHousehold`
(`packages/db/src/access.ts`), que leem o vínculo da pessoa e consultam a matriz de papéis
(`packages/core/src/access.ts`). A tabela completa está em [`permissoes.md`](permissoes.md).

## Lançamentos e categorização (M07)

- **Lançar** pede dois crachás: `edit` na carteira (de quem é) e o de **uso da conta** (quem
  paga), que vem de `edit` na carteira da conta ou de ser **portador** de um cartão dela (o
  adicional do cônjuge lança na fatura do titular, só com o próprio cartão).
- **`categorizedBy`** diz quem decidiu a categoria: a pessoa (`MANUAL`) ou a camada da cascata
  cuja sugestão ela aceitou (`RULE`, `HISTORY`). É de onde sai, no M10, o "percentual
  resolvido sem LLM". Lançamentos anteriores ao M07 ficam com nulo.
- **`categorization_example`** guarda cada **correção** (a sugestão ou a categoria gravada
  trocada por outra): o conjunto rotulado do classificador e do eval do M10.
- A cascata e o encaixe para IA estão no [ADR-007](adr/0007-lancamentos-e-categorizacao.md).

## Pago por, parcelas e despesas fixas (M07.4)

- **Pago por** não é coluna: sai do cartão (portador, ou Compartilhado quando
  `sharedPurchases` é verdadeiro) ou, sem cartão, do titular da conta. A regra está no core
  (`resolvePayer`) e no `WHERE` do filtro, conferidos juntos por um teste de integração.
- **Parcelada** vira um `InstallmentGroup` com N lançamentos, um por fatura (`CardStatement`
  único por conta e mês); a sobra de centavos vai na 1ª, as futuras nascem `SCHEDULED`.
- **Fixa** cria a `Recurrence` e o lançamento do mês com o mesmo `externalId` que a geração
  mensal usaria, então gerar o mês de novo não duplica.
- As decisões e o porquê estão no [ADR-009](adr/0009-pago-por-parcelas-e-fixas.md).

## Como ler o dinheiro

- **No banco:** `NUMERIC(14,2)`, com sinal: negativo saiu, positivo entrou.
- **No código:** `bigint` em centavos (`@fintrack/core`). A ponte é `toDbDecimal` e
  `fromDbDecimal` (`@fintrack/db`), sempre passando por texto, nunca por `number`.
- **Gasto do mês de um ambiente:** some por `walletId`, só o que tem `transferId` nulo,
  `deletedAt` nulo e `status` diferente de SCHEDULED. Transferência e pagamento de fatura
  mudam o dinheiro de lugar, não são gasto.
- **Fatura de um cartão:** some por `statementId` (competência) ou por `accountId` e
  `occurredOn` (quando a compra aconteceu). Os dois números são diferentes, e os dois certos.

## Como o modelo cresce sem reestruturar

Feature nova entra como **tabela nova**, **coluna opcional** ou **valor novo de enum**; uma
coluna nunca muda de significado; o que se calcula não é guardado. Planejadas desta forma:
investimentos, metas, limite de gastos com alerta, divisão dentro do ambiente com acerto de
contas, mês de referência manual e anexos. Veja a skill `prisma-migration`.

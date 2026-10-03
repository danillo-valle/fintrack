---
name: prisma-migration
description: Como mudar o banco do FinTrack com o Prisma 7 (schema em pasta, migração nomeada, CHECK e gatilho à mão, dinheiro em Decimal, testes de integração). Use ao criar ou alterar qualquer arquivo em packages/db/prisma/, ao adicionar tabela, coluna, índice ou regra, ao mexer no seed, ou antes de rodar migrate.
---

# Mudanças no banco do FinTrack

Leia antes: `docs/modelo-de-dados.md` (mapa) e `docs/adr/0004-modelo-de-dados.md` (decisões).

## Onde fica cada coisa

| O quê                                        | Onde                                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Tabelas do login (Better Auth)               | `packages/db/prisma/schema/auth.prisma` (gerado pelo CLI)   |
| Grupo, ambientes, membros                    | `packages/db/prisma/schema/household.prisma`                |
| Contas, cartões, categorias, orçamento       | `packages/db/prisma/schema/accounts.prisma`                 |
| Lançamentos, faturas, parcelas, recorrências | `packages/db/prisma/schema/transactions.prisma`             |
| Conexões, sincronização, auditoria           | `packages/db/prisma/schema/integrations.prisma`             |
| Migrações (nunca edite as aplicadas)         | `packages/db/prisma/migrations/<data>_<nome>/migration.sql` |
| Testes que provam as regras do banco         | `packages/db/src/integration/*.integration.test.ts`         |
| Seed (plano puro + gravação)                 | `packages/db/prisma/seed.ts` e `packages/db/prisma/seed/`   |
| Ponte Decimal ⇄ centavos                     | `packages/db/src/money.ts` (`toDbDecimal`, `fromDbDecimal`) |

## Como o modelo cresce (leia antes de qualquer mudança)

Cada feature é um acréscimo, nunca uma reestruturação:

- **Coisa nova = tabela nova, coluna opcional (ou com `@default`) ou valor novo de enum.**
  Uma coluna obrigatória sem padrão numa tabela com dados quebra a migração; um valor de enum
  removido quebra quem o usa.
- **Uma coluna nunca muda de significado.** Precisa de outro significado? Coluna nova.
- **O que se calcula não se guarda:** natureza da despesa (fixa, parcelada, variável), status
  "pago" de compra no cartão (vem da fatura), saldo. Guardar duas vezes faz as versões discordarem.
- **Mudança incompatível inevitável (renomear, trocar tipo): expandir e contrair.** PR 1: coluna
  nova + cópia dos dados + código lendo a nova. PR 2, depois: remover a antiga.
- **Toda tabela do domínio leva `householdId`** e toda ligação usa chave composta com ele
  (`@@unique([id, householdId])` no alvo). Assim nada aponta para outro grupo.
- **"Quem paga" e "de quem é" ficam separados:** conta/cartão/forma de pagamento num lado,
  ambiente (`walletId`) no outro. Não volte a amarrar o lançamento ao ambiente da conta.

## Regras

1. **Nunca edite uma migração já aplicada** (no seu banco, no CI ou na `main`). Mudou de ideia?
   Crie outra migração. Editar a antiga faz o banco de quem já aplicou divergir do histórico.
2. **Toda migração tem nome** em kebab-case que diz o que muda: `pnpm db:migrate --name orcamento-por-semana`.
3. **Dinheiro:** `Decimal @db.Decimal(14, 2)`, com sinal (negativo = saída). No código, `bigint`
   em centavos (`@fintrack/core`); converta só com `toDbDecimal`/`fromDbDecimal`. Nunca `number`,
   `Number()`, `parseFloat` ou `toFixed` de number (o ESLint `moneyGuard` reprova).
4. **Datas sem hora** (dia do lançamento, mês do orçamento, vencimento): `DateTime @db.Date`. Converta
   com `dbDateFromCivil`/`civilFromDbDate` do `@fintrack/core`. Mês é guardado como o dia 1.
5. **Ids do domínio:** `String @id @default(uuid(7)) @db.Uuid`. Chaves para usuário: `String` (texto, como o Better Auth).
6. **Nomes:** modelo em PascalCase inglês com `@@map("snake_case")`; enum em inglês com `@@map`.
7. **Toda chave estrangeira tem `onDelete` escolhido de propósito** e um índice (o Postgres não
   cria índice para chave estrangeira sozinho). Autoreferência que precisa sumir junto com o pai
   na cascata: `NoAction`, não `Restrict`. Chave **composta opcional** (cartão, categoria):
   `NoAction`, nunca `SetNull` (zeraria também o `accountId`/`householdId`, obrigatórios); o que
   está em uso é **arquivado** (`archivedAt`), não apagado.
8. **Regra que o Prisma não escreve** (CHECK, gatilho, índice parcial): crie a migração com
   `--create-only`, cole o SQL no fim do `migration.sql`, comente cada regra e só então aplique.
   O Prisma não enxerga CHECK nem gatilho e não tenta desfazê-los depois. Índice parcial, sim:
   ele aparece como diferença na próxima migração. Prefira resolver índices pelo schema.
9. **Toda regra nova no banco ganha um teste de integração** que tenta quebrá-la e confere o
   nome da regra na mensagem de erro (`dbError()` em `src/integration/fixtures.ts`).
10. **Campo novo no `User`?** Só listas de relação. Coluna nova em tabela do Better Auth vai pelo
    `auth.ts` + `bash scripts/gerar-schema-auth.sh`.
11. **Número de cartão:** só `lastFour` (4 dígitos, CHECK no banco). Nunca o número completo,
    validade ou CVV, nem em `notes` ou `metadata`.
12. **Seed:** só dados sintéticos; mudou o schema, ajuste `prisma/seed/plan.ts` e `write.ts`, e o
    `plan.test.ts` diz o que quebrou.

## Passo a passo de uma mudança

```bash
# 1. edite o arquivo certo em packages/db/prisma/schema/
pnpm --filter @fintrack/db exec prisma format          # alinha e confere a sintaxe
pnpm db:migrate --name descricao-curta --create-only   # gera o SQL SEM aplicar
# 2. leia o migration.sql gerado; acrescente CHECK/gatilho se precisar
pnpm db:migrate                                        # aplica (e gera o cliente)
pnpm db:generate                                       # garante o cliente atualizado
pnpm test:integration                                  # as regras do banco
pnpm check                                             # lint, tipos, testes, build
```

Depois: atualize `docs/modelo-de-dados.md` (o `docs-sync.test.ts` reprova modelo fora do
diagrama) e, se a decisão for de arquitetura, um ADR.

## O que um agente de IA NÃO faz sozinho

- `prisma migrate reset`, `DROP`, `TRUNCATE` ou `pnpm db:reset`: apagam o banco. O Prisma 7 recusa
  o reset quando detecta um agente de IA. Peça para a pessoa rodar no terminal dela.
- Editar migração existente para "consertar" um erro: crie uma migração nova.
- Rodar o seed apontando para um banco que não seja `localhost` (o seed se recusa).

## Conferências rápidas

```bash
pnpm --filter @fintrack/db exec prisma migrate status   # "Database schema is up to date!"
pnpm --filter @fintrack/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
# a última deve responder "-- This is an empty migration."
```

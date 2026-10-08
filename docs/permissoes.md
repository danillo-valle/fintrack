# Permissões do FinTrack (M06, ampliadas no M07)

Quem pode fazer o quê. A fonte é o código (`packages/core/src/access.ts`, constantes
`WALLET_MATRIX` e `HOUSEHOLD_MATRIX`); este documento é conferido contra ele pelo teste
`packages/db/src/permissoes-doc.test.ts`. Mudou uma regra? Mude a tabela no código, a tabela
aqui, e o teste da matriz (`packages/core/src/access.test.ts`), que é escrito à mão de propósito.

## Lançar numa conta (M07)

Lançar exige `edit` na carteira do lançamento **e** poder usar a conta: ter `edit` na
carteira que gere a conta, ou ser **portador** de um cartão ativo dela (o adicional do
cônjuge). Pela porta do cartão, a pessoa só lança com o próprio cartão e não faz
transferência com a conta. Conta fora das duas portas responde como inexistente.

## Como a decisão acontece

1. A página ou a Server Action confere a sessão (`requireUser`).
2. Pede o crachá: `requireWalletAccess(session, walletId, ação)` ou
   `requireHouseholdAccess(session, ação)` (`apps/web/src/lib/access.ts`).
3. O crachá vem de `authorizeWallet` / `authorizeHousehold` (`packages/db/src/access.ts`):
   uma consulta pelo **vínculo da pessoa** com a carteira (nunca pela carteira solta) e a
   pergunta à matriz abaixo.
4. As operações que mudam dados (`packages/db/src/wallets.ts`, `households.ts`) só aceitam o
   crachá da ação certa (o TypeScript reprova o resto), travam a carteira, conferem o papel de
   novo e gravam a auditoria na mesma transação.

**Quem não participa recebe 404** (a mesma página de um id que não existe). Quem participa
mas não tem o papel recebe a explicação ("Seu papel nesta carteira não permite essa ação.").

## Carteira

Legenda: **sim** = permitido; **não** = negado pelo papel; **só compartilhada** = o dono
pode, mas não numa carteira pessoal.

<!-- matriz-carteira: início -->

| Ação            | Dono (OWNER)     | Editor (EDITOR)  | Leitor (VIEWER)  |
| --------------- | ---------------- | ---------------- | ---------------- |
| view            | sim              | sim              | sim              |
| edit            | sim              | sim              | não              |
| export          | sim              | não              | não              |
| rename          | sim              | não              | não              |
| manage_members  | só compartilhada | não              | não              |
| archive         | só compartilhada | não              | não              |
| leave           | só compartilhada | só compartilhada | só compartilhada |
| manage_accounts | sim              | não              | não              |

<!-- matriz-carteira: fim -->

- **view**: ver a carteira, quem participa e os lançamentos (M07).
- **edit**: lançar, editar, excluir e transferir; criar recorrências (M07).
- **export**: exportar CSV (M07). Dado sensível: só dono, com reautenticação (10 min) e
  registro `transactions.exported` na auditoria.
- **manage_accounts**: criar e arquivar contas e cartões geridos na carteira (M07).
- **rename** / **archive**: mudar o nome; arquivar ou desarquivar (esconde sem apagar).
- **manage_members**: adicionar, remover e trocar o papel de outras pessoas.
- **leave**: sair da carteira. O **último dono não sai** nem é rebaixado (`LAST_OWNER`).
- **Carteira arquivada**: só `view` e `archive` (para desarquivar) continuam valendo.
- **Carteira pessoal** não se compartilha: quem quer dividir cria uma compartilhada.

## Lar

<!-- matriz-lar: início -->

| Ação              | Dono do lar (OWNER) | Membro (MEMBER) |
| ----------------- | ------------------- | --------------- |
| view              | sim                 | sim             |
| invite            | sim                 | não             |
| remove_member     | sim                 | não             |
| create_wallet     | sim                 | sim             |
| view_activity     | sim                 | não             |
| manage_categories | sim                 | sim             |

<!-- matriz-lar: fim -->

- **invite**: gerar convite (link de uso único, 72 h, só o e-mail convidado aceita) e cancelar.
- **remove_member**: tirar um membro do lar. A carteira pessoal dele é **arquivada**, não
  apagada. Recusado se ele for o único dono de uma carteira compartilhada.
- **view_activity**: ver a trilha de auditoria do lar.
- **manage_categories**: criar e arquivar categorias e regras texto → categoria (M07). As duas
  pessoas organizam; a sugestão de categoria, porém, só olha o histórico das carteiras que
  quem pede consegue ver (nada vaza da carteira pessoal do outro).
- Por enquanto, **um lar por pessoa** (o banco aceita mais; escolher entre lares é feature futura).

## O que fica registrado (auditoria)

`household.created`, `household.invite_created`, `household.invite_revoked`,
`household.invite_accepted`, `household.member_removed`, `wallet.created`, `wallet.renamed`,
`wallet.archived`, `wallet.restored`, `wallet.member_added`, `wallet.role_changed`,
`wallet.member_removed`, `wallet.member_left`. Desde o M07: `transaction.deleted`,
`transaction.restored`, `transactions.exported`, `recurrence.created`, `recurrence.archived`,
`recurrences.generated`, `account.created`, `account.archived`, `card.created`,
`card.archived`, `category.created`, `category.archived`, `category_rule.created`,
`category_rule.deleted`. Lançar e editar não vão para a auditoria (seriam milhares de linhas;
o lançamento guarda quem criou e quando mudou). Nunca vão para a auditoria: segredo do
convite, senha, token, número de cartão (nem os 4 finais), descrição ou valor de lançamento;
e-mail aparece mascarado (`***@exemplo.com`).

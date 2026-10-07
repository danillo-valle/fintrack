# ADR-006: Lar, carteiras e autorização por recurso

- **Status:** aceita
- **Data:** 2026-10-06
- **Módulo:** M06

## Contexto

O FinTrack é usado por mais de uma pessoa, e cada uma precisa ver o que é seu e o que é
compartilhado, nunca o que é só de outra pessoa. Quebra de controle de acesso é o primeiro
item do OWASP Top 10:2025 (A01), e o caso mais comum é o **IDOR**: a URL ou o formulário
trazem um id (`/carteiras/0199…`) e o servidor busca o recurso sem perguntar se quem pede
participa dele. O M04 já criou as tabelas (`Household`, `HouseholdMember`, `Wallet`,
`WalletMember` com papéis OWNER/EDITOR/VIEWER) e garante no banco a fronteira do **grupo**
(nada aponta para outro lar). Falta decidir **quem, dentro do lar, faz o quê**, e como impedir
que uma tela nova esqueça a checagem.

## Decisões

1. **A matriz de papéis é uma regra pura** (`packages/core/src/access.ts`: `WALLET_MATRIX`,
   `HOUSEHOLD_MATRIX`, `canInWallet`, `canInHousehold`). Um lugar para ler e revisar, testado
   linha por linha com uma tabela escrita à mão (42 + 10 casos), e conferido contra
   `docs/permissoes.md` por teste.
2. **Ponto único de decisão**: `authorizeWallet(db, userId, walletId, ação)` e
   `authorizeHousehold(db, userId, ação)` (`packages/db/src/access.ts`). A consulta parte do
   **vínculo** (`wallet_member` com `walletId` E `userId`), nunca da carteira solta. No app,
   `requireWalletAccess(session, walletId, ação)` e `requireHouseholdAccess` (`apps/web/src/lib/access.ts`)
   ligam essa decisão à sessão, ao log (`access.denied`) e às respostas do Next.js.
3. **Crachá tipado (capability)**: a decisão positiva devolve um `WalletGrant<Ação>` /
   `HouseholdGrant<Ação>` com uma marca de tipo que só `access.ts` consegue criar. As operações
   que mudam dados exigem o crachá da ação certa. **Esquecer a checagem vira erro de compilação**;
   um teste com `@ts-expect-error` prova isso no `pnpm typecheck`.
4. **Recurso alheio responde como inexistente**: id de outra pessoa, id que não existe e id fora
   do formato dão a **mesma** página 404 (`(app)/not-found.tsx`). "Sem permissão" só aparece
   para quem já participa da carteira (sabe que ela existe).
5. **Releitura com trava na gravação**: entre o crachá e a gravação passam milissegundos. As
   operações fazem `SELECT … FOR UPDATE` na carteira, releem os membros e conferem o papel de
   novo (`STALE_GRANT`). Sem isso, dois donos que se rebaixam ao mesmo tempo deixam a carteira
   sem dono; o teste de corrida falha sem o `FOR UPDATE` (verificado por mutação).
6. **Invariantes**: carteira compartilhada nunca fica sem dono (`LAST_OWNER`); carteira pessoal
   não se compartilha; quem sai do lar tem a pessoal **arquivada**, não apagada; não se tira do
   lar quem é a única dona de uma compartilhada (`SOLE_WALLET_OWNER`).
7. **Convite por link de uso único**: segredo de 32 bytes aleatórios (base64url, 43 caracteres)
   no link; o banco guarda **só o SHA-256** (`household_invite.tokenHash`, CHECK de formato).
   Prazo de 72 h; só a conta com o e-mail convidado aceita; aceitação numa transação com trava
   por pessoa (`pg_advisory_xact_lock`), `UPDATE` condicional (aberto e no prazo) e a chave
   primária de `household_member` como terceira barreira. Convite novo para o mesmo e-mail
   cancela o anterior. O link é mostrado uma vez para a dona copiar e também vai por e-mail.
8. **O cadastro continua fechado** (`ALLOWED_EMAILS`, M03): o convite não cria conta, só põe no
   lar quem já tem conta. Liberar o cadastro por convite é uma feature futura (acréscimo).
9. **Um lar por pessoa, por enquanto**: o banco aceita vários; o app usa o mais antigo e recusa
   criar ou aceitar um segundo (`ALREADY_IN_HOUSEHOLD`). Escolher entre lares é uma feature futura,
   sem mudar o banco.
10. **Auditoria na mesma transação** (`writeAudit(tx, …)`, `packages/db/src/audit.ts`): convite
    (criado, cancelado, aceito), entrada e saída de pessoas, criação, renomeação, arquivamento,
    mudança de papel. Lista fechada de eventos (union `AuditAction`): evento sem texto na tela é
    erro de compilação. Nada de segredo; e-mail mascarado. A tabela só aceita INSERT (M04).

## O status HTTP do 404 (limitação conhecida)

O grupo `(app)` tem um `loading.tsx` (esqueleto do M02). Com ele, o Next.js manda o começo da
resposta (status **200**) antes de a página rodar; quando a página chama `notFound()`, o Next
mostra o 404 e acrescenta `<meta name="robots" content="noindex">`, mas o status já saiu. Nem
`generateMetadata` resolve: no Next 16 os metadados também são enviados em streaming para
navegadores (testado no laboratório).

Decidimos **manter o esqueleto** e garantir o que protege de fato: o corpo da resposta é
idêntico para "não é seu" e "não existe", sem nenhum dado da carteira (nem no payload do
React), com `noindex`. O E2E `permissoes.spec.ts` confere exatamente isso. Rotas de API
(`route.ts`, a partir do M07) e Server Actions não fazem streaming: lá a recusa é 404 ou
mensagem de verdade. Se um dia o status da página precisar ser 404, o caminho é tirar o
`loading.tsx` do grupo e pôr esqueletos por página.

## Alternativas consideradas

- **Checar o acesso em cada página/action, cada uma do seu jeito**: é como o IDOR nasce.
  Recusada em favor do ponto único com crachá tipado.
- **Row Level Security (RLS) do Postgres**: forte, mas exige passar o usuário em cada conexão
  (`SET app.user_id`) com pool compartilhado e driver adapter; complexidade alta para o momento.
  Fica como reforço possível no M12 (ADR novo, se adotado).
- **Responder 403 para recurso alheio**: confirma que o id existe. Recusada.
- **Convite com o segredo em texto no banco**: um backup vazado viraria convites válidos.
  Recusada em favor do hash.
- **Biblioteca de autorização (CASL, Casbin)**: a matriz cabe em 60 linhas tipadas e testadas;
  uma biblioteca acrescentaria um formato de regra a aprender sem ganho agora.

## Consequências

- Toda feature nova que toca uma carteira segue a skill `nova-feature`: schema zod, crachá,
  operação com auditoria, teste de acesso negado e E2E (skill `teste-e2e`).
- O M07 (lançamentos) usa `requireWalletAccess(session, walletId, "edit")` nas actions e
  `"view"` nas listas; a exportação usa `"export"` + `requireRecentAuth` e grava
  `transactions.exported`.
- Mudar uma permissão é mudar `WALLET_MATRIX`, o teste escrito à mão e `docs/permissoes.md`;
  três lugares de propósito, e os testes avisam se um ficar para trás.

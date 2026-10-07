---
name: nova-feature
description: A fatia vertical padrão do FinTrack com checagem de acesso embutida (schema zod, operação com crachá e auditoria, Server Action, tela, testes de acesso negado e E2E). Use ao criar ou estender uma funcionalidade em apps/web/src/features, ao criar uma tela ou action que lê ou grava dados de uma carteira ou do lar, ou ao adicionar uma ação à matriz de papéis.
---

# Nova funcionalidade (fatia vertical)

Referência viva: `apps/web/src/features/wallets/` e `packages/db/src/wallets.ts` (M06).
Leia antes de escrever. Decisões: `docs/adr/0006-autorizacao-por-recurso.md`; matriz:
`docs/permissoes.md`.

## A ordem (cada passo com o seu teste)

1. **Regra pura**, se houver (`packages/core/src/<assunto>.ts`): sem banco, sem `Date.now()`
   escondido (o tempo entra como parâmetro). Teste de exemplo + propriedade (fast-check).
2. **Ação nova na matriz?** Acrescente em `WALLET_ACTIONS`/`WALLET_MATRIX` (ou do lar) em
   `packages/core/src/access.ts`, na tabela escrita à mão de `access.test.ts` e em
   `docs/permissoes.md`. Os três testes avisam se um ficar para trás.
3. **Operação no banco** (`packages/db/src/<assunto>.ts`):
   - leitura que depende de carteira recebe `WalletGrant<"view">`; mutação recebe o crachá da
     ação certa (`WalletGrant<"edit">`...). Nunca receba `walletId` solto do app;
   - mutação numa transação: `lockWallet(tx, grant)` quando a regra depende de quem participa,
     depois a gravação, depois `writeAudit(tx, …)` (evento novo entra na union `AuditAction`
     e ganha frase em `AUDIT_ACTION_LABEL`; o TypeScript cobra);
   - regra violada: `throw new DomainError("CODIGO")` (código novo na union `DomainErrorCode`
     e frase em `access-messages.ts`);
   - dinheiro: `toDbDecimal`/`fromDbDecimal`; nunca `number` (ESLint `moneyGuard`).
4. **Teste de integração** (`packages/db/src/integration/<assunto>.integration.test.ts`), com
   Postgres de verdade: caminho feliz, **pessoa de outro lar recebe NOT_FOUND**, papel sem
   permissão recebe o motivo, regra do domínio, auditoria gravada. Corrida, se houver trava.
5. **Schema zod** (`features/<assunto>/schemas.ts`) + `schemas.test.ts` (válidos e inválidos,
   inclusive valor que só chega editando o HTML: papel inventado, id fora do formato).
6. **Server Action** (`features/<assunto>/server/actions.ts`), sempre nesta ordem:
   ```ts
   export async function algoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
     const session = await requireUser(); // 1. sessão
     const parsed = algoSchema.safeParse(Object.fromEntries(formData));
     if (!parsed.success) return invalid(parsed.error); // 2. entrada
     const result = await runAction(async () => {
       const grant = await requireWalletAccess(session, parsed.data.walletId, "edit"); // 3. crachá
       await fazerAlgo(prisma, grant, parsed.data, await requestContext()); // 4. operação
       return "Feito.";
     });
     revalidatePath(`/carteiras/${parsed.data.walletId}`);
     return result;
   }
   ```
7. **Leitura para a página** (`features/<assunto>/server/queries.ts`, com `import "server-only"`):
   `requireWalletAccess(...).catch(notFoundOnDenied)`; devolva também `can.{ação}` para a tela
   decidir os botões. Esconder botão é conforto; quem decide é a action.
8. **Tela**: página em `app/(app)/...` começa com `await requireUser()`; formulários com
   `ActionForm` (erros em português embaixo do campo, aviso de erro/sucesso), botões de uma
   ação com `ActionButton` (com `confirm` quando apaga, arquiva ou tira alguém). Estados vazio,
   carregando e erro (skill `ui-componentes`).
9. **E2E** (skill `teste-e2e`): a página entra em `PAGES` (axe, foco, proteção); um teste de
   IDOR (URL de outra pessoa → página 404 sem dados) e o fluxo principal no celular.
10. `pnpm check`, `pnpm test:integration` e `pnpm e2e` inteiros antes do PR.

## Proibido

- `prisma.wallet.findUnique({ where: { id } })` com `id` vindo de URL ou formulário, sem crachá.
- Montar um crachá na mão (`{ action, userId, ... } as WalletGrant`): o crachá só nasce em
  `authorizeWallet`/`authorizeHousehold`.
- Responder "sem permissão" para quem não participa (confirma que existe): use 404.
- Auditoria fora da transação, ou com segredo, token, senha ou número de cartão.

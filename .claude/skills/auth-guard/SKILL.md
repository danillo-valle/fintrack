---
name: auth-guard
description: Como proteger páginas, Server Actions e rotas de API do FinTrack com o Better Auth, e o que o proxy.ts NÃO cobre. Use ao criar ou alterar qualquer page.tsx, action ("use server"), route.ts, ou ao mexer em login, sessão, 2FA, passkey ou cadastro.
---

# Proteção de acesso no FinTrack

## As três camadas (e qual delas é a barreira)

| Camada                    | Onde                      | O que faz                                                    | É barreira? |
| ------------------------- | ------------------------- | ------------------------------------------------------------ | ----------- |
| `proxy.ts`                | `apps/web/src/proxy.ts`   | Sem cookie de sessão → `/entrar?next=...`. Não vai ao banco. | **Não**     |
| `requireUser()`           | `src/lib/auth/session.ts` | Confere a sessão no banco e o 2FA ligado                     | **Sim**     |
| `requireRecentAuth(back)` | `src/lib/auth/session.ts` | Exige login ou reautenticação nos últimos 10 min             | **Sim**     |

O proxy é conveniência de navegação: o cookie pode ser velho ou forjado. Toda decisão de acesso
acontece em `requireUser()` / `requireRecentAuth()`.

## Regras

1. **Toda página em `src/app/(app)/`** começa com `await requireUser()` (ou `const { user } = await requireUser()`).
   O teste `src/app/paginas-protegidas.test.ts` reprova a página que esquecer.
2. **Toda Server Action** (`"use server"`) começa com `await requireUser()`. Uma action é um endpoint
   público: qualquer um pode chamá-la com um POST, com ou sem tela.
3. **Toda rota de API** própria (`route.ts`) chama `auth.api.getSession({ headers })` e responde 401 sem sessão.
   As exceções são `/api/auth/*` (o próprio Better Auth) e `/api/health`.
4. **Dados sempre filtrados pelo `user.id` da sessão**, nunca por um id vindo do formulário ou da URL.
   Recurso de outra pessoa: não faça nada e não diga nada (a partir do M06, responde 404).
5. **Ações sensíveis** (exportar, excluir carteira, conectar banco, mudar e-mail, desligar 2FA):
   `await requireRecentAuth("/caminho/da/tela")` na action. Endpoint sensível do próprio Better Auth:
   acrescente o caminho em `SENSITIVE_AUTH_PATHS` (`src/lib/auth/reauth.ts`).
6. **Destino depois do login** (`?next=`): sempre por `safeNextPath()`. Nunca redirecione para uma URL
   vinda do usuário sem validar (open redirect).
7. **Componentes do navegador** usam `src/lib/auth-client.ts`. Nunca importe `src/lib/auth.ts`,
   `env.ts` ou `mailer.ts` num arquivo com `"use client"`.
8. **Mensagens de erro** passam por `authErrorMessage()` (`src/lib/auth/messages.ts`). Login errado
   diz sempre "E-mail ou senha incorretos.", sem revelar se o e-mail existe.

## Modelos

Página:

```tsx
import { requireUser } from "@/lib/auth/session";

export default async function WalletsPage() {
  const { user } = await requireUser();
  // ...consultas sempre com where: { userId: user.id } (a partir do M06, requireWalletAccess)
}
```

Server Action sensível:

```ts
"use server";
import { requireRecentAuth } from "@/lib/auth/session";

export async function exportTransactions(formData: FormData) {
  const { user } = await requireRecentAuth("/lancamentos");
  // ...
}
```

## O que o 2FA do Better Auth NÃO cobre

O desafio do segundo fator só acontece no login por **senha**. Entrar com **passkey** já é forte
(o aparelho exige digital, rosto ou PIN). Entrar com **Google** depende do 2FA da conta Google:
mantenha-o ligado nas duas contas.

## Testes obrigatórios para tela ou action nova

- Página nova do app: acrescente o caminho em `PAGES` (`apps/web/e2e/helpers.ts`). O teste
  "toda página do app manda para /entrar" passa a cobri-la, junto com axe e foco.
- Tela nova de entrada (sem sessão): `PUBLIC_PAGES` e `AUTH_PAGES` (`src/lib/auth/routes.ts`).
- Action sensível: um E2E com `ageSessions(email, 60)` que confere o desvio para `/reautenticar`.
- Rode `pnpm check` e `pnpm e2e` inteiros antes de concluir.

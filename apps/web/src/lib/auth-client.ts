// O lado do navegador do Better Auth: funções que os formulários chamam
// (signIn.email, signUp.email, twoFactor.verifyTotp, passkey.addPasskey...).
// Elas fazem requisições para /api/auth/* no mesmo endereço do app; nada de segredo aqui.
"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [
    // Os tipos dos campos extras (reauthenticatedAt) vêm da configuração do servidor
    inferAdditionalFields<typeof auth>(),
    // Quando o login por senha pede o segundo fator, vai para a tela do código
    twoFactorClient({
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.assign(
          next ? `/entrar/dois-fatores?next=${encodeURIComponent(next)}` : "/entrar/dois-fatores",
        );
      },
    }),
    passkeyClient(),
  ],
});

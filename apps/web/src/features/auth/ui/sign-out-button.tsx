"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { navigateAfterAuthChange } from "@/lib/navigation";

/**
 * Sair: apaga a sessão no banco (não só o cookie) e volta para a tela de entrada. O mesmo caminho
 * para o botão de Ajustes e o do menu de quem está na sessão (M13.1).
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    await authClient.signOut();
    // Navegação completa: descarta tudo que a aba guardou das telas do app (lib/navigation.ts)
    navigateAfterAuthChange("/entrar");
  }
  return { pending, signOut };
}

export function SignOutButton() {
  const { pending, signOut } = useSignOut();
  return (
    <Button type="button" variant="outline" size="lg" onClick={signOut} disabled={pending}>
      <LogOut aria-hidden />
      {pending ? "Saindo…" : "Sair"}
    </Button>
  );
}

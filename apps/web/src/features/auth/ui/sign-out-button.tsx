"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Sair: apaga a sessão no banco (não só o cookie) e volta para a tela de entrada
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.replace("/entrar");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={signOut} disabled={pending}>
      <LogOut aria-hidden />
      {pending ? "Saindo…" : "Sair"}
    </Button>
  );
}

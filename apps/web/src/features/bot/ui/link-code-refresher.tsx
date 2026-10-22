"use client";

// Enquanto o código espera a mensagem, pede a tela de novo ao servidor a cada 3 s (router.refresh:
// só os dados, sem recarregar a página). Some quando a tela muda para "vinculado" ou "vencido".
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const LINK_REFRESH_MS = 3_000;

export function LinkCodeRefresher() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), LINK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

"use client";

import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";

// Anel de foco dos avisos igual ao do resto do app (ring-3 ring-ring). O "!" é necessário porque
// o CSS do Sonner fica fora das camadas do Tailwind e ganharia das classes. O contêiner focado
// pelo Alt+T tem altura zero (os avisos são absolutos), então o anel dele aparece em cada aviso,
// via group-focus-visible.
const FOCUS_RING = "outline-none focus-visible:ring-3! focus-visible:ring-ring!";
const TOAST_FOCUS_RING = {
  toast: `${FOCUS_RING} group-focus-visible:ring-3! group-focus-visible:ring-ring!`,
  actionButton: FOCUS_RING,
  closeButton: FOCUS_RING,
};

// Tudo que precisa existir uma vez só, em volta do app inteiro
export function Providers({ children }: { children: React.ReactNode }) {
  // Marca a página como pronta quando o React termina de carregar no navegador.
  // Os testes E2E esperam por esta marca antes de digitar ou clicar.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      {/* No celular, os avisos sobem acima do "+" (8rem do fundo) e da barra inferior.
          Os rótulos substituem os padrões em inglês do Sonner ("Notifications", "Close toast");
          o leitor de tela anuncia a região como "Notificações alt+T" */}
      <Toaster
        position="bottom-center"
        closeButton
        mobileOffset={{ bottom: "calc(8.5rem + env(safe-area-inset-bottom))" }}
        containerAriaLabel="Notificações"
        toastOptions={{ closeButtonAriaLabel: "Fechar aviso", classNames: TOAST_FOCUS_RING }}
      />
    </ThemeProvider>
  );
}

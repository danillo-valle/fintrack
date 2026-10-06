"use client";

import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { ToastKeyboard } from "@/components/feedback/toast-keyboard";
import { Toaster } from "@/components/ui/sonner";

// Tudo que precisa existir uma vez só, em volta do app inteiro
export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  // Marca a página como pronta quando o React termina de carregar no navegador.
  // Os testes E2E esperam por esta marca antes de digitar ou clicar.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // O script do tema roda antes do React: com o nonce, a CSP do proxy.ts o deixa rodar
      nonce={nonce}
    >
      {children}
      <Toaster
        position="bottom-center"
        closeButton
        // Nome da região lido pelo leitor de tela. customAriaLabel substitui o nome inteiro: com
        // containerAriaLabel, o Sonner emendava o atalho cru ("Notificações alt+T").
        customAriaLabel="Avisos (Alt+T)"
        // No celular, o aviso fica acima do botão "+" e da barra de navegação.
        // A folga de rolagem para o foco não ficar embaixo dele está no globals.css.
        mobileOffset={{ bottom: "calc(8.75rem + env(safe-area-inset-bottom))" }}
        // Este toastOptions substitui o do components/ui/sonner.tsx: por isso repete o rounded-2xl
        toastOptions={{
          closeButtonAriaLabel: "Fechar aviso",
          classNames: { toast: "rounded-2xl" },
        }}
      />
      {/* Sair do aviso com Tab: o foco volta visível e não fica girando (veja o arquivo) */}
      <ToastKeyboard />
    </ThemeProvider>
  );
}

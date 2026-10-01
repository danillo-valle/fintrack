"use client";

import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";

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
      {/* No celular, sobe os avisos para não cobrirem a barra de navegação.
          containerAriaLabel: o leitor de tela anuncia a região como "Avisos alt+T", o mesmo
          atalho que os avisos com "Desfazer" ensinam na descrição */}
      <Toaster
        position="bottom-center"
        closeButton
        mobileOffset={{ bottom: "5.5rem" }}
        containerAriaLabel="Avisos"
      />
    </ThemeProvider>
  );
}

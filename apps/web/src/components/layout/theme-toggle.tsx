"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { SidebarLabel } from "./sidebar-label";

const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];

const LABELS: Record<Theme, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Escuro",
};

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

// true no navegador, false no servidor: evita mostrar um tema errado antes de o JavaScript carregar
const noop = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

// "header": o botão do cabeçalho do celular (só o ícone). "sidebar": o do menu lateral, com o
// texto ao lado ou, com o menu recolhido, como dica.
export function ThemeToggle({ placement = "header" }: { placement?: "header" | "sidebar" }) {
  const { theme, setTheme } = useTheme();
  const isClient = useIsClient();

  const current: Theme = isClient && ORDER.includes(theme as Theme) ? (theme as Theme) : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";
  const Icon = ICONS[current];

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={() => setTheme(next)}
      aria-label={`Tema: ${LABELS[current]}. Mudar para ${LABELS[next]}`}
      className={
        placement === "sidebar"
          ? "group/item collapsed:justify-center collapsed:px-0 relative w-full justify-start"
          : undefined
      }
    >
      <Icon aria-hidden className={placement === "sidebar" ? "size-5" : undefined} />
      {placement === "sidebar" ? (
        <SidebarLabel>Tema: {LABELS[current]}</SidebarLabel>
      ) : (
        <span className="hidden md:inline">Tema: {LABELS[current]}</span>
      )}
    </Button>
  );
}

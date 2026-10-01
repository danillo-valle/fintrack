import { House, PiggyBank, ReceiptText, Settings, Wallet, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

// Uma lista só alimenta o menu lateral (desktop) e a barra inferior (celular)
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Início", icon: House },
  { href: "/lancamentos", label: "Lançamentos", icon: ReceiptText },
  { href: "/orcamento", label: "Orçamento", icon: PiggyBank },
  { href: "/carteiras", label: "Carteiras", icon: Wallet },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

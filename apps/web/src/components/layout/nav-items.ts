import {
  CreditCard,
  House,
  PiggyBank,
  ReceiptText,
  Repeat,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Fica só no menu lateral: a barra do celular tem 5 lugares (M13.3a) */
  desktopOnly?: boolean;
};

// Uma lista só alimenta o menu lateral (desktop) e a barra inferior (celular). As visões (Cartões e
// Fixas e parcelas, M13.3a) são itens do menu, nunca páginas de Ajustes. No celular a barra tem 5
// lugares: Carteiras fica em Ajustes e Fixas e parcelas abre pelo Início.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Início", icon: House },
  { href: "/lancamentos", label: "Lançamentos", icon: ReceiptText },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/fixas", label: "Fixas e parcelas", icon: Repeat, desktopOnly: true },
  { href: "/orcamento", label: "Orçamento", icon: PiggyBank },
  { href: "/carteiras", label: "Carteiras", icon: Wallet, desktopOnly: true },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

/** Os itens da barra do celular. */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.desktopOnly);

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

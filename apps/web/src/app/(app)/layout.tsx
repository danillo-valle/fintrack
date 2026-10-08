import { AppShell } from "@/components/layout/app-shell";

// O grupo (app) não aparece na URL: só junta as páginas que usam a casca do app.
// "modal" é a rota paralela @modal (M07.1): o novo lançamento abre por cima da página atual.
export default function AppLayout({ children, modal }: LayoutProps<"/">) {
  return <AppShell modal={modal}>{children}</AppShell>;
}

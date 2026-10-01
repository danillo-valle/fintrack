import { AppShell } from "@/components/layout/app-shell";

// O grupo (app) não aparece na URL: só junta as páginas que usam a casca do app
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}

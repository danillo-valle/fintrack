import { Brand } from "../brand";
import { NAV_ITEMS } from "../nav-items";
import { ThemeToggle } from "../theme-toggle";
import { SidebarHandle } from "./sidebar-handle";
import { SidebarNavItem } from "./sidebar-nav-item";

const ID = "menu-lateral";

// O menu lateral do computador (M07.3): marinho de vidro nos dois temas, com o item ativo em
// lima. Só navegação: "Novo lançamento" fica no cabeçalho de cada página, onde já é visível.
// Recolhe até ficarem só os ícones pela alça na borda (SidebarHandle).
export function Sidebar() {
  return (
    <aside
      id={ID}
      aria-label="Menu lateral"
      className="glass-sidebar text-sidebar-foreground collapsed:items-center collapsed:px-4 sticky top-0 z-40 hidden h-dvh flex-col gap-6 border-r px-3.5 py-5 md:flex"
    >
      <div className="collapsed:px-0 px-2">
        <Brand collapsible className="focus-visible:ring-sidebar-ring text-lg font-extrabold" />
      </div>
      <nav aria-label="Principal" className="collapsed:w-full">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <SidebarNavItem
                href={item.href}
                label={item.label}
                icon={<item.icon aria-hidden className="size-5 shrink-0" />}
              />
            </li>
          ))}
        </ul>
      </nav>
      <div className="collapsed:w-full mt-auto">
        <ThemeToggle placement="sidebar" />
      </div>
      <SidebarHandle controls={ID} />
    </aside>
  );
}

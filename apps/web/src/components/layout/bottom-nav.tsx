import { NAV_ITEMS } from "./nav-items";
import { BottomNavItem } from "./bottom-nav-item";

// A barra inferior de vidro do celular (abaixo de 768 px). A mesma lista do menu lateral.
export function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="glass fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <BottomNavItem
              href={item.href}
              label={item.label}
              icon={<item.icon aria-hidden className="size-5 shrink-0" />}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

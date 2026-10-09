import type { LucideIcon } from "lucide-react";
import { IconTile } from "@/components/visual/icon-tile";

type Props = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Ação que resolve o vazio. Um estado vazio sem ação é um beco sem saída. */
  action?: React.ReactNode;
};

// Estado vazio (M07.2): o mesmo bloco branco das listas, com o ícone colorido em destaque.
export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div
      data-slot="empty"
      className="bg-card flex flex-col items-center gap-4 rounded-2xl border px-6 py-10 text-center"
    >
      <IconTile tone={1} icon={icon} size="lg" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm text-balance">{description}</p>
      </div>
      {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

// As abas do Novo lançamento (M13.3a, pranchas N-NovoTransferencia, N-NovoRecorrencia e N-CelNovo):
// Lançamento, Transferência e Recorrência no mesmo modal, cada uma com o seu formulário. Cada aba é
// um endereço (`/lancamentos/novo?aba=...`): dá para voltar, e a rota interceptada mantém o modal
// por cima da página de onde se veio.
import { SegmentedNav } from "@/components/visual/segmented-nav";
import { cn } from "@/lib/utils";

export type EntryTab = "lancamento" | "transferencia" | "recorrencia";

// No celular (390 px), "Transferência" não cabe ao lado das outras duas: o rótulo curto
const TABS: { tab: EntryTab; label: string; shortLabel?: string }[] = [
  { tab: "lancamento", label: "Lançamento" },
  { tab: "transferencia", label: "Transferência", shortLabel: "Transferir" },
  { tab: "recorrencia", label: "Recorrência" },
];

/** A aba pedida no endereço; qualquer outra coisa é o lançamento comum. */
export function parseEntryTab(value: string | string[] | undefined): EntryTab {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "transferencia" || v === "recorrencia" ? v : "lancamento";
}

export function entryTabHref(tab: EntryTab): string {
  return tab === "lancamento" ? "/lancamentos/novo" : `/lancamentos/novo?aba=${tab}`;
}

export function EntryTabs({ current, className }: { current: EntryTab; className?: string }) {
  return (
    <SegmentedNav
      label="O que registrar"
      className={cn("compact:[&_a]:h-8 compact:[&_a]:px-2.5", className)}
      items={TABS.map((t) => ({
        href: entryTabHref(t.tab),
        label: t.label,
        shortLabel: t.shortLabel,
        active: t.tab === current,
      }))}
    />
  );
}

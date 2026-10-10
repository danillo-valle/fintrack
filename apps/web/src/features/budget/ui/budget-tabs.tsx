import { TabNav } from "@/components/visual/tab-nav";
import { budgetQuery, type BudgetParams } from "../schemas";

// As três abas do Orçamento (M08, canvas D): "Orçamento do mês | Fluxo de caixa | Evolução"
// (no celular: "Do mês | Fluxo | Evolução"). O ambiente escolhido vai junto de uma aba para a
// outra; o mês, a pessoa e o período ficam só na aba que os usa.
export function BudgetTabs({
  current,
  walletId,
  className,
}: {
  current: "mes" | "fluxo" | "evolucao";
  walletId: string | null;
  className?: string;
}) {
  const keep: Partial<BudgetParams> = { walletId };
  return (
    <TabNav
      label="Orçamento"
      className={className}
      items={[
        {
          href: `/orcamento${budgetQuery(keep)}`,
          label: "Orçamento do mês",
          shortLabel: "Do mês",
          active: current === "mes",
        },
        {
          href: `/orcamento/fluxo${budgetQuery(keep)}`,
          label: "Fluxo de caixa",
          shortLabel: "Fluxo",
          active: current === "fluxo",
        },
        {
          href: `/orcamento/evolucao${budgetQuery(keep)}`,
          label: "Evolução",
          active: current === "evolucao",
        },
      ]}
    />
  );
}

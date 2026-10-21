// Os textos do topo do "Criar e aplicar" (M10.2b): servem à página e ao modal.
import { formatBRL } from "@/lib/money";
import { dayMonth } from "./parts";

type Head = {
  name: string;
  transaction: { description: string; amount: bigint; occurredOn: string };
};

export const proposalTitle = (page: Head) => `Criar a categoria ${page.name}?`;

export function proposalSubtitle(page: Head) {
  const t = page.transaction;
  const sign = t.amount < 0n ? "− " : "+ ";
  return `${t.description} · ${dayMonth(t.occurredOn)} · ${sign}${formatBRL(t.amount < 0n ? -t.amount : t.amount)}`;
}

import { payerParam, type PayerFilter } from "@fintrack/core";
import { ChipLink } from "@/components/visual/chip";
import { cn } from "@/lib/utils";
import type { PayerOption } from "../payers";

// Os chips "Pago por" (M07.4, canvas C.2): Todos e um chip por pessoa do lar, mais o
// Compartilhado. Cada chip é um link (o filtro vai para a URL, como os outros); o escolhido vem
// de payerParam, a mesma função que escreve o parâmetro, para leitura e escrita nunca divergirem.
export function PayerChips({
  payers,
  current,
  hrefFor,
  labelClassName,
}: {
  payers: readonly PayerOption[];
  /** O filtro atual, ou null para "Todos" */
  current: PayerFilter | null;
  /** O endereço da mesma página com o filtro trocado (null = Todos) */
  hrefFor: (param: string | null) => string;
  /** Classes do rótulo "Pago por" (o Orçamento no celular o esconde: a navegação já tem nome) */
  labelClassName?: string;
}) {
  const active = current ? payerParam(current) : null;
  return (
    <>
      <span
        className={cn(
          "text-muted-foreground self-center pr-1 text-sm font-semibold",
          labelClassName,
        )}
      >
        Pago por
      </span>
      <ChipLink href={hrefFor(null)} active={active === null}>
        Todos
      </ChipLink>
      {payers.map((payer) => (
        <ChipLink key={payer.param} href={hrefFor(payer.param)} active={active === payer.param}>
          {payer.name}
        </ChipLink>
      ))}
    </>
  );
}

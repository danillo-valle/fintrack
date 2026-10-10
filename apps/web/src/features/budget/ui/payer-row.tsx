import type { PayerFilter } from "@fintrack/core";
import type { PayerOption } from "@/features/transactions/payers";
import { PayerChips } from "@/features/transactions/ui/payer-chips";

// "Pago por" nas telas do M08 (canvas D): no computador, os chips quebram linha; no celular,
// rolam de lado numa linha só, sem o rótulo (o nome da navegação já diz o que é).
export function PayerRow({
  payers,
  current,
  hrefFor,
}: {
  payers: readonly PayerOption[];
  current: PayerFilter | null;
  hrefFor: (param: string | null) => string;
}) {
  if (payers.length === 0) return null;
  return (
    <nav
      aria-label="Pago por"
      className="-mx-4 flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      <PayerChips
        payers={payers}
        current={current}
        hrefFor={hrefFor}
        labelClassName="max-md:hidden"
      />
    </nav>
  );
}

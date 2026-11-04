// A fatura fechada pelo banco ou pelo PDF (M09.1 e M09.4; na página de Cartões desde o M13.3a):
// as linhas de compras, encargos e pagamentos, e a conferência ao centavo.
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

export function ChargeRow({
  label,
  cents,
  muted = false,
}: {
  label: string;
  cents: bigint;
  muted?: boolean;
}) {
  return (
    <>
      <dt className={muted ? "text-muted-foreground" : undefined}>{label}</dt>
      <dd className={cn("tabular m-0 text-right font-mono", muted && "text-muted-foreground")}>
        {formatBRL(cents)}
      </dd>
    </>
  );
}

export function StatementCheck({
  check,
  fromPdf,
  purchaseCount,
  purchases,
  charges,
}: {
  check: { kind: "matches" } | { kind: "partial" } | { kind: "difference"; difference: bigint };
  /** A fatura veio do PDF importado (M09.4), não do banco */
  fromPdf: boolean;
  purchaseCount: number;
  purchases: bigint;
  charges: bigint;
}) {
  if (check.kind === "matches") {
    return (
      <div
        className="bg-income/12 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl p-3"
        data-testid="fatura-confere"
      >
        <CheckCircle2 aria-hidden className="text-income size-5" />
        <span className="text-sm">
          <strong>Confere ao centavo.</strong> As {purchaseCount} compras ligadas a esta fatura
          somam {formatBRL(purchases)}; com{" "}
          {charges > 0n ? `os encargos (${formatBRL(charges)})` : "os encargos"}, dão o total{" "}
          {fromPdf ? "da fatura" : "do banco"}.
        </span>
      </div>
    );
  }
  if (check.kind === "partial") {
    return (
      <div className="bg-muted/60 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl border p-3">
        <Info aria-hidden className="text-chart-1-ink size-5" />
        <span className="text-sm">
          Esta fatura começou antes da data de corte: só parte das compras dela foi importada, de
          propósito.
        </span>
      </div>
    );
  }
  return (
    <div
      className="bg-expense/10 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl p-3"
      data-testid="fatura-diferenca"
    >
      <TriangleAlert aria-hidden className="text-expense size-5" />
      <span className="text-sm">
        <strong>
          Diferença de {formatBRL(check.difference < 0n ? -check.difference : check.difference)}
        </strong>{" "}
        entre as compras recebidas e o total {fromPdf ? "da fatura (não confere)" : "do banco"}. A
        conferência compra a compra vem com a revisão (M09.2).
      </span>
    </div>
  );
}

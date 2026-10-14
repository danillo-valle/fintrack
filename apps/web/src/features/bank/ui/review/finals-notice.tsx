// O aviso do final que o banco mandou e não está cadastrado (M09.2, prancha E2-Revisao): as
// compras dele ficam SEM cartão (antes iam para o titular) até a pessoa cadastrar o cartão.
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SMALL_BUTTON } from "./parts";

export type UnregisteredFinal = {
  accountId: string;
  accountName: string;
  lastFour: string;
  count: number;
};

export function FinalsNotice({ finals }: { finals: readonly UnregisteredFinal[] }) {
  if (finals.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {finals.map((f) => {
        const href = `/ajustes/contas/${f.accountId}#final-${f.lastFour}`;
        const purchases = f.count === 1 ? "1 compra" : `${f.count} compras`;
        return (
          <div
            key={`${f.accountId}-${f.lastFour}`}
            data-testid="aviso-final"
            className="grid grid-cols-[1.375rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] px-4 py-3.5 md:grid-cols-[1.375rem_minmax(0,1fr)_auto]"
          >
            <TriangleAlert aria-hidden className="text-chart-4-ink size-[1.375rem]" />
            <p className="text-sm">
              O banco mandou{" "}
              <strong>
                {purchases} do final <span className="tabular">{f.lastFour}</span>
              </strong>
              <span className="hidden md:inline">
                , que não está cadastrado no {f.accountName}.{" "}
                {f.count === 1 ? "Ela fica" : "Elas ficam"} sem cartão até você cadastrar.
              </span>
              <span className="md:hidden">: {f.count === 1 ? "está" : "estão"} sem cartão.</span>
            </p>
            <Link
              href={href}
              className={cn(SMALL_BUTTON, "col-span-2 md:col-span-1")}
              aria-label={`Cadastrar o cartão final ${f.lastFour}`}
            >
              Cadastrar o cartão
            </Link>
          </div>
        );
      })}
    </div>
  );
}

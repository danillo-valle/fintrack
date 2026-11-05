// Próximos meses no Início (M13.3c, ADR-027; pranchas O-ProximosMeses e O-CelProximos): só o que
// se repete, mês a mês: o que entra, as fixas das contas, o que já se sabe das faturas e a sobra
// antes das variáveis. No computador, uma tabela; no celular, um bloco por mês. O nome do mês
// leva aos lançamentos dele, com as previstas.
import Link from "next/link";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK, TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { UpcomingView } from "../server/queries";

const TH =
  "text-muted-foreground px-2.5 pb-2.5 text-right text-xs font-bold tracking-[0.04em] uppercase";
const TD = "tabular px-2.5 py-3 text-right font-mono font-semibold";

/** "+ R$ 9.940,00", "− R$ 1.076,40" ou, sem nada, "R$ 0,00" (o sinal escrito, não só a cor). */
function signed(cents: bigint, negative: boolean) {
  return cents === 0n ? formatBRL(0n) : `${negative ? "−" : "+"} ${formatBRL(cents)}`;
}

function Left({ cents, className }: { cents: bigint; className?: string }) {
  const negative = cents < 0n;
  return (
    <span
      className={cn(
        "tabular font-mono font-extrabold",
        negative ? "text-expense" : "text-income",
        className,
      )}
    >
      {signed(negative ? -cents : cents, negative)}
    </span>
  );
}

export function UpcomingMonths({ months }: { months: readonly UpcomingView[] }) {
  return (
    <>
      <table
        className="hidden w-full border-collapse text-sm md:table"
        data-testid="proximos-meses"
      >
        <thead>
          <tr>
            <th scope="col" className={cn(TH, "text-left")}>
              Mês
            </th>
            <th scope="col" className={TH}>
              Entra
            </th>
            <th scope="col" className={TH}>
              Fixas da conta
            </th>
            <th scope="col" className={TH}>
              Fatura do cartão
            </th>
            <th scope="col" className={TH}>
              Sobra antes das variáveis
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className="border-t">
              <th scope="row" className="px-2.5 py-3 text-left font-normal">
                <Link href={m.href} className={cn(NUMBER_LINK, "font-bold")}>
                  {m.title}
                </Link>
                {m.note ? (
                  <span className="text-muted-foreground block text-[0.8125rem]">{m.note}</span>
                ) : null}
              </th>
              <td className={TD}>{signed(m.income, false)}</td>
              <td className={TD}>{signed(m.account, true)}</td>
              <td className={TD}>{signed(m.card, true)}</td>
              <td className="px-2.5 py-3 text-right">
                <Left cents={m.left} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col md:hidden" data-testid="proximos-meses-celular">
        {months.map((m) => (
          <li key={m.month} className="flex flex-col gap-1.5 border-t py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={m.href} className={cn(NUMBER_LINK, "font-bold")}>
                {m.title}
              </Link>
              <Left cents={m.left} />
            </div>
            {[
              ["entra", signed(m.income, false)],
              ["fixas da conta", signed(m.account, true)],
              ["fatura", signed(m.card, true)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="text-muted-foreground flex justify-between text-[0.8125rem]"
              >
                <span>{label}</span>
                <span className="tabular font-mono">{value}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        Entra: o que se repete pela regra de cada um. Fatura: as fixas e as parcelas do cartão e o
        que já chegou nela, no mês em que vence. As variáveis não entram aqui.{" "}
        <Link href="/fixas" className={TEXT_LINK}>
          Ver fixas e parcelas
        </Link>
      </p>
    </>
  );
}

// O previsto do mês no Início (M13.3b, ADR-026, bloco "Previsto para" da prancha N-Inicio): o total
// e as três partes, cada uma com a frase do porquê. As fixas e as parcelas entram uma vez (a fixa
// que ainda não chegou, pelo valor do mês passado); só o variável segue o ritmo do mês. O total leva
// à lista do mês; as partes não são links, porque somam o que ainda vai acontecer.
import { Layers, Repeat, Waves, type LucideIcon } from "lucide-react";
import { MoneyLink } from "@/components/money/money-link";
import { IconTile } from "@/components/visual/icon-tile";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ForecastView, Linked } from "../server/queries";

const names = new Intl.ListFormat("pt-BR", { type: "conjunction" });
const MISSING_SHOWN = 3;

/** "faltam o aluguel, a escola e mais 2": os nomes como a pessoa deu, até três. */
function missingText(missing: readonly string[]) {
  const shown = missing.slice(0, MISSING_SHOWN);
  const more = missing.length - shown.length;
  return names.format(more > 0 ? [...shown, `mais ${more}`] : shown);
}

function fixedSentence(fixed: ForecastView["fixed"]) {
  if (fixed.expected === 0) return "nenhuma conta fixa ou assinatura neste mês até agora";
  if (fixed.missing.length === 0) {
    return fixed.arrived === 1
      ? "a única deste mês já chegou"
      : `todas as ${fixed.arrived} já chegaram`;
  }
  return `uma vez cada: ${fixed.arrived} de ${fixed.expected} já chegaram; ${
    fixed.missing.length === 1 ? "falta" : "faltam"
  } ${missingText(fixed.missing)}`;
}

function Part({
  icon,
  tone,
  label,
  sentence,
  cents,
  testId,
}: {
  icon: LucideIcon;
  tone: 1 | 4 | 5;
  label: string;
  sentence: string;
  cents: bigint;
  testId: string;
}) {
  return (
    <li className="flex items-center gap-3 border-t py-3" data-testid={testId}>
      <IconTile tone={tone} icon={icon} size="sm" className="size-9 rounded-xl" />
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="text-[0.9375rem]">{label}</strong>
        <span className="text-muted-foreground text-[0.8125rem]">{sentence}</span>
      </span>
      <span className="tabular shrink-0 font-mono text-base font-extrabold">
        {formatBRL(cents)}
      </span>
    </li>
  );
}

export function ForecastBlock({
  monthLabel,
  elapsedDays,
  monthDays,
  total,
  forecast,
  budget,
}: {
  /** "novembro" */
  monthLabel: string;
  elapsedDays: number;
  monthDays: number;
  total: Linked;
  forecast: ForecastView;
  /** O orçado do mês (o "sobra" ou "passa"), quando há */
  budget: { cents: bigint; href: string; count: number; left: string | null };
}) {
  return (
    <section
      aria-labelledby="previsto-do-mes"
      className="bg-card flex flex-col gap-3 rounded-[1.25rem] border px-4 py-4 md:px-5 md:py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="previsto-do-mes"
          className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl"
        >
          Previsto para {monthLabel}
        </h2>
        <span className="text-muted-foreground text-sm">gasto até o fim do mês</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <MoneyLink
          cents={total.cents}
          href={total.href}
          label={`Saídas previstas para ${monthLabel}`}
          className="text-[2rem] font-extrabold md:text-4xl"
          data-testid="inicio-previsto"
        />
        <span className="text-muted-foreground text-sm">
          previsto · {formatBRL(forecast.spent)} já saiu
          {budget.count > 0 ? (
            <>
              {" "}
              · de{" "}
              <Link
                href={budget.href}
                className={cn(NUMBER_LINK, "tabular font-mono")}
                data-testid="inicio-orcado"
              >
                {formatBRL(budget.cents)}
              </Link>{" "}
              orçados{budget.left ? ` · ${budget.left}` : ""}
            </>
          ) : (
            <>
              {" "}
              · sem orçamento neste mês.{" "}
              <Link href={budget.href} className={NUMBER_LINK}>
                Definir
              </Link>
            </>
          )}
        </span>
      </div>
      <ul aria-label={`As partes do previsto para ${monthLabel}`} className="m-0 p-0">
        <Part
          icon={Repeat}
          tone={4}
          label="Fixas"
          sentence={fixedSentence(forecast.fixed)}
          cents={forecast.fixed.cents}
          testId="previsto-fixas"
        />
        <Part
          icon={Layers}
          tone={1}
          label="Parcelas"
          sentence={`a parcela de ${monthLabel} de cada compra parcelada`}
          cents={forecast.installment.cents}
          testId="previsto-parcelas"
        />
        <Part
          icon={Waves}
          tone={5}
          label="Variáveis"
          sentence={`no ritmo do mês: ${formatBRL(forecast.variable.spent)} em ${elapsedDays} ${
            elapsedDays === 1 ? "dia" : "dias"
          }, até o dia ${monthDays}`}
          cents={forecast.variable.cents}
          testId="previsto-variaveis"
        />
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        As fixas e as parcelas não se multiplicam pelo ritmo: entram uma vez por mês. Fixa ou
        variável vem da categoria, e você troca em cada compra. As contas fixas e as compras
        parceladas em andamento ficam em{" "}
        <Link href="/fixas" className={NUMBER_LINK}>
          Fixas e parcelas
        </Link>
        .
      </p>
    </section>
  );
}

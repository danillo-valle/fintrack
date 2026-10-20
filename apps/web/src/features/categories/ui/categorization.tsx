// Ajustes › Categorização (M10.1, pranchas F-Inteligencia e F-CelInteligencia).
//
//   ┌ Categorizados automaticamente, sem IA ┐  [regras|histórico|banco|classif.|você|sem]
//   │ 66,7 %                                │  ≡ Regras ............... 168   40,8 %
//   │ 6 de 9 lançamentos dos últimos 30 dias│  ⟲ Histórico ............  92   22,3 %
//   └───────────────────────────────────────┘  ...
//   ┌ Classificador ───────────────┐ ┌ IA local ──────────────── [◯━] ┐
//   │ treinado, acerto, limiar      │ │ janela, fila, última noite     │
//   └───────────────────────────────┘ └────────────────────────────────┘
//   (o cartão IA local é do M10.2b, prancha F2-IaLocal)
//
// Cada número de camada leva à lista dos lançamentos que ela categorizou (?quem=), como os
// números do painel (M08). A barra é um desenho (role="img" com o texto inteiro); a lista ao
// lado diz o mesmo em texto: a cor nunca é o único sinal.
import Link from "next/link";
import { Check, CircleAlert } from "lucide-react";
import {
  CLASSIFIER_THRESHOLD,
  LOCAL_AI_NIGHT_LIMIT,
  LOCAL_AI_WINDOW_TEXT,
  type BreakdownKey,
  type CategorizationSource,
} from "@fintrack/core";
import type { CategorizationPage } from "../server/categorization";
import { SOURCE_ICON } from "@/components/visual/source-pill";
import { SoftPanel } from "@/components/visual/summary";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatDate } from "@/lib/dates";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { LocalAiSwitch } from "./local-ai-switch";
import { TrainButton } from "./train-button";

const BACK = "/ajustes/categorizacao";

/** 917 → "91,7 %" */
export const tenthsText = (tenths: number) => `${Math.floor(tenths / 10)},${tenths % 10} %`;

const NAME: Record<BreakdownKey, string> = {
  RULE: "Regras",
  HISTORY: "Histórico",
  PROVIDER: "Banco (Meu Pluggy)",
  CLASSIFIER: "Classificador",
  LLM: "IA local",
  MANUAL: "Você escolheu",
  NONE: "Sem categoria",
};

const QUEM: Record<CategorizationSource, string> = {
  RULE: "regra",
  HISTORY: "historico",
  PROVIDER: "banco",
  CLASSIFIER: "classificador",
  LLM: "ia",
  MANUAL: "voce",
};

/** A cor de cada fatia (com a listra no classificador, como no canvas). */
const FILL: Record<BreakdownKey, string> = {
  RULE: "bg-chart-5",
  HISTORY: "bg-chart-1",
  PROVIDER: "bg-chart-4",
  CLASSIFIER: "hatch [--tone:var(--chart-1)]",
  LLM: "hatch [--tone:var(--chart-3)]",
  MANUAL: "bg-chart-2",
  NONE: "bg-muted-foreground/35",
};

function listHref(page: CategorizationPage, key: BreakdownKey | "ALL") {
  const query = new URLSearchParams({ de: page.period.from, ate: page.period.to });
  if (key === "NONE") query.set("categoria", "sem");
  else if (key !== "ALL") query.set("quem", QUEM[key]);
  query.set("volta", BACK);
  return `/lancamentos?${query.toString()}`;
}

export function AutomaticShare({ page }: { page: CategorizationPage }) {
  const { stats } = page;
  return (
    <SoftPanel labelledBy="sem-ia" className="flex flex-col gap-1 p-4 md:p-5">
      <h2 id="sem-ia" className="text-sm font-semibold">
        Categorizados automaticamente, sem IA
      </h2>
      <span
        className="tabular text-hero-soft-strong font-mono text-[2.375rem] leading-tight font-bold tracking-tight md:text-[2.75rem]"
        data-testid="percentual-sem-ia"
      >
        {tenthsText(stats.automaticTenths)}
      </span>
      <span className="text-[0.8125rem]">
        <span className="tabular font-mono">{stats.automatic}</span> de{" "}
        <Link href={listHref(page, "ALL")} className={cn(NUMBER_LINK, "tabular font-mono")}>
          {stats.total}
        </Link>{" "}
        lançamentos dos últimos 30 dias, por regras, histórico, banco ou classificador
      </span>
    </SoftPanel>
  );
}

export function LayerBreakdown({ page }: { page: CategorizationPage }) {
  const { stats } = page;
  const description = stats.rows
    .map((row) => `${NAME[row.key]} ${tenthsText(row.tenths)}`)
    .join(", ");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="img"
        aria-label={stats.total === 0 ? "Nenhum lançamento no período." : `${description}.`}
        className="bg-muted flex h-5 gap-0.5 overflow-hidden rounded-lg md:h-[1.375rem]"
      >
        {stats.rows
          .filter((row) => row.count > 0)
          .map((row) => (
            <span
              key={row.key}
              className={cn("block h-full", FILL[row.key])}
              style={{ width: `${row.tenths / 10}%` }}
            />
          ))}
      </div>
      <ul aria-label="Quem categorizou" className="flex flex-col">
        {stats.rows.map((row, index) => {
          const Icon = row.key === "NONE" ? null : SOURCE_ICON[row.key];
          return (
            <li
              key={row.key}
              data-testid={`camada-${row.key}`}
              className={cn(
                "grid grid-cols-[0.875rem_minmax(0,1fr)_3.5rem_4rem] items-center gap-2.5 py-2",
                index > 0 && "border-t",
              )}
            >
              <span aria-hidden className={cn("size-3.5 rounded-[0.25rem]", FILL[row.key])} />
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                {Icon ? (
                  <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                ) : null}
                <span className="truncate">{NAME[row.key]}</span>
              </span>
              <span className="text-right">
                {row.count > 0 ? (
                  <Link
                    href={listHref(page, row.key)}
                    className={cn(NUMBER_LINK, "tabular font-mono text-sm font-bold")}
                    aria-label={`${row.count} lançamentos: ${NAME[row.key]}`}
                  >
                    {row.count}
                  </Link>
                ) : (
                  <span className="tabular text-muted-foreground font-mono text-sm">0</span>
                )}
              </span>
              <span className="tabular text-muted-foreground text-right font-mono text-sm">
                {tenthsText(row.tenths)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const sameDay = (a: Date, b: Date) => formatDate(a) === formatDate(b);
const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function trainedLabel(date: Date, now: Date) {
  const time = timeFormat.format(date);
  if (sameDay(date, now)) return `hoje às ${time}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(date, yesterday)) return `ontem às ${time}`;
  return `em ${formatDate(date)} às ${time}`;
}

export function ClassifierCard({ page, now }: { page: CategorizationPage; now: Date }) {
  const { classifier, evaluation } = page;
  return (
    <section
      aria-labelledby="classificador"
      className="bg-card flex flex-col gap-3.5 rounded-[1.125rem] border p-4 md:p-5"
    >
      <h2 id="classificador" className="text-lg font-extrabold tracking-tight md:text-xl">
        Classificador
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Treinado</dt>
        <dd>
          {classifier.lastTrainedAt ? (
            <>
              {trainedLabel(classifier.lastTrainedAt, now)}, com{" "}
              <span className="tabular font-mono">
                {classifier.examples.toLocaleString("pt-BR")}
              </span>{" "}
              confirmações e correções
              {classifier.models > 1 ? ` (${classifier.models} carteiras)` : ""}
            </>
          ) : (
            "ainda não: precisa de 20 lançamentos com categoria numa carteira"
          )}
        </dd>
        <dt className="text-muted-foreground">Acerto</dt>
        <dd className="flex flex-col gap-1.5">
          {evaluation ? (
            <>
              <span>
                <span className="tabular font-mono font-bold">
                  {tenthsText(Math.round(evaluation.acerto * 1000))}
                </span>{" "}
                no conjunto de teste sintético (mínimo{" "}
                {tenthsText(Math.round(evaluation.minimo * 1000))})
              </span>
              <span
                role="img"
                aria-label={`${tenthsText(Math.round(evaluation.acerto * 1000))} de acerto; o mínimo é ${tenthsText(Math.round(evaluation.minimo * 1000))}`}
                className="bg-muted relative block h-2 rounded"
              >
                <span
                  className="bg-income absolute inset-y-0 left-0 rounded"
                  style={{ width: `${evaluation.acerto * 100}%` }}
                />
                <span
                  className="bg-foreground absolute -inset-y-1 w-0.5"
                  style={{ left: `${evaluation.minimo * 100}%` }}
                />
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">o serviço não respondeu agora</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Sugere</dt>
        <dd>
          a partir de <span className="tabular font-mono font-bold">{CLASSIFIER_THRESHOLD} %</span>{" "}
          de confiança; abaixo disso, fica sem sugestão para você escolher
        </dd>
        <dt className="text-muted-foreground">Fica</dt>
        <dd>só no servidor de casa (nunca no GitHub nem na imagem)</dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        {page.canManage && page.configured ? <TrainButton /> : null}
        <span className="text-muted-foreground text-[0.8125rem]">
          Treina sozinho toda noite, às 03:15
          {page.configured ? "" : " (o serviço Python não está ligado neste servidor)"}
        </span>
      </div>
    </section>
  );
}

const n = (value: number) => <span className="tabular font-mono font-bold">{value}</span>;

/** O cartão IA local (M10.2b, prancha F2-IaLocal): o interruptor, a janela e a última noite. */
export function LocalAiCard({ page, now }: { page: CategorizationPage; now: Date }) {
  const { localAi } = page;
  const on = localAi.enabledAt !== null;
  const night = localAi.lastNight;
  return (
    <section
      aria-labelledby="ia-local"
      className="bg-card flex flex-col gap-3.5 rounded-[1.125rem] border p-4 md:p-5"
      data-testid="cartao-ia-local"
    >
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="ia-local" className="text-lg font-extrabold tracking-tight md:text-xl">
            IA local
          </h2>
          <span
            className={cn("text-sm font-bold", on ? "text-income" : "text-muted-foreground")}
            data-testid="ia-local-estado"
          >
            {localAi.enabledAt ? `Ligada desde ${formatDate(localAi.enabledAt)}` : "Desligada"}
          </span>
        </div>
        {page.canManage && page.configured ? <LocalAiSwitch on={on} labelledBy="ia-local" /> : null}
      </div>
      <p className="text-sm">
        {on ? (
          <>
            Roda à noite, {LOCAL_AI_WINDOW_TEXT}, até {LOCAL_AI_NIGHT_LIMIT} lançamentos por noite,
            só no que veio do banco. Na fila agora: {n(localAi.queued)}.
          </>
        ) : (
          "O que as regras, o histórico, o banco e o classificador não resolvem fica sem sugestão, para você escolher."
        )}
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {[
          "Roda no servidor de casa: a descrição do lançamento não sai dele",
          `Custo: R$ 0,00. Sem API paga, não há teto em reais; o limite é de uso (${LOCAL_AI_NIGHT_LIMIT} por noite)`,
          "Responde só uma categoria da sua lista, ou propõe uma nova; nada é criado nem confirmado sem você",
          "Lançamento feito à mão nunca vai para a IA",
        ].map((text) => (
          <li key={text} className="flex gap-2">
            <Check aria-hidden className="text-income mt-0.5 size-[1.125rem] shrink-0" />
            {text}
          </li>
        ))}
      </ul>
      {night ? (
        <div
          className="bg-muted/50 flex flex-col gap-1.5 rounded-[0.875rem] border px-3.5 py-3 text-sm"
          data-testid="ia-local-noite"
        >
          <strong>Última noite ({trainedLabel(night.at, now)})</strong>
          <span>
            {n(night.outcomes.SUGGESTED)} com categoria · {n(night.outcomes.NEW_CATEGORY)}{" "}
            {night.outcomes.NEW_CATEGORY === 1
              ? "categoria nova proposta"
              : "categorias novas propostas"}{" "}
            · {n(night.outcomes.NO_SUGGESTION + night.outcomes.INVALID)} sem resposta ·{" "}
            {n(night.outcomes.BLOCKED)} {night.outcomes.BLOCKED === 1 ? "barrada" : "barradas"}{" "}
            (texto com cara de instrução)
          </span>
        </div>
      ) : null}
      {page.configured ? null : (
        <span className="text-muted-foreground text-[0.8125rem]">
          O serviço Python não está ligado neste servidor
        </span>
      )}
      {/* Texto longo para a largura do celular: a etiqueta quebra a linha em vez de vazar do cartão */}
      <ToneChip
        tone={4}
        icon={CircleAlert}
        className="h-auto min-h-6 self-start py-1 whitespace-normal"
      >
        Qwen2.5 3B, medido no servidor de casa (ADR-016)
      </ToneChip>
    </section>
  );
}

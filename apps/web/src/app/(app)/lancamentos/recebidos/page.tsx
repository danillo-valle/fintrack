import type { Metadata } from "next";
import Link from "next/link";
import { Check, Inbox, Upload } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedNav } from "@/components/visual/segmented-nav";
import { parseReviewView, type ReviewView } from "@/features/bank/schemas";
import { getReviewPage } from "@/features/bank/server/review";
import { FinalsNotice } from "@/features/bank/ui/review/finals-notice";
import { PairCard } from "@/features/bank/ui/review/pair-card";
import { MAIN_BUTTON, SMALL_BUTTON } from "@/features/bank/ui/review/parts";
import { ReceivedGroup } from "@/features/bank/ui/review/received-group";
import {
  ReviewActions,
  ReviewForm,
  ReviewSubmit,
  type ReviewReturn,
} from "@/features/bank/ui/review/review-actions";
import { SyncLine } from "@/features/bank/ui/sync-line";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Recebidos do banco" };

const PATH = "/lancamentos/recebidos";
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hrefFor(view: ReviewView, open?: string) {
  const params = new URLSearchParams();
  if (view !== "todos") params.set("ver", view);
  if (open) params.set("abrir", open);
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

// A revisão dos recebidos do banco (M09.2, pranchas E2-Revisao e E2-CelRevisao): os pares
// sugeridos (o mesmo gasto lançado por você e mandado pelo banco), os estornos e, por fatura ou
// conta, os recebidos sem par com a categoria em um clique, o ambiente e o "Confirmar". Tudo
// aqui está FORA das somas até ser confirmado (ADR-011 e ADR-012).
export default async function ReviewPage({ searchParams }: PageProps<"/lancamentos/recebidos">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const params = await searchParams;
  const view = parseReviewView(one(params.ver));
  const open = one(params.abrir) ?? null;
  const joined = one(params.juntado) ?? null;
  const confirmed = one(params.confirmado) ?? null;
  const created = one(params.criada) ?? null;
  const applied = Number.parseInt(one(params.aplicados) ?? "", 10);
  // A decisão tomada num modal (o par, ou o "Por que essa categoria?") volta com o Desfazer
  const returned: ReviewReturn | null =
    joined && UUID.test(joined)
      ? {
          key: `juntado:${joined}`,
          message: "Par confirmado. Ficou um lançamento só, com o id do banco.",
          undo: { kind: "match", matchId: joined },
        }
      : confirmed && UUID.test(confirmed)
        ? {
            key: `confirmado:${confirmed}`,
            message: "1 recebido confirmado. Já entra nas somas.",
            undo: { kind: "review", ids: [confirmed] },
          }
        : created && UUID.test(created)
          ? {
              key: `criada:${created}`,
              message: `Categoria aplicada em ${applied === 1 ? "1 recebido" : `${Number.isFinite(applied) ? applied : 0} recebidos`}. Falta o seu Confirmar.`,
              undo: null,
            }
          : null;
  const page = await getReviewPage(session, view);
  const { queue } = page;
  // A categoria da IA local fica fora do "Confirmar os N" (M10.2b): a tela diz isso
  const hasLlm = queue.groups.some((g) =>
    g.items.some((i) => i.categorizedBy === "LLM" && i.category !== null),
  );
  const waiting = queue.total === 1 ? "1 esperando revisão." : `${queue.total} esperando revisão.`;

  return (
    <ReviewActions returned={returned}>
      <PageHeader
        crumb={{ href: "/lancamentos", label: "Lançamentos" }}
        title="Recebidos do banco"
        description={
          <>
            {waiting}{" "}
            <span className="hidden md:inline">Ficam fora das somas até você confirmar.</span>
            <span className="md:hidden">Fora das somas até confirmar.</span>
          </>
        }
        actions={
          <>
            {page.sync.canSync || page.sync.lastSyncedAt ? (
              <SyncLine
                bankUpdatedAt={page.sync.bankUpdatedAt}
                lastSyncedAt={page.sync.lastSyncedAt}
                canSync={page.sync.canSync}
                compact
              />
            ) : null}
            {/* M09.3: o extrato .ofx do banco entra aqui, como os recebidos do Meu Pluggy */}
            <Link href="/lancamentos/importar" className={cn(SMALL_BUTTON, "gap-1.5")}>
              <Upload aria-hidden className="size-4" />
              Importar OFX
            </Link>
          </>
        }
      />
      <noscript>
        {joined ? <p className="mb-4 text-sm font-semibold">Par confirmado.</p> : null}
        {confirmed ? <p className="mb-4 text-sm font-semibold">Recebido confirmado.</p> : null}
        {created ? (
          <p className="mb-4 text-sm font-semibold">Categoria criada e aplicada.</p>
        ) : null}
      </noscript>

      {queue.total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nada para revisar"
          description="Tudo o que veio do banco já foi conferido. A próxima busca (ou um extrato .ofx importado) traz o que for novo."
        />
      ) : (
        <div className="flex flex-col gap-4 md:gap-5">
          <FinalsNotice finals={queue.finals} />
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <SegmentedNav
              label="Filtrar recebidos"
              className="max-md:auto-cols-auto md:w-fit"
              items={[
                {
                  href: hrefFor("todos"),
                  label: "Todos",
                  count: queue.total,
                  active: view === "todos",
                },
                {
                  href: hrefFor("pares"),
                  label: "Com par sugerido",
                  shortLabel: "Pares",
                  count: queue.pairs.length,
                  active: view === "pares",
                },
                {
                  href: hrefFor("sem-categoria"),
                  label: "Sem categoria",
                  count: queue.uncategorized,
                  active: view === "sem-categoria",
                },
                // M10.2b: só com a IA local ligada no lar (prancha F2-Recebidos)
                ...(queue.localAiOn
                  ? [
                      {
                        href: hrefFor("fila-ia"),
                        label: "Na fila da IA",
                        shortLabel: "Fila da IA",
                        count: queue.localAiQueued,
                        active: view === "fila-ia",
                      },
                    ]
                  : []),
              ]}
            />
            {queue.confirmable > 0 ? (
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2.5">
                {hasLlm ? (
                  <span className="text-muted-foreground order-last text-[0.8125rem] md:order-first md:max-w-56 md:text-right">
                    A da IA local você confirma uma a uma
                  </span>
                ) : null}
                <ReviewForm intent="bulk" fields={{}} className="grid md:block">
                  <ReviewSubmit className={MAIN_BUTTON}>
                    <Check aria-hidden className="size-[1.125rem]" />
                    {queue.confirmable === 1 ? (
                      "Confirmar o que já tem categoria"
                    ) : (
                      <>
                        <span className="md:hidden">
                          Confirmar os {queue.confirmable} com categoria
                        </span>
                        <span className="hidden md:inline">
                          Confirmar os {queue.confirmable} que já têm categoria
                        </span>
                      </>
                    )}
                  </ReviewSubmit>
                </ReviewForm>
              </div>
            ) : null}
          </div>

          {page.pairs.length > 0 ? (
            <section aria-labelledby="pares" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h2 id="pares" className="text-lg font-extrabold md:text-xl">
                  Pares sugeridos
                </h2>
                <span className="text-muted-foreground hidden text-sm md:inline">
                  o mesmo gasto lançado por você e mandado pelo banco
                </span>
              </div>
              {page.pairs.map((pair) => (
                <PairCard key={`${pair.received.id}-${pair.own.id}`} pair={pair} />
              ))}
            </section>
          ) : null}

          {page.groups.map((group) => (
            <ReceivedGroup
              key={group.key}
              group={group}
              choices={page.categories}
              wallets={page.wallets}
              expanded={open === group.key}
              expandHref={`${hrefFor(view, group.key)}#grupo-${group.key.replace(":", "-")}`}
              canManageCategories={page.canManageCategories}
            />
          ))}

          {view !== "todos" && page.pairs.length === 0 && page.groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {view === "pares"
                ? "Nenhum par sugerido agora."
                : view === "fila-ia"
                  ? "Nada na fila da IA local agora."
                  : "Todos já têm categoria."}
            </p>
          ) : null}
          {queue.truncated ? (
            <p className="text-muted-foreground text-sm">
              Mostrando os{" "}
              {queue.groups.reduce((n, g) => n + g.items.length, 0) + queue.pairs.length} mais
              recentes. Confirme estes para ver os outros.
            </p>
          ) : null}
        </div>
      )}
    </ReviewActions>
  );
}

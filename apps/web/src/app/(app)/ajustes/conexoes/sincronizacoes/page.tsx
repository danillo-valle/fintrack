import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { syncErrorShort } from "@/features/bank/messages";
import { getSyncHistory } from "@/features/bank/server/queries";
import { RequestSyncButton } from "@/features/bank/ui/request-sync-button";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sincronizações" };

const TZ = "America/Sao_Paulo";
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** "Hoje, 06:47", "Ontem, 06:47" ou "08/10, 06:47" (no fuso de São Paulo). */
function runWhen(date: Date, now: Date) {
  const time = timeFmt.format(date);
  if (dayKey.format(date) === dayKey.format(now)) return `Hoje, ${time}`;
  if (dayKey.format(date) === dayKey.format(new Date(now.getTime() - 86_400_000)))
    return `Ontem, ${time}`;
  return `${dayMonthFmt.format(date)}, ${time}`;
}

function seconds(run: { startedAt: Date; finishedAt: Date | null }) {
  if (!run.finishedAt) return "—";
  const tenths = Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10} s`;
}

// Histórico de sincronizações (M09.1, pranchas E-Sync e E-CelSync): a próxima busca agendada, a
// última atualização do banco e cada execução (SyncRun), com o resultado escrito e um ícone.
export default async function SyncHistoryPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const history = await getSyncHistory(session);
  if (!history) notFound();
  const now = new Date();
  const nextDay = dayKey.format(now) === history.next.day ? "Hoje" : "Amanhã";
  const lastFailure = history.runs.find((r) => r.status === "FAILED");

  return (
    <>
      <nav aria-label="Caminho" className="mb-1">
        <Link
          href="/ajustes/conexoes"
          className={cn(TEXT_LINK, "inline-flex min-h-8 items-center gap-1 text-sm")}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Ajustes · Conexões bancárias
        </Link>
      </nav>
      <PageHeader
        help="meu-pluggy"
        title="Sincronizações"
        description={`Meu Pluggy de ${session.user.name.split(" ")[0] ?? session.user.name} · cada busca fica registrada aqui`}
        actions={<RequestSyncButton />}
      />
      <div className="flex flex-col gap-4">
        <section
          aria-label="Situação"
          className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3.5"
        >
          <div className="bg-card flex flex-col gap-0.5 rounded-2xl border px-3.5 py-3 md:px-5 md:py-4">
            <span className="text-muted-foreground text-xs md:text-[0.8125rem]">
              Próxima busca agendada
            </span>
            <strong className="text-base md:text-[1.375rem]">
              {nextDay}, {history.next.time}
            </strong>
            <span className="text-muted-foreground hidden text-xs md:block">
              todo dia, depois do backup
            </span>
          </div>
          <div className="bg-card flex flex-col gap-0.5 rounded-2xl border px-3.5 py-3 md:px-5 md:py-4">
            <span className="text-muted-foreground text-xs md:text-[0.8125rem]">
              Banco atualizado pela última vez
            </span>
            <strong className="text-base md:text-[1.375rem]">
              {history.bankUpdatedAt ? runWhen(history.bankUpdatedAt, now) : "—"}
            </strong>
            <span className="text-muted-foreground hidden text-xs md:block">
              o Meu Pluggy atualiza cada banco uma vez por dia
            </span>
          </div>
          <div className="bg-card col-span-2 flex flex-col gap-0.5 rounded-2xl border px-3.5 py-3 md:col-span-1 md:px-5 md:py-4">
            <span className="text-muted-foreground text-xs md:text-[0.8125rem]">
              Recebidos esperando revisão
            </span>
            <Link
              href="/lancamentos/recebidos"
              className={cn(
                TEXT_LINK,
                "text-chart-4-ink tabular font-mono text-base font-bold md:text-[1.375rem]",
              )}
            >
              {history.received.count}
            </Link>
            <span className="text-muted-foreground hidden text-xs md:block">
              não entram nas somas até a revisão
            </span>
          </div>
        </section>
        <p className="bg-muted/50 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl border px-3.5 py-3 text-sm">
          <Info aria-hidden className="text-chart-1-ink size-5" />
          <span>
            Buscar agora lê o que o Meu Pluggy já tem; ele não pede ao banco dados mais novos.
            Buscar duas vezes não cria lançamentos repetidos.
          </span>
        </p>

        <section
          aria-labelledby="historico"
          className="bg-card flex flex-col gap-2 rounded-[1.25rem] border p-4 md:p-5"
        >
          <h2 id="historico" className="text-xl font-extrabold">
            Histórico
          </h2>
          {history.runs.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma busca ainda.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sr-only md:not-sr-only">
                <tr className="text-muted-foreground text-left text-[0.8125rem]">
                  <th scope="col" className="py-2 font-bold">
                    Quando
                  </th>
                  <th scope="col" className="py-2 font-bold">
                    Como
                  </th>
                  <th scope="col" className="py-2 font-bold">
                    Resultado
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Novos
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Atualizados
                  </th>
                  <th scope="col" className="py-2 text-right font-bold">
                    Tempo
                  </th>
                  <th scope="col" className="py-2 pl-3 font-bold">
                    Observação
                  </th>
                </tr>
              </thead>
              <tbody className="flex flex-col gap-2 md:table-row-group">
                {history.runs.map((run) => {
                  const note =
                    run.status === "FAILED"
                      ? syncErrorShort(run.error)
                      : run.status === "SUCCEEDED" &&
                          run.itemsCreated === 0 &&
                          run.itemsUpdated === 0
                        ? "nada novo"
                        : run.itemsSkipped > 0
                          ? `${run.itemsSkipped} em outra moeda sem valor em reais ficaram de fora`
                          : "";
                  return (
                    <tr
                      key={run.id}
                      className="grid grid-cols-2 gap-1 rounded-2xl border p-3 md:table-row md:rounded-none md:border-0 md:border-t md:p-0"
                    >
                      <td className="font-semibold md:py-3">{runWhen(run.startedAt, now)}</td>
                      <td className="text-muted-foreground md:text-foreground text-right md:py-3 md:text-left">
                        {run.trigger === "MANUAL" ? "Botão" : "Agendada"}
                      </td>
                      <td className="col-span-2 md:py-3">
                        {run.status === "SUCCEEDED" ? (
                          <span className="text-income inline-flex items-center gap-1.5 font-bold">
                            <CheckCircle2 aria-hidden className="size-[1.125rem]" />
                            Concluída
                          </span>
                        ) : run.status === "FAILED" ? (
                          <span className="text-expense inline-flex items-center gap-1.5 font-bold">
                            <TriangleAlert aria-hidden className="size-[1.125rem]" />
                            Falhou
                          </span>
                        ) : (
                          <span className="text-muted-foreground inline-flex items-center gap-1.5 font-bold">
                            <LoaderCircle
                              aria-hidden
                              className="size-[1.125rem] animate-spin motion-reduce:animate-none"
                            />
                            Em andamento
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground tabular md:text-foreground font-mono text-xs md:py-3 md:text-right md:text-sm">
                        <span className="md:hidden">novos </span>
                        {run.status === "FAILED" ? "—" : run.itemsCreated}
                      </td>
                      <td className="text-muted-foreground tabular md:text-foreground text-right font-mono text-xs md:py-3 md:text-sm">
                        <span className="md:hidden">atualizados </span>
                        {run.status === "FAILED" ? "—" : run.itemsUpdated}
                      </td>
                      <td className="text-muted-foreground tabular md:text-foreground hidden font-mono md:table-cell md:py-3 md:text-right">
                        {seconds(run)}
                      </td>
                      <td className="text-muted-foreground col-span-2 text-[0.8125rem] md:py-3 md:pl-3 md:text-sm">
                        {note}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {lastFailure ? (
            <div className="bg-expense/10 flex flex-wrap items-center gap-2.5 rounded-xl p-3 text-sm">
              <TriangleAlert aria-hidden className="text-expense size-5" />
              <span className="flex-[1_1_18rem]">
                Na falha de {runWhen(lastFailure.startedAt, now).toLowerCase()}, nada foi gravado.
                {lastFailure.error === "PROVIDER_AUTH_FAILED"
                  ? " Se acontecer de novo, troque o Client Secret."
                  : " A próxima busca tenta de novo."}
              </span>
              {lastFailure.error === "PROVIDER_AUTH_FAILED" ? (
                <Link href="/ajustes/conexoes/credenciais" className={cn(TEXT_LINK, "font-bold")}>
                  Trocar credenciais
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}

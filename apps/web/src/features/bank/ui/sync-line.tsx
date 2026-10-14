// "Banco atualizado às 05:12 · buscado às 06:47" + "Buscar agora" (M09.1, linha E do canvas).
// O Meu Pluggy atualiza cada banco uma vez por dia; a busca do FinTrack lê o que ele já tem.
// As duas horas aparecem para a pessoa saber de quando é o número.
import { CheckCircle2, Clock } from "lucide-react";
import { RequestSyncButton } from "./request-sync-button";

const time = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** "às 05:12" hoje; "em 09/10, 05:12" em outro dia. */
export function whenLabel(date: Date, now: Date = new Date()): string {
  if (dayKey.format(date) === dayKey.format(now)) return `às ${time.format(date)}`;
  const d = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  return `em ${d.format(date)}, ${time.format(date)}`;
}

export function SyncLine({
  bankUpdatedAt,
  lastSyncedAt,
  canSync,
  compact = false,
}: {
  bankUpdatedAt: Date | null;
  lastSyncedAt: Date | null;
  canSync: boolean;
  /** Letra menor, no cabeçalho de uma página cheia (revisão, M09.2) */
  compact?: boolean;
}) {
  const parts = [
    bankUpdatedAt ? `Banco atualizado ${whenLabel(bankUpdatedAt)}` : null,
    lastSyncedAt ? `buscado ${whenLabel(lastSyncedAt)}` : "ainda não buscado",
  ].filter(Boolean);
  const sentence = parts.join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="sync-line">
      <span
        className={`text-muted-foreground inline-flex items-center gap-2 ${compact ? "text-[0.8125rem]" : "text-sm"}`}
      >
        {lastSyncedAt ? (
          <CheckCircle2 aria-hidden className="text-income size-[1.125rem]" />
        ) : (
          <Clock aria-hidden className="size-[1.125rem]" />
        )}
        <span>{sentence.charAt(0).toUpperCase() + sentence.slice(1)}</span>
      </span>
      {canSync ? <RequestSyncButton /> : null}
    </div>
  );
}

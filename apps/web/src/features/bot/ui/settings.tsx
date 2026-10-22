// Ajustes › Bot do WhatsApp (M11, pranchas G-Ajustes e G-CelAjustes). No computador, duas colunas
// (o bot, o número e os padrões; a conta das respostas e as últimas mensagens); no celular, uma
// só, na ordem da prancha do celular (bot, conta, número, padrões, mensagens). As colunas viram
// `contents` no celular e cada cartão leva a sua ordem: um HTML só, sem duplicar.
import Link from "next/link";
import {
  Check,
  CircleAlert,
  Clock,
  Info,
  MessageCircle,
  Phone,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { BOT_FREE_TIER, BOT_STOP_AT, BOT_WARN_AT, botPhase, nameWords } from "@fintrack/core";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatDate } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { BotSettingsPage } from "../server/queries";
import { BotSwitch, PreferenceForm, StartLinkButton, UnlinkButton } from "./forms";

const CARD = "bg-card flex min-w-0 flex-col gap-3.5 rounded-[1.125rem] border p-4 md:p-5";
const n = (value: number) => value.toLocaleString("pt-BR");

const TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** "20:41" hoje, "ontem" ou "19/10". */
function whenLabel(at: Date, now: Date): string {
  const day = DAY.format(at);
  if (day === DAY.format(now)) return TIME.format(at);
  if (day === DAY.format(new Date(now.getTime() - 86_400_000))) return "ontem";
  return formatDate(at).slice(0, 5);
}

export function BotStatusCard({ page }: { page: BotSettingsPage }) {
  const on = page.enabled;
  return (
    <section
      aria-labelledby="bot-h"
      className={cn(CARD, "order-1 md:order-none")}
      data-testid="cartao-bot"
    >
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="bot-h" className="text-lg font-extrabold tracking-tight md:text-xl">
            Bot do WhatsApp
          </h2>
          <span
            className={cn("text-sm font-bold", on ? "text-income" : "text-muted-foreground")}
            data-testid="bot-estado"
          >
            {on ? "Ligado" : "Desligado"}
          </span>
        </div>
        {page.canManage && page.configured ? <BotSwitch on={on} labelledBy="bot-h" /> : null}
      </div>
      <p className="text-sm">
        {on
          ? "Lê o que as pessoas do lar mandam dos números vinculados, propõe o lançamento e espera o Confirmar. Nunca manda mensagem sozinho."
          : "O bot não lê nem responde. Mensagens que chegarem enquanto ele estiver desligado são descartadas sem gravar nada."}
      </p>
      {page.configured ? (
        <div className="bg-muted/50 flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm">
          <MessageCircle aria-hidden className="text-muted-foreground size-[1.125rem] shrink-0" />
          <span className="min-w-0">
            Número do bot:{" "}
            <span className="font-mono font-bold tabular-nums" data-testid="bot-numero">
              {page.displayNumber ?? "configurado no servidor"}
            </span>
            {page.testNumber ? " · número de teste da Meta" : null}
          </span>
        </div>
      ) : (
        <ToneChip
          tone={4}
          icon={CircleAlert}
          className="h-auto min-h-6 self-start py-1 whitespace-normal"
        >
          O bot ainda não está configurado neste servidor (passo da Meta, M11.2)
        </ToneChip>
      )}
    </section>
  );
}

export function NumberCard({ page }: { page: BotSettingsPage }) {
  return (
    <section
      aria-labelledby="bot-numero-h"
      className={cn(CARD, "order-3 md:order-none")}
      data-testid="cartao-numero"
    >
      <h2 id="bot-numero-h" className="text-base font-extrabold md:text-lg">
        Seu número
      </h2>
      {page.link ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-income/12 text-income flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Phone aria-hidden className="size-5" />
          </span>
          <span className="flex min-w-0 flex-[1_1_10rem] flex-col gap-0.5">
            <strong className="text-[0.9375rem]" data-testid="numero-vinculado">
              Vinculado: final{" "}
              <span className="font-mono tabular-nums">{page.link.phoneLastFour}</span>
            </strong>
            <span className="text-muted-foreground text-[0.8125rem]">
              Desde {formatDate(page.link.linkedAt)}. Só lança em seu nome; não serve para entrar no
              FinTrack.
            </span>
          </span>
          <UnlinkButton />
        </div>
      ) : (
        <>
          <p className="text-sm">
            Nenhum número vinculado. Você gera um código aqui e manda pelo WhatsApp do seu celular;
            o código vale 10 minutos e uma vez só.
          </p>
          {page.configured ? <StartLinkButton /> : null}
          <span className="text-muted-foreground text-[0.8125rem]">
            Pedimos sua senha de novo antes de mostrar o código.
          </span>
        </>
      )}
    </section>
  );
}

/** "“na casa” na mensagem troca": a dica com um nome de verdade (a primeira palavra dele). */
function mention(prefix: string, name: string | undefined, fallback: string): string {
  const word = name ? nameWords(name)[0] : undefined;
  return word ? `“${prefix} ${word}” na mensagem troca` : fallback;
}

export function PreferenceCard({ page }: { page: BotSettingsPage }) {
  const { choices, defaults } = page;
  const credit = choices.cards.filter((c) => c.credit);
  const otherWallet = choices.wallets.find((w) => w.id !== defaults.walletId) ?? choices.wallets[0];
  const otherCard = credit.find((c) => c.id !== defaults.creditCardId) ?? credit[0];
  return (
    <section aria-labelledby="bot-padroes-h" className={cn(CARD, "order-4 md:order-none")}>
      <h2 id="bot-padroes-h" className="text-base font-extrabold md:text-lg">
        O que o bot usa quando você não diz
      </h2>
      <PreferenceForm
        wallets={choices.wallets}
        debitAccounts={choices.debitAccounts}
        creditCards={credit.map((c) => ({ id: c.id, name: c.nickname }))}
        defaults={defaults}
        hints={{
          wallet: mention("na", otherWallet?.name, "o nome do ambiente na mensagem troca"),
          debit: "“no pix” ou “no débito”",
          credit: mention("no", otherCard?.nickname, "o apelido do cartão na mensagem troca"),
        }}
      />
      <div className="bg-muted/50 flex flex-col gap-1.5 rounded-[0.875rem] border px-3.5 py-3 text-sm">
        <strong>Como escrever</strong>
        {[
          "gastei 42,90 no mercado",
          "35 farmácia ontem no pix",
          "tênis 600 em 3x",
          "uber 18,50 dia 19",
        ].map((example) => (
          <span key={example} className="font-mono text-[0.8125rem]">
            {example}
          </span>
        ))}
      </div>
    </section>
  );
}

const PHASE: Record<
  ReturnType<typeof botPhase>,
  { label: string; tone: 1 | 2 | 3 | 4 | 5; icon: LucideIcon; bar: string }
> = {
  NORMAL: { label: "Normal", tone: 2, icon: Check, bar: "bg-primary" },
  ESSENTIAL: { label: "Só o essencial", tone: 4, icon: CircleAlert, bar: "bg-chart-4" },
  STOPPED: { label: "Parado até o mês virar", tone: 3, icon: X, bar: "bg-expense" },
};

export function UsageCard({ page, now }: { page: BotSettingsPage; now: Date }) {
  const used = page.usage?.used ?? 0;
  const phase = PHASE[botPhase(used)];
  const month = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    month: "long",
  }).format(now);
  return (
    <section
      aria-labelledby="bot-conta-h"
      className={cn(CARD, "order-2 md:order-none")}
      data-testid="cartao-conta"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="bot-conta-h" className="text-base font-extrabold md:text-lg">
          Respostas grátis de {month}
        </h2>
        <span className="text-muted-foreground text-[0.8125rem]">
          Do número do bot, para todo o lar
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className="font-mono text-4xl font-bold tracking-tight tabular-nums"
          data-testid="respostas-usadas"
        >
          {n(used)}
        </span>
        <span className="text-muted-foreground">
          de <span className="font-mono tabular-nums">{n(BOT_STOP_AT)}</span>
        </span>
        <ToneChip tone={phase.tone} icon={phase.icon} className="ml-auto">
          {phase.label}
        </ToneChip>
      </div>
      <div className="relative h-11 max-sm:h-14">
        <span
          role="img"
          aria-label={`${n(used)} de ${n(BOT_STOP_AT)} respostas usadas; aviso em ${n(BOT_WARN_AT)}, para em ${n(BOT_STOP_AT)}; a Meta dá ${n(BOT_FREE_TIER)}.`}
          className="bg-muted absolute inset-x-0 top-0 block h-3.5 overflow-hidden rounded-full"
        >
          <span
            className={cn("block h-full rounded-full", phase.bar)}
            style={{ width: `${Math.min(used, BOT_FREE_TIER) / 10}%` }}
          />
        </span>
        <span aria-hidden className="bg-foreground absolute -top-0.5 left-[85%] h-5 w-0.5" />
        <span aria-hidden className="bg-expense absolute -top-0.5 left-[90%] h-5 w-0.5" />
        <span
          aria-hidden
          className="text-muted-foreground absolute top-[1.375rem] right-[15%] pr-1 font-mono text-xs whitespace-nowrap"
        >
          {BOT_WARN_AT} aviso
        </span>
        {/* O "900 para" encostado na borda direita (a 90 % ele vazaria do cartão a 320 px) */}
        <span
          aria-hidden
          className="text-expense absolute top-[1.375rem] right-0 font-mono text-xs whitespace-nowrap max-sm:top-[2.375rem]"
        >
          {BOT_STOP_AT} para
        </span>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <Info aria-hidden className="text-muted-foreground mt-0.5 size-[1.125rem] shrink-0" />
          <span>
            A Meta dá {n(BOT_FREE_TIER)} por mês ao número do bot. Paramos em {n(BOT_STOP_AT)}, com
            folga, e sem cartão cadastrado na Meta nunca há cobrança.
          </span>
        </li>
        <li className="flex gap-2">
          <MessageCircle
            aria-hidden
            className="text-muted-foreground mt-0.5 size-[1.125rem] shrink-0"
          />
          <span>
            Cada lançamento gasta 2 respostas (a proposta e o “Lançado”). Depois do aviso, só 1: a
            confirmação vira o “lida”.
          </span>
        </li>
        <li className="flex gap-2">
          <Clock aria-hidden className="text-muted-foreground mt-0.5 size-[1.125rem] shrink-0" />
          <span>
            Volta a zero no dia 1º às 00:00, horário de São Paulo. No teto, o que vocês mandarem
            continua chegando em Recebidos.
          </span>
        </li>
      </ul>
    </section>
  );
}

type Row = BotSettingsPage["recent"]["items"][number];

const OUTCOME: Record<string, { label: string; tone: 1 | 2 | 3 | 4 | 5 | null; icon: LucideIcon }> =
  {
    CONFIRMED: { label: "Confirmado", tone: 2, icon: Check },
    PROPOSED: { label: "Em Recebidos", tone: 1, icon: Clock },
    ASKED: { label: "Em Recebidos", tone: 1, icon: Clock },
    NOT_UNDERSTOOD: { label: "Não entendi", tone: 4, icon: CircleAlert },
    CARD_NUMBER: { label: "Número de cartão recusado", tone: 4, icon: ShieldCheck },
    CANCELLED: { label: "Cancelado", tone: null, icon: X },
    UNDONE: { label: "Desfeito", tone: null, icon: X },
    LINKED: { label: "Vinculou", tone: 2, icon: Check },
    BOT_OFF: { label: "Bot desligado", tone: null, icon: X },
    STALE: { label: "Botão antigo", tone: null, icon: X },
  };

function rowStatus(row: Row) {
  // A mensagem que propôs passa a mostrar o que aconteceu com a proposta depois
  if (row.outcome === "PROPOSED" || row.outcome === "ASKED") {
    if (row.draftStatus === "CONFIRMED") return OUTCOME.CONFIRMED!;
    if (row.draftStatus === "CANCELLED") return OUTCOME.CANCELLED!;
    if (row.draftStatus === "UNDONE") return OUTCOME.UNDONE!;
  }
  return OUTCOME[row.outcome] ?? { label: "Lida", tone: null, icon: Check };
}

function rowDetail(row: Row): string {
  if (row.detail) {
    const amount = row.detail.installments
      ? `${formatBRL(-row.detail.cents)} em ${row.detail.installments}x`
      : formatBRL(-row.detail.cents);
    return [amount, row.detail.category ?? row.detail.description, row.detail.wallet]
      .filter(Boolean)
      .join(" · ");
  }
  if (row.outcome === "NOT_UNDERSTOOD") return "Sem valor, data ou conta que o bot entendesse";
  if (row.outcome === "LINKED") return "Número vinculado";
  return "Proposta de um ambiente que você não vê";
}

export function RecentCard({ page, now }: { page: BotSettingsPage; now: Date }) {
  const { items, unknownToday } = page.recent;
  return (
    <section
      aria-labelledby="bot-recentes-h"
      className={cn(CARD, "order-5 md:order-none")}
      data-testid="cartao-mensagens"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="bot-recentes-h" className="text-base font-extrabold md:text-lg">
          Últimas mensagens
        </h2>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[0.8125rem]">
          <ShieldCheck aria-hidden className="size-4" />
          Sem o texto: ele é apagado depois de lido
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhuma mensagem ainda.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((row) => {
            const status = rowStatus(row);
            const Icon = status.icon;
            return (
              <li
                key={row.id}
                className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-t py-2.5 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto]"
              >
                <span className="text-muted-foreground font-mono text-[0.8125rem] tabular-nums">
                  {whenLabel(row.at, now)}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-bold">
                    {row.who}
                    {row.lastFour ? ` · final ${row.lastFour}` : ""}
                  </span>
                  <span className="text-muted-foreground text-[0.8125rem] break-words">
                    {rowDetail(row)}
                  </span>
                </span>
                {status.tone ? (
                  <ToneChip
                    tone={status.tone}
                    icon={Icon}
                    className="col-start-2 h-auto min-h-6 self-center justify-self-start py-1 whitespace-normal sm:col-start-3 sm:justify-self-end"
                  >
                    {status.label}
                  </ToneChip>
                ) : (
                  <span className="bg-muted text-muted-foreground col-start-2 inline-flex min-h-6 items-center gap-1.5 self-center justify-self-start rounded-full px-2.5 py-1 text-xs font-bold sm:col-start-3 sm:justify-self-end">
                    <Icon aria-hidden className="size-3.5" />
                    {status.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {unknownToday > 0 ? (
        <p className="text-muted-foreground text-[0.8125rem]">
          {n(unknownToday)}{" "}
          {unknownToday === 1
            ? "mensagem de número não vinculado nas últimas 24 h (ignorada, sem resposta)"
            : "mensagens de números não vinculados nas últimas 24 h (ignoradas, sem resposta)"}
        </p>
      ) : null}
      <Link href="/lancamentos/recebidos" className={cn(TEXT_LINK, "self-start text-sm font-bold")}>
        Ver as propostas em Recebidos
      </Link>
    </section>
  );
}

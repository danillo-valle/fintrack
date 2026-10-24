// A tela do código de vínculo (M11, pranchas G-Vincular e G-CelVincular; o Telegram no M12.0b,
// H-Vincular e H-CelVincular), na página inteira e no modal: no WhatsApp, os três passos com o
// número do bot e o código; no Telegram, o "Abrir no Telegram" com o código no link e o código
// para digitar como reserva. "Esperando…" e, quando a mensagem chega, "Pronto". Sem JavaScript, o
// link "Atualizar" recarrega.
import { Check, Clock, ExternalLink, Info, Send } from "lucide-react";
import { formatLinkCode } from "@fintrack/core";
import { CopyButton } from "@/components/feedback/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { LinkCodePage } from "../server/queries";
import { LinkCodeRefresher } from "./link-code-refresher";
import { StartLinkButton } from "./forms";

const TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

export function linkCodeTitle(page: LinkCodePage): string {
  if (page.status.state === "LINKED")
    return page.status.channel === "TELEGRAM"
      ? "Pronto, Telegram vinculado"
      : "Pronto, número vinculado";
  if (page.status.state === "EXPIRED") return "Esse código não vale mais";
  return page.channel === "TELEGRAM"
    ? "Abra o FinTrack no Telegram"
    : "Mande o código pelo WhatsApp";
}

/** O texto curto acima do título ("Vincular número" ou "Vincular o Telegram"). */
export function linkCodeEyebrow(page: LinkCodePage): string {
  return page.channel === "TELEGRAM" ? "Vincular o Telegram" : "Vincular número";
}

export function LinkCodeBody({ page, idPrefix = "" }: { page: LinkCodePage; idPrefix?: string }) {
  const { status } = page;
  if (status.state === "LINKED") {
    return (
      <div className="flex flex-col gap-3.5" data-testid="vinculo-pronto">
        <div role="status" className="bg-income/12 flex items-center gap-3.5 rounded-2xl p-4">
          <span className="bg-card text-income flex size-11 shrink-0 items-center justify-center rounded-xl">
            <Check aria-hidden className="size-5" />
          </span>
          <span className="flex flex-col gap-0.5">
            {status.channel === "TELEGRAM" ? (
              <strong>Telegram vinculado</strong>
            ) : (
              <strong>
                Número final <span className="font-mono tabular-nums">{status.lastFour}</span>{" "}
                vinculado
              </strong>
            )}
            <span className="text-sm">
              {status.channel === "TELEGRAM"
                ? "O bot respondeu no Telegram."
                : "O bot respondeu no seu WhatsApp."}
            </span>
          </span>
        </div>
        <p className="text-sm">
          Agora é só escrever, por exemplo{" "}
          <span className="font-mono">gastei 42,90 no mercado</span>. O ambiente, a conta e o cartão
          que ele usa ficam em Ajustes › Bot de lançamento.
        </p>
      </div>
    );
  }
  if (status.state === "EXPIRED") {
    return (
      <div className="flex flex-col gap-3.5" data-testid="vinculo-vencido">
        <p className="text-sm">
          O código vale 10 minutos e uma vez só. Gere outro e mande de novo pelo WhatsApp.
        </p>
        <StartLinkButton
          label="Gerar outro código"
          replace
          channel={page.channel === "TELEGRAM" ? "telegram" : "whatsapp"}
        />
      </div>
    );
  }
  if (page.channel === "TELEGRAM") return <TelegramWaiting page={page} idPrefix={idPrefix} />;
  const number = page.displayNumber ?? "o número do bot";
  return (
    <div className="flex flex-col gap-4" data-testid="vinculo-esperando">
      <LinkCodeRefresher />
      <ol className="flex list-decimal flex-col gap-3.5 pl-5 text-[0.9375rem] leading-relaxed">
        <li>
          No WhatsApp do <strong>seu</strong> celular, abra a conversa com o bot:
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span id={`${idPrefix}numero-bot`} className="font-mono text-lg font-bold tabular-nums">
              {number}
            </span>
            {page.displayNumber ? (
              <CopyButton
                text={page.displayNumber}
                targetId={`${idPrefix}numero-bot`}
                label="Copiar o número do bot"
              />
            ) : null}
          </div>
        </li>
        <li>
          Mande exatamente esta mensagem:
          <div className="bg-muted/50 border-primary mt-2 flex flex-wrap items-center gap-3 rounded-[0.875rem] border-[1.5px] border-dashed px-4 py-3.5">
            <span
              id={`${idPrefix}codigo`}
              className="font-mono text-2xl font-bold tracking-wide tabular-nums md:text-[1.75rem]"
              data-testid="codigo-vinculo"
            >
              vincular {formatLinkCode(status.code)}
            </span>
            <span className="ml-auto">
              <CopyButton
                text={`vincular ${formatLinkCode(status.code)}`}
                targetId={`${idPrefix}codigo`}
                label="Copiar a mensagem com o código"
                variant="default"
              />
            </span>
          </div>
          <span className="text-muted-foreground mt-1.5 block text-[0.8125rem]">
            Vale até <span className="font-mono">{TIME.format(status.expiresAt)}</span> (10 minutos)
            e uma vez só. O número que mandar é o que fica vinculado.
          </span>
        </li>
        <li>Volte aqui. A tela muda sozinha quando a mensagem chegar.</li>
      </ol>
      <div
        role="status"
        className="bg-chart-1/12 text-chart-1-ink flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-bold"
      >
        <Clock aria-hidden className="size-[1.125rem]" />
        Esperando a sua mensagem…
        <noscript>
          <a href="" className={cn(TEXT_LINK, "font-bold")}>
            Atualizar
          </a>
        </noscript>
      </div>
      {page.testNumber ? (
        <div className="bg-muted/50 flex gap-2.5 rounded-xl border px-3.5 py-3 text-[0.8125rem] leading-relaxed">
          <Info aria-hidden className="text-muted-foreground mt-0.5 size-[1.125rem] shrink-0" />
          <span>
            Com o número de teste, o seu número também precisa estar na lista de destinatários do
            painel da Meta (o manual mostra onde). Sem isso, a Meta não deixa o bot responder.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** O Telegram esperando (prancha H-Vincular): o botão com o código no link e o código de reserva. */
function TelegramWaiting({ page, idPrefix }: { page: LinkCodePage; idPrefix: string }) {
  const { status } = page;
  if (status.state !== "WAITING") return null;
  return (
    <div className="flex flex-col gap-4" data-testid="vinculo-esperando">
      <LinkCodeRefresher />
      <ol className="flex list-decimal flex-col gap-3.5 pl-5 text-[0.9375rem] leading-relaxed">
        <li>
          Toque no botão: o Telegram abre a conversa com o bot já com o código.
          <div className="mt-2.5">
            {page.telegramLink ? (
              <a
                href={page.telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="abrir-telegram"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "h-13 rounded-xl px-5 text-[1.0625rem] font-bold",
                )}
              >
                <Send aria-hidden className="size-5" />
                Abrir no Telegram
                <ExternalLink aria-hidden className="size-4 opacity-80" />
                <span className="sr-only"> (abre em outra aba)</span>
              </a>
            ) : null}
          </div>
        </li>
        <li>
          No Telegram, toque em <strong>Iniciar</strong>.
        </li>
        <li>Volte aqui. A tela muda sozinha quando o Telegram avisar.</li>
      </ol>
      <div
        role="status"
        className="bg-chart-1/12 text-chart-1-ink flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm font-bold"
      >
        <Clock aria-hidden className="size-[1.125rem]" />
        Esperando o Telegram…
        <noscript>
          <a href="" className={cn(TEXT_LINK, "font-bold")}>
            Atualizar
          </a>
        </noscript>
      </div>
      <div className="bg-muted/50 flex flex-col gap-2 rounded-[0.875rem] border px-3.5 py-3 text-sm leading-relaxed">
        <strong>Não abriu?</strong>
        <span>
          Procure <span className="font-mono">@{page.telegramUsername}</span> no Telegram e mande:
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span
            id={`${idPrefix}codigo`}
            className="font-mono text-[1.375rem] font-bold tracking-wide tabular-nums"
            data-testid="codigo-vinculo"
          >
            vincular {formatLinkCode(status.code)}
          </span>
          <span className="ml-auto">
            <CopyButton
              text={`vincular ${formatLinkCode(status.code)}`}
              targetId={`${idPrefix}codigo`}
              label="Copiar a mensagem com o código"
            />
          </span>
        </div>
        <span className="text-muted-foreground text-[0.8125rem]">
          Vale até <span className="font-mono">{TIME.format(status.expiresAt)}</span> (10 minutos) e
          uma vez só. A conta do Telegram que mandar é a que fica vinculada.
        </span>
      </div>
    </div>
  );
}

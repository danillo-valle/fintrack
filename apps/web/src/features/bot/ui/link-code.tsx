// A tela do código de vínculo (M11, pranchas G-Vincular e G-CelVincular), na página inteira e no
// modal: os três passos com o número do bot e o código, "Esperando a sua mensagem…" e, quando a
// mensagem chega, "Pronto, número vinculado". Sem JavaScript, o link "Atualizar" recarrega.
import { Check, Clock, Info } from "lucide-react";
import { formatLinkCode } from "@fintrack/core";
import { CopyButton } from "@/components/feedback/copy-button";
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
  if (page.status.state === "LINKED") return "Pronto, número vinculado";
  if (page.status.state === "EXPIRED") return "Esse código não vale mais";
  return "Mande o código pelo WhatsApp";
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
            <strong>
              Número final <span className="font-mono tabular-nums">{status.lastFour}</span>{" "}
              vinculado
            </strong>
            <span className="text-sm">O bot respondeu no seu WhatsApp.</span>
          </span>
        </div>
        <p className="text-sm">
          Agora é só escrever, por exemplo{" "}
          <span className="font-mono">gastei 42,90 no mercado</span>. O ambiente, a conta e o cartão
          que ele usa ficam em Ajustes › Bot do WhatsApp.
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
        <StartLinkButton />
      </div>
    );
  }
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

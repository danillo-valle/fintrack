"use client";

// Os formulários de Ajustes › Bot do WhatsApp (M11, prancha G-Ajustes): todos com a Server Action
// direta no <form> (ActionForm), então funcionam antes do React carregar (regra do M08).
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { SwitchButton } from "@/components/visual/switch-button";
import {
  saveBotPreferenceAction,
  setBotEnabledAction,
  startLinkAction,
  unlinkAction,
  type LinkState,
} from "../server/actions";

export function BotSwitch({ on, labelledBy }: { on: boolean; labelledBy: string }) {
  return (
    <ActionForm action={setBotEnabledAction} aria-label="Ligar ou desligar o bot do WhatsApp">
      {({ pending }) => (
        <>
          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
          <SwitchButton
            on={on}
            labelledBy={labelledBy}
            disabled={pending}
            testId="bot-interruptor"
          />
        </>
      )}
    </ActionForm>
  );
}

/**
 * "Vincular meu número" (ou "Gerar outro código"). O código novo abre na tela do código: com o
 * React, navega sozinho (o modal abre por cima de Ajustes); sem ele, aparece o link para abrir.
 *
 * `replace`: o botão que já está DENTRO da tela do código (código vencido, "Gerar outro código")
 * troca o endereço em vez de empilhar. Assim o Fechar (que volta uma página) sai para Ajustes, e
 * não para o código anterior (M12.0).
 */
export function StartLinkButton({
  label = "Vincular meu número",
  variant = "default",
  replace = false,
  channel = "whatsapp",
}: {
  label?: string;
  variant?: "default" | "outline";
  replace?: boolean;
  /** Por qual canal a pessoa vai mandar o código (M12.0b): muda as instruções da tela do código */
  channel?: "whatsapp" | "telegram";
}) {
  return (
    <ActionForm<LinkState> action={startLinkAction} initialState={INITIAL_LINK} aria-label={label}>
      {({ pending, state }) => (
        <>
          <input type="hidden" name="canal" value={channel} />
          <OpenCode url={state.codeUrl} replace={replace} />
          <Button
            type="submit"
            variant={variant}
            disabled={pending}
            className="h-11 self-start px-4"
          >
            {variant === "default" ? <Link2 aria-hidden /> : null}
            {pending ? "Gerando o código…" : label}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

const INITIAL_LINK: LinkState = { error: null, success: null, codeUrl: null };

/** Quanto a tela espera a navegação do Next antes de abrir o código pelo navegador. */
const OPEN_FALLBACK_MS = 2500;

function OpenCode({ url, replace }: { url: string | null; replace: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!url) return;
    const from = window.location.pathname + window.location.search;
    if (replace) router.replace(url);
    else router.push(url);
    // Rede de segurança (M12.0): no Safari do Danillo, o código era gerado e a tela não saía do
    // lugar. Se o endereço continua o mesmo depois do prazo, abre o código pelo navegador (a
    // página inteira do código, a mesma do link sem JavaScript).
    const timer = window.setTimeout(() => {
      if (window.location.pathname + window.location.search === from) window.location.assign(url);
    }, OPEN_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [url, replace, router]);
  if (!url) return null;
  return (
    <noscript>
      <Link href={url} className="font-bold underline">
        Abrir o código
      </Link>
    </noscript>
  );
}

export function UnlinkButton({ channel = "whatsapp" }: { channel?: "whatsapp" | "telegram" }) {
  return (
    <ActionButton
      action={unlinkAction}
      fields={{ canal: channel }}
      variant="outline"
      confirm={
        channel === "telegram"
          ? "O bot para de ler este Telegram. Desvincular?"
          : "O bot para de ler este número. Desvincular?"
      }
      confirmLabel="Sim, desvincular"
    >
      <Unlink aria-hidden />
      Desvincular
    </ActionButton>
  );
}

type Option = { id: string; name: string };

function Select({
  id,
  name,
  label,
  hint,
  emptyHint,
  options,
  value,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  /** Sem nenhuma opção (M12.1): o select fica desabilitado e diz por quê */
  emptyHint: string;
  options: Option[];
  value: string | null;
}) {
  if (options.length === 0)
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-bold">
          {label}
        </label>
        {/* Desabilitado não vai no envio: o servidor lê o campo ausente como "nenhum" */}
        <NativeSelect
          id={id}
          name={name}
          disabled
          aria-describedby={`${id}-ajuda`}
          className="h-11 w-full border-dashed"
        >
          <option value="">Nenhuma disponível</option>
        </NativeSelect>
        <span id={`${id}-ajuda`} className="text-chart-4-ink text-[0.8125rem]">
          {emptyHint}
        </span>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={value ?? ""}
        aria-describedby={`${id}-ajuda`}
        className="h-11 w-full"
      >
        <option value="">Nenhum (o bot pergunta)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
      <span id={`${id}-ajuda`} className="text-muted-foreground text-[0.8125rem]">
        {hint}
      </span>
    </div>
  );
}

export function PreferenceForm({
  wallets,
  debitAccounts,
  creditCards,
  defaults,
  hints,
}: {
  wallets: Option[];
  debitAccounts: Option[];
  creditCards: Option[];
  defaults: { walletId: string | null; debitAccountId: string | null; creditCardId: string | null };
  /** As dicas com os nomes de verdade do lar ("“na casa” na mensagem troca") */
  hints: { wallet: string; debit: string; credit: string };
}) {
  return (
    <ActionForm action={saveBotPreferenceAction} idPrefix="bot-" aria-label="Padrões do bot">
      {({ pending }) => (
        <div className="flex flex-col gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
            <Select
              id="bot-ambiente"
              name="walletId"
              label="Ambiente"
              hint={hints.wallet}
              emptyHint="Você não edita nenhum ambiente: peça o papel de editor."
              options={wallets}
              value={defaults.walletId}
            />
            <Select
              id="bot-debito"
              name="debitAccountId"
              label="Débito e pix"
              hint={hints.debit}
              emptyHint="Nenhuma conta corrente ou poupança: cadastre em Contas."
              options={debitAccounts}
              value={defaults.debitAccountId}
            />
            <Select
              id="bot-credito"
              name="creditCardId"
              label="Crédito"
              hint={hints.credit}
              emptyHint="Nenhum cartão de crédito: cadastre em Contas."
              options={creditCards}
              value={defaults.creditCardId}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={pending}
            className="h-11 self-start px-4"
          >
            {pending ? "Salvando…" : "Salvar padrões"}
          </Button>
        </div>
      )}
    </ActionForm>
  );
}

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
 */
export function StartLinkButton({
  label = "Vincular meu número",
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  return (
    <ActionForm<LinkState> action={startLinkAction} initialState={INITIAL_LINK} aria-label={label}>
      {({ pending, state }) => (
        <>
          <OpenCode url={state.codeUrl} />
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

function OpenCode({ url }: { url: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (url) router.push(url);
  }, [url, router]);
  if (!url) return null;
  return (
    <noscript>
      <Link href={url} className="font-bold underline">
        Abrir o código
      </Link>
    </noscript>
  );
}

export function UnlinkButton() {
  return (
    <ActionButton
      action={unlinkAction}
      fields={{}}
      variant="outline"
      confirm="O bot para de ler este número. Desvincular?"
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
  options,
  value,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  options: Option[];
  value: string | null;
}) {
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
              options={wallets}
              value={defaults.walletId}
            />
            <Select
              id="bot-debito"
              name="debitAccountId"
              label="Débito e pix"
              hint={hints.debit}
              options={debitAccounts}
              value={defaults.debitAccountId}
            />
            <Select
              id="bot-credito"
              name="creditCardId"
              label="Crédito"
              hint={hints.credit}
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

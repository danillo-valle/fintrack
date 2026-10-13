"use client";

// Passo 1 de 2 · Credenciais (M09.1, pranchas E-Conectar e E-CelConectar). Client ID, Client
// Secret e o Item ID de cada banco (até 5), digitados pela própria pessoa: o FinTrack nunca vê a
// senha do banco. "Testar e continuar" confere na Pluggy ANTES de gravar.
//
// O segredo é campo de senha, nunca volta preenchido: em branco = manter o que já está gravado.
import { useState } from "react";
import { Lock, Plus, X } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/features/auth/ui/password-input";
import { MAX_ITEMS } from "../schemas";
import { saveCredentialsAction } from "../server/actions";

export function CredentialsForm({
  idPrefix,
  formId,
  clientIdMasked,
  hasSecret,
  itemIds,
}: {
  idPrefix: string;
  /** id do <form> (o botão do rodapé do modal liga-se a ele) */
  formId: string;
  clientIdMasked: string | null;
  hasSecret: boolean;
  itemIds: readonly string[];
}) {
  const [items, setItems] = useState<string[]>(() => (itemIds.length > 0 ? [...itemIds] : [""]));
  // Controlados: o React limpa o formulário depois do envio, e uma recusa da Pluggy não pode
  // apagar o que a pessoa colou (o segredo, sim, volta em branco)
  const [clientId, setClientId] = useState("");
  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <ActionForm
      action={saveCredentialsAction}
      idPrefix={idPrefix}
      id={formId}
      aria-label="Credenciais do Meu Pluggy"
      className="flex flex-col gap-4"
    >
      {({ field }) => (
        <div className="flex flex-col gap-4">
          <p className="bg-muted/60 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl border p-3 text-sm">
            <Lock aria-hidden className="text-chart-1-ink size-5" />
            <span>Identidade confirmada. Esta tela fica liberada por 10 minutos.</span>
          </p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={id("clientId")} className="text-sm font-semibold">
              Client ID
            </label>
            <Input
              id={id("clientId")}
              name="clientId"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required={!clientIdMasked}
              data-msg-missing="Cole o Client ID do painel da Pluggy."
              placeholder={clientIdMasked ? `gravado: ${clientIdMasked}` : undefined}
              className="h-11 rounded-xl font-mono"
              {...field("clientId", { helpId: id("clientId-ajuda") }).props}
            />
            <FieldError id={field("clientId").errorId}>{field("clientId").error}</FieldError>
            <span id={id("clientId-ajuda")} className="text-muted-foreground text-[0.8125rem]">
              {clientIdMasked
                ? "Em branco, fica o que já está gravado. Fica no painel da Pluggy, em Aplicações."
                : "Fica no painel da Pluggy, em Aplicações."}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={id("clientSecret")} className="text-sm font-semibold">
              Client Secret
            </label>
            <PasswordInput
              id={id("clientSecret")}
              name="clientSecret"
              autoComplete="off"
              spellCheck={false}
              required={!hasSecret}
              data-msg-missing="Cole o Client Secret do painel da Pluggy."
              className="h-11 rounded-xl font-mono"
              {...field("clientSecret", { helpId: id("clientSecret-ajuda") }).props}
            />
            <FieldError id={field("clientSecret").errorId}>
              {field("clientSecret").error}
            </FieldError>
            <span id={id("clientSecret-ajuda")} className="text-muted-foreground text-[0.8125rem]">
              {hasSecret
                ? "Guardado cifrado. Em branco, fica o atual; para trocar, cole outro."
                : "Guardado cifrado. Não aparece de novo; para trocar, cole outro."}
            </span>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1.5 text-sm font-semibold">Bancos (Item ID de cada um)</legend>
            {items.map((value, index) => (
              <div
                key={index}
                className="grid grid-cols-[4rem_minmax(0,1fr)_2.75rem] items-center gap-2 md:grid-cols-[5rem_minmax(0,1fr)_2.75rem]"
              >
                <label htmlFor={id(`item-${index + 1}`)} className="text-muted-foreground text-sm">
                  Banco {index + 1}
                </label>
                <Input
                  id={id(`item-${index + 1}`)}
                  name={`item-${index + 1}`}
                  value={value}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((v, i) => (i === index ? event.target.value : v)),
                    )
                  }
                  autoComplete="off"
                  spellCheck={false}
                  pattern="[A-Za-z0-9\-]{8,64}"
                  data-msg-pattern="Item ID só tem letras, números e hífen."
                  required={index === 0}
                  data-msg-missing="Informe o Item ID de pelo menos um banco."
                  className="h-11 rounded-xl font-mono"
                  {...field(`item-${index + 1}`).props}
                />
                <button
                  type="button"
                  aria-label={`Remover banco ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  className="text-muted-foreground hover:bg-muted focus-visible:ring-ring grid size-11 place-items-center rounded-xl outline-none focus-visible:ring-3 disabled:opacity-40"
                >
                  <X aria-hidden className="size-[1.125rem]" />
                </button>
                <FieldError
                  id={field(`item-${index + 1}`).errorId}
                  className="col-start-2 col-end-4"
                >
                  {field(`item-${index + 1}`).error}
                </FieldError>
              </div>
            ))}
            {items.length < MAX_ITEMS ? (
              <button
                type="button"
                onClick={() => setItems((current) => [...current, ""])}
                className="text-chart-1-ink hover:bg-muted focus-visible:ring-ring inline-flex h-10 items-center gap-1.5 self-start rounded-xl border border-dashed px-3 text-sm font-semibold outline-none focus-visible:ring-3"
              >
                <Plus aria-hidden className="size-4" />
                Adicionar outro banco (até {MAX_ITEMS})
              </button>
            ) : null}
          </fieldset>
        </div>
      )}
    </ActionForm>
  );
}

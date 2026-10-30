"use client";

// Adicionar cartão numa conta (M07; em modal desde o M12.3a, prancha J-AdicionarCartao) e, desde o
// M13.1, Editar cartão (prancha L-EditarCartao). Só os 4 últimos dígitos: o número inteiro, a
// validade e o CVV nunca entram no FinTrack (o banco recusa qualquer coisa que não sejam 4
// dígitos). Editando, o final não muda: outro final é outro cartão. O botão fica no rodapé
// (form="…").
//
// Editando, aparece também "Compras do banco entram em": o padrão (o pessoal de quem usa um cartão
// de outra pessoa, senão o ambiente da conta) ou outro ambiente do lar de que QUEM USA participa
// (destinationChoices). A lista acompanha o "Quem usa" escolhido; o servidor confere de novo.
import { useState } from "react";
import { firstNameOf, importWalletFor } from "@fintrack/core";
import { Users } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CARD_FORM_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { createCardAction, updateCardAction } from "../server/actions";

type CardForm = "PHYSICAL" | "VIRTUAL" | "VIRTUAL_TEMPORARY";

/** O cartão que está sendo editado (M13.1), como está gravado. */
export type EditingCard = {
  id: string;
  nickname: string;
  brand: string;
  lastFour: string;
  form: CardForm;
  holderId: string | null;
  isAdditional: boolean;
  sharedPurchases: boolean;
  importWalletId: string | null;
};

type WalletOption = {
  id: string;
  name: string;
  kind: "PERSONAL" | "SHARED";
  memberIds: string[];
  ownerIds: string[];
};

/** O valor do "padrão" no select: o banco grava nulo e a regra importWalletFor decide. */
const DEFAULT = "padrao";

/**
 * O que "Compras do banco entram em" oferece para quem usa o cartão: o padrão (a mesma regra do
 * banco, importWalletFor: o pessoal de quem usa um cartão de outra pessoa, senão o ambiente da
 * conta) e os OUTROS ambientes de que quem usa participa. O ambiente que o padrão já dá não
 * aparece de novo: seriam duas escolhas com o mesmo efeito.
 */
function destinationChoices(
  editing: { account: { holderId: string | null; walletId: string }; wallets: WalletOption[] },
  holder: { userId: string; name: string },
) {
  const personalWallets = new Map(
    editing.wallets
      .filter((w) => w.kind === "PERSONAL")
      .flatMap((w) => w.ownerIds.map((owner) => [owner, w.id] as const)),
  );
  const defaultId = importWalletFor({
    account: editing.account,
    card: { holderId: holder.userId, importWalletId: null },
    personalWallets,
  }).walletId;
  return {
    defaultName:
      defaultId === editing.account.walletId
        ? (editing.wallets.find((w) => w.id === defaultId)?.name ?? "")
        : `pessoal de ${firstNameOf(holder.name)}`,
    options: editing.wallets.filter(
      (w) => w.id !== defaultId && w.memberIds.includes(holder.userId),
    ),
  };
}

const CHECKBOX =
  "accent-primary focus-visible:ring-ring size-5 shrink-0 rounded outline-none focus-visible:ring-3";

export function CardForm({
  formId,
  walletId,
  accountId,
  people,
  me,
  back,
  editing,
}: {
  formId: string;
  walletId: string;
  accountId: string;
  people: { userId: string; name: string }[];
  me: string;
  /** Para onde voltar depois de salvar: a lista de contas ou a página da conta */
  back: "contas" | "conta";
  /** Editar (M13.1): o cartão, a conta (titular e carteira) e os ambientes do lar */
  editing?: {
    card: EditingCard;
    account: { holderId: string | null; walletId: string };
    wallets: WalletOption[];
  };
}) {
  const prefix = `${formId}-`;
  const [holder, setHolder] = useState(editing?.card.holderId ?? me);
  const [destination, setDestination] = useState(editing?.card.importWalletId ?? DEFAULT);
  const holderName = people.find((p) => p.userId === holder)?.name ?? "";
  const choices = editing
    ? destinationChoices(editing, { userId: holder, name: holderName })
    : null;
  // Trocou quem usa e o ambiente escolhido deixou de valer (ou virou o padrão): volta ao padrão
  const chosen = choices?.options.some((w) => w.id === destination) ? destination : DEFAULT;

  return (
    <ActionForm
      action={editing ? updateCardAction : createCardAction}
      id={formId}
      idPrefix={prefix}
      aria-label={editing ? "Editar cartão" : "Adicionar cartão"}
      className="flex flex-col gap-4"
    >
      {({ field }) => {
        const nickname = field("nickname");
        const brand = field("brand");
        const last = field("lastFour", { helpId: `${prefix}final-help` });
        return (
          <>
            <input type="hidden" name="walletId" value={walletId} />
            {editing ? (
              <input type="hidden" name="cardId" value={editing.card.id} />
            ) : (
              <input type="hidden" name="accountId" value={accountId} />
            )}
            <input type="hidden" name="volta" value={back} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={nickname.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}apelido`}>Apelido</FieldLabel>
                <Input
                  id={`${prefix}apelido`}
                  name="nickname"
                  required
                  maxLength={60}
                  defaultValue={editing?.card.nickname}
                  data-msg-missing="Dê um apelido ao cartão."
                  className="h-10"
                  {...nickname.props}
                />
                <FieldError id={nickname.errorId}>{nickname.error}</FieldError>
              </Field>
              <Field data-invalid={brand.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}bandeira`}>Bandeira</FieldLabel>
                <Input
                  id={`${prefix}bandeira`}
                  name="brand"
                  required
                  minLength={2}
                  maxLength={30}
                  defaultValue={editing?.card.brand}
                  data-msg-missing="Informe a bandeira."
                  className="h-10"
                  {...brand.props}
                />
                <FieldError id={brand.errorId}>{brand.error}</FieldError>
              </Field>
              {editing ? (
                <Field>
                  <FieldLabel htmlFor={`${prefix}final`}>Final</FieldLabel>
                  <Input
                    id={`${prefix}final`}
                    value={`···· ${editing.card.lastFour}`}
                    readOnly
                    aria-describedby={`${prefix}final-help`}
                    className="bg-muted text-muted-foreground tabular h-10"
                  />
                  <FieldDescription id={`${prefix}final-help`}>
                    O final não muda. Outro final é outro cartão: use Adicionar cartão.
                  </FieldDescription>
                </Field>
              ) : (
                <Field data-invalid={last.error ? true : undefined}>
                  <FieldLabel htmlFor={`${prefix}final`}>Final</FieldLabel>
                  <Input
                    id={`${prefix}final`}
                    name="lastFour"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    pattern="[0-9]{4}"
                    maxLength={4}
                    data-msg-missing="Digite os 4 últimos dígitos."
                    data-msg-pattern="Digite só os 4 últimos dígitos."
                    className="h-10"
                    {...last.props}
                  />
                  <FieldDescription id={`${prefix}final-help`}>
                    Só os 4 últimos. Nunca o número inteiro, a validade ou o código de segurança.
                  </FieldDescription>
                  <FieldError id={last.errorId}>{last.error}</FieldError>
                </Field>
              )}
            </div>

            {/* Rádios nativos com cara de botões: teclado (setas) e leitor de tela sem código extra */}
            <FieldSet>
              <FieldLegend variant="label">Tipo</FieldLegend>
              <div className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1">
                {(Object.keys(CARD_FORM_LABEL) as CardForm[]).map((f) => (
                  <label
                    key={f}
                    className="has-focus-visible:ring-ring text-muted-foreground has-checked:bg-card has-checked:text-foreground flex min-h-10 cursor-pointer items-center justify-center rounded-[0.5625rem] px-2 text-center text-sm font-semibold has-checked:font-bold has-checked:shadow-[0_1px_4px_rgb(10_13_40/0.12)] has-focus-visible:ring-3"
                  >
                    <input
                      type="radio"
                      name="form"
                      value={f}
                      defaultChecked={(editing?.card.form ?? "PHYSICAL") === f}
                      className="sr-only"
                    />
                    {CARD_FORM_LABEL[f]}
                  </label>
                ))}
              </div>
            </FieldSet>

            <div className={cn("grid gap-4", editing && "sm:grid-cols-2")}>
              <Field>
                <FieldLabel htmlFor={`${prefix}portador`}>Quem usa (portador)</FieldLabel>
                <NativeSelect
                  id={`${prefix}portador`}
                  name="holderId"
                  value={holder}
                  onChange={(event) => setHolder(event.target.value)}
                  aria-describedby={editing ? `${prefix}portador-help` : undefined}
                  className="h-10"
                >
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
                {editing ? (
                  <FieldDescription id={`${prefix}portador-help`}>
                    Muda o Pago por e para onde vão as compras do banco.
                  </FieldDescription>
                ) : null}
              </Field>
              {editing ? (
                <Field>
                  <FieldLabel htmlFor={`${prefix}destino`}>Compras do banco entram em</FieldLabel>
                  <NativeSelect
                    id={`${prefix}destino`}
                    name="importWalletId"
                    value={chosen}
                    onChange={(event) => setDestination(event.target.value)}
                    aria-describedby={`${prefix}destino-help`}
                    className="h-10"
                  >
                    <option value={DEFAULT}>Padrão: {choices?.defaultName}</option>
                    {choices?.options.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription id={`${prefix}destino-help`}>
                    Só os ambientes de que {firstNameOf(holderName) || "quem usa"} participa.
                  </FieldDescription>
                </Field>
              ) : null}
            </div>

            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="isAdditional"
                defaultChecked={editing?.card.isAdditional}
                className={CHECKBOX}
              />
              Cartão adicional (o portador lança com ele sem ver o resto da fatura)
            </label>
            <label className="flex min-h-11 items-start gap-3 rounded-xl bg-[color-mix(in_srgb,var(--chart-5)_14%,transparent)] px-3.5 py-3 text-sm">
              <input
                type="checkbox"
                name="sharedPurchases"
                defaultChecked={editing?.card.sharedPurchases}
                className={cn(CHECKBOX, "mt-0.5")}
              />
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <Users aria-hidden className="size-4" />
                  Compras conjuntas
                </span>
                <span className="text-muted-foreground">
                  Em Pago por, as compras deste cartão aparecem como Compartilhado.
                </span>
              </span>
            </label>
            {editing ? (
              <p className="bg-muted rounded-xl px-3.5 py-3 text-sm">
                Os recebidos deste cartão que ainda não foram confirmados vão na hora para o
                ambiente escolhido. O que já foi confirmado não muda.
              </p>
            ) : null}
          </>
        );
      }}
    </ActionForm>
  );
}

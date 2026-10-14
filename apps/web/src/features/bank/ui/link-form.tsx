"use client";

// Passo 2 de 2 · Ligar as contas (M09.1, pranchas E-Ligar e E-CelLigar). Para cada conta que a
// Pluggy devolveu: ligar a uma conta do FinTrack (já vem sugerida pelo final do cartão ou pelo
// nome), criar uma conta nova ou não importar. Embaixo de um cartão com adicional de outra pessoa:
// "Compras do final 0003 (Caio) entram em [ambiente]" (padrão: o ambiente pessoal dela).
// E a data de corte: nada do banco antes dela entra.
import { useState } from "react";
import { CheckCircle2, CreditCard, Landmark, MoveRight } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToneChip } from "@/components/visual/tone-chip";
import { linkAccountsAction } from "../server/actions";

type Kind = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";

export type LinkFormData = {
  bank: {
    externalId: string;
    kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
    name: string;
    number: string | null;
    institution: string | null;
    suggestion: { accountId: string; reason: string } | null;
  }[];
  accounts: {
    id: string;
    name: string;
    kind: Kind;
    walletName: string;
    walletKind: "PERSONAL" | "SHARED";
    sharedPurchases: boolean;
    linkedElsewhere: boolean;
    cards: {
      id: string;
      lastFour: string;
      holderId: string | null;
      holderName: string | null;
      importWalletId: string | null;
      otherHolder: boolean;
    }[];
  }[];
  wallets: {
    id: string;
    name: string;
    kind: "PERSONAL" | "SHARED";
    memberIds: string[];
    ownerIds: string[];
  }[];
  importFrom: string;
  today: string;
};

const COMPATIBLE: Record<LinkFormData["bank"][number]["kind"], Kind[]> = {
  CHECKING: ["CHECKING", "SAVINGS"],
  SAVINGS: ["SAVINGS", "CHECKING"],
  CREDIT_CARD: ["CREDIT_CARD"],
};

const REASON: Record<string, string> = {
  LAST_FOUR: "pelo final",
  NAME: "pelo nome",
  LINKED: "ligada antes",
};

function defaultChoice(b: LinkFormData["bank"][number]): string {
  if (b.suggestion) return `existing:${b.suggestion.accountId}`;
  return b.kind === "SAVINGS" ? "skip" : "new";
}

const firstName = (name: string | null) => (name ?? "").split(" ")[0] || "outra pessoa";

/** Mínimo da data de corte: 12 meses atrás (o que o banco guarda de cartão). */
function minDate(today: string) {
  const [y, m, d] = today.split("-").map((n) => Number.parseInt(n, 10)) as [number, number, number];
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function LinkForm({
  data,
  idPrefix,
  formId,
}: {
  data: LinkFormData;
  idPrefix: string;
  formId: string;
}) {
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.bank.map((b) => [b.externalId, defaultChoice(b)])),
  );
  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <ActionForm
      action={linkAccountsAction}
      idPrefix={idPrefix}
      id={formId}
      aria-label="Ligar as contas"
      className="flex flex-col gap-4"
    >
      {({ field }) => (
        <>
          <p className="text-[0.9375rem]">
            A Pluggy devolveu {data.bank.length} {data.bank.length === 1 ? "conta" : "contas"}. Diga
            onde cada uma entra no FinTrack.
          </p>
          <ul className="divide-y">
            {data.bank.map((b, index) => {
              const choice = choices[b.externalId] ?? defaultChoice(b);
              const accountId = choice.startsWith("existing:") ? choice.slice(9) : null;
              const account = data.accounts.find((a) => a.id === accountId) ?? null;
              const options = data.accounts.filter(
                (a) => COMPATIBLE[b.kind].includes(a.kind) && !a.linkedElsewhere,
              );
              const extra = account?.cards.filter((c) => c.otherHolder) ?? [];
              const selectId = id(`conta-${index}`);
              return (
                <li
                  key={b.externalId}
                  className="flex flex-col gap-2.5 py-3 md:grid md:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1.15fr)] md:items-center md:gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="bg-muted grid size-[2.125rem] shrink-0 place-items-center rounded-[0.625rem] [&_svg]:size-[1.125rem]"
                    >
                      {b.kind === "CREDIT_CARD" ? <CreditCard /> : <Landmark />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <label htmlFor={selectId} className="truncate text-[0.9375rem] font-semibold">
                        {b.institution ? `${b.institution} · ` : ""}
                        {b.name}
                      </label>
                      <span className="text-muted-foreground tabular font-mono text-xs">
                        {b.kind === "CREDIT_CARD"
                          ? `cartão final ${b.number ?? "—"}`
                          : `conta ${b.number ? `···· ${b.number.slice(-4)}` : "—"}`}
                      </span>
                    </span>
                  </span>
                  <MoveRight
                    aria-hidden
                    className="text-muted-foreground hidden size-[1.125rem] md:block"
                  />
                  <span className="flex flex-col gap-1.5">
                    <NativeSelect
                      id={selectId}
                      name={`conta:${b.externalId}`}
                      value={choice}
                      onChange={(event) =>
                        setChoices((current) => ({
                          ...current,
                          [b.externalId]: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl px-2.5"
                    >
                      {options.map((a) => (
                        <option key={a.id} value={`existing:${a.id}`}>
                          {a.name} (
                          {a.sharedPurchases
                            ? `compras da ${a.walletName}`
                            : `ambiente ${a.walletName}`}
                          )
                        </option>
                      ))}
                      <option value="new">Criar uma conta nova</option>
                      <option value="skip">Não importar</option>
                    </NativeSelect>
                    <span>
                      {b.suggestion && choice === `existing:${b.suggestion.accountId}` ? (
                        <ToneChip tone={5} icon={CheckCircle2}>
                          sugerido {REASON[b.suggestion.reason] ?? ""}
                          {b.suggestion.reason === "LAST_FOUR" && b.number ? ` ${b.number}` : ""}
                        </ToneChip>
                      ) : !b.suggestion ? (
                        <span className="text-muted-foreground text-xs">sem par parecido</span>
                      ) : null}
                    </span>
                  </span>
                  {extra.length > 0 ? (
                    <div className="flex flex-col gap-2 md:col-span-3">
                      {extra.map((card) => {
                        const cardSelect = id(`cartao-${card.id}`);
                        const allowed = data.wallets.filter(
                          (w) => !card.holderId || w.memberIds.includes(card.holderId),
                        );
                        return (
                          <div
                            key={card.id}
                            className="bg-muted/50 grid gap-1.5 rounded-xl border px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-center md:gap-3"
                          >
                            <label htmlFor={cardSelect} className="text-sm">
                              Compras do adicional final{" "}
                              <span className="tabular font-mono">{card.lastFour}</span> (
                              {firstName(card.holderName)}) entram em
                            </label>
                            <NativeSelect
                              id={cardSelect}
                              name={`cartao:${card.id}`}
                              defaultValue={card.importWalletId ?? "padrao"}
                              className="h-11 rounded-xl px-2.5"
                            >
                              <option value="padrao">
                                Padrão: ambiente pessoal de {firstName(card.holderName)}
                              </option>
                              {allowed.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </NativeSelect>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={id("importFrom")} className="text-sm font-semibold">
              Importar a partir de
            </label>
            <Input
              id={id("importFrom")}
              name="importFrom"
              type="date"
              defaultValue={data.importFrom}
              min={minDate(data.today)}
              max={data.today}
              required
              data-msg-missing="Escolha a data a partir da qual importar."
              className="h-11 max-w-[14rem] rounded-xl"
              {...field("importFrom", { helpId: id("importFrom-ajuda") }).props}
            />
            <FieldError id={field("importFrom").errorId}>{field("importFrom").error}</FieldError>
            <span id={id("importFrom-ajuda")} className="text-muted-foreground text-[0.8125rem]">
              Antes desta data nada entra. Os seus lançamentos manuais anteriores ficam como estão.
            </span>
          </div>
        </>
      )}
    </ActionForm>
  );
}

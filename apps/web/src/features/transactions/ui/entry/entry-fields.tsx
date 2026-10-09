"use client";

// Os blocos do formulário de lançamento, na ordem do desenho (canvas C.2):
//   Tipo · Valor e Data · Descrição · Categoria e Ambiente · Pagamento · Mais opções
// Cada bloco lê e escreve o estado pelo useEntry(); nenhum guarda estado próprio.
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MoneyInput } from "@/components/money/money-input";
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
import { KIND_LABEL, METHOD_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useEntry, useEntryRefs } from "./entry-provider";

const CONTROL = "h-[2.875rem] rounded-xl";

/** Despesa, Receita e o caminho para Transferência, num seletor só. */
export function KindField() {
  const e = useEntry();
  return (
    <FieldSet>
      <FieldLegend className="sr-only">Tipo</FieldLegend>
      <div className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1">
        {/* Rádios nativos: teclado (setas) e leitor de tela funcionam sem código extra */}
        {(["expense", "income"] as const).map((option) => (
          <label
            key={option}
            className={cn(
              "has-focus-visible:ring-ring flex h-[2.375rem] cursor-pointer items-center justify-center rounded-[0.5625rem] text-sm font-semibold has-focus-visible:ring-3",
              e.kind === option
                ? "bg-card font-bold shadow-[0_1px_4px_rgb(10_13_40/0.12)]"
                : "text-muted-foreground",
              e.kind === option && option === "expense" && "text-expense",
              e.kind === option && option === "income" && "text-income",
            )}
          >
            <input
              type="radio"
              name="kind"
              value={option}
              checked={e.kind === option}
              onChange={() => e.setKind(option)}
              className="sr-only"
            />
            {KIND_LABEL[option]}
          </label>
        ))}
        {/* Transferência é outro formulário (duas contas, sem categoria): um link, não um rádio */}
        {e.editing ? null : (
          <Link
            href="/lancamentos/transferencia"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-[2.375rem] items-center justify-center gap-1.5 rounded-[0.5625rem] text-sm font-semibold outline-none focus-visible:ring-3"
          >
            Transferência
          </Link>
        )}
      </div>
    </FieldSet>
  );
}

/** Valor (grande, com o foco) e data, lado a lado. */
export function AmountAndDateFields() {
  const e = useEntry();
  const { amountRef } = useEntryRefs();
  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2.5 md:gap-3">
      <Field data-invalid={e.errors.amount ? true : undefined}>
        <FieldLabel htmlFor={e.fid("amount")}>Valor</FieldLabel>
        <MoneyInput
          ref={amountRef}
          id={e.fid("amount")}
          name="amount"
          value={e.cents}
          autoFocus={!e.editing}
          onValueChange={(value) => {
            e.setCents(value);
            if (value > 0n) e.setErrors((x) => ({ ...x, amount: undefined }));
          }}
          aria-invalid={e.errors.amount ? true : undefined}
          aria-describedby={e.errors.amount ? e.fid("amount-error") : e.fid("amount-help")}
          className="focus-visible:border-ring h-[3.25rem] rounded-xl border-2 text-left text-[1.375rem] font-bold md:text-2xl"
        />
        {e.errors.amount ? (
          <FieldError id={e.fid("amount-error")}>{e.errors.amount}</FieldError>
        ) : (
          <FieldDescription id={e.fid("amount-help")} className="sr-only">
            Digite só os números. 1234 vira R$ 12,34.
          </FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={e.fid("occurredOn")}>Data</FieldLabel>
        <Input
          id={e.fid("occurredOn")}
          name="occurredOn"
          type="date"
          value={e.occurredOn}
          onChange={(event) => e.setOccurredOn(event.target.value)}
          // O campo de data tem partes (dia, mês, ano, calendário): o anel vale para todas
          className="focus-within:border-ring focus-within:ring-ring h-[3.25rem] rounded-xl focus-within:ring-3"
        />
      </Field>
    </div>
  );
}

export function DescriptionField() {
  const e = useEntry();
  const { descriptionRef } = useEntryRefs();
  return (
    <Field data-invalid={e.errors.description ? true : undefined}>
      <FieldLabel htmlFor={e.fid("description")}>Descrição</FieldLabel>
      <Input
        ref={descriptionRef}
        id={e.fid("description")}
        name="description"
        value={e.description}
        maxLength={200}
        onChange={(event) => {
          e.setDescription(event.target.value);
          if (event.target.value.trim() !== "")
            e.setErrors((x) => ({ ...x, description: undefined }));
        }}
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={e.errors.description ? true : undefined}
        aria-describedby={e.errors.description ? e.fid("description-error") : undefined}
        className={CONTROL}
      />
      {e.errors.description ? (
        <FieldError id={e.fid("description-error")}>{e.errors.description}</FieldError>
      ) : null}
    </Field>
  );
}

/** O que é (categoria, com a sugestão da cascata) e de quem é (ambiente). */
export function ClassificationFields() {
  const e = useEntry();
  const suggestedName = e.suggestion
    ? e.options.categories.find((c) => c.id === e.suggestion?.categoryId)?.name
    : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2.5 md:gap-3">
        <Field>
          <FieldLabel htmlFor={e.fid("categoryId")}>Categoria</FieldLabel>
          <NativeSelect
            id={e.fid("categoryId")}
            name="categoryId"
            value={e.categoryId}
            onChange={(event) => e.chooseCategory(event.target.value)}
            aria-describedby={e.fid("category-help")}
            className={CONTROL}
          >
            <option value="">Sem categoria</option>
            {e.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={e.errors.walletId ? true : undefined}>
          <FieldLabel htmlFor={e.fid("walletId")}>Ambiente</FieldLabel>
          <NativeSelect
            id={e.fid("walletId")}
            name="walletId"
            value={e.walletId}
            onChange={(event) => e.setWalletId(event.target.value)}
            aria-invalid={e.errors.walletId ? true : undefined}
            aria-describedby={e.errors.walletId ? e.fid("wallet-error") : undefined}
            className={CONTROL}
          >
            {e.options.wallets.length === 0 ? <option value="">Nenhum ambiente</option> : null}
            {e.options.wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          {e.errors.walletId ? (
            <FieldError id={e.fid("wallet-error")}>{e.errors.walletId}</FieldError>
          ) : null}
        </Field>
      </div>
      {/* aria-live: quem usa leitor de tela ouve a sugestão chegar */}
      <p
        id={e.fid("category-help")}
        aria-live="polite"
        className="text-muted-foreground text-[0.8125rem]"
      >
        {e.suggestion && suggestedName ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles aria-hidden className="size-3.5" />
            Sugerida: {suggestedName} ({e.suggestion.reason})
          </span>
        ) : e.categories.length === 0 ? (
          "Crie categorias em Ajustes > Categorias."
        ) : (
          "Escreva a descrição: o FinTrack sugere a categoria."
        )}
      </p>
      {e.correcting && e.options.canManageCategories ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="rememberRule"
            className="accent-primary focus-visible:ring-ring size-4 rounded outline-none focus-visible:ring-3"
          />
          Sempre categorizar assim
        </label>
      ) : null}
    </div>
  );
}

/** Valor do "Pago com": a conta, ou a conta e um cartão dela ("conta:cartão"). */
const paymentValue = (accountId: string, cardId: string) =>
  cardId ? `${accountId}:${cardId}` : accountId;

/**
 * O bloco do pagamento: com o que foi pago (conta e cartão num campo só). O M07.4 acrescenta
 * aqui quem pagou e as parcelas.
 */
export function PaymentFields({ children }: { children?: React.ReactNode }) {
  const e = useEntry();
  const { paymentRef } = useEntryRefs();
  return (
    <div className="bg-muted/50 flex flex-col gap-2.5 rounded-2xl border p-3 md:p-3.5">
      <Field data-invalid={e.errors.payment ? true : undefined}>
        <FieldLabel htmlFor={e.fid("payment")}>Pago com</FieldLabel>
        <NativeSelect
          ref={paymentRef}
          id={e.fid("payment")}
          value={paymentValue(e.accountId, e.cardId)}
          onChange={(event) => {
            const [accountId = "", cardId = ""] = event.target.value.split(":");
            e.choosePayment(accountId, cardId);
          }}
          aria-invalid={e.errors.payment ? true : undefined}
          aria-describedby={e.errors.payment ? e.fid("payment-error") : undefined}
          className={CONTROL}
        >
          {e.options.accounts.length === 0 ? <option value="">Nenhuma conta</option> : null}
          {e.options.accounts.map((a) =>
            a.cards.length === 0 ? (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ) : (
              <optgroup key={a.id} label={a.name}>
                <option value={a.id}>{a.name} · sem cartão específico</option>
                {a.cards.map((c) => (
                  <option key={c.id} value={paymentValue(a.id, c.id)}>
                    {c.nickname} final {c.lastFour}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </NativeSelect>
        {/* O servidor recebe os dois campos de sempre */}
        <input type="hidden" name="accountId" value={e.accountId} />
        <input type="hidden" name="cardId" value={e.cardId} />
        {e.errors.payment ? (
          <FieldError id={e.fid("payment-error")}>{e.errors.payment}</FieldError>
        ) : null}
      </Field>
      {children}
    </div>
  );
}

/** Forma de pagamento e observação: raramente mudam, então ficam recolhidas. */
export function MoreOptionsFields() {
  const e = useEntry();
  return (
    <details className="group rounded-xl" open={e.editing}>
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded text-sm font-semibold outline-none focus-visible:ring-3">
        Mais opções: forma de pagamento e observação
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={e.fid("method")}>Forma de pagamento</FieldLabel>
          <NativeSelect
            id={e.fid("method")}
            name="method"
            value={e.method}
            onChange={(event) => e.setMethod(event.target.value)}
            className={CONTROL}
          >
            <option value="">
              Automática{e.automaticMethod ? ` (${METHOD_LABEL[e.automaticMethod]})` : ""}
            </option>
            {e.methods.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={e.fid("notes")}>Observação</FieldLabel>
          <Input
            id={e.fid("notes")}
            name="notes"
            maxLength={500}
            defaultValue={e.existing?.notes ?? ""}
            className={CONTROL}
          />
        </Field>
      </div>
    </details>
  );
}

"use client";

// Os blocos do formulário de lançamento, na ordem do desenho (canvas C.2):
//   Tipo · Valor e Data · Descrição · Tipo da despesa · Categoria e Ambiente · Pagamento ·
//   Mais opções
// (A prancha do computador põe o Tipo da despesa logo abaixo das abas; a do celular, depois da
// Descrição. Fica uma ordem só, a do celular: ordem visual diferente da ordem do HTML confunde o
// Tab (WCAG 2.4.3), e o Valor primeiro mantém o lançamento em menos de 10 s.)
// Cada bloco lê e escreve o estado pelo useEntry(); nenhum guarda estado próprio. As medidas são
// as do desenho, apertadas o bastante para o modal caber numa tela de 720 px de altura.
import Link from "next/link";
import { Layers, ReceiptText, Repeat, Sparkles, type LucideIcon } from "lucide-react";
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
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PayerTile } from "../payer-tile";
import { useEntry, useEntryRefs, type ExpenseType } from "./entry-provider";

const CONTROL = "h-[2.625rem] rounded-xl";
const MAX_INSTALLMENTS = 24;

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
              "has-focus-visible:ring-ring compact:h-[2.125rem] flex h-[2.375rem] cursor-pointer items-center justify-center rounded-[0.5625rem] text-sm font-semibold has-focus-visible:ring-3",
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
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring compact:h-[2.125rem] flex h-[2.375rem] items-center justify-center rounded-[0.5625rem] text-sm font-semibold outline-none focus-visible:ring-3"
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
          className="focus-visible:border-ring compact:h-[2.625rem] h-12 rounded-xl border-2 text-left text-[1.375rem] font-bold md:text-2xl"
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
          className="focus-within:border-ring focus-within:ring-ring compact:h-[2.625rem] h-12 rounded-xl focus-within:ring-3"
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

const EXPENSE_TYPES: { value: ExpenseType; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "variable", label: "Variável", hint: "compra do dia a dia", icon: ReceiptText },
  { value: "installment", label: "Parcelada", hint: "divide nas faturas", icon: Layers },
  { value: "fixed", label: "Fixa", hint: "repete todo mês", icon: Repeat },
];

/**
 * Tipo da despesa (M07.4): só numa despesa nova. Não vira coluna no banco: "parcelada" cria as
 * parcelas ligadas a um grupo e "fixa" cria a recorrência (ADR-004 e ADR-009).
 */
export function ExpenseTypeField() {
  const e = useEntry();
  if (e.editing || e.kind !== "expense") return null;
  return (
    <FieldSet>
      <FieldLegend variant="label">Tipo da despesa</FieldLegend>
      <div className="grid grid-cols-3 gap-2">
        {EXPENSE_TYPES.map(({ value, label, hint, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "has-focus-visible:ring-ring compact:h-10 flex h-[3.25rem] cursor-pointer items-center gap-2.5 rounded-xl border px-3 has-focus-visible:ring-3",
              e.expenseType === value
                ? "border-chart-1 bg-[color-mix(in_srgb,var(--chart-1)_12%,transparent)]"
                : "hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name="expenseType"
              value={value}
              checked={e.expenseType === value}
              onChange={() => e.setExpenseType(value)}
              className="sr-only"
            />
            <Icon aria-hidden className="text-chart-1 size-[1.125rem] shrink-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                className={cn("text-sm", e.expenseType === value ? "font-bold" : "font-semibold")}
              >
                {label}
              </span>
              <span className="text-muted-foreground compact:hidden hidden truncate text-xs md:block">
                {hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </FieldSet>
  );
}

/** O que é (categoria, com a sugestão da cascata) e de quem é (ambiente). */
export function ClassificationFields() {
  const e = useEntry();
  const suggestedName = e.suggestion
    ? e.options.categories.find((c) => c.id === e.suggestion?.categoryId)?.name
    : null;
  return (
    <div className="flex flex-col gap-1.5">
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
      {/* aria-live: quem usa leitor de tela ouve a sugestão chegar. Vazio, não ocupa espaço. */}
      <p
        id={e.fid("category-help")}
        aria-live="polite"
        className="text-muted-foreground text-[0.8125rem] empty:hidden"
      >
        {e.suggestion && suggestedName ? (
          <span className="inline-flex items-center gap-1">
            <Sparkles aria-hidden className="size-3.5" />
            Sugerida: {suggestedName} ({e.suggestion.reason})
          </span>
        ) : e.categories.length === 0 ? (
          "Crie categorias em Ajustes > Categorias."
        ) : null}
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
 * O bloco do pagamento: com o que foi pago (conta e cartão num campo só), quem pagou (calculado,
 * não se escolhe: segue o cartão ou a conta) e, conforme o tipo da despesa, as parcelas ou o
 * vencimento da despesa fixa.
 */
export function PaymentFields() {
  const e = useEntry();
  const { paymentRef } = useEntryRefs();
  const isExpense = e.kind === "expense";
  return (
    // Duas linhas, como no canvas C.2: [Pago com | Pago por] e, na parcelada, [Parcelas | plano].
    // Na segunda linha, o plano ganha mais espaço que o seletor de parcelas (2:3, como no desenho).
    <div className="bg-muted/50 compact:gap-2 compact:p-2.5 flex flex-col gap-2.5 rounded-2xl border p-3 md:p-3.5">
      <div className="grid gap-2.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-3">
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
                      {c.sharedPurchases ? " · compras conjuntas" : ""}
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
        <PayerPreview />
      </div>
      {isExpense && e.expenseType === "installment" ? (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-end gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-3">
          <InstallmentsField />
          <InstallmentsPreview />
        </div>
      ) : null}
      {isExpense && e.expenseType === "fixed" ? <FixedFields /> : null}
    </div>
  );
}

/**
 * "Pago por": calculado, não é campo. No computador, um rótulo em cima e o quadrado com o nome
 * (como a coluna ao lado do "Pago com"); no celular, uma linha só: [CP] Pago por Compartilhado ·
 * vem do cartão. O grupo tem o mesmo nome nos dois ("Pago por").
 */
function PayerPreview() {
  const e = useEntry();
  const origin = e.cardId ? "vem do cartão" : "vem da conta";
  return (
    <div className="compact:gap-1 flex flex-col gap-2">
      <span id={e.fid("payer-label")} className="hidden text-sm font-medium md:block">
        Pago por
      </span>
      <div
        role="group"
        aria-labelledby={e.fid("payer-label")}
        className="flex items-center gap-2.5 md:h-[2.625rem]"
      >
        {e.payer ? (
          <>
            <PayerTile payer={e.payer} className="size-9 rounded-[0.6875rem] text-[0.8125rem]" />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-tight md:flex-col md:flex-nowrap md:items-start">
              <span className="truncate text-sm font-bold">
                <span className="md:hidden">Pago por </span>
                {e.payer.name}
              </span>
              <span className="text-muted-foreground text-xs">
                <span aria-hidden className="md:hidden">
                  ·{" "}
                </span>
                {origin}
              </span>
            </span>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            <span className="md:hidden">Pago por: </span>sem titular cadastrado
          </span>
        )}
      </div>
    </div>
  );
}

function InstallmentsField() {
  const e = useEntry();
  return (
    <Field>
      <FieldLabel htmlFor={e.fid("installments")}>Parcelas</FieldLabel>
      <NativeSelect
        id={e.fid("installments")}
        name="installments"
        value={String(e.installments)}
        onChange={(event) => e.setInstallments(Number.parseInt(event.target.value, 10))}
        aria-describedby={e.fid("installments-help")}
        className={CONTROL}
      >
        {Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, i) => i + 2).map((n) => (
          <option key={n} value={n}>
            {n}x
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

const monthName = (referenceMonth: string, month: "long" | "short") =>
  new Intl.DateTimeFormat("pt-BR", { month, timeZone: "UTC" }).format(
    new Date(`${referenceMonth}-01T12:00:00Z`),
  );

/**
 * O plano, calculado pelo core: o valor de cada parcela em cima e as faturas embaixo.
 *   R$ 14,13 + 2 × R$ 14,11
 *   Faturas de novembro a janeiro. A sobra de centavos vai na 1ª.   (no celular: "de nov. a jan.")
 */
function InstallmentsPreview() {
  const e = useEntry();
  const plan = e.plan;
  return (
    <p
      id={e.fid("installments-help")}
      aria-live="polite"
      className="text-muted-foreground flex min-h-[2.625rem] flex-col justify-center text-[0.8125rem] leading-snug"
    >
      {!e.canInstall ? (
        'Parcelada só no cartão de crédito com fechamento e vencimento: escolha um em "Pago com".'
      ) : plan && plan.length > 0 ? (
        <>
          <span className="text-foreground tabular font-semibold">
            {formatBRL(-plan[0]!.amount)}
            {plan.length > 1
              ? plan[1]!.amount === plan[0]!.amount
                ? ` × ${plan.length}`
                : ` + ${plan.length - 1} × ${formatBRL(-plan[1]!.amount)}`
              : ""}
          </span>
          <span className="md:hidden">
            {`Faturas de ${monthName(plan[0]!.referenceMonth, "short")} a ${monthName(plan.at(-1)!.referenceMonth, "short")}`}
          </span>
          <span className="hidden md:inline">
            {`Faturas de ${monthName(plan[0]!.referenceMonth, "long")} a ${monthName(plan.at(-1)!.referenceMonth, "long")}. A sobra de centavos vai na 1ª.`}
          </span>
        </>
      ) : (
        "Digite o valor total da compra: o FinTrack divide nas faturas."
      )}
    </p>
  );
}

/** Despesa fixa: conta fixa ou assinatura, o dia do vencimento e, se acabar, até quando. */
function FixedFields() {
  const e = useEntry();
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1.2fr)_6rem_minmax(0,1fr)] md:gap-3">
      <Field className="col-span-2 md:col-span-1">
        <FieldLabel htmlFor={e.fid("fixedKind")}>É uma</FieldLabel>
        <NativeSelect
          id={e.fid("fixedKind")}
          name="fixedKind"
          defaultValue="FIXED_BILL"
          className={CONTROL}
        >
          <option value="FIXED_BILL">Conta fixa (aluguel, internet…)</option>
          <option value="SUBSCRIPTION">Assinatura (streaming, academia…)</option>
        </NativeSelect>
      </Field>
      <Field data-invalid={e.errors.dueDay ? true : undefined}>
        <FieldLabel htmlFor={e.fid("dueDay")}>Vence dia</FieldLabel>
        <Input
          id={e.fid("dueDay")}
          name="dueDay"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          value={Number.isNaN(e.dueDay) ? "" : e.dueDay}
          onChange={(event) => e.setDueDay(Number.parseInt(event.target.value, 10))}
          aria-invalid={e.errors.dueDay ? true : undefined}
          aria-describedby={e.errors.dueDay ? e.fid("dueDay-error") : undefined}
          className={CONTROL}
        />
        {e.errors.dueDay ? (
          <FieldError id={e.fid("dueDay-error")}>{e.errors.dueDay}</FieldError>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={e.fid("endsOn")}>Até (opcional)</FieldLabel>
        <Input
          id={e.fid("endsOn")}
          name="endsOn"
          type="date"
          min={e.occurredOn}
          className="focus-within:border-ring focus-within:ring-ring h-[2.625rem] rounded-xl focus-within:ring-3"
        />
      </Field>
      <p className="text-muted-foreground compact:hidden col-span-2 text-[0.8125rem] md:col-span-3">
        Lança este mês agora; os próximos saem da recorrência, sem cadastrar um a um.
      </p>
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

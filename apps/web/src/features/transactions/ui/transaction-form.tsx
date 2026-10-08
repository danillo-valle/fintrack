"use client";

// O formulário de lançamento (M07): o lançamento rápido em /lancamentos/novo e a edição em
// /lancamentos/[id].
//
// Lançamento rápido em três toques: digitar o valor, digitar a descrição, salvar. O resto já
// vem preenchido: a categoria SUGERIDA pela cascata (regra → histórico) enquanto a pessoa
// digita, a conta e a carteira do último lançamento, a data de hoje e a forma de pagamento
// padrão da conta. "Mais opções" guarda data, forma, cartão e observação.
//
// A sugestão é só uma ajuda na tela: ao salvar, o servidor roda a cascata DE NOVO para saber se
// a pessoa aceitou a sugestão (categorizedBy) ou corrigiu (exemplo de treino).
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { allowedMethods, defaultMethod, type AccountKind, type CivilDate } from "@fintrack/core";
import { undoToast } from "@/components/feedback/undo-toast";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormAlert } from "@/features/auth/ui/form-alert";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { focusAfterToast } from "@/lib/focus";
import { KIND_LABEL, METHOD_LABEL } from "@/lib/labels";
import { decimalToCents, formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  createTransactionAction,
  deleteTransactionAction,
  suggestCategoryAction,
  updateTransactionAction,
  type EntryState,
} from "../server/actions";

type Kind = "expense" | "income";

export type EntryOptions = {
  wallets: { id: string; name: string }[];
  accounts: {
    id: string;
    name: string;
    kind: AccountKind;
    walletName: string;
    cards: { id: string; nickname: string; lastFour: string }[];
  }[];
  categories: { id: string; name: string; kind: "EXPENSE" | "INCOME"; parentName: string | null }[];
  canManageCategories: boolean;
  defaults: { walletId: string | null; accountId: string | null; occurredOn: CivilDate };
};

/** Valores de um lançamento que já existe (edição). */
export type ExistingTransaction = {
  id: string;
  kind: Kind;
  cents: bigint;
  description: string;
  occurredOn: CivilDate;
  walletId: string;
  accountId: string;
  categoryId: string | null;
  method: string;
  cardId: string | null;
  notes: string | null;
};

type Errors = { amount?: string; description?: string; accountId?: string; walletId?: string };
type Suggestion = { categoryId: string; reason: string } | null;

const INITIAL_ENTRY: EntryState = { ...INITIAL_ACTION_STATE, created: null, version: 0 };

export function TransactionForm({
  options,
  existing,
  idPrefix = "",
}: {
  options: EntryOptions;
  existing?: ExistingTransaction;
  /** Prefixo dos ids dos campos: o modal usa "modal-" para não repetir os ids da página atrás. */
  idPrefix?: string;
}) {
  const editing = existing !== undefined;
  const fid = (name: string) => `${idPrefix}${name}`;
  const [kind, setKind] = useState<Kind>(existing?.kind ?? "expense");
  const [cents, setCents] = useState<bigint>(existing?.cents ?? 0n);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [categoryTouched, setCategoryTouched] = useState(editing);
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? options.defaults.accountId ?? "",
  );
  const [walletId, setWalletId] = useState(existing?.walletId ?? options.defaults.walletId ?? "");
  const [method, setMethod] = useState(existing?.method ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(
    createTransactionAction,
    INITIAL_ENTRY,
  );
  const [updateState, updateAction, updating] = useActionState<ActionState, FormData>(
    updateTransactionAction,
    INITIAL_ACTION_STATE,
  );
  const state: ActionState = editing ? updateState : createState;
  const pending = editing ? updating : creating;

  const account = options.accounts.find((a) => a.id === accountId) ?? null;
  const categoryKind = kind === "expense" ? "EXPENSE" : "INCOME";
  const categories = useMemo(
    () => options.categories.filter((c) => c.kind === categoryKind),
    [options.categories, categoryKind],
  );
  const methods = account ? allowedMethods(account.kind) : [];
  const automaticMethod = account ? defaultMethod(account.kind, kind) : null;
  // A categoria escolhida corrige algo (a sugestão, ou a categoria que já estava gravada)?
  const shown = description.trim().length >= 2 ? suggestion : null;
  const reference = editing ? (existing?.categoryId ?? null) : (shown?.categoryId ?? null);
  const correcting = categoryId !== "" && reference !== null && categoryId !== reference;

  // ── Sugestão enquanto a pessoa digita (espera 350 ms sem digitar) ──
  useEffect(() => {
    if (description.trim().length < 2) return; // descrição curta: a tela ignora a sugestão
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await suggestCategoryAction({ description, kind });
        setSuggestion(found ? { categoryId: found.categoryId, reason: found.reason } : null);
        // A sugestão só preenche a categoria se a pessoa ainda não escolheu uma
        if (found && !categoryTouched) setCategoryId(found.categoryId);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [description, kind, categoryTouched]);

  // ── Depois de salvar (lançamento rápido): limpa, avisa e oferece "Desfazer" ──
  const lastVersion = useRef(0);
  useEffect(() => {
    const created = createState.created;
    if (editing || createState.version === lastVersion.current || !created) return;
    lastVersion.current = createState.version;
    const saved = { kind, cents, description, categoryId, categoryTouched };
    setCents(0n);
    setDescription("");
    setCategoryId("");
    setCategoryTouched(false);
    setSuggestion(null);
    amountRef.current?.focus();
    const label = created.kind === "expense" ? "Despesa" : "Receita";
    undoToast(`${label} de ${formatBRL(decimalToCents(created.amount))} registrada`, {
      variant: "success",
      description: created.description,
      onUndo: () => {
        const data = new FormData();
        data.set("transactionId", created.id);
        startTransition(async () => {
          const result = await deleteTransactionAction(INITIAL_ACTION_STATE, data);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          // O que foi salvo volta para o formulário, para corrigir e salvar de novo
          setKind(saved.kind);
          setCents(saved.cents);
          setDescription(saved.description);
          setCategoryId(saved.categoryId);
          setCategoryTouched(saved.categoryTouched);
          setErrors({});
          toast("Lançamento desfeito");
          focusAfterToast(() => amountRef.current);
        });
      },
    });
    // Só reage a um salvamento novo (version); os valores lidos são os do momento do envio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createState.version]);

  function changeKind(next: Kind) {
    setKind(next);
    // Categoria de despesa não serve numa receita: limpa e deixa a cascata sugerir de novo
    setCategoryId("");
    setCategoryTouched(false);
    setMethod("");
  }

  function validate(): boolean {
    const found: Errors = {};
    if (cents <= 0n) found.amount = "Informe um valor maior que zero.";
    if (description.trim() === "")
      found.description = "Descreva o lançamento, por exemplo: Mercado.";
    if (!accountId) found.accountId = "Escolha a conta.";
    if (!walletId) found.walletId = "Escolha a carteira.";
    setErrors(found);
    if (found.amount) amountRef.current?.focus();
    else if (found.description) descriptionRef.current?.focus();
    else if (found.accountId) accountRef.current?.focus();
    return Object.keys(found).length === 0;
  }

  const suggestedName = shown
    ? options.categories.find((c) => c.id === shown.categoryId)?.name
    : null;

  return (
    <form
      ref={formRef}
      action={editing ? updateAction : createAction}
      noValidate
      className="max-w-md"
      onSubmit={(event) => {
        if (!validate()) event.preventDefault();
      }}
    >
      <FormAlert message={state.error} />
      {editing ? (
        <FormAlert message={state.error ? null : state.success} variant="success" />
      ) : null}
      {existing ? <input type="hidden" name="transactionId" value={existing.id} /> : null}
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Tipo</FieldLegend>
          {/* Rádios nativos: teclado (setas) e leitor de tela funcionam sem código extra */}
          <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
            {(["expense", "income"] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  "has-focus-visible:ring-ring flex h-10 cursor-pointer items-center justify-center rounded-md text-sm font-medium has-focus-visible:ring-3",
                  kind === option && "bg-background shadow-sm",
                  kind === option && option === "expense" && "text-expense",
                  kind === option && option === "income" && "text-income",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => changeKind(option)}
                  className="sr-only"
                />
                {KIND_LABEL[option]}
              </label>
            ))}
          </div>
        </FieldSet>

        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor={fid("amount")}>Valor</FieldLabel>
          <MoneyInput
            ref={amountRef}
            id={fid("amount")}
            name="amount"
            value={cents}
            autoFocus={!editing}
            onValueChange={(value) => {
              setCents(value);
              if (value > 0n) setErrors((e) => ({ ...e, amount: undefined }));
            }}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? fid("amount-error") : fid("amount-help")}
            className="h-12 text-lg"
          />
          {errors.amount ? (
            <FieldError id={fid("amount-error")}>{errors.amount}</FieldError>
          ) : (
            <FieldDescription id={fid("amount-help")}>
              Digite só os números. 1234 vira R$ 12,34.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor={fid("description")}>Descrição</FieldLabel>
          <Input
            ref={descriptionRef}
            id={fid("description")}
            name="description"
            value={description}
            maxLength={200}
            onChange={(event) => {
              setDescription(event.target.value);
              if (event.target.value.trim() !== "")
                setErrors((e) => ({ ...e, description: undefined }));
            }}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? fid("description-error") : undefined}
            className="h-10"
          />
          {errors.description ? (
            <FieldError id={fid("description-error")}>{errors.description}</FieldError>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor={fid("categoryId")}>Categoria</FieldLabel>
          <NativeSelect
            id={fid("categoryId")}
            name="categoryId"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setCategoryTouched(true);
            }}
            aria-describedby={fid("category-help")}
            className="h-10"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentName ? `${c.parentName} › ${c.name}` : c.name}
              </option>
            ))}
          </NativeSelect>
          {/* aria-live: quem usa leitor de tela ouve a sugestão chegar */}
          <FieldDescription id={fid("category-help")} aria-live="polite">
            {shown && suggestedName ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles aria-hidden className="size-3.5" />
                Sugerida: {suggestedName} ({shown.reason})
              </span>
            ) : categories.length === 0 ? (
              "Crie categorias em Ajustes > Categorias."
            ) : (
              "Escreva a descrição: o FinTrack sugere a categoria pelas suas regras e pelo histórico."
            )}
          </FieldDescription>
          {correcting && options.canManageCategories ? (
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="rememberRule"
                className="accent-primary focus-visible:ring-ring size-4 rounded outline-none focus-visible:ring-3"
              />
              Sempre categorizar assim
            </label>
          ) : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.accountId ? true : undefined}>
            <FieldLabel htmlFor={fid("accountId")}>Conta</FieldLabel>
            <NativeSelect
              ref={accountRef}
              id={fid("accountId")}
              name="accountId"
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setMethod("");
                setErrors((e) => ({ ...e, accountId: undefined }));
              }}
              aria-invalid={errors.accountId ? true : undefined}
              aria-describedby={errors.accountId ? fid("account-error") : undefined}
              className="h-10"
            >
              {options.accounts.length === 0 ? <option value="">Nenhuma conta</option> : null}
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {errors.accountId ? (
              <FieldError id={fid("account-error")}>{errors.accountId}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={errors.walletId ? true : undefined}>
            <FieldLabel htmlFor={fid("walletId")}>Carteira</FieldLabel>
            <NativeSelect
              id={fid("walletId")}
              name="walletId"
              value={walletId}
              onChange={(event) => setWalletId(event.target.value)}
              aria-invalid={errors.walletId ? true : undefined}
              aria-describedby={errors.walletId ? fid("wallet-error") : fid("wallet-help")}
              className="h-10"
            >
              {options.wallets.length === 0 ? <option value="">Nenhuma carteira</option> : null}
              {options.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
            {errors.walletId ? (
              <FieldError id={fid("wallet-error")}>{errors.walletId}</FieldError>
            ) : (
              <FieldDescription id={fid("wallet-help")}>De quem é o gasto</FieldDescription>
            )}
          </Field>
        </div>

        <details className="bg-card rounded-lg border px-4 py-2" open={editing}>
          <summary className="focus-visible:ring-ring cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-3">
            Mais opções: data, forma de pagamento, cartão, observação
          </summary>
          <div className="mt-3 flex flex-col gap-4 pb-2">
            <Field>
              <FieldLabel htmlFor={fid("occurredOn")}>Data</FieldLabel>
              <Input
                id={fid("occurredOn")}
                name="occurredOn"
                type="date"
                defaultValue={existing?.occurredOn ?? options.defaults.occurredOn}
                className="focus-within:border-ring focus-within:ring-ring h-10 focus-within:ring-3"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={fid("method")}>Forma de pagamento</FieldLabel>
              <NativeSelect
                id={fid("method")}
                name="method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className="h-10"
              >
                <option value="">
                  Automática{automaticMethod ? ` (${METHOD_LABEL[automaticMethod]})` : ""}
                </option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {account && account.cards.length > 0 ? (
              <Field>
                <FieldLabel htmlFor={fid("cardId")}>Cartão</FieldLabel>
                <NativeSelect
                  id={fid("cardId")}
                  name="cardId"
                  defaultValue={existing?.cardId ?? ""}
                  key={account.id}
                  className="h-10"
                >
                  <option value="">Sem cartão específico</option>
                  {account.cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nickname} (final {c.lastFour})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor={fid("notes")}>Observação</FieldLabel>
              <Input
                id={fid("notes")}
                name="notes"
                maxLength={500}
                defaultValue={existing?.notes ?? ""}
                className="h-10"
              />
            </Field>
          </div>
        </details>

        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? "Salvando…" : editing ? "Salvar alterações" : "Salvar lançamento"}
        </Button>
      </FieldGroup>
    </form>
  );
}

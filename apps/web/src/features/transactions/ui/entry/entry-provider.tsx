"use client";

// O estado do formulário de lançamento (M07.3). Fica num provider, e não dentro do <form>,
// porque partes do lançamento aparecem fora dele: o subtítulo do modal ("No ambiente Casa") e o
// rodapé com Cancelar e Salvar, que no celular fica fixo embaixo do painel. Todos leem o mesmo
// estado por useEntry(); o <form> (EntryForm) e o botão de salvar (EntrySubmit, ligado pelo
// atributo form=) continuam um formulário só para o navegador.
//
// Regras que moram aqui (e não espalhadas pelos campos): a sugestão de categoria enquanto a pessoa
// digita, a validação antes de enviar e o "Desfazer" depois de salvar.
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { allowedMethods, defaultMethod, type AccountKind, type CivilDate } from "@fintrack/core";
import { undoToast } from "@/components/feedback/undo-toast";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { focusAfterToast } from "@/lib/focus";
import { decimalToCents, formatBRL } from "@/lib/money";
import {
  createTransactionAction,
  deleteTransactionAction,
  suggestCategoryAction,
  updateTransactionAction,
  type EntryState,
} from "../../server/actions";

export type Kind = "expense" | "income";

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

export type EntryErrors = {
  amount?: string;
  description?: string;
  payment?: string;
  walletId?: string;
};
type Suggestion = { categoryId: string; reason: string } | null;

const INITIAL_ENTRY: EntryState = { ...INITIAL_ACTION_STATE, created: null, version: 0 };

function useEntryValue({
  options,
  existing,
  idPrefix,
}: {
  options: EntryOptions;
  existing?: ExistingTransaction;
  idPrefix: string;
}) {
  const editing = existing !== undefined;
  const formId = `${idPrefix}entry-${useId()}`;
  const fid = (name: string) => `${idPrefix}${name}`;

  const [kind, setKindState] = useState<Kind>(existing?.kind ?? "expense");
  const [cents, setCents] = useState<bigint>(existing?.cents ?? 0n);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [occurredOn, setOccurredOn] = useState<string>(
    existing?.occurredOn ?? options.defaults.occurredOn,
  );
  const [categoryId, setCategoryIdState] = useState(existing?.categoryId ?? "");
  const [categoryTouched, setCategoryTouched] = useState(editing);
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [accountId, setAccountIdState] = useState(
    existing?.accountId ?? options.defaults.accountId ?? "",
  );
  const [cardId, setCardId] = useState(existing?.cardId ?? "");
  const [walletId, setWalletId] = useState(existing?.walletId ?? options.defaults.walletId ?? "");
  const [method, setMethod] = useState(existing?.method ?? "");
  const [errors, setErrors] = useState<EntryErrors>({});
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLSelectElement>(null);
  const [, startTransition] = useTransition();

  const [createState, createAction, creating] = useActionState(
    createTransactionAction,
    INITIAL_ENTRY,
  );
  const [updateState, updateAction, updating] = useActionState<ActionState, FormData>(
    updateTransactionAction,
    INITIAL_ACTION_STATE,
  );

  const account = options.accounts.find((a) => a.id === accountId) ?? null;
  const wallet = options.wallets.find((w) => w.id === walletId) ?? null;
  const categoryKind = kind === "expense" ? "EXPENSE" : "INCOME";
  const categories = useMemo(
    () => options.categories.filter((c) => c.kind === categoryKind),
    [options.categories, categoryKind],
  );
  // A sugestão só vale com pelo menos 2 letras de descrição
  const shown = description.trim().length >= 2 ? suggestion : null;
  const reference = editing ? (existing?.categoryId ?? null) : (shown?.categoryId ?? null);

  // ── Sugestão enquanto a pessoa digita (espera 350 ms sem digitar) ──
  useEffect(() => {
    if (description.trim().length < 2) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await suggestCategoryAction({ description, kind });
        setSuggestion(found ? { categoryId: found.categoryId, reason: found.reason } : null);
        // A sugestão só preenche a categoria se a pessoa ainda não escolheu uma
        if (found && !categoryTouched) setCategoryIdState(found.categoryId);
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
    setCategoryIdState("");
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
          setKindState(saved.kind);
          setCents(saved.cents);
          setDescription(saved.description);
          setCategoryIdState(saved.categoryId);
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

  function setKind(next: Kind) {
    setKindState(next);
    // Categoria de despesa não serve numa receita: limpa e deixa a cascata sugerir de novo
    setCategoryIdState("");
    setCategoryTouched(false);
    setMethod("");
  }

  function chooseCategory(id: string) {
    setCategoryIdState(id);
    setCategoryTouched(true);
  }

  /** "Pago com": a conta e, se houver, o cartão dela, escolhidos juntos. */
  function choosePayment(nextAccountId: string, nextCardId: string) {
    setAccountIdState(nextAccountId);
    setCardId(nextCardId);
    setMethod("");
    setErrors((e) => ({ ...e, payment: undefined }));
  }

  function validate(): boolean {
    const found: EntryErrors = {};
    if (cents <= 0n) found.amount = "Informe um valor maior que zero.";
    if (description.trim() === "")
      found.description = "Descreva o lançamento, por exemplo: Mercado.";
    if (!accountId) found.payment = "Escolha com o que foi pago.";
    if (!walletId) found.walletId = "Escolha o ambiente.";
    setErrors(found);
    if (found.amount) amountRef.current?.focus();
    else if (found.description) descriptionRef.current?.focus();
    else if (found.payment) paymentRef.current?.focus();
    return Object.keys(found).length === 0;
  }

  return {
    editing,
    existing,
    options,
    formId,
    fid,
    action: editing ? updateAction : createAction,
    state: (editing ? updateState : createState) as ActionState,
    pending: editing ? updating : creating,
    kind,
    setKind,
    cents,
    setCents,
    description,
    setDescription,
    occurredOn,
    setOccurredOn,
    categoryId,
    chooseCategory,
    categories,
    suggestion: shown,
    correcting: categoryId !== "" && reference !== null && categoryId !== reference,
    accountId,
    cardId,
    account,
    choosePayment,
    walletId,
    setWalletId,
    wallet,
    method,
    setMethod,
    methods: account ? allowedMethods(account.kind) : [],
    automaticMethod: account ? defaultMethod(account.kind, kind) : null,
    errors,
    setErrors,
    validate,
    // Fora do valor do contexto (o compilador do React não deixa ler refs durante a renderização)
    refs: { amountRef, descriptionRef, paymentRef },
  };
}

type Built = ReturnType<typeof useEntryValue>;
export type EntryValue = Omit<Built, "refs">;
export type EntryRefs = Built["refs"];

const EntryContext = createContext<EntryValue | null>(null);
const EntryRefsContext = createContext<EntryRefs | null>(null);

export function useEntry(): EntryValue {
  const value = useContext(EntryContext);
  if (!value) throw new Error("useEntry fora do EntryProvider");
  return value;
}

/** Os campos que recebem o foco quando há erro (valor, descrição e "pago com"). */
export function useEntryRefs(): EntryRefs {
  const value = useContext(EntryRefsContext);
  if (!value) throw new Error("useEntryRefs fora do EntryProvider");
  return value;
}

export function EntryProvider({
  options,
  existing,
  idPrefix = "",
  children,
}: {
  options: EntryOptions;
  existing?: ExistingTransaction;
  /** Prefixo dos ids: o modal usa "modal-" para não repetir os ids da página atrás dele */
  idPrefix?: string;
  children: React.ReactNode;
}) {
  const { refs, ...value } = useEntryValue({ options, existing, idPrefix });
  return (
    <EntryRefsContext value={refs}>
      <EntryContext value={value}>{children}</EntryContext>
    </EntryRefsContext>
  );
}

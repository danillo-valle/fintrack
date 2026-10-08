// Validação das entradas de lançamentos (zod) e os filtros da lista (guardados na URL).
// O servidor é quem decide: os formulários repetem os limites em atributos HTML só para ajudar
// quem digita. Nada do formulário é confiável, nem o <select> de forma de pagamento.
import {
  decimalToCents,
  isCivilDate,
  MAX_ABS_CENTS,
  monthRange,
  PAYMENT_METHODS,
  TRANSFER_METHODS,
  type CivilDate,
  type PaymentMethod,
} from "@fintrack/core";
import { z } from "zod";

// O z.enum quer uma lista com pelo menos um item no tipo; as constantes do core são listas comuns
const methods = (list: readonly PaymentMethod[]) => list as [PaymentMethod, ...PaymentMethod[]];

// ── Peças ───────────────────────────────────────────────────────────────────────

/** Vazio vira null (o <select> "Sem categoria" manda ""); senão, um uuid. */
const optionalUuid = z
  .union([z.literal(""), z.uuid()])
  .default("")
  .transform((v) => v || null);

const civilDate = (message = "Use uma data válida.") =>
  z.string().refine((v) => isCivilDate(v), message);

/** O valor chega do MoneyInput como texto decimal ("1234.56"), sempre positivo. */
const positiveCents = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Informe um valor maior que zero.")
  .transform((v) => decimalToCents(v))
  .refine((c) => c > 0n, "Informe um valor maior que zero.")
  .refine((c) => c <= MAX_ABS_CENTS, "Valor grande demais.");

const description = z
  .string()
  .trim()
  .min(1, "Descreva o lançamento, por exemplo: Mercado.")
  .max(200, "Use no máximo 200 caracteres.");

const checkbox = z
  .literal("on")
  .optional()
  .transform((v) => v === "on");

// ── Lançamento ──────────────────────────────────────────────────────────────────

export const transactionSchema = z.object({
  kind: z.enum(["expense", "income"], { error: "Escolha despesa ou receita." }),
  amount: positiveCents,
  description,
  occurredOn: civilDate(),
  walletId: z.uuid("Escolha a carteira."),
  accountId: z.uuid("Escolha a conta."),
  categoryId: optionalUuid,
  method: z
    .union([z.literal(""), z.enum(methods(PAYMENT_METHODS))])
    .default("")
    .transform((v) => v || null),
  cardId: optionalUuid,
  notes: z
    .string()
    .trim()
    .max(500, "Use no máximo 500 caracteres.")
    .default("")
    .transform((v) => v || null),
  /** "Sempre categorizar assim" (só faz algo quando a categoria corrige a sugestão) */
  rememberRule: checkbox,
});

export const transactionIdSchema = z.object({ transactionId: z.uuid() });

/** O que a tela pede enquanto a pessoa digita a descrição. */
export const suggestSchema = z.object({
  description: z.string().trim().min(1).max(200),
  kind: z.enum(["expense", "income"]),
});

export const transferSchema = z
  .object({
    fromAccountId: z.uuid("Escolha a conta de onde o dinheiro sai."),
    toAccountId: z.uuid("Escolha a conta para onde o dinheiro vai."),
    amount: positiveCents,
    occurredOn: civilDate(),
    description: z
      .string()
      .trim()
      .max(200, "Use no máximo 200 caracteres.")
      .default("")
      .transform((v) => v || "Transferência"),
    method: z.enum(methods(TRANSFER_METHODS)).default("TRANSFER"),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: "Escolha duas contas diferentes.",
    path: ["toAccountId"],
  });

// ── Recorrência ─────────────────────────────────────────────────────────────────

export const recurrenceSchema = z
  .object({
    kind: z.enum(["FIXED_BILL", "SUBSCRIPTION", "INCOME"], { error: "Escolha o tipo." }),
    description,
    amount: positiveCents,
    dayOfMonth: z.coerce
      .number({ error: "Dia de 1 a 31." })
      .int("Dia de 1 a 31.")
      .min(1, "Dia de 1 a 31.")
      .max(31, "Dia de 1 a 31."),
    startsOn: civilDate(),
    endsOn: z
      .union([z.literal(""), civilDate()])
      .default("")
      .transform((v) => v || null),
    walletId: z.uuid("Escolha a carteira."),
    accountId: z.uuid("Escolha a conta."),
    categoryId: optionalUuid,
  })
  .refine((r) => !r.endsOn || r.endsOn >= r.startsOn, {
    message: "O fim precisa ser depois do início.",
    path: ["endsOn"],
  });

export const recurrenceIdSchema = z.object({ walletId: z.uuid(), recurrenceId: z.uuid() });

export const generateSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido."),
});

// ── Filtros da lista (na URL) ───────────────────────────────────────────────────

export type TransactionTypeFilter = "expense" | "income" | "transfer";

/** O mesmo formato que o @fintrack/db recebe (TransactionFilters). */
export type ListFilters = {
  from: CivilDate;
  to: CivilDate;
  accountId: string | null;
  categoryId: string | null;
  text: string | null;
  type: TransactionTypeFilter | null;
};

export type ParsedFilters = {
  filters: ListFilters;
  walletId: string | null;
  cursor: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, TransactionTypeFilter> = {
  despesa: "expense",
  receita: "income",
  transferencia: "transfer",
};
const TYPE_PARAM: Record<TransactionTypeFilter, string> = {
  expense: "despesa",
  income: "receita",
  transfer: "transferencia",
};

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;
const idOrNull = (value: string | null) => (value && UUID.test(value) ? value.toLowerCase() : null);

/**
 * Lê os filtros da URL. Os nomes são em português porque aparecem na barra de endereço:
 *   /lancamentos?de=2026-10-01&ate=2026-10-31&carteira=<id>&conta=<id>&categoria=<id|sem>&q=mercado&tipo=despesa
 * Nada aqui é confiável: valor fora do formato é ignorado (cai no padrão), nunca vira erro.
 * O id de carteira passa depois pelo escopo do servidor: carteira alheia = lista vazia.
 */
export function parseFilters(params: SearchParams, today: CivilDate): ParsedFilters {
  const month = monthRange(today);
  let from = one(params.de);
  let to = one(params.ate);
  from = from && isCivilDate(from) ? from : month.from;
  to = to && isCivilDate(to) ? to : month.to;
  if (from > to) [from, to] = [to, from];

  const category = one(params.categoria);
  const text = one(params.q);
  return {
    filters: {
      from,
      to,
      accountId: idOrNull(one(params.conta)),
      categoryId: category === "sem" ? "none" : idOrNull(category),
      text: text ? text.slice(0, 100) : null,
      type: TYPES[one(params.tipo) ?? ""] ?? null,
    },
    walletId: idOrNull(one(params.carteira)),
    cursor: one(params.cursor),
  };
}

/** O contrário: monta a URL de volta (próxima página, limpar um filtro, exportar o mesmo). */
export function filtersToQuery(
  parsed: { filters: ListFilters; walletId: string | null },
  extra: Record<string, string | null> = {},
): string {
  const { filters: f, walletId } = parsed;
  const query = new URLSearchParams();
  query.set("de", f.from);
  query.set("ate", f.to);
  if (walletId) query.set("carteira", walletId);
  if (f.accountId) query.set("conta", f.accountId);
  if (f.categoryId) query.set("categoria", f.categoryId === "none" ? "sem" : f.categoryId);
  if (f.text) query.set("q", f.text);
  if (f.type) query.set("tipo", TYPE_PARAM[f.type]);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) query.delete(key);
    else query.set(key, value);
  }
  return query.toString();
}

/** Exportar: a carteira (obrigatória, só o dono exporta) e o mesmo período e filtros da lista. */
export const exportSchema = z.object({
  walletId: z.uuid("Escolha a carteira."),
  from: civilDate("Use uma data de início válida."),
  to: civilDate("Use uma data de fim válida."),
});

// Validação das entradas de lançamentos (zod) e os filtros da lista (guardados na URL).
// O servidor é quem decide: os formulários repetem os limites em atributos HTML só para ajudar
// quem digita. Nada do formulário é confiável, nem o <select> de forma de pagamento.
import {
  BUSINESS_DAY_MAX,
  cleanText,
  dayOfMonth,
  decimalToCents,
  EXPENSE_NATURES,
  addMonths,
  firstDayOf,
  monthOf,
  isCivilDate,
  MAX_ABS_CENTS,
  parsePayerParam,
  payerParam,
  PAYMENT_METHODS,
  RECURRENCE_AMOUNT_RULES,
  STATED_INSTALLMENTS_MAX,
  TRANSFER_METHODS,
  type CategorizationSource,
  type CivilDate,
  type DateRange,
  type ExpenseNature,
  type MonthKey,
  type PayerFilter,
  type PaymentMethod,
  type RecurrenceAmountRule,
  type RecurrenceSettings,
} from "@fintrack/core";
import { z } from "zod";
import { textField } from "@/lib/text-field";

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

const description = textField()
  .trim()
  .min(1, "Descreva o lançamento, por exemplo: Mercado.")
  .max(200, "Use no máximo 200 caracteres.");

const checkbox = z
  .literal("on")
  .optional()
  .transform((v) => v === "on");

// ── Fixa ou variável (M13.3b, ADR-026) ─────────────────────────────────────────

const expenseNature = z.enum(EXPENSE_NATURES as [ExpenseNature, ...ExpenseNature[]]);

/**
 * O tipo da despesa escolhido numa tela: os botões Fixa/Variável chegam já marcados com o tipo de
 * agora, e `natureBefore` diz qual era. Só o que a pessoa TROCOU vira marca; igual ao de antes,
 * fica indefinido (a compra continua seguindo a categoria, se seguia).
 */
export const natureChoiceSchema = z
  .object({ nature: expenseNature.optional(), natureBefore: expenseNature.optional() })
  .transform(({ nature, natureBefore }) => ({
    nature: nature && nature !== natureBefore ? nature : undefined,
  }));

/** O tipo num toque (a etiqueta da lista): o lançamento, o tipo e "as próximas desta loja também". */
export const setNatureSchema = z
  .object({ transactionId: z.uuid(), rememberRule: checkbox })
  .and(natureChoiceSchema);

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
  notes: textField()
    .trim()
    .max(500, "Use no máximo 500 caracteres.")
    .default("")
    .transform((v) => v || null),
  /**
   * "O que foi" (M13.2): só vale num lançamento do banco, do OFX ou do PDF (o servidor confere a
   * origem). Neles a descrição é a da origem e não muda; o nome da pessoa vem aqui
   */
  label: textField()
    .trim()
    .max(200, "Use no máximo 200 caracteres.")
    .default("")
    .transform((v) => v || null),
  /** "Sempre categorizar assim" (só faz algo quando a categoria corrige a sugestão) */
  rememberRule: checkbox,
});

/** O máximo da tela para parcelas (o mesmo MAX_INSTALLMENTS do @fintrack/db). */
export const MAX_INSTALLMENTS_UI = 24;

const dayOfMonthField = z.coerce
  .number({ error: "Dia de 1 a 31." })
  .int("Dia de 1 a 31.")
  .min(1, "Dia de 1 a 31.")
  .max(31, "Dia de 1 a 31.");

/**
 * O novo lançamento (M07.4): o lançamento de sempre e o "Tipo da despesa". Variável é o de
 * sempre; parcelada pede o número de parcelas; fixa pede o tipo (conta fixa ou assinatura), o
 * dia do vencimento e, se houver, até quando. Os campos de um tipo são ignorados nos outros.
 */
export const newEntrySchema = transactionSchema
  .extend({
    expenseType: z.enum(["variable", "installment", "fixed"]).default("variable"),
    installments: z.coerce
      .number({ error: `De 2 a ${MAX_INSTALLMENTS_UI} parcelas.` })
      .int(`De 2 a ${MAX_INSTALLMENTS_UI} parcelas.`)
      .min(2, `De 2 a ${MAX_INSTALLMENTS_UI} parcelas.`)
      .max(MAX_INSTALLMENTS_UI, `De 2 a ${MAX_INSTALLMENTS_UI} parcelas.`)
      .optional(),
    fixedKind: z.enum(["FIXED_BILL", "SUBSCRIPTION"]).default("FIXED_BILL"),
    dueDay: dayOfMonthField.optional(),
    endsOn: z
      .union([z.literal(""), civilDate()])
      .default("")
      .transform((v) => v || null),
  })
  .refine((e) => e.kind === "expense" || e.expenseType === "variable", {
    message: "Só despesa é parcelada ou fixa.",
    path: ["expenseType"],
  })
  .refine((e) => e.expenseType !== "installment" || e.installments !== undefined, {
    message: `Escolha de 2 a ${MAX_INSTALLMENTS_UI} parcelas.`,
    path: ["installments"],
  })
  .refine((e) => e.expenseType !== "fixed" || e.dueDay !== undefined, {
    message: "Informe o dia do vencimento.",
    path: ["dueDay"],
  })
  .refine((e) => !e.endsOn || e.endsOn >= e.occurredOn, {
    message: "O fim precisa ser depois do lançamento.",
    path: ["endsOn"],
  });

export const transactionIdSchema = z.object({ transactionId: z.uuid() });

/** O que a tela pede enquanto a pessoa digita a descrição. */
export const suggestSchema = z.object({
  description: textField().trim().min(1).max(200),
  kind: z.enum(["expense", "income"]),
});

export const transferSchema = z
  .object({
    fromAccountId: z.uuid("Escolha a conta de onde o dinheiro sai."),
    toAccountId: z.uuid("Escolha a conta para onde o dinheiro vai."),
    amount: positiveCents,
    occurredOn: civilDate(),
    description: textField()
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

// ── O que se repete (M13.3c, ADR-027) ───────────────────────────────────────────

/** "2026-12" (o campo de mês) vira o último dia do mês; vazio é sem data para acabar. */
const monthEnd = z
  .union([z.literal(""), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use um mês válido.")])
  .default("")
  .transform((v) => (v ? dayOfMonth(v as MonthKey, 31) : null));

/**
 * O valor e o dia de uma recorrência (Repete todo mês e Mudar o valor). O valor fixo só vale (e só
 * é exigido) com "Um valor fixo"; o dia útil vai até o 23º. O resto da regra é do core
 * (recurrenceSettingsValid), conferida de novo no servidor.
 */
export const recurrenceSettingsSchema = z
  .object({
    amountRule: z.enum(
      RECURRENCE_AMOUNT_RULES as [RecurrenceAmountRule, ...RecurrenceAmountRule[]],
      {
        error: "Escolha como prever o valor.",
      },
    ),
    // O valor do MoneyInput ("1234.56"); vazio fora de "Um valor fixo"
    fixed: z
      .string()
      .trim()
      .regex(/^(\d{1,12}(\.\d{1,2})?)?$/, "Informe um valor maior que zero.")
      .default(""),
    dayRule: z.enum(["DAY", "BUSINESS_DAY"], { error: "Escolha quando cai." }),
    day: z.coerce
      .number({ error: "Dia de 1 a 31." })
      .int("Dia de 1 a 31.")
      .min(1, "Dia de 1 a 31.")
      .max(31, "Dia de 1 a 31."),
    endsOn: monthEnd,
  })
  .refine((s) => s.dayRule !== "BUSINESS_DAY" || s.day <= BUSINESS_DAY_MAX, {
    message: `O dia útil vai do 1º ao ${BUSINESS_DAY_MAX}º.`,
    path: ["day"],
  })
  .transform((s, ctx): RecurrenceSettings => {
    let fixed: bigint | null = null;
    if (s.amountRule === "FIXED") {
      const parsed = positiveCents.safeParse(s.fixed);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Informe um valor maior que zero.",
          path: ["fixed"],
        });
        return z.NEVER;
      }
      fixed = parsed.data;
    }
    return { amountRule: s.amountRule, fixed, dayRule: s.dayRule, day: s.day, endsOn: s.endsOn };
  });

/** Mudar o valor (Fixas e parcelas): a carteira e a recorrência, com o valor e o dia. */
export const updateRecurrenceSchema = recurrenceIdSchema.and(recurrenceSettingsSchema);

const statedInstallmentSchema = z
  .object({
    installmentNumber: z.coerce
      .number({ error: "Informe a parcela." })
      .int("Informe a parcela.")
      .min(1, "A parcela começa em 1."),
    installmentCount: z.coerce
      .number({ error: `De 2 a ${STATED_INSTALLMENTS_MAX} parcelas.` })
      .int(`De 2 a ${STATED_INSTALLMENTS_MAX} parcelas.`)
      .min(2, `De 2 a ${STATED_INSTALLMENTS_MAX} parcelas.`)
      .max(STATED_INSTALLMENTS_MAX, `De 2 a ${STATED_INSTALLMENTS_MAX} parcelas.`),
  })
  .refine((i) => i.installmentNumber <= i.installmentCount, {
    message: "A parcela não passa do total.",
    path: ["installmentNumber"],
  });

/**
 * O tipo de um lançamento que já existe (O-Parcelada, O-ReceitaFixa): Fixa com o valor e o dia,
 * Variável, ou Parcelada com a parcela e o total. Os campos de um tipo são ignorados nos outros.
 */
export function parseEntryType(formData: FormData) {
  const entries = Object.fromEntries(formData);
  const base = z
    .object({
      transactionId: z.uuid(),
      type: z.enum(["FIXED", "VARIABLE", "INSTALLMENT"], { error: "Escolha o tipo." }),
      rememberRule: checkbox,
    })
    .safeParse(entries);
  if (!base.success) return base;
  const { transactionId, type, rememberRule } = base.data;
  if (type === "FIXED") {
    const settings = recurrenceSettingsSchema.safeParse(entries);
    if (!settings.success) return settings;
    return {
      success: true as const,
      data: { transactionId, rememberRule, choice: { type, settings: settings.data } as const },
    };
  }
  if (type === "INSTALLMENT") {
    const parcel = statedInstallmentSchema.safeParse(entries);
    if (!parcel.success) return parcel;
    return {
      success: true as const,
      data: {
        transactionId,
        rememberRule,
        choice: {
          type,
          number: parcel.data.installmentNumber,
          count: parcel.data.installmentCount,
        } as const,
      },
    };
  }
  return {
    success: true as const,
    data: { transactionId, rememberRule, choice: { type } as const },
  };
}

export const generateSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido."),
});

// ── Filtros da lista (na URL) ───────────────────────────────────────────────────

export type TransactionTypeFilter = "expense" | "income" | "transfer";

/**
 * O período da lista (M13.3a): meses marcados no combo do Período (um ou vários, não precisam ser
 * seguidos) ou dias de/até (o que um número do painel abre: "do dia 1 até hoje"). Vale pela data
 * de caixa (ADR-025): no cartão, o mês do vencimento da fatura.
 */
export type ListPeriod =
  | { kind: "months"; months: readonly MonthKey[] }
  | { kind: "range"; from: CivilDate; to: CivilDate };

/** O mesmo formato que o @fintrack/db recebe (TransactionFilters), com o período ainda na forma da URL. */
export type ListFilters = {
  period: ListPeriod;
  /** Só o que já aconteceu até este dia (`?aconteceu=`): o "gasto até hoje" do painel */
  upTo: CivilDate | null;
  accountId: string | null;
  categoryId: string | null;
  text: string | null;
  type: TransactionTypeFilter | null;
  /** "Pago por" (M07.4): Compartilhado ou pessoas; vazio = todos (M13.3a: várias) */
  payers: readonly PayerFilter[];
  /** Recebidos do banco esperando revisão (M09.1); fora disso, a lista não os mostra */
  received: boolean;
  /** Quem categorizou (M10.1, `?quem=`): os números de Ajustes › Categorização levam aqui */
  categorizedBy?: CategorizationSource | null;
};

export type ParsedFilters = {
  filters: ListFilters;
  walletId: string | null;
  cursor: string | null;
  /** O cursor da parte dos cartões, no recorte do painel (M13.3a) */
  cardCursor: string | null;
  /** De onde se veio (M08): uma tela do painel, para o link "Voltar para Orçamento · Mercado" */
  back: string | null;
};

/** Os períodos que o banco recebe: um por mês marcado, ou o de/até. */
export function periodRanges(period: ListPeriod): DateRange[] {
  if (period.kind === "range") return [{ from: period.from, to: period.to }];
  return period.months.map((month) => ({ from: firstDayOf(month), to: dayOfMonth(month, 31) }));
}

/** O primeiro e o último dia do período (o saldo no começo, o CSV). */
export function periodBounds(period: ListPeriod): DateRange {
  const ranges = periodRanges(period);
  return {
    from: ranges.map((r) => r.from).toSorted()[0] as CivilDate,
    to: ranges
      .map((r) => r.to)
      .toSorted()
      .at(-1) as CivilDate,
  };
}

/**
 * O que a lista mostra (M13.3a, ADR-025):
 *   received  a fila do banco (`?situacao=recebidos`)
 *   account   uma conta que não é cartão (o padrão de Lançamentos)
 *   slice     o recorte que um número do painel abre, em duas partes (contas e cartões): sem conta
 *             escolhida e com algum filtro que não é período, ambiente ou Pago por
 */
export type ListView = "received" | "account" | "slice";

export function listView(parsed: ParsedFilters): ListView {
  const f = parsed.filters;
  if (f.received) return "received";
  if (f.accountId) return "account";
  return hasSliceFilters(parsed) ? "slice" : "account";
}

/** Algum filtro além do período, do ambiente e do Pago por (o que um número do painel escreve). */
export function hasSliceFilters(parsed: ParsedFilters): boolean {
  const f = parsed.filters;
  return Boolean(f.categoryId || f.type || f.text || f.categorizedBy || f.upTo || parsed.back);
}

/**
 * O "volta" só aceita as telas do painel, com os parâmetros delas: nunca outro site nem outro
 * caminho (um link com ?volta=https://... não pode virar um redirecionamento aberto).
 */
const BACK =
  /^\/(orcamento(\/(fluxo|evolucao))?|ajustes\/categorizacao)?(\?[A-Za-z0-9=&%._-]{0,400})?$/;
export const backOrNull = (value: string | null) => (value && BACK.test(value) ? value : null);

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** No máximo 24 meses marcados (o combo mostra 12 por vez) */
const MAX_MONTHS = 24;
/** No máximo uma pessoa por pessoa do lar mais o Compartilhado; mais que isso é lixo na URL */
const MAX_PAYERS = 12;
const TYPES: Record<string, TransactionTypeFilter> = {
  despesa: "expense",
  receita: "income",
  transferencia: "transfer",
};
/** `?quem=`: quem categorizou, em português na barra de endereço (M10.1). */
export const CATEGORIZED_BY_PARAM: Record<CategorizationSource, string> = {
  RULE: "regra",
  HISTORY: "historico",
  PROVIDER: "banco",
  CLASSIFIER: "classificador",
  LLM: "ia",
  MANUAL: "voce",
};
const CATEGORIZED_BY: Record<string, CategorizationSource> = Object.fromEntries(
  Object.entries(CATEGORIZED_BY_PARAM).map(([source, param]) => [param, source]),
) as Record<string, CategorizationSource>;
const TYPE_PARAM: Record<TransactionTypeFilter, string> = {
  expense: "despesa",
  income: "receita",
  transfer: "transferencia",
};

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;
const many = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map((v) => v.trim())
    .filter(Boolean);
const dateOrNull = (value: string | null) => (value && isCivilDate(value) ? value : null);
const idOrNull = (value: string | null) => (value && UUID.test(value) ? value.toLowerCase() : null);

/**
 * Lê os filtros da URL. Os nomes são em português porque aparecem na barra de endereço:
 *   /lancamentos?mes=2026-10&mes=2026-08   meses marcados no Período (um ou vários, M13.3a)
 *   /lancamentos?de=2026-10-01&ate=2026-10-09   dias (o "até hoje" de um número do painel)
 *   &carteira=<id>&conta=<id>&categoria=<id|sem>&q=mercado&tipo=despesa
 *   &pago=<id>&pago=compartilhado   Pago por: uma ou várias pessoas (M13.3a)
 *   &aconteceu=2026-11-03   só o que já aconteceu até o dia (o "gasto até hoje", M13.3a)
 *   /lancamentos?quem=classificador   quem categorizou (M10.1): regra, historico, banco,
 *                                     classificador ou voce
 *   /lancamentos?situacao=recebidos   os recebidos do banco que esperam revisão (M09.1); sem
 *                                     período, os dos últimos 12 meses
 * Nada aqui é confiável: valor fora do formato é ignorado (cai no padrão), nunca vira erro; o
 * texto da busca chega sem caractere nulo nem invisível (cleanText, M12.4a).
 * O id de carteira passa depois pelo escopo do servidor: carteira alheia = lista vazia.
 */
export function parseFilters(params: SearchParams, today: CivilDate): ParsedFilters {
  const received = one(params.situacao) === "recebidos";
  const category = one(params.categoria);
  // A busca é o único texto livre da URL: limpa antes de chegar ao banco (M12.4a)
  const text = cleanText(one(params.q) ?? "").trim();
  return {
    filters: {
      period: parsePeriod(params, today, received),
      upTo: dateOrNull(one(params.aconteceu)),
      accountId: idOrNull(one(params.conta)),
      categoryId: category === "sem" ? "none" : idOrNull(category),
      text: text ? text.slice(0, 100) : null,
      type: TYPES[one(params.tipo) ?? ""] ?? null,
      // A pessoa passa depois pelo escopo: filtrar por quem não está no lar só esvazia a lista
      payers: uniqueBy(
        many(params.pago)
          .slice(0, MAX_PAYERS)
          .flatMap((p) => {
            const payer = parsePayerParam(p);
            return payer ? [payer] : [];
          }),
        payerParam,
      ),
      received,
      categorizedBy: CATEGORIZED_BY[one(params.quem) ?? ""] ?? null,
    },
    walletId: idOrNull(one(params.carteira)),
    cursor: one(params.cursor),
    cardCursor: one(params.cursorCartoes),
    back: backOrNull(one(params.volta)),
  };
}

function parsePeriod(params: SearchParams, today: CivilDate, received: boolean): ListPeriod {
  let from = one(params.de);
  let to = one(params.ate);
  if (from && to && isCivilDate(from) && isCivilDate(to)) {
    if (from > to) [from, to] = [to, from];
    return { kind: "range", from, to };
  }
  const months = [...new Set(many(params.mes).filter((m) => MONTH.test(m)))]
    .slice(0, MAX_MONTHS)
    .toSorted();
  if (months.length > 0) return { kind: "months", months };
  if (received) return { kind: "range", from: addMonths(today, -12), to: today };
  return { kind: "months", months: [monthOf(today)] };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** O valor de um parâmetro: um texto, vários (mes, pago) ou null para tirar. */
export type QueryValue = string | readonly string[] | null;

/** O contrário: monta a URL de volta (próxima página, limpar um filtro, exportar o mesmo). */
export function filtersToQuery(
  parsed: {
    filters: ListFilters;
    walletId: string | null;
    back?: string | null;
  },
  extra: Record<string, QueryValue> = {},
): string {
  const { filters: f, walletId } = parsed;
  const query = new URLSearchParams();
  if (f.period.kind === "range") {
    query.set("de", f.period.from);
    query.set("ate", f.period.to);
  } else {
    for (const month of f.period.months) query.append("mes", month);
  }
  if (f.upTo) query.set("aconteceu", f.upTo);
  if (walletId) query.set("carteira", walletId);
  if (f.accountId) query.set("conta", f.accountId);
  if (f.categoryId) query.set("categoria", f.categoryId === "none" ? "sem" : f.categoryId);
  if (f.text) query.set("q", f.text);
  if (f.type) query.set("tipo", TYPE_PARAM[f.type]);
  for (const payer of f.payers) query.append("pago", payerParam(payer));
  if (f.received) query.set("situacao", "recebidos");
  if (f.categorizedBy) query.set("quem", CATEGORIZED_BY_PARAM[f.categorizedBy]);
  if (parsed.back) query.set("volta", parsed.back);
  for (const [key, value] of Object.entries(extra)) {
    query.delete(key);
    // O período é um só: trocar os meses tira o de/até, e o contrário
    if (key === "mes" && value !== null) {
      query.delete("de");
      query.delete("ate");
    }
    if ((key === "de" || key === "ate") && value !== null) query.delete("mes");
    if (value === null) continue;
    if (typeof value === "string") query.set(key, value);
    else for (const v of value) query.append(key, v);
  }
  return query.toString();
}

/** Exportar: a carteira (obrigatória, só o dono exporta) e o mesmo período e filtros da lista. */
export const exportSchema = z.object({
  walletId: z.uuid("Escolha a carteira."),
  from: civilDate("Use uma data de início válida."),
  to: civilDate("Use uma data de fim válida."),
});

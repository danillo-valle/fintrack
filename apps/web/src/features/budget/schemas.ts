// Os parâmetros das telas do M08 (na URL) e o formulário do orçado.
//
//   /                      ?carteira=<id>&ver=tabela
//   /orcamento             ?mes=2026-10&carteira=<id>&pago=<id|compartilhado>
//   /orcamento/fluxo       ?carteira=<id>&detalhe=2026-11
//   /orcamento/evolucao    ?carteira=<id>&pago=...&categoria=<grupo|sem>&meses=12&ver=tabela
//
// Nada da URL é confiável: valor fora do formato cai no padrão (nunca vira erro). A carteira
// passa depois pelo escopo do servidor: carteira alheia = tela vazia, sem dizer se existe.
import {
  decimalToCents,
  monthOf,
  parsePayerParam,
  payerParam,
  type CivilDate,
  type MonthKey,
  type PayerFilter,
} from "@fintrack/core";
import { z } from "zod";

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;
const idOrNull = (value: string | null) => (value && UUID.test(value) ? value.toLowerCase() : null);
const monthOrNull = (value: string | null): MonthKey | null =>
  value && MONTH.test(value) ? value : null;

export type ViewMode = "grafico" | "tabela";
export const EVOLUTION_SPANS = [6, 12, 24] as const;
export type EvolutionSpan = (typeof EVOLUTION_SPANS)[number];

export type BudgetParams = {
  walletId: string | null;
  payer: PayerFilter | null;
  /** O mês do orçamento (padrão: o de hoje) */
  month: MonthKey;
  view: ViewMode;
  /** Evolução: o grupo escolhido (id, "none" = sem categoria, null = o maior) */
  group: string | "none" | null;
  span: EvolutionSpan;
  /** Fluxo de caixa: o mês aberto no detalhe (padrão: o de hoje) */
  detail: MonthKey | null;
};

export function parseBudgetParams(params: SearchParams, today: CivilDate): BudgetParams {
  const span = Number.parseInt(one(params.meses) ?? "", 10);
  const group = one(params.categoria);
  return {
    walletId: idOrNull(one(params.carteira)),
    payer: parsePayerParam(one(params.pago)),
    month: monthOrNull(one(params.mes)) ?? monthOf(today),
    view: one(params.ver) === "tabela" ? "tabela" : "grafico",
    group: group === "sem" ? "none" : idOrNull(group),
    span: (EVOLUTION_SPANS as readonly number[]).includes(span) ? (span as EvolutionSpan) : 12,
    detail: monthOrNull(one(params.detalhe)),
  };
}

/** Monta a URL de volta, trocando só o que vier em `extra` (null tira o parâmetro). */
export function budgetQuery(
  p: Partial<BudgetParams>,
  extra: Record<string, string | null> = {},
): string {
  const query = new URLSearchParams();
  if (p.month) query.set("mes", p.month);
  if (p.walletId) query.set("carteira", p.walletId);
  if (p.payer) query.set("pago", payerParam(p.payer));
  if (p.group) query.set("categoria", p.group === "none" ? "sem" : p.group);
  if (p.span && p.span !== 12) query.set("meses", String(p.span));
  if (p.view === "tabela") query.set("ver", "tabela");
  if (p.detail) query.set("detalhe", p.detail);
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) query.delete(key);
    else query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

// ── O formulário do orçado ─────────────────────────────────────────────────────

/** Valor que chega do MoneyInput ("1234.56"); zero vale (tira o orçado). */
const cents = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Informe um valor de R$ 0,00 a R$ 9.999.999,99.")
  .transform((v) => decimalToCents(v));

/**
 * Orçado de uma categoria: ambiente, mês, categoria, valor e, se "Dividir por pessoa" estiver
 * marcado, as partes (campos "parte:<pessoa>" e "parte:compartilhado"). Com divisão, o valor é a
 * soma das partes: o servidor calcula, não confia no total que a tela mostra.
 */
export const budgetFormSchema = z.object({
  walletId: z.uuid("Escolha o ambiente."),
  month: z.string().regex(MONTH, "Mês inválido."),
  categoryId: z.uuid("Escolha a categoria."),
  amount: cents.optional().transform((v) => v ?? 0n),
  split: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export type BudgetFormShare = { payer: string; cents: bigint };

/** As partes do formulário: chaves "parte:<id|compartilhado>", só as que têm formato válido. */
export function parseShares(form: Record<string, unknown>): BudgetFormShare[] | string {
  const shares: BudgetFormShare[] = [];
  for (const [key, raw] of Object.entries(form)) {
    if (!key.startsWith("parte:")) continue;
    const payer = parsePayerParam(key.slice("parte:".length));
    if (!payer) return "Divisão inválida.";
    const value = typeof raw === "string" ? raw.trim() : "";
    const parsed = cents.safeParse(value === "" ? "0" : value);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Valor inválido.";
    shares.push({ payer: payerParam(payer), cents: parsed.data });
  }
  return shares;
}

export const copyBudgetsSchema = z.object({
  walletId: z.uuid("Escolha o ambiente."),
  month: z.string().regex(MONTH, "Mês inválido."),
});

export const undoCopySchema = z.object({
  walletId: z.uuid(),
  month: z.string().regex(MONTH),
  categoryIds: z
    .string()
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).max(500)),
  copiedAt: z.iso.datetime(),
});

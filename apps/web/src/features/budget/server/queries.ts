// Leituras das telas do M08: Início (painel), Orçamento, Fluxo de caixa e Evolução.
//
// Cada tela segue o mesmo caminho:
//   1. o crachá: o escopo das carteiras que a pessoa vê (com ?carteira=, só aquela, se ela vê)
//   2. as somas, com cache (data.ts): gasto, recorrências, orçados, fluxo
//   3. as regras do @fintrack/core: previsto, média de 6 meses, orçado × realizado, fluxo
//   4. nomes e links: cada número sai com o endereço da lista que o compõe (links.ts)
import "server-only";
import {
  addMonthsToKey,
  averageCents,
  budgetRows,
  budgetStatus,
  cashBucketOf,
  cashDateFor,
  cashFlow,
  categoryGroupOf,
  comparisonFor,
  figuresFor,
  incomeUpToToday,
  monthlySeries,
  monthOf,
  monthPhase,
  monthsBefore,
  monthsEndingAt,
  monthsStartingAt,
  payerParam,
  pendingOccurrences,
  percentVersus,
  projectMonth,
  SHARED_PAYER_PARAM,
  spendingByGroup,
  subtreeOf,
  sumCents,
  todayCivil,
  type BudgetStatus,
  type CashMovement,
  type CategoryNode,
  type CivilDate,
  type MonthKey,
  type PayerFilter,
  type PendingRow,
  type Projection,
  type Slice,
  type SpendingRow,
} from "@fintrack/core";
import { listCategories, listMyWallets, prisma, type RecurrencePlan } from "@fintrack/db";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { environmentsOf, environmentsSentence } from "@/features/transactions/environments";
import type { PayerOption } from "@/features/transactions/payers";
import { payersOf } from "@/features/transactions/server/queries";
import {
  monthSpan,
  monthsSpan,
  monthToDate,
  statementSpan,
  transactionsHref,
  type ListLink,
} from "../links";
import { budgetQuery, parseBudgetParams } from "../schemas";
import {
  cachedBudgets,
  cachedCash,
  cachedCategoryTree,
  cachedRecurrences,
  cachedSpending,
} from "./data";

type SearchParams = Record<string, string | string[] | undefined>;

/** Um valor com o caminho até os lançamentos que o compõem. */
export type Linked = { cents: bigint; href: string };

const monthLong = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const at = (month: MonthKey) => new Date(`${month}-15T12:00:00Z`);
/** "outubro de 2026" */
export const monthLabel = (month: MonthKey) => monthLong.format(at(month));
/** "Outubro" */
export const monthTitle = (month: MonthKey) => {
  const text = monthName.format(at(month));
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/** "out" */
export const monthAbbr = (month: MonthKey) => monthShort.format(at(month)).replace(".", "");
/** "sexta-feira, 9 de outubro" */
const todayLabel = (today: CivilDate) => dayLong.format(new Date(`${today}T12:00:00Z`));

const list = new Intl.ListFormat("pt-BR", { type: "conjunction" });

// ── O que toda tela do M08 precisa ─────────────────────────────────────────────

type Names = {
  category: Map<string, string>;
  wallet: Map<string, string>;
};

async function context(session: Session, params: SearchParams) {
  const today = todayCivil();
  const parsed = parseBudgetParams(params, today);
  const scope = await requireScope(session, "view", parsed.walletId);
  const [wallets, payers, categories] = await Promise.all([
    listMyWallets(prisma, session.user.id),
    payersOf(session),
    householdCategories(session),
  ]);
  const tree: CategoryNode[] = scope.householdId ? await cachedCategoryTree(scope.householdId) : [];
  const names: Names = {
    category: new Map(categories.map((c) => [c.id, c.name])),
    wallet: new Map(wallets.map((w) => [w.id, w.name])),
  };
  const environments = environmentsOf(wallets);
  // Um ambiente só: "Tudo que vejo" é ele mesmo. A tela fala dele pelo nome (Ambiente Casa) e
  // as ações que pedem um ambiente (Copiar do mês anterior) ficam disponíveis.
  const only = environments.length === 1 ? environments[0] : undefined;
  if (parsed.walletId === null && only) parsed.walletId = only.id;
  const otherMembers = payers
    .filter((p) => p.param !== SHARED_PAYER_PARAM && p.param !== session.user.id)
    .map((p) => p.name);
  const editable = new Set(
    wallets.filter((w) => w.role !== "VIEWER" && !w.archived).map((w) => w.id),
  );
  return {
    today,
    parsed,
    scope,
    wallets,
    payers,
    categories,
    tree,
    names,
    environments,
    sentence: environmentsSentence(environments, parsed.walletId, otherMembers),
    editable,
    hasWallets: wallets.length > 0,
  };
}

async function householdCategories(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    return await listCategories(prisma, grant, { includeArchived: true });
  } catch (error) {
    if (error instanceof AccessError) return [];
    throw error;
  }
}

type Context = Awaited<ReturnType<typeof context>>;

const payerString = (payer: PayerFilter | null) => (payer ? payerParam(payer) : null);

/** As recorrências que ainda não viraram lançamento, no formato das linhas de gasto. */
function pendingRows(
  plans: readonly RecurrencePlan[],
  months: readonly MonthKey[],
  today: CivilDate,
) {
  const rows: PendingRow[] = [];
  for (const plan of plans) {
    if (plan.amount >= 0n) continue; // receita não é gasto
    for (const o of pendingOccurrences(plan, months, today)) {
      rows.push({
        month: o.month,
        date: o.date,
        walletId: plan.walletId,
        categoryId: plan.categoryId,
        payer: plan.payer,
        expense: -plan.amount,
      });
    }
  }
  return rows;
}

/** Nome do grupo (categoria de primeiro nível); null é "Sem categoria". */
const groupName = (ctx: Context, groupId: string | null) =>
  groupId === null ? "Sem categoria" : (ctx.names.category.get(groupId) ?? "Categoria");

/** Em que ambientes houve gasto de um grupo no mês: "Casa e Danillo". */
function groupWallets(ctx: Context, rows: readonly SpendingRow[], month: MonthKey, slice: Slice) {
  const ids = new Set<string>();
  const cats = slice.categories;
  for (const r of rows) {
    if (r.month !== month || r.expense === 0n) continue;
    if (
      cats === "none"
        ? r.categoryId !== null
        : cats && (r.categoryId === null || !cats.has(r.categoryId))
    )
      continue;
    if (slice.payer && r.payer !== slice.payer) continue;
    if (slice.walletId && r.walletId !== slice.walletId) continue;
    ids.add(r.walletId);
  }
  return list.format([...ids].map((id) => ctx.names.wallet.get(id) ?? "Ambiente").sort());
}

// ── Início: o painel do mês ────────────────────────────────────────────────────

export type GroupView = {
  groupId: string | null;
  name: string;
  wallets: string;
  spent: Linked;
  projected: Linked;
  lastMonth: Linked;
  average: { cents: bigint; href: string; total: bigint };
  /** Evolução mês a mês do grupo */
  evolutionHref: string;
};

export type AlertView = {
  key: string;
  categoryName: string;
  walletName: string;
  projected: Linked;
  budget: { cents: bigint; href: string };
  by: bigint;
};

export type CashMonthView = {
  month: MonthKey;
  title: string;
  abbr: string;
  current: boolean;
  income: bigint;
  fixed: bigint;
  other: bigint;
  net: bigint;
  cumulative: bigint;
  /** O detalhe do mês no Fluxo de caixa (de onde vem e para onde vai) */
  href: string;
};

export async function getHomeDashboard(session: Session, params: SearchParams) {
  const ctx = await context(session, params);
  const { today, scope, parsed } = ctx;
  // Cada número leva à lista, e a lista mostra o caminho de volta para esta tela
  const back = `/${budgetQuery({ walletId: parsed.walletId, view: parsed.view })}`;
  const listHref = (link: ListLink) => transactionsHref({ ...link, back });
  const month = monthOf(today);
  const first = monthsBefore(month, 6)[0] as MonthKey;
  const [rows, plans, budgets, cash] = await Promise.all([
    cachedSpending(scope, first, addMonthsToKey(month, 5), today),
    cachedRecurrences(scope, monthsStartingAt(month, 6)),
    cachedBudgets(scope, month, month),
    cachedCash(scope, monthSpan(month).from, monthSpan(addMonthsToKey(month, 5)).to),
  ]);
  const pending = pendingRows(plans, [month], today);
  const slice: Slice = {};
  const base = { walletId: parsed.walletId };
  const span = monthSpan(month);
  const toDate = monthToDate(month, today);

  const all = projectMonth(month, today, figuresFor(rows, pending, month, slice));
  const budgetTotal = sumCents(budgets.map((b) => b.cents));
  const groups: GroupView[] = spendingByGroup({
    rows,
    pending,
    nodes: ctx.tree,
    month,
    today,
    slice,
  }).map((g) => {
    const categoryId = g.groupId ?? "none";
    const link = (s: { from: CivilDate; to: CivilDate }): string =>
      listHref({ ...base, ...s, categoryId, type: "expense" });
    const months6 = g.comparison.months6;
    const groupSlice: Slice = {
      categories: g.groupId === null ? "none" : subtreeOf(g.groupId, ctx.tree),
    };
    return {
      groupId: g.groupId,
      name: groupName(ctx, g.groupId),
      wallets: groupWallets(ctx, rows, month, groupSlice),
      spent: { cents: g.projection.spent, href: link(toDate) },
      projected: { cents: g.projection.projected, href: link(span) },
      lastMonth: {
        cents: g.comparison.lastMonth,
        href: link(monthSpan(months6.at(-1) as MonthKey)),
      },
      average: {
        cents: g.comparison.average6,
        href: link(monthsSpan(months6[0] as MonthKey, months6.at(-1) as MonthKey)),
        total: g.comparison.total6,
      },
      evolutionHref: `/orcamento/evolucao${budgetQuery({ walletId: parsed.walletId, group: categoryId })}`,
    };
  });

  const rowsOfBudget = budgetRows({
    budgets,
    rows,
    pending,
    nodes: ctx.tree,
    month,
    today,
    payer: null,
  });
  const alerts: AlertView[] = rowsOfBudget
    .filter((r) => r.status.kind === "over")
    .map((r) => ({
      key: `${r.walletId}:${r.categoryId}`,
      categoryName: ctx.names.category.get(r.categoryId) ?? "Categoria",
      walletName: ctx.names.wallet.get(r.walletId) ?? "Ambiente",
      projected: {
        cents: r.projection.projected,
        href: listHref({
          ...span,
          walletId: r.walletId,
          categoryId: r.categoryId,
          type: "expense",
        }),
      },
      budget: {
        cents: r.budget ?? 0n,
        href: `/orcamento${budgetQuery({ walletId: r.walletId, month })}`,
      },
      by: r.status.kind === "over" ? r.status.by : 0n,
    }))
    .toSorted((a, b) => (a.by === b.by ? 0 : a.by > b.by ? -1 : 1));

  return {
    hasWallets: ctx.hasWallets,
    environments: ctx.environments,
    walletId: parsed.walletId,
    sentence: ctx.sentence,
    view: parsed.view,
    today,
    todayLabel: todayLabel(today),
    month,
    monthLabel: monthLabel(month),
    elapsedDays: all.elapsedDays,
    monthDays: all.monthDays,
    summary: {
      projected: {
        cents: all.projected,
        href: listHref({ ...base, ...span, type: "expense" }),
      },
      spent: { cents: all.spent, href: listHref({ ...base, ...toDate, type: "expense" }) },
      income: {
        cents: incomeUpToToday(rows, month, slice),
        href: listHref({ ...base, ...toDate, type: "income" }),
      },
      budget: {
        cents: budgetTotal,
        href: `/orcamento${budgetQuery({ walletId: parsed.walletId, month })}`,
      },
      budgetCount: budgets.length,
      status:
        budgets.length > 0
          ? budgetStatus(all.projected, budgetTotal)
          : ({ kind: "none" } as BudgetStatus),
    },
    groups,
    alerts,
    withinCount: rowsOfBudget.length - alerts.length,
    cashflow: cashFlowMonths(ctx, cash, plans, monthsStartingAt(month, 6)),
  };
}

// ── Fluxo de caixa ─────────────────────────────────────────────────────────────

function cashFlowMonths(
  ctx: Context,
  cash: Awaited<ReturnType<typeof cachedCash>>,
  plans: readonly RecurrencePlan[],
  months: readonly MonthKey[],
): CashMonthView[] {
  const movements = cashMovements(cash, plans, months, ctx.today);
  return cashFlow(movements, months).map((m) => ({
    ...m,
    title: monthTitle(m.month),
    abbr: monthAbbr(m.month),
    current: m.month === monthOf(ctx.today),
    href: `/orcamento/fluxo${budgetQuery({ walletId: ctx.parsed.walletId, detail: m.month })}#detalhe`,
  }));
}

function cashMovements(
  cash: Awaited<ReturnType<typeof cachedCash>>,
  plans: readonly RecurrencePlan[],
  months: readonly MonthKey[],
  today: CivilDate,
): (CashMovement & { accountId: string | null })[] {
  const movements: (CashMovement & { accountId: string | null })[] = cash.map((r) => ({
    date: cashDateFor(r.occurredOn, r.account, r.statementDue),
    amount: r.amount,
    bucket: cashBucketOf(r.amount, r.fromRecurrence),
    accountId: r.accountId,
  }));
  for (const plan of plans) {
    for (const o of pendingOccurrences(plan, months, today)) {
      movements.push({
        date: cashDateFor(o.date, plan.account),
        amount: plan.amount,
        bucket: cashBucketOf(plan.amount, true),
        accountId: null, // ainda não é lançamento: aparece como "Recorrências a lançar"
      });
    }
  }
  return movements;
}

export type CashDetailRow = {
  key: string;
  name: string;
  /** "Fatura que vence em 10/11" ou "Conta corrente" */
  note: string;
  income: Linked | null;
  expense: Linked | null;
};

export async function getCashFlowPage(session: Session, params: SearchParams) {
  const ctx = await context(session, params);
  const { today, scope, parsed } = ctx;
  // Cada número leva à lista, e a lista mostra o caminho de volta para esta tela
  const back = `/orcamento/fluxo${budgetQuery({ walletId: parsed.walletId, detail: parsed.detail })}`;
  const listHref = (link: ListLink) => transactionsHref({ ...link, back });
  const month = monthOf(today);
  const months = monthsStartingAt(month, 6);
  const last = months.at(-1) as MonthKey;
  const [cash, plans] = await Promise.all([
    cachedCash(scope, monthSpan(month).from, monthSpan(last).to),
    cachedRecurrences(scope, months),
  ]);
  const flow = cashFlowMonths(ctx, cash, plans, months);
  const detailMonth = parsed.detail && months.includes(parsed.detail) ? parsed.detail : month;

  // O detalhe de um mês: de onde vem e para onde vai, conta por conta, com o caminho de cada uma
  const movements = cashMovements(cash, plans, months, today).filter(
    (m) => monthOf(m.date) === detailMonth,
  );
  const accounts = new Map(cash.map((r) => [r.accountId, r] as const));
  const byAccount = new Map<string | null, { income: bigint; expense: bigint }>();
  for (const m of movements) {
    const entry = byAccount.get(m.accountId) ?? { income: 0n, expense: 0n };
    if (m.amount > 0n) entry.income += m.amount;
    else entry.expense -= m.amount;
    byAccount.set(m.accountId, entry);
  }
  const span = monthSpan(detailMonth);
  const detail: CashDetailRow[] = [...byAccount.entries()]
    .map(([accountId, sums]) => {
      if (accountId === null) {
        const href = "/lancamentos/recorrencias";
        return {
          key: "recorrencias",
          name: "Recorrências ainda não lançadas",
          note: "Pelo valor previsto de cada uma",
          income: sums.income > 0n ? { cents: sums.income, href } : null,
          expense: sums.expense > 0n ? { cents: sums.expense, href } : null,
        };
      }
      const acc = accounts.get(accountId);
      const cycle = acc?.account.kind === "CREDIT_CARD" ? acc.account.cycle : null;
      const statement = cycle ? statementSpan(detailMonth, cycle) : null;
      const period = statement ?? span;
      const link = (type: ListLink["type"]) =>
        listHref({ walletId: parsed.walletId, accountId, ...period, type });
      return {
        key: accountId,
        name: acc?.accountName ?? "Conta",
        note: statement
          ? `Fatura que vence em ${monthTitle(detailMonth).toLowerCase()}: compras de ${formatShort(statement.from)} a ${formatShort(statement.to)}`
          : "Lançamentos do mês",
        income: sums.income > 0n ? { cents: sums.income, href: link("income") } : null,
        expense: sums.expense > 0n ? { cents: sums.expense, href: link("expense") } : null,
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const totalIncome = sumCents(flow.map((m) => m.income));
  const totalOut = sumCents(flow.map((m) => m.fixed + m.other));
  return {
    hasWallets: ctx.hasWallets,
    environments: ctx.environments,
    walletId: parsed.walletId,
    sentence: ctx.sentence,
    view: parsed.view,
    firstLabel: monthLabel(month),
    lastLabel: monthLabel(last),
    lastTitle: monthTitle(last).toLowerCase(),
    flow,
    totals: { income: totalIncome, out: totalOut, cumulative: flow.at(-1)?.cumulative ?? 0n },
    detail: { month: detailMonth, title: monthTitle(detailMonth), rows: detail },
    recurrencesHref: "/lancamentos/recorrencias",
  };
}

const formatShort = (date: CivilDate) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// ── Orçamento do mês ───────────────────────────────────────────────────────────

export type BudgetPartView = {
  payer: PayerOption;
  spent: Linked;
  projected: Linked;
  budget: bigint;
  lastMonth: Linked;
  average: Linked;
  status: BudgetStatus;
  projection: Projection;
};

export type BudgetRowView = {
  key: string;
  categoryId: string;
  categoryName: string;
  walletId: string;
  walletName: string;
  spent: Linked;
  projected: Linked;
  budget: bigint | null;
  fullBudget: bigint;
  lastMonth: Linked;
  average: Linked;
  status: BudgetStatus;
  projection: Projection;
  onlyFixed: boolean;
  nextDue: CivilDate | null;
  parts: BudgetPartView[];
  /** Quanto do orçado ficou sem dono (alguém saiu do lar depois da divisão) */
  unassigned: bigint;
  /** A divisão pode ser feita (ambiente compartilhado) */
  splittable: boolean;
  evolutionHref: string;
  editHref: string | null;
};

export async function getBudgetPage(session: Session, params: SearchParams) {
  const ctx = await context(session, params);
  const { today, scope, parsed } = ctx;
  // Cada número leva à lista, e a lista mostra o caminho de volta para esta tela
  const back = `/orcamento${budgetQuery(parsed)}`;
  const listHref = (link: ListLink) => transactionsHref({ ...link, back });
  const month = parsed.month;
  const months6 = monthsBefore(month, 6);
  const [rows, plans, budgets] = await Promise.all([
    cachedSpending(scope, months6[0] as MonthKey, month, today),
    cachedRecurrences(scope, [month]),
    cachedBudgets(scope, month, month),
  ]);
  const pending = pendingRows(plans, [month], today);
  const payer = payerString(parsed.payer);
  const inMonth = budgets;
  const span = monthSpan(month);
  const toDate = monthToDate(month, today);
  const avgSpan = monthsSpan(months6[0] as MonthKey, months6.at(-1) as MonthKey);
  const lastSpan = monthSpan(months6.at(-1) as MonthKey);
  const kindOf = new Map(ctx.wallets.map((w) => [w.id, w.kind] as const));
  const payerOption = (param: string): PayerOption =>
    ctx.payers.find((p) => p.param === param) ?? {
      param,
      name: "Pessoa que saiu do lar",
      initials: "?",
      tone: 3,
    };

  const view: BudgetRowView[] = budgetRows({
    budgets: inMonth,
    rows,
    pending,
    nodes: ctx.tree,
    month,
    today,
    payer,
  }).map((r) => {
    const link = (s: { from: CivilDate; to: CivilDate }, who: string | null = payer) =>
      listHref({
        ...s,
        walletId: r.walletId,
        categoryId: r.categoryId,
        payer: who,
        type: "expense",
      });
    const record = inMonth.find((b) => b.walletId === r.walletId && b.categoryId === r.categoryId);
    const assigned = sumCents((record?.shares ?? []).map((s) => s.cents));
    return {
      key: `${r.walletId}:${r.categoryId}`,
      categoryId: r.categoryId,
      categoryName: ctx.names.category.get(r.categoryId) ?? "Categoria",
      walletId: r.walletId,
      walletName: ctx.names.wallet.get(r.walletId) ?? "Ambiente",
      spent: { cents: r.projection.spent, href: link(toDate) },
      projected: { cents: r.projection.projected, href: link(span) },
      budget: r.budget,
      fullBudget: r.fullBudget,
      lastMonth: { cents: r.comparison.lastMonth, href: link(lastSpan) },
      average: { cents: r.comparison.average6, href: link(avgSpan) },
      status: r.status,
      projection: r.projection,
      onlyFixed: r.onlyFixed,
      nextDue: r.nextDue,
      parts: r.parts.map((p) => ({
        payer: payerOption(p.payer),
        spent: { cents: p.projection.spent, href: link(toDate, p.payer) },
        projected: { cents: p.projection.projected, href: link(span, p.payer) },
        budget: p.budget,
        lastMonth: { cents: p.comparison.lastMonth, href: link(lastSpan, p.payer) },
        average: { cents: p.comparison.average6, href: link(avgSpan, p.payer) },
        status: p.status,
        projection: p.projection,
      })),
      unassigned: record && record.shares.length > 0 ? record.cents - assigned : 0n,
      splittable: kindOf.get(r.walletId) === "SHARED",
      evolutionHref: `/orcamento/evolucao${budgetQuery({
        walletId: r.walletId,
        payer: parsed.payer,
        group: r.categoryId,
      })}`,
      editHref: ctx.editable.has(r.walletId)
        ? `/orcamento/editar${budgetQuery({ walletId: r.walletId, month }, { categoria: r.categoryId })}`
        : null,
    };
  });

  const totals = {
    spent: sumCents(view.map((r) => r.spent.cents)),
    projected: sumCents(view.map((r) => r.projected.cents)),
    budget: sumCents(view.map((r) => r.budget ?? 0n)),
    lastMonth: sumCents(view.map((r) => r.lastMonth.cents)),
    average: sumCents(view.map((r) => r.average.cents)),
  };
  const over = view.filter((r) => r.status.kind === "over");
  const singleWallet =
    parsed.walletId && ctx.editable.has(parsed.walletId) ? parsed.walletId : null;
  const projection = projectMonth(month, today, {
    spent: totals.spent,
    variableSpent: 0n,
    scheduled: 0n,
    pendingRecurrences: 0n,
  });

  return {
    hasWallets: ctx.hasWallets,
    environments: ctx.environments,
    walletId: parsed.walletId,
    walletKind: parsed.walletId ? (kindOf.get(parsed.walletId) ?? null) : null,
    walletName: parsed.walletId ? (ctx.names.wallet.get(parsed.walletId) ?? null) : null,
    sentence: ctx.sentence,
    payers: ctx.payers,
    payer: parsed.payer,
    params: parsed,
    month,
    monthLabel: monthLabel(month),
    phase: monthPhase(month, today),
    elapsedDays: projection.elapsedDays,
    monthDays: projection.monthDays,
    prevHref: `/orcamento${budgetQuery({ ...parsed, month: addMonthsToKey(month, -1) })}`,
    nextHref: `/orcamento${budgetQuery({ ...parsed, month: addMonthsToKey(month, 1) })}`,
    prevLabel: monthLabel(addMonthsToKey(month, -1)),
    nextLabel: monthLabel(addMonthsToKey(month, 1)),
    previousTitle: monthTitle(addMonthsToKey(month, -1)).toLowerCase(),
    rows: view,
    totals,
    overCount: over.length,
    overFirst: over[0]
      ? { name: over[0].categoryName, by: over[0].status.kind === "over" ? over[0].status.by : 0n }
      : null,
    singleWallet,
    editHref: singleWallet
      ? `/orcamento/editar${budgetQuery({ walletId: singleWallet, month })}`
      : null,
    firstEditableWallet: ctx.environments.find((e) => ctx.editable.has(e.id)) ?? null,
  };
}

// ── Evolução mês a mês ─────────────────────────────────────────────────────────

export type SeriesPoint = {
  month: MonthKey;
  abbr: string;
  title: string;
  spent: bigint;
  projected: bigint;
  budget: bigint | null;
  current: boolean;
  href: string;
};

export type GroupSeriesView = {
  groupId: string | "none";
  name: string;
  wallets: string;
  points: SeriesPoint[];
  /** O previsto de hoje contra a média de 6 meses, em pontos percentuais */
  versusAverage: bigint | null;
  average6: bigint;
  href: string;
  current: boolean;
};

export async function getEvolutionPage(session: Session, params: SearchParams) {
  const ctx = await context(session, params);
  const { today, scope, parsed } = ctx;
  // Cada número leva à lista, e a lista mostra o caminho de volta para esta tela
  const back = `/orcamento/evolucao${budgetQuery(parsed)}`;
  const listHref = (link: ListLink) => transactionsHref({ ...link, back });
  const month = monthOf(today);
  const months = monthsEndingAt(month, parsed.span);
  const first = monthsBefore(months[0] as MonthKey, 6)[0] as MonthKey;
  const [rows, plans, budgets] = await Promise.all([
    cachedSpending(scope, first, month, today),
    cachedRecurrences(scope, [month]),
    cachedBudgets(scope, months[0] as MonthKey, month),
  ]);
  const pending = pendingRows(plans, [month], today);
  const payer = payerString(parsed.payer);
  const base: Slice = { walletId: parsed.walletId, payer };

  // Os grupos com algum gasto no período (do maior para o menor) e, dentro de cada um, as
  // categorias de baixo que também tiveram gasto: o seletor deixa ver "Alimentação › Mercado",
  // que é onde o orçado costuma estar
  const parents = new Map(ctx.tree.map((n) => [n.id, n.parentId] as const));
  const totals = new Map<string, bigint>();
  const used = new Set<string>();
  const add = (categoryId: string | null, cents: bigint) => {
    const g = categoryId === null ? "none" : categoryGroupOf(categoryId, parents);
    totals.set(g, (totals.get(g) ?? 0n) + cents);
    for (let c = categoryId; c !== null && c !== g; c = parents.get(c) ?? null) used.add(c);
  };
  for (const r of rows) {
    if (r.expense === 0n || !months.includes(r.month)) continue;
    if (base.payer && r.payer !== base.payer) continue;
    add(r.categoryId, r.expense);
  }
  for (const p of pending) {
    if (base.payer && p.payer !== base.payer) continue;
    add(p.categoryId, 0n);
  }
  // Categoria orçada no período também entra, mesmo sem gasto (o link do Orçamento leva a ela)
  for (const b of budgets) add(b.categoryId, 0n);

  const seriesOf = (categoryId: string | "none"): GroupSeriesView => {
    const slice: Slice = {
      ...base,
      categories: categoryId === "none" ? "none" : subtreeOf(categoryId, ctx.tree),
    };
    const points = monthlySeries({
      rows,
      pending,
      budgets,
      nodes: ctx.tree,
      months,
      today,
      slice,
    }).map((p) => ({
      ...p,
      abbr: monthAbbr(p.month),
      title: monthTitle(p.month),
      current: p.month === month,
      href: listHref({
        ...monthSpan(p.month),
        walletId: parsed.walletId,
        categoryId,
        payer,
        type: "expense",
      }),
    }));
    const comparison = comparisonFor(rows, month, slice);
    const now = points.at(-1)?.projected ?? 0n;
    return {
      groupId: categoryId,
      name: groupName(ctx, categoryId === "none" ? null : categoryId),
      wallets: groupWallets(ctx, rows, month, slice),
      points,
      versusAverage: percentVersus(now, comparison.average6),
      average6: comparison.average6,
      href: `/orcamento/evolucao${budgetQuery({ ...parsed, group: categoryId })}`,
      current: false,
    };
  };

  const ordered = [...totals.entries()]
    .toSorted((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .map(([g]) => seriesOf(g));
  // O escolhido pode ser um grupo ou uma categoria de baixo com gasto no período
  const requested = parsed.group;
  const selectedId =
    requested && (totals.has(requested) || used.has(requested))
      ? requested
      : (ordered[0]?.groupId ?? null);
  const selected =
    selectedId === null
      ? null
      : (ordered.find((s) => s.groupId === selectedId) ?? seriesOf(selectedId));
  const selectedGroup =
    selectedId === null || selectedId === "none"
      ? selectedId
      : categoryGroupOf(selectedId, parents);
  const multiples = ordered.map((s) => ({ ...s, current: s.groupId === selectedGroup }));
  const childName = (id: string) => {
    const names: string[] = [];
    for (let c: string | null = id; c !== null; c = parents.get(c) ?? null) {
      names.unshift(ctx.names.category.get(c) ?? "Categoria");
    }
    return names.join(" › ");
  };
  const options = ordered.flatMap((s) => [
    { id: s.groupId, name: s.name, href: s.href },
    ...[...used]
      .filter((c) => s.groupId !== "none" && categoryGroupOf(c, parents) === s.groupId)
      .map((c) => ({
        id: c,
        name: childName(c),
        href: `/orcamento/evolucao${budgetQuery({ ...parsed, group: c })}`,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  ]);
  if (selected) selected.name = selectedId === "none" ? selected.name : childName(selected.groupId);

  // Os números de baixo do gráfico grande: o maior mês, a média dos meses fechados e quantos
  // passaram do orçado
  const closed = selected?.points.filter((p) => !p.current) ?? [];
  const biggest = closed.reduce<SeriesPoint | null>(
    (best, p) => (best === null || p.spent > best.spent ? p : best),
    null,
  );
  const withBudget = closed.filter((p) => p.budget !== null);
  // A média dos meses fechados leva à lista do período inteiro (que soma média × meses)
  const closedHref =
    selected && closed.length > 0
      ? listHref({
          ...monthsSpan(closed[0]?.month as MonthKey, closed.at(-1)?.month as MonthKey),
          walletId: parsed.walletId,
          categoryId: selected.groupId,
          payer,
          type: "expense",
        })
      : null;
  return {
    hasWallets: ctx.hasWallets,
    environments: ctx.environments,
    walletId: parsed.walletId,
    sentence: ctx.sentence,
    payers: ctx.payers,
    params: parsed,
    firstLabel: monthLabel(months[0] as MonthKey),
    lastLabel: monthLabel(month),
    selected,
    multiples,
    biggest,
    closedAverage: averageCents(closed.map((p) => p.spent)),
    closedTotal: sumCents(closed.map((p) => p.spent)),
    closedHref,
    closedCount: closed.length,
    overCount: withBudget.filter((p) => p.spent > (p.budget ?? 0n)).length,
    budgetedCount: withBudget.length,
    options,
  };
}

/** O ambiente do formulário do orçado e as categorias que dá para orçar. */
export async function getBudgetEditor(session: Session, params: SearchParams) {
  const ctx = await context(session, params);
  const { parsed } = ctx;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const walletId =
    parsed.walletId && ctx.editable.has(parsed.walletId)
      ? parsed.walletId
      : (ctx.environments.find((e) => ctx.editable.has(e.id))?.id ?? null);
  if (!walletId) return null;
  const wallet = ctx.wallets.find((w) => w.id === walletId);
  const scope = await requireScope(session, "view", walletId);
  const budgets = await cachedBudgets(scope, parsed.month, parsed.month);
  const expense = ctx.categories.filter((c) => c.kind === "EXPENSE" && !c.archived);
  const requested = one(params.categoria);
  const categoryId =
    expense.find((c) => c.id === requested)?.id ?? budgets[0]?.categoryId ?? expense[0]?.id ?? null;
  return {
    walletId,
    walletName: wallet?.name ?? "Ambiente",
    shared: wallet?.kind === "SHARED",
    month: parsed.month,
    monthLabel: monthLabel(parsed.month),
    categories: expense.map((c) => ({
      id: c.id,
      name: c.parentName ? `${c.parentName} › ${c.name}` : c.name,
    })),
    categoryId,
    /** O orçado de cada categoria do ambiente no mês (o formulário troca de categoria sem ir ao servidor) */
    budgets: budgets.map((b) => ({
      categoryId: b.categoryId,
      cents: b.cents,
      shares: b.shares.map((s) => ({ payer: s.payer, cents: s.cents })),
    })),
    split: one(params.dividir) === "1",
    payers: ctx.payers,
    environments: ctx.environments.filter((e) => ctx.editable.has(e.id)),
    hrefFor: (id: string) =>
      `/orcamento/editar${budgetQuery({ walletId: id, month: parsed.month }, categoryId ? { categoria: categoryId } : {})}`,
    backHref: `/orcamento${budgetQuery({ walletId, month: parsed.month })}`,
  };
}

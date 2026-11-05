// A limpeza das categorias que eram transferência (M13.3b, ADR-026). Antes do M13.2 ligar
// transferências na revisão, o resgate da poupança e o PIX entre contas ganhavam uma categoria
// ("Resgate Poupança", "Transferência") e contam até hoje como gasto ou receita. Aqui a regra
// pura: qual categoria parece de transferência e, para ela, quais lançamentos formam par (o mesmo
// formato da sugestão da revisão, transferShape) e quais ficam de um lado só.
import { addMonthsToKey, firstDayOf, monthOf, type CivilDate } from "./dates";
import {
  pickTransfers,
  transferShape,
  type TransferSide,
  type TransferSuggestion,
} from "./reconcile";

/** Quantos meses para trás a limpeza olha (o mês de hoje incluído). */
export const CLEANUP_LOOKBACK_MONTHS = 6;
/** Uma categoria só aparece com pelo menos este número de lançamentos que têm o outro lado. */
export const CLEANUP_MIN_PAIRED = 2;

/** Um lançamento confirmado, sem transferência, de uma carteira que a pessoa edita. */
export type CleanupRow = Omit<TransferSide, "pending"> & {
  categoryId: string | null;
  /** Parcela (do FinTrack ou do banco) ou estorno: nunca vira transferência */
  locked: boolean;
};

export type CleanupPlan = {
  categoryId: string;
  /** Os lançamentos da categoria que entram na limpeza */
  members: number;
  /** Os pares (um lado pode ser de outra categoria, ou sem categoria) */
  pairs: TransferSuggestion[];
  /** Os da categoria sem o outro lado: viram transferência de um lado só (conta fora do app) */
  oneSided: string[];
};

/** O primeiro dia que a limpeza olha. */
export function cleanupSince(today: CivilDate): CivilDate {
  return firstDayOf(addMonthsToKey(monthOf(today), -(CLEANUP_LOOKBACK_MONTHS - 1)));
}

/** Pode ficar só com um lado: não é parcela nem estorno, e a saída não é compra no cartão. */
function canStandAlone(row: CleanupRow): boolean {
  return !row.locked && !(row.accountKind === "CREDIT_CARD" && row.amount < 0n);
}

/**
 * O plano de uma categoria: os pares em que pelo menos um lado é dela (cada lançamento em no
 * máximo um par, como na revisão) e os dela que ficam sozinhos. Parcela e estorno ficam de fora.
 */
export function planCleanup(categoryId: string, rows: readonly CleanupRow[]): CleanupPlan {
  const usable = rows.filter((r) => !r.locked);
  const byAmount = new Map<bigint, CleanupRow[]>();
  for (const r of usable) {
    const key = r.amount < 0n ? -r.amount : r.amount;
    byAmount.set(key, [...(byAmount.get(key) ?? []), r]);
  }
  const edges: TransferSuggestion[] = [];
  for (const group of byAmount.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i] as CleanupRow;
        const b = group[j] as CleanupRow;
        if (a.categoryId !== categoryId && b.categoryId !== categoryId) continue;
        const edge = transferShape(a, b);
        if (edge) edges.push(edge);
      }
    }
  }
  const pairs = pickTransfers(edges);
  const paired = new Set(pairs.flatMap((p) => [p.outId, p.inId]));
  const own = usable.filter((r) => r.categoryId === categoryId);
  return {
    categoryId,
    members: own.filter((r) => paired.has(r.id) || canStandAlone(r)).length,
    pairs,
    oneSided: own.filter((r) => !paired.has(r.id) && canStandAlone(r)).map((r) => r.id),
  };
}

/** Quantos lançamentos da categoria têm o outro lado num plano. */
export function pairedMembers(plan: CleanupPlan, rows: readonly CleanupRow[]): number {
  const own = new Set(rows.filter((r) => r.categoryId === plan.categoryId).map((r) => r.id));
  return plan.pairs.reduce((n, p) => n + (own.has(p.outId) ? 1 : 0) + (own.has(p.inId) ? 1 : 0), 0);
}

/**
 * As categorias que parecem de transferência: pelo menos CLEANUP_MIN_PAIRED dos lançamentos dela
 * têm o outro lado, e eles são pelo menos a metade dos dela. As que têm mais pares primeiro.
 */
export function cleanupCandidates(
  rows: readonly CleanupRow[],
): (CleanupPlan & { paired: number })[] {
  const categories = new Set(
    rows.map((r) => r.categoryId).filter((id): id is string => id !== null),
  );
  const found: (CleanupPlan & { paired: number })[] = [];
  for (const categoryId of categories) {
    const plan = planCleanup(categoryId, rows);
    const paired = pairedMembers(plan, rows);
    const total = rows.filter((r) => r.categoryId === categoryId && !r.locked).length;
    if (paired >= CLEANUP_MIN_PAIRED && paired * 2 >= total) found.push({ ...plan, paired });
  }
  return found.toSorted((a, b) => b.paired - a.paired || a.categoryId.localeCompare(b.categoryId));
}

// O tipo da despesa (fixa, parcela, variável) lido do banco (M13.3b, ADR-026). Uma regra só, em
// dois formatos: `natureOf` sobre o que o Prisma devolveu com NATURE_SELECT (a mesma ordem do
// `spendingNature` do core) e NATURE_SQL para as somas. O teste de integração "o tipo da
// despesa" confere que os dois concordam.
import { natureView, spendingNature, type NatureView, type SpendingNature } from "@fintrack/core";
import { Prisma } from "./generated/prisma/client";

/** O que precisa vir junto de um lançamento para saber o tipo dele. */
export const NATURE_SELECT = {
  recurrenceId: true,
  installmentGroupId: true,
  providerInstallmentCount: true,
  nature: true,
  category: { select: { defaultNature: true } },
} satisfies Prisma.TransactionSelect;

type NatureRow = {
  recurrenceId: string | null;
  installmentGroupId: string | null;
  providerInstallmentCount: number | null;
  nature: "FIXED" | "VARIABLE" | null;
  category: { defaultNature: "FIXED" | "VARIABLE" } | null;
};

/** Fixa, parcela ou variável de um lançamento lido com NATURE_SELECT. */
export function natureOf(row: NatureRow): SpendingNature {
  return spendingNature({
    recurrenceId: row.recurrenceId,
    installmentGroupId: row.installmentGroupId,
    providerInstallmentCount: row.providerInstallmentCount,
    nature: row.nature,
    categoryNature: row.category?.defaultNature ?? null,
  });
}

/** O tipo para a tela (natureView) de um lançamento lido com NATURE_SELECT; nulo fora da saída. */
export function natureViewOf(
  row: NatureRow,
  flow: { expense: boolean; transfer: boolean },
): NatureView | null {
  return natureView({
    recurrenceId: row.recurrenceId,
    installmentGroupId: row.installmentGroupId,
    providerInstallmentCount: row.providerInstallmentCount,
    nature: row.nature,
    categoryNature: row.category?.defaultNature ?? null,
    ...flow,
  });
}

/**
 * A mesma regra em SQL, para somas. "t" é o lançamento; o padrão da categoria vem por subconsulta
 * (pela chave primária), para a regra não depender de quem chama ter feito o JOIN.
 */
export const NATURE_SQL = Prisma.sql`CASE
    WHEN t."installmentGroupId" IS NOT NULL OR t."providerInstallmentCount" IS NOT NULL
      THEN 'installment'
    WHEN t."nature" = 'FIXED' THEN 'fixed'
    WHEN t."nature" = 'VARIABLE' THEN 'variable'
    WHEN t."recurrenceId" IS NOT NULL THEN 'fixed'
    WHEN (SELECT cat."defaultNature" FROM "category" cat WHERE cat."id" = t."categoryId") = 'FIXED'
      THEN 'fixed'
    ELSE 'variable'
  END`;

// Leituras de "Importar extrato" (M09.3, linha E.3 do canvas). A conferência é de quem enviou;
// o histórico mostra os arquivos das contas que a pessoa vê.
import "server-only";
import {
  classifyPreviewRows,
  fileImportFor,
  filePreviewFor,
  isUuid,
  listFileImports,
  prisma,
  type FilePreview,
  type ImportAccountOption,
} from "@fintrack/db";
import type { ImportRowState } from "@fintrack/core";
import { requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";

// Os tipos que as telas usam (features/*/ui não importa @fintrack/db, nem só o tipo)
export type { FileImportSummary, PreviewRow } from "@fintrack/db";

/** A tela de envio: pode importar (edita alguma carteira), o histórico e o resultado do último. */
export async function getImportPage(session: Session, importedId: string | null) {
  const [view, edit] = await Promise.all([
    requireScope(session, "view"),
    requireScope(session, "edit"),
  ]);
  const [history, result] = await Promise.all([
    listFileImports(prisma, view),
    importedId ? fileImportFor(prisma, view, importedId) : Promise.resolve(null),
  ]);
  return { canImport: edit.walletIds.length > 0, history, result };
}

export type PreviewPage = FilePreview & {
  /** A conta escolhida (?conta=, senão a sugerida, senão a primeira) */
  account: ImportAccountOption | null;
  /** A conta veio do ?conta= (a pessoa trocou) */
  chosenByYou: boolean;
  states: ImportRowState[];
  counts: Record<ImportRowState, number>;
};

/** A conferência de um arquivo, com o estado de cada linha na conta escolhida. Sem acesso: null. */
export async function getPreviewPage(
  session: Session,
  importId: string,
  chosen: string | null,
): Promise<PreviewPage | null> {
  const preview = await filePreviewFor(prisma, session.user.id, importId, new Date());
  if (!preview) return null;
  const byId = (id: string | null | undefined) =>
    id && isUuid(id) ? (preview.accounts.find((a) => a.id === id) ?? null) : null;
  const picked = byId(chosen);
  const account = picked ?? byId(preview.suggestion?.accountId) ?? preview.accounts[0] ?? null;
  const states = account ? await classifyPreviewRows(prisma, account.id, preview.rows) : [];
  const counts = { NEW: 0, PLUGGY: 0, IMPORTED: 0 } satisfies Record<ImportRowState, number>;
  for (const state of states) counts[state] += 1;
  if (!account) counts.NEW = preview.rows.length;
  return { ...preview, account, chosenByYou: picked !== null, states, counts };
}

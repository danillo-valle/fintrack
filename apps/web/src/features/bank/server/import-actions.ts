"use server";

// Server Actions de "Importar extrato" (M09.3). Mesma ordem de sempre (skill nova-feature):
// sessão → validação → escopo/crachá de quem está logado → operação do @fintrack/db.
//
// O arquivo: no máximo 2 MB (o Next.js recusa antes, em serverActions.bodySizeLimit), tipo
// conferido pelos primeiros bytes (nunca pelo nome), lido NA MEMÓRIA e descartado. Nada do
// arquivo vai para disco, log ou auditoria: só o SHA-256 e o resumo (ADR-013).
//
// O que entra fica PENDING (fora das somas, como a busca do Meu Pluggy): não chama
// financeChanged; só atualiza as telas de Recebidos e Lançamentos.
import { cancelFilePreview, createFilePreview, importFilePreview, prisma } from "@fintrack/db";
import {
  fileFingerprint,
  isOfxError,
  MAX_OFX_BYTES,
  parseOfx,
  type OfxStatement,
} from "@fintrack/importers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requestContext,
  requireAccountUse,
  requireScope,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { ofxErrorMessage } from "../messages";
import { cancelImportSchema, importFileSchema } from "../schemas";

const IMPORT_PATH = "/lancamentos/importar";

const failed = (error: string): ActionState => ({ error, success: null });

/** Passo 1: "Escolher arquivo". Lê, guarda a conferência e vai para ela. */
export async function previewFileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const file = formData.get("arquivo");
  if (!(file instanceof File) || file.size === 0) return failed(ofxErrorMessage("OFX_EMPTY"));
  if (file.size > MAX_OFX_BYTES) return failed(ofxErrorMessage("OFX_TOO_LARGE"));

  const bytes = new Uint8Array(await file.arrayBuffer());
  let statement: OfxStatement;
  try {
    statement = parseOfx(bytes);
  } catch (error) {
    if (!isOfxError(error)) throw error;
    // Só o código e um detalhe sem dado do arquivo (ex.: "lançamento 12: data")
    logger.info(
      { event: "file.rejected", code: error.code, detail: error.detail, userId: session.user.id },
      "arquivo OFX recusado",
    );
    return failed(ofxErrorMessage(error.code));
  }

  let importId = "";
  const result = await runAction(async () => {
    const scope = await requireScope(session, "edit");
    const created = await createFilePreview(prisma, {
      scope,
      fileName: file.name,
      sha256: fileFingerprint(bytes),
      statement,
      now: new Date(),
    });
    importId = created.id;
  });
  if (result.error) return result;
  redirect(`${IMPORT_PATH}/${importId}`);
}

/** Passo 2: "Importar N lançamentos" na conta escolhida. */
export async function importFileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = importFileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed("Escolha a conta em que o arquivo entra.");
  const { importId, accountId } = parsed.data;
  const result = await runAction(async () => {
    const grant = await requireAccountUse(session, accountId);
    const outcome = await importFilePreview(
      prisma,
      { grant, importId, now: new Date() },
      await requestContext(),
    );
    logger.info(
      {
        event: "file.imported",
        importId: outcome.id,
        created: outcome.created,
        pluggy: outcome.pluggy,
        alreadyImported: outcome.alreadyImported,
        userId: session.user.id,
      },
      "extrato importado",
    );
  });
  if (result.error) return result;
  revalidatePath("/lancamentos/recebidos");
  revalidatePath("/lancamentos");
  revalidatePath(IMPORT_PATH);
  redirect(`${IMPORT_PATH}?importado=${importId}`);
}

/** "Cancelar": nada foi gravado; apaga a conferência e volta para o envio. */
export async function cancelImportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = cancelImportSchema.safeParse(Object.fromEntries(formData));
  if (parsed.success) await cancelFilePreview(prisma, session.user.id, parsed.data.importId);
  redirect(IMPORT_PATH);
}

"use server";

// Server Actions de "Importar extrato" (M09.3) e da fatura em PDF (M09.4). Mesma ordem de
// sempre (skill nova-feature): sessão → validação → escopo/crachá de quem está logado →
// operação do @fintrack/db.
//
// O arquivo: OFX até 2 MB, PDF até 5 MB (o Next.js recusa antes de 6 MB, em
// serverActions.bodySizeLimit), formato conferido pelos primeiros bytes (nunca pelo nome), lido
// NA MEMÓRIA e descartado. Nada do arquivo vai para disco, log ou auditoria: só o SHA-256 e o
// resumo (ADR-013). O PDF é lido pelo serviço Python da rede interna (ADR-014), com um token de
// 2 minutos; a senha do PDF, quando há, vai só nessa chamada e não é gravada em lugar nenhum.
//
// O que entra fica PENDING (fora das somas, como a busca do Meu Pluggy): não chama
// financeChanged; só atualiza as telas de Recebidos e Lançamentos.
import { cancelFilePreview, createFilePreview, importFilePreview, prisma } from "@fintrack/db";
import {
  fileFingerprint,
  isOfxError,
  isPdfError,
  MAX_OFX_BYTES,
  MAX_PDF_BYTES,
  parseOfx,
  readInvoice,
  sniffPdf,
  type StatementFile,
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
import { mlServiceToken } from "@/lib/auth/ml-token";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { financeChanged } from "@/lib/finance-cache";
import { logger } from "@/lib/logger";
import { INITIAL_UPLOAD_STATE, type UploadState } from "../import-state";
import { ofxErrorMessage, pdfErrorMessage } from "../messages";
import { cancelImportSchema, importFileSchema } from "../schemas";

const IMPORT_PATH = "/lancamentos/importar";

const failed = (error: string): ActionState => ({ error, success: null });

const refused = (error: string): UploadState => ({ ...INITIAL_UPLOAD_STATE, error });

/**
 * Passo 1: "Escolher arquivo". Lê, guarda a conferência e vai para ela. PDF com senha: devolve o
 * passo da senha (o arquivo fica no navegador e volta junto com a senha). "Cancelar" no passo da
 * senha (acao=cancelar) volta ao começo sem ler nada.
 */
export async function previewFileAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await requireUser();
  if (formData.get("acao") === "cancelar") return INITIAL_UPLOAD_STATE;
  const file = formData.get("arquivo");
  if (!(file instanceof File) || file.size === 0) return refused(ofxErrorMessage("OFX_EMPTY"));
  if (file.size > MAX_PDF_BYTES) return refused(pdfErrorMessage("PDF_TOO_LARGE"));

  const bytes = new Uint8Array(await file.arrayBuffer());
  let statement: StatementFile;
  if (sniffPdf(bytes)) {
    const read = await readPdf(session.user.id, bytes, formData, {
      fileName: file.name.slice(0, 120),
      size: file.size,
    });
    if ("state" in read) return read.state;
    statement = read.statement;
  } else {
    if (file.size > MAX_OFX_BYTES) return refused(ofxErrorMessage("OFX_TOO_LARGE"));
    try {
      statement = parseOfx(bytes);
    } catch (error) {
      if (!isOfxError(error)) throw error;
      // Só o código e um detalhe sem dado do arquivo (ex.: "lançamento 12: data")
      logger.info(
        { event: "file.rejected", code: error.code, detail: error.detail, userId: session.user.id },
        "arquivo OFX recusado",
      );
      return refused(ofxErrorMessage(error.code));
    }
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
  if (result.error) return refused(result.error);
  redirect(`${IMPORT_PATH}/${importId}`);
}

/**
 * A fatura em PDF, lida pelo serviço Python. A senha só é lida do formulário e repassada; o
 * log leva o código e um detalhe sem dado do arquivo, nunca a senha.
 */
async function readPdf(
  userId: string,
  bytes: Uint8Array,
  formData: FormData,
  passwordStep: NonNullable<UploadState["pdf"]>,
): Promise<{ statement: StatementFile } | { state: UploadState }> {
  if (!env.ML_SERVICE_URL) return { state: refused(pdfErrorMessage("PDF_SERVICE_NOT_CONFIGURED")) };
  const asked = formData.has("senha");
  const password = String(formData.get("senha") ?? "");
  if (asked && password === "") {
    return { state: { error: "Digite a senha do PDF.", success: null, pdf: passwordStep } };
  }
  try {
    const statement = await readInvoice(bytes, {
      baseUrl: env.ML_SERVICE_URL,
      token: await mlServiceToken(userId),
      password: password || null,
    });
    return { statement };
  } catch (error) {
    if (!isPdfError(error)) throw error;
    const service = error.code.startsWith("PDF_SERVICE_");
    logger[service ? "warn" : "info"](
      { event: "file.rejected", code: error.code, detail: error.detail, userId },
      "fatura em PDF recusada",
    );
    if (error.code === "PDF_PASSWORD_REQUIRED" || error.code === "PDF_PASSWORD_WRONG") {
      return {
        state: {
          // A primeira vez é só o pedido da senha; a senha errada ganha o aviso
          error: asked ? pdfErrorMessage("PDF_PASSWORD_WRONG") : null,
          success: null,
          pdf: passwordStep,
        },
      };
    }
    return { state: refused(pdfErrorMessage(error.code)) };
  }
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
  let statementId: string | null = null;
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
        statementId: outcome.statementId,
        userId: session.user.id,
      },
      "extrato importado",
    );
    statementId = outcome.statementId;
  });
  if (result.error) return result;
  // A fatura do PDF liga à fatura do cartão compras que já estavam confirmadas: o vencimento
  // delas no fluxo de caixa pode mudar (as somas usam a fatura de cada compra)
  if (statementId) {
    await financeChanged(session);
    revalidatePath(`/carteiras/conta/${accountId}`);
  }
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

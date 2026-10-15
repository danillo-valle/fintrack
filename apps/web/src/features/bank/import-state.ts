// O estado do envio do arquivo (M09.3 e M09.4). Arquivo sem "server-only": o formulário do
// navegador importa o tipo e o valor inicial; a Server Action o devolve.
import type { ActionState } from "@/lib/action-state";

/**
 * `pdf`: a fatura em PDF tem senha (passo "Este PDF tem senha"). Traz só o nome e o tamanho,
 * para a tela; o arquivo continua no navegador e volta junto com a senha no próximo envio.
 */
export type UploadState = ActionState & { pdf: { fileName: string; size: number } | null };

export const INITIAL_UPLOAD_STATE: UploadState = { error: null, success: null, pdf: null };

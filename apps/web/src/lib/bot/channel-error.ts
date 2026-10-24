// A recusa de um canal do bot (M11.2 para o WhatsApp; M12.0b também para o Telegram): o status
// HTTP, o código do canal e um nome curto conhecido (a tabela do runbook). Nunca o texto do erro
// do canal (ele pode repetir o número ou a mensagem).
export type ChannelFailure = { code: number | null; subcode: number | null; hint: string | null };

export class ChannelError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly hint: string | null;

  constructor(
    readonly status: number,
    meta: ChannelFailure = { code: null, subcode: null, hint: null },
    source = "a Cloud API",
  ) {
    super(`${source} respondeu ${status}${meta.code !== null ? ` (código ${meta.code})` : ""}`);
    this.name = "ChannelError";
    this.code = meta.code;
    this.subcode = meta.subcode;
    this.hint = meta.hint;
  }
}

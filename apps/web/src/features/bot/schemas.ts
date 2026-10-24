// Validação das entradas do bot (M11; o canal no M12.0b). Ids sempre uuid; vazio = "nenhum padrão".
import { z } from "zod";

const optionalId = z
  .union([z.literal(""), z.uuid()])
  .default("")
  .transform((v) => v || null);

/** O interruptor do lar: o estado que o botão pede. */
export const botSwitchSchema = z.object({ enabled: z.enum(["true", "false"]) });

/** Os padrões: ambiente, conta do débito/pix e cartão do crédito. */
export const botPreferenceSchema = z.object({
  walletId: optionalId,
  debitAccountId: optionalId,
  creditCardId: optionalId,
});

/** Confirmar ou cancelar uma proposta pela web (Recebidos). */
export const botDraftSchema = z.object({
  draftId: z.uuid(),
  intent: z.enum(["confirmar", "cancelar"]),
});

/** O canal (M12.0b): o campo "canal" dos botões de vincular e desvincular. Sem ele, o WhatsApp. */
export const botChannelSchema = z.object({
  canal: z
    .enum(["whatsapp", "telegram"])
    .default("whatsapp")
    .transform((c) => (c === "telegram" ? ("TELEGRAM" as const) : ("WHATSAPP" as const))),
});

/** O canal na URL da tela do código (?canal=telegram); qualquer outra coisa, o WhatsApp. */
export function channelFromParam(value: string | undefined): "WHATSAPP" | "TELEGRAM" {
  return value === "telegram" ? "TELEGRAM" : "WHATSAPP";
}

// Validação das entradas do bot do WhatsApp (M11). Ids sempre uuid; vazio = "nenhum padrão".
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

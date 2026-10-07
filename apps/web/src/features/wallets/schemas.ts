// Validação das entradas das actions de carteira (zod).
import { z } from "zod";
import { displayName, userIdSchema } from "../households/schemas";

export const walletRoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"], {
  error: "Escolha um papel.",
});

export const walletIdSchema = z.object({ walletId: z.uuid() });

export const renameWalletSchema = walletIdSchema.extend({ name: displayName("à carteira") });

export const memberRoleSchema = walletIdSchema.extend({
  userId: userIdSchema.shape.userId,
  role: walletRoleSchema,
});

export const memberSchema = walletIdSchema.extend({ userId: userIdSchema.shape.userId });

export const archiveSchema = walletIdSchema.extend({ archived: z.enum(["true", "false"]) });

/**
 * Formulário "Nova carteira compartilhada". Cada pessoa do lar aparece com uma caixa
 * (name="member", value=id) e um seletor de papel (name="role:<id>"). Só as marcadas entram.
 */
export function parseCreateWalletForm(formData: FormData) {
  const members = formData.getAll("member").map((userId) => ({
    userId: String(userId),
    role: formData.get(`role:${String(userId)}`),
  }));
  return z
    .object({
      name: displayName("à carteira"),
      members: z
        .array(z.object({ userId: userIdSchema.shape.userId, role: walletRoleSchema }))
        .max(20),
    })
    .safeParse({ name: formData.get("name"), members });
}

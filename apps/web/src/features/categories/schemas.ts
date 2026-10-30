// Validação das entradas de categorias e regras (zod). Os mesmos limites do banco (M04).
import { z } from "zod";
import { textField } from "@/lib/text-field";

export const categorySchema = z.object({
  name: textField()
    .trim()
    .min(1, "Dê um nome à categoria.")
    .max(60, "Use no máximo 60 caracteres."),
  kind: z.enum(["EXPENSE", "INCOME"], { error: "Escolha despesa ou receita." }),
  parentId: z
    .union([z.literal(""), z.uuid()])
    .default("")
    .transform((v) => v || null),
});

export const archiveCategorySchema = z.object({
  categoryId: z.uuid(),
  archived: z.enum(["true", "false"]),
});

export const ruleSchema = z.object({
  pattern: textField()
    .trim()
    .min(2, "O texto da regra precisa ter de 2 a 100 caracteres.")
    .max(100, "O texto da regra precisa ter de 2 a 100 caracteres."),
  match: z.enum(["CONTAINS", "STARTS_WITH", "EQUALS"]).default("CONTAINS"),
  categoryId: z.uuid("Escolha a categoria."),
});

export const ruleIdSchema = z.object({ ruleId: z.uuid() });

/** O interruptor da IA local (M10.2b): o estado que o botão pede. */
export const localAiSwitchSchema = z.object({ enabled: z.enum(["true", "false"]) });

/** "Criar e aplicar" (M10.2b): a pessoa pode trocar o nome e a mãe que a IA propôs. */
export const localAiProposalSchema = z.object({
  transactionId: z.uuid(),
  name: textField()
    .trim()
    .min(1, "Dê um nome à categoria.")
    .max(60, "Use no máximo 60 caracteres."),
  parentId: z
    .union([z.literal(""), z.uuid()])
    .default("")
    .transform((v) => v || null),
});

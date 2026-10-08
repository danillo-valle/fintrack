// Validação das entradas de categorias e regras (zod). Os mesmos limites do banco (M04).
import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à categoria.").max(60, "Use no máximo 60 caracteres."),
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
  pattern: z
    .string()
    .trim()
    .min(2, "O texto da regra precisa ter de 2 a 100 caracteres.")
    .max(100, "O texto da regra precisa ter de 2 a 100 caracteres."),
  match: z.enum(["CONTAINS", "STARTS_WITH", "EQUALS"]).default("CONTAINS"),
  categoryId: z.uuid("Escolha a categoria."),
});

export const ruleIdSchema = z.object({ ruleId: z.uuid() });

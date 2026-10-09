// Validação das entradas de contas e cartões (zod). Os mesmos limites do banco (M04).
import { decimalToCents } from "@fintrack/core";
import { z } from "zod";
import { displayName } from "../households/schemas";

const day = z.coerce
  .number()
  .int()
  .min(1, "Use um dia de 1 a 31.")
  .max(31, "Use um dia de 1 a 31.");
const optionalDay = z
  .union([z.literal(""), day])
  .default("")
  .transform((v) => (v === "" ? null : v));

export const accountSchema = z
  .object({
    walletId: z.uuid("Escolha a carteira."),
    name: displayName("à conta"),
    kind: z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "MEAL_VOUCHER", "CASH"], {
      error: "Escolha o tipo de conta.",
    }),
    institution: z
      .string()
      .trim()
      .max(60, "Use no máximo 60 caracteres.")
      .default("")
      .transform((v) => v || null),
    closingDay: optionalDay,
    dueDay: optionalDay,
    initialBalance: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/)
      .default("0.00")
      .transform((v) => decimalToCents(v)),
  })
  .superRefine((a, ctx) => {
    if (a.kind !== "CREDIT_CARD") return;
    if (a.closingDay === null)
      ctx.addIssue({
        code: "custom",
        message: "Informe o dia do fechamento da fatura.",
        path: ["closingDay"],
      });
    if (a.dueDay === null)
      ctx.addIssue({
        code: "custom",
        message: "Informe o dia do vencimento da fatura.",
        path: ["dueDay"],
      });
    if (a.closingDay !== null && a.closingDay === a.dueDay) {
      ctx.addIssue({
        code: "custom",
        message: "Fechamento e vencimento em dias diferentes.",
        path: ["dueDay"],
      });
    }
  });

export const cardSchema = z.object({
  walletId: z.uuid(),
  accountId: z.uuid(),
  nickname: displayName("ao cartão"),
  brand: z
    .string()
    .trim()
    .min(2, "Informe a bandeira (ex.: Visa).")
    .max(30, "Use no máximo 30 caracteres."),
  // Só os 4 últimos dígitos: nunca o número inteiro (o banco também recusa)
  lastFour: z.string().regex(/^\d{4}$/, "Digite só os 4 últimos dígitos do cartão."),
  form: z.enum(["PHYSICAL", "VIRTUAL", "VIRTUAL_TEMPORARY"]),
  holderId: z.string().max(100).default(""),
  isAdditional: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
  /** Cartão de compras conjuntas (M07.4): "Pago por" mostra Compartilhado */
  sharedPurchases: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export const cardSharedSchema = z.object({
  walletId: z.uuid(),
  cardId: z.uuid(),
  sharedPurchases: z.enum(["true", "false"]),
});

export const archiveAccountSchema = z.object({
  walletId: z.uuid(),
  accountId: z.uuid(),
  archived: z.enum(["true", "false"]),
});

export const archiveCardSchema = z.object({
  walletId: z.uuid(),
  cardId: z.uuid(),
  archived: z.enum(["true", "false"]),
});

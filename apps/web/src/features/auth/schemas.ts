// Validação das entradas das actions de autenticação (zod). Usado no servidor;
// os formulários repetem os limites como atributos HTML para ajudar quem digita.
import { z } from "zod";

export const reauthSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("password"),
    password: z.string().min(1, "Digite a sua senha.").max(128),
    next: z.string().default("/"),
  }),
  z.object({
    method: z.literal("totp"),
    code: z
      .string()
      .transform((value) => value.replace(/\s/g, ""))
      .pipe(z.string().regex(/^\d{6}$/, "O código tem 6 números.")),
    next: z.string().default("/"),
  }),
]);

export const sessionIdSchema = z.object({ sessionId: z.string().min(1).max(100) });

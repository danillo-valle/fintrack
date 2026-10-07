// Validação das entradas das actions do lar (zod). Roda no servidor, que é quem decide:
// os formulários repetem os limites em atributos HTML só para ajudar quem digita.
import { z } from "zod";

/** Nome do lar ou de carteira: 1 a 60 caracteres depois de tirar os espaços das pontas. */
export const displayName = (what: string) =>
  z.string().trim().min(1, `Dê um nome ${what}.`).max(60, "Use no máximo 60 caracteres.");

export const createHouseholdSchema = z.object({ name: displayName("ao lar") });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Digite um e-mail válido, como nome@exemplo.com.").max(254)),
  role: z.enum(["MEMBER", "OWNER"]).default("MEMBER"),
});

/** Ids que chegam de formulário: convite (uuid) e pessoa (id do Better Auth, texto). */
export const inviteIdSchema = z.object({ inviteId: z.uuid() });
export const userIdSchema = z.object({ userId: z.string().min(1).max(100) });

/** O segredo do convite: 43 caracteres de base64url (o mesmo formato do @fintrack/db). */
export const inviteTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

// Validação das telas da coleta bancária (M09.1): credenciais do Meu Pluggy, ligação das contas e
// a categoria em um clique. O servidor é quem decide; nada do formulário é confiável.
import { isCivilDate } from "@fintrack/core";
import { z } from "zod";

/** Até 5 bancos por pessoa (limite do Meu Pluggy); o formulário manda item-1 … item-5. */
export const MAX_ITEMS = 5;
const ITEM_ID = /^[A-Za-z0-9-]{8,64}$/;

export const credentialsSchema = z.object({
  // Vazio = manter o Client ID já gravado (o servidor confere se existe um)
  clientId: z
    .string()
    .trim()
    .max(100, "O Client ID tem no máximo 100 caracteres.")
    .refine((v) => v === "" || v.length >= 8, "Cole o Client ID do painel da Pluggy.")
    .transform((v) => v || null),
  // Vazio = manter o Client Secret já gravado (o servidor confere se existe um)
  clientSecret: z
    .string()
    .trim()
    .max(200, "O Client Secret tem no máximo 200 caracteres.")
    .transform((v) => v || null),
  itemIds: z
    .array(z.string().trim())
    .transform((ids) => [...new Set(ids.filter(Boolean))])
    .refine((ids) => ids.length >= 1, "Informe o Item ID de pelo menos um banco.")
    .refine((ids) => ids.length <= MAX_ITEMS, `No máximo ${MAX_ITEMS} bancos.`)
    .refine(
      (ids) => ids.every((id) => ITEM_ID.test(id)),
      "Item ID só tem letras, números e hífen (copie do painel da Pluggy).",
    ),
});

/** Os campos do formulário de credenciais (item-1 … item-5 viram uma lista). */
export function credentialsInput(formData: FormData) {
  const itemIds: string[] = [];
  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const value = formData.get(`item-${i}`);
    if (typeof value === "string") itemIds.push(value);
  }
  return {
    clientId: String(formData.get("clientId") ?? ""),
    clientSecret: String(formData.get("clientSecret") ?? ""),
    itemIds,
  };
}

/**
 * A escolha de cada conta do banco no passo 2. Campo `conta:<id no banco>` com:
 *   "existing:<uuid>"  ligar a uma conta do FinTrack
 *   "new"              criar uma conta nova na carteira pessoal
 *   "skip"             não importar
 * E `cartao:<uuid do cartão>` = "<uuid do ambiente>" ou "padrao" (a regra padrão).
 */
export type ParsedLinkForm = {
  importFrom: string;
  choices: (
    | { externalId: string; target: "existing"; accountId: string }
    | { externalId: string; target: "new" | "skip" }
  )[];
  cardWallets: { cardId: string; walletId: string | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BANK_ID = /^[A-Za-z0-9-]{1,64}$/;

export function parseLinkForm(
  formData: FormData,
): { ok: true; data: ParsedLinkForm } | { ok: false; error: string } {
  const importFrom = String(formData.get("importFrom") ?? "").trim();
  if (!isCivilDate(importFrom)) return { ok: false, error: "Escolha a data de corte." };
  const choices: ParsedLinkForm["choices"] = [];
  const cardWallets: ParsedLinkForm["cardWallets"] = [];
  for (const [name, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;
    if (name.startsWith("conta:")) {
      const externalId = name.slice("conta:".length);
      if (!BANK_ID.test(externalId)) return { ok: false, error: "Conta do banco inválida." };
      if (raw === "new" || raw === "skip") choices.push({ externalId, target: raw });
      else if (raw.startsWith("existing:") && UUID.test(raw.slice(9))) {
        choices.push({ externalId, target: "existing", accountId: raw.slice(9).toLowerCase() });
      } else return { ok: false, error: "Escolha o que fazer com cada conta do banco." };
    }
    if (name.startsWith("cartao:")) {
      const cardId = name.slice("cartao:".length);
      if (!UUID.test(cardId)) return { ok: false, error: "Cartão inválido." };
      if (raw === "padrao") cardWallets.push({ cardId, walletId: null });
      else if (UUID.test(raw)) cardWallets.push({ cardId, walletId: raw.toLowerCase() });
      else return { ok: false, error: "Escolha o ambiente das compras de cada cartão." };
    }
  }
  if (choices.length === 0) return { ok: false, error: "Nenhuma conta do banco para ligar." };
  return { ok: true, data: { importFrom, choices, cardWallets } };
}

/**
 * Categoria em um clique: uma categoria existente (botão da lista) OU uma nova (o texto da busca,
 * "Criar “Pet shop”"). Com "sempre categorizar assim", vira regra.
 */
export const setCategorySchema = z
  .object({
    transactionId: z.uuid(),
    categoryId: z
      .union([z.literal(""), z.uuid()])
      .default("")
      .transform((v) => v || null),
    newCategory: z
      .string()
      .trim()
      .max(60, "Use no máximo 60 caracteres.")
      .default("")
      .transform((v) => v || null),
    rememberRule: z
      .enum(["on"])
      .optional()
      .transform((v) => v === "on"),
  })
  .refine((d) => d.categoryId || d.newCategory, { message: "Escolha uma categoria." });

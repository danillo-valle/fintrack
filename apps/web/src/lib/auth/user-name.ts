import { cleanText } from "@fintrack/core";
import { APIError } from "better-auth";

/**
 * O nome da pessoa no cadastro e no /api/auth/update-user, limpo como todo texto que chega de fora
 * (cleanText, M12.4a): sem caractere nulo, que o banco recusaria com um erro 500, nem invisível
 * ou de direção do texto, que mudariam como o nome aparece para o resto do lar.
 */
export function cleanUserName(name: string): string {
  const clean = cleanText(name).trim();
  if (clean === "") {
    throw new APIError("BAD_REQUEST", { code: "NAME_REQUIRED", message: "Digite o seu nome." });
  }
  return clean;
}

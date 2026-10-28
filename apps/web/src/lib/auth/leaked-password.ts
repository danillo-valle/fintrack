// Senhas vazadas (Have I Been Pwned), com tempo limite (M12.3a). Substitui o plugin
// haveIBeenPwned do Better Auth 1.7.7, que esperava a resposta da internet sem limite: com o
// serviço lento ou fora, o cadastro, a troca e a redefinição de senha ficavam parados.
//
// A regra continua a mesma (ADR-003): senha nova só passa depois de conferida. Sem resposta em
// LEAKED_PASSWORD_TIMEOUT_MS, ou com resposta estranha, a senha é RECUSADA com um código próprio
// (PASSWORD_CHECK_UNAVAILABLE) e a pessoa vê "tente de novo"; nada é criado nem trocado.
//
// Como o plugin original: confere toda senha que o Better Auth vai guardar (o `hash` é chamado
// só para senha nova: cadastro, troca, redefinição), e manda só os 5 primeiros caracteres do
// SHA-1 (k-anonimato), com "Add-Padding" para o tamanho da resposta não dizer nada.
import { createHash } from "node:crypto";
import { APIError } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { logger } from "../logger";

export const LEAKED_PASSWORD_TIMEOUT_MS = 3_000;
export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

export type LeakedPasswordResult = "ok" | "leaked" | "unavailable";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Quantas vezes o sufixo aparece na resposta do /range (0 se não aparece). Lança se a linha vier estranha. */
export function compromiseCount(body: string, suffix: string): number {
  const prefix = `${suffix.toUpperCase()}:`;
  for (const line of body.split(/\r?\n/)) {
    if (line.slice(0, prefix.length).toUpperCase() !== prefix) continue;
    const text = line.slice(prefix.length).trim();
    if (!/^\d{1,12}$/.test(text)) throw new Error("contagem inválida na resposta do HIBP");
    return Number.parseInt(text, 10);
  }
  return 0;
}

/**
 * Pergunta ao HIBP se a senha já vazou. Nunca lança: "unavailable" quando não deu para saber
 * (tempo esgotado, erro de rede, status diferente de 200, resposta estranha).
 */
export async function checkLeakedPassword(
  password: string,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<LeakedPasswordResult> {
  const doFetch = options.fetch ?? fetch;
  // SHA-1 porque é o protocolo do HIBP, não para guardar: o hash não é gravado nem logado, e só
  // os 5 primeiros caracteres saem do servidor. A senha guardada usa o scrypt do Better Auth.
  // O CodeQL marca esta linha (js/insufficient-password-hash): alerta dispensado como falso
  // positivo, com o motivo no OWASP (A04, "Exceções do CodeQL").
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const response = await doFetch(`${PWNED_RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "FinTrack" },
      signal: AbortSignal.timeout(options.timeoutMs ?? LEAKED_PASSWORD_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status !== 200) return "unavailable";
    return compromiseCount(await response.text(), suffix) > 0 ? "leaked" : "ok";
  } catch {
    return "unavailable";
  }
}

export const LEAKED_PASSWORD_MESSAGE =
  "Esta senha já apareceu em vazamentos de dados. Escolha outra, de preferência uma frase.";
export const PASSWORD_CHECK_UNAVAILABLE_MESSAGE =
  "Não deu para conferir a senha agora. Tente de novo em alguns segundos.";

/** Plugin do Better Auth: confere toda senha nova antes de guardar o hash dela. */
export function leakedPasswordCheck(options: {
  enabled: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
}): BetterAuthPlugin {
  return {
    id: "fintrack-leaked-password",
    init(ctx) {
      const originalHash = ctx.password.hash;
      return {
        context: {
          password: {
            ...ctx.password,
            async hash(password: string) {
              if (!options.enabled) return originalHash(password);
              const result = await checkLeakedPassword(password, options);
              if (result === "leaked") {
                throw new APIError("BAD_REQUEST", {
                  message: LEAKED_PASSWORD_MESSAGE,
                  code: "PASSWORD_COMPROMISED",
                });
              }
              if (result === "unavailable") {
                // Só o fato: nada da senha, nem o prefixo do hash
                logger.warn({ event: "auth.password_check_unavailable" });
                throw new APIError("SERVICE_UNAVAILABLE", {
                  message: PASSWORD_CHECK_UNAVAILABLE_MESSAGE,
                  code: "PASSWORD_CHECK_UNAVAILABLE",
                });
              }
              return originalHash(password);
            },
          },
        },
      };
    },
  };
}

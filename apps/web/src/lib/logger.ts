// Log estruturado do servidor (pino): uma linha JSON por acontecimento.
//
// Por que JSON e não console.error("deu ruim"): em produção, os logs saem do container e são
// lidos com `docker compose logs web | jq`. Com campos fixos (level, time, event, version),
// dá para filtrar "todos os erros da versão abc123 de ontem" sem garimpar texto.
//
// Exemplo de linha:
//   {"level":"error","time":"2026-10-04T13:05:12.345Z","service":"fintrack-web",
//    "version":"3f2a...","event":"email.send_failed","to":"***@gmail.com","msg":"..."}
//
// Regras (estão também na skill deploy-e-operacao):
//   - todo log tem um "event" curto e estável ("auth.rate_limited", "health.database_failed");
//   - nunca logar senha, token, cookie, segredo do 2FA, Client Secret nem valor de lançamento;
//     a lista REDACT abaixo apaga esses campos mesmo que alguém os passe por engano;
//   - e-mail só mascarado (maskEmail): o log não é lugar de dado pessoal.
//
// Este arquivo NÃO importa o env.ts: o logger precisa funcionar até quando as variáveis estão
// erradas (é justamente aí que ele mais ajuda). Por isso lê process.env direto.
import pino, { type DestinationStream, type Logger } from "pino";

/** Campos apagados de qualquer log, em qualquer profundidade conhecida. */
export const REDACT_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "secret",
  "totpURI",
  "backupCodes",
  "clientSecret",
  "authorization",
  "cookie",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
  "*.secret",
  "*.clientSecret",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
];

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type Level = (typeof LEVELS)[number];

function levelFromEnv(): Level {
  const value = process.env.LOG_LEVEL;
  // Nos testes, silêncio (a menos que alguém peça); no resto, "info"
  if (!value) return process.env.NODE_ENV === "test" ? "silent" : "info";
  return (LEVELS as readonly string[]).includes(value) ? (value as Level) : "info";
}

/** Cria um logger. Os testes passam um destino próprio para ler o que foi escrito. */
export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: levelFromEnv(),
      // Campos presentes em toda linha
      base: { service: "fintrack-web", version: process.env.APP_VERSION ?? "dev" },
      // Data legível (ISO 8601, UTC) em vez de milissegundos desde 1970
      timestamp: pino.stdTimeFunctions.isoTime,
      // "level":"error" em vez de "level":50: mais fácil de ler e de filtrar com jq
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: "[oculto]" },
    },
    destination,
  );
}

/** O logger do app. Escreve em stdout, que o Docker guarda (veja logging no compose.prod.yml). */
export const logger = createLogger();

/** "danillo@gmail.com" vira "***@gmail.com": dá para saber o provedor sem expor a pessoa. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "***" : `***${email.slice(at)}`;
}

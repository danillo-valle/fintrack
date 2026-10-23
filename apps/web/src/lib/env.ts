// Variáveis de ambiente do servidor, conferidas uma vez na inicialização.
//
// Por que validar: um BETTER_AUTH_SECRET vazio ou um ALLOWED_EMAILS com erro de digitação
// não quebram o app na hora; quebram a segurança em silêncio. Com o zod, o app se recusa
// a subir e diz exatamente qual variável está errada.
//
// Este arquivo só pode rodar no servidor: os segredos daqui nunca podem chegar ao JavaScript
// que vai para o celular. A trava logo abaixo garante isso (veja o comentário no auth.ts sobre
// por que não usamos `import "server-only"` aqui).
import { z } from "zod";
import { parseAllowedEmails } from "./auth/allowlist";

if (typeof window !== "undefined") {
  throw new Error("env.ts foi importado no navegador. Use src/lib/auth-client.ts nos componentes.");
}

const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // openssl rand -base64 32 gera 44 caracteres
  BETTER_AUTH_SECRET: z.string().min(32, "use pelo menos 32 caracteres (openssl rand -base64 32)"),
  BETTER_AUTH_URL: z.url(),
  // Outros endereços de onde o app é aberto (ex.: o IP do servidor na rede de casa)
  BETTER_AUTH_TRUSTED_ORIGINS: csv,
  ALLOWED_EMAILS: z
    .string()
    .min(1, "liste os e-mails que podem criar conta, separados por vírgula")
    .transform(parseAllowedEmails),
  EMAIL_FROM: z.string().min(3),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  // Opcionais: sem os dois, o botão "Entrar com Google" não aparece
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Domínio das passkeys: "localhost" em desenvolvimento; o domínio real no M05
  PASSKEY_RP_ID: z.string().min(1).default("localhost"),
  // Consulta de senhas vazadas (Have I Been Pwned). Só desligue em teste automatizado.
  HIBP_CHECK: z.enum(["on", "off"]).default("on"),
  // Nível do log JSON (src/lib/logger.ts). O logger lê direto de process.env, para funcionar até
  // quando outra variável está errada; a validação aqui só impede um valor digitado errado.
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  // ── Coleta bancária (M09.1, ADR-011) ──
  // Chaves que cifram o Client Secret do Meu Pluggy no banco: "versão:base64" separados por
  // vírgula, a primeira cifra (openssl rand -base64 32). Sem ela, as telas de conexão explicam
  // que o servidor não está pronto. O formato é conferido por parseKeyring (features/bank).
  CONNECTION_SECRET_KEYS: z
    .string()
    .regex(
      /^\s*\d{1,3}:[A-Za-z0-9+/=]{40,}\s*(,\s*\d{1,3}:[A-Za-z0-9+/=]{40,}\s*)*$/,
      "use versão:base64 (openssl rand -base64 32)",
    )
    .optional(),
  // Endereço da API da Pluggy. Só os testes E2E apontam para a Pluggy de mentira (127.0.0.1)
  PLUGGY_API_URL: z.url({ protocol: /^https?$/ }).default("https://api.pluggy.ai"),
  // A fila de sincronização (pg-boss) roda dentro do próprio servidor do app. "off" desliga
  // (a agenda diária e o "Buscar agora" ficam parados até voltar a "on")
  SYNC_WORKER: z.enum(["on", "off"]).default("on"),
  // ── Fatura em PDF (M09.4, ADR-014) e classificador (M10.1, ADR-015) ──
  // Endereço do serviço Python (services/ml), só na rede interna: em produção
  // http://ml:8001; no desenvolvimento http://127.0.0.1:8001. Sem ela, o PDF é recusado com
  // um aviso, a cascata roda sem o classificador e o OFX continua funcionando.
  ML_SERVICE_URL: z.url({ protocol: /^https?$/ }).optional(),
  // ── Bot do WhatsApp (M11, ADR-018) ──
  // As quatro do painel da Meta. Sem elas (todas), o bot fica desligado: o webhook responde como
  // rota inexistente e Ajustes › Bot do WhatsApp explica que o servidor não está pronto. Valores
  // só no .env local e em /srv/fintrack/app.env (fintrack-definir), nunca no Git ou em log.
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16, "use pelo menos 16 caracteres").optional(),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .regex(/^\d{5,20}$/, "o id do número (só dígitos)")
    .optional(),
  // Endereço da Graph API, com a versão (v26.0, de 29/7/2026; a Meta mantém cada versão por cerca
  // de dois anos: a troca está no runbook). Os testes apontam para a Cloud API de mentira (127.0.0.1:8789)
  WHATSAPP_API_URL: z.url({ protocol: /^https?$/ }).default("https://graph.facebook.com/v26.0"),
  // O número do bot como a tela mostra ("+1 555 010-0000") e se é o número de teste da Meta
  WHATSAPP_DISPLAY_NUMBER: z.string().max(30).optional(),
  WHATSAPP_TEST_NUMBER: z.enum(["on", "off"]).default("on"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Variáveis de ambiente inválidas (confira o .env na raiz):\n${problems}`);
}

export const env = parsed.data;

/** O login com Google só fica ativo quando as duas credenciais existem. */
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

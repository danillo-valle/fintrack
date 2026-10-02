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

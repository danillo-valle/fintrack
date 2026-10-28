// Configuração do Better Auth: QUEM pode entrar e COMO.
//
// Este arquivo roda só no servidor. Ele é usado pela rota /api/auth/[...all] (os endpoints
// que o navegador chama) e pelas funções de src/lib/auth/session.ts (as checagens das páginas
// e actions). O navegador usa o par dele, src/lib/auth-client.ts.
//
// Sem `import "server-only"` aqui, nem no env.ts e no mailer.ts que ele importa: o CLI do
// Better Auth (que gera as tabelas no passo 6) se recusa a ler a configuração se encontrar
// essa linha em qualquer arquivo do caminho. A proteção fica no session.ts (que toda página
// usa) e na trava do env.ts, que se recusa a rodar no navegador.
import { passkey } from "@better-auth/passkey";
import { prisma } from "@fintrack/db";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { jwt, twoFactor } from "better-auth/plugins";
import { isEmailAllowed } from "./auth/allowlist";
import { AUTH_ADVANCED, AUTH_SESSION } from "./auth/cookies";
import { ML_TOKEN } from "./auth/ml-token-claims";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./auth/password-policy";
import { leakedPasswordCheck } from "./auth/leaked-password";
import { isRecentlyAuthenticated, isSensitiveAuthPath } from "./auth/reauth";
import { formatDateTime } from "./dates";
import { passwordChangedEmail, resetPasswordEmail, verificationEmail } from "./email-templates";
import { env, googleEnabled } from "./env";
import { logger } from "./logger";
import { sendEmail } from "./mailer";

const ONE_HOUR = 60 * 60;

export const auth = betterAuth({
  appName: "FinTrack",
  // M09.4: o JWT do plugin jwt nunca vai para o navegador (só o servidor assina)
  disabledPaths: ["/token"],
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Outros endereços aceitos como origem das requisições (proteção contra CSRF)
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // ── E-mail e senha ─────────────────────────────────────────────────────────
  // Política do NIST SP 800-63B-4 para senha usada junto com um segundo fator:
  // mínimo de 8 caracteres, máximo generoso (frases-senha), sem regras de composição
  // ("1 maiúscula, 1 símbolo") e sem troca periódica. Senhas vazadas são recusadas (HIBP, com tempo limite).
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // Sem e-mail confirmado, não entra: quem digitou o e-mail errado não cria conta de outra pessoa
    requireEmailVerification: true,
    // Depois do cadastro, a pessoa vai confirmar o e-mail; o login acontece pelo link
    autoSignIn: false,
    resetPasswordTokenExpiresIn: ONE_HOUR,
    // Trocou a senha (por exemplo, porque desconfiou de algo): todas as sessões caem
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(user.email, resetPasswordEmail(user.name, url));
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // Quem tenta entrar sem ter confirmado recebe o link de novo
    sendOnSignIn: true,
    // O link de confirmação já abre a sessão e leva à configuração do 2FA
    autoSignInAfterVerification: true,
    expiresIn: ONE_HOUR,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(user.email, verificationEmail(user.name, url));
    },
  },

  // ── Login com Google (OAuth 2.0, fluxo authorization code com PKCE) ─────────
  // Só liga se as credenciais estiverem no .env. disableImplicitSignUp: o Google não cria
  // conta nova; ele só entra numa conta que já existe com o mesmo e-mail (ligação de contas).
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
          disableImplicitSignUp: true,
          prompt: "select_account",
        },
      }
    : {},
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },

  // ── Sessão ─────────────────────────────────────────────────────────────────
  // 7 dias sem uso e a sessão expira; renovada a cada dia de uso (src/lib/auth/cookies.ts)
  session: AUTH_SESSION,

  // ── Limite de tentativas (força bruta) ─────────────────────────────────────
  // Guardado no banco para valer mesmo depois de reiniciar o app.
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
      "/send-verification-email": { window: 60, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      // Trocar a senha pede a senha atual: sem limite, um cookie roubado viraria chute à vontade
      "/change-password": { window: 60, max: 5 },
    },
  },

  // ── Cadastro fechado ───────────────────────────────────────────────────────
  // Roda antes de QUALQUER criação de usuário (e-mail e senha, Google, o que vier depois).
  // Detalhe do Better Auth: no cadastro por e-mail, um 403 vindo daqui vira a MESMA resposta
  // de sucesso de um cadastro normal ("confirme seu e-mail"), mas sem criar conta e sem enviar
  // e-mail. Assim a tela não revela quais e-mails estão na lista (proteção contra enumeração).
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isEmailAllowed(user.email, env.ALLOWED_EMAILS)) {
            throw new APIError("FORBIDDEN", {
              code: "SIGNUP_NOT_ALLOWED",
              message: "Este e-mail não está autorizado a criar conta no FinTrack.",
            });
          }
          return { data: user };
        },
      },
    },
  },

  // ── Ações sensíveis exigem prova recente de identidade ──────────────────────
  // Antes de cada endpoint da lista (cadastrar passkey, desligar 2FA...), confere se o login
  // ou a última reautenticação aconteceram há menos de 10 minutos. Se não, recusa com
  // REAUTH_REQUIRED, e a tela manda a pessoa para /reautenticar.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!isSensitiveAuthPath(ctx.path)) return;
      const current = await getSessionFromCtx(ctx);
      if (!current) return; // sem sessão, o próprio endpoint responde 401
      if (!isRecentlyAuthenticated(current.session)) {
        throw new APIError("FORBIDDEN", {
          code: "REAUTH_REQUIRED",
          message: "Confirme sua identidade antes de continuar.",
        });
      }
    }),
    // Depois de uma troca de senha que deu certo, avisa por e-mail (recomendação do NIST:
    // a pessoa fica sabendo se não foi ela). Erro no endpoint (senha atual errada) não avisa.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/change-password") return;
      if (ctx.context.returned instanceof APIError) return;
      const user = ctx.context.session?.user;
      if (!user) return;
      await sendEmail(
        user.email,
        passwordChangedEmail(
          user.name,
          formatDateTime(new Date()),
          `${env.BETTER_AUTH_URL}/esqueci-a-senha`,
        ),
      );
    }),
  },

  // Cookies do login (HttpOnly, SameSite=Lax, Secure em HTTPS) e o IP de quem pede, que o limite
  // de tentativas usa: em src/lib/auth/cookies.ts, conferidos pelo cookies.test.ts (M12.1)
  advanced: AUTH_ADVANCED,

  // Os avisos e erros internos do Better Auth saem no mesmo log JSON do app (src/lib/logger.ts)
  logger: {
    level: "warn",
    log: (level, message, ...args) => {
      const target = level === "debug" ? "debug" : level;
      logger[target]({ event: "auth.internal", details: args.length ? args : undefined }, message);
    },
  },

  plugins: [
    // 2FA com app autenticador (TOTP) e 10 códigos de backup de uso único
    twoFactor({
      issuer: "FinTrack",
      backupCodeOptions: { amount: 10, length: 10 },
    }),
    // Passkeys (WebAuthn): entrar com a digital ou o rosto, resistente a phishing
    passkey({
      rpID: env.PASSKEY_RP_ID,
      rpName: "FinTrack",
      origin: [env.BETTER_AUTH_URL, ...env.BETTER_AUTH_TRUSTED_ORIGINS],
    }),
    // Recusa senhas que já apareceram em vazamentos (envia só 5 caracteres do hash SHA-1). Com
    // tempo limite de 3 s (M12.3a): sem resposta, recusa com "tente de novo" (auth/leaked-password.ts)
    leakedPasswordCheck({ enabled: env.HIBP_CHECK === "on" }),
    // M09.4 (ADR-014): o app assina um token CURTO para chamar o serviço Python (services/ml),
    // que confere pela chave pública em /api/auth/jwks. Chave EdDSA guardada na tabela jwks, com a
    // parte privada cifrada pelo BETTER_AUTH_SECRET. O /token (que daria o JWT ao navegador) fica
    // desligado em disabledPaths: só o servidor assina, pelo auth.api.signJWT (ml-token.ts).
    jwt({
      jwt: { issuer: ML_TOKEN.issuer, audience: ML_TOKEN.audience, expirationTime: "2m" },
      disableSettingJwtHeader: true,
    }),
    // Deixa as Server Actions gravarem os cookies da sessão. Precisa ser o último plugin.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

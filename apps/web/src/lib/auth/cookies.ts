// Os cookies do login e o IP de quem pede: as opções do Better Auth que decidem isso (M12.1).
//
// Ficam fora do auth.ts por dois motivos:
//   1. o teste (cookies.test.ts) confere os cookies com estas MESMAS opções, sem subir banco nem
//      e-mail: HttpOnly, SameSite=Lax e, em HTTPS, Secure com o prefixo __Secure-;
//   2. o nome dos cookies sai de um lugar só: o auth.ts, o proxy.ts (que só olha se o cookie
//      existe) e a tela do código do 2FA leem o prefixo daqui.
//
// Sem import de servidor: o proxy.ts também usa este arquivo.

/** O começo do nome de todo cookie do login ("fintrack.session_token"). */
export const AUTH_COOKIE_PREFIX = "fintrack";

/** O prefixo que o navegador exige em cookie Secure (o Better Auth põe sozinho em HTTPS). */
const SECURE_PREFIX = "__Secure-";

/**
 * Cookie que o Better Auth grava entre a senha certa e o código do 2FA (vale 10 minutos). Com
 * HTTPS (M05), ganha o prefixo __Secure-. Sem ele, a tela do código não tem o que confirmar:
 * /entrar/dois-fatores manda para /entrar.
 */
export const TWO_FACTOR_PENDING_COOKIES = [
  `${AUTH_COOKIE_PREFIX}.two_factor`,
  `${SECURE_PREFIX}${AUTH_COOKIE_PREFIX}.two_factor`,
] as const;

const ONE_DAY = 24 * 60 * 60;

/** A sessão: a validade também decide o Max-Age do cookie. */
export const AUTH_SESSION = {
  expiresIn: 7 * ONE_DAY, // sem uso por 7 dias, a sessão expira
  updateAge: ONE_DAY, // a cada dia de uso, a validade é renovada
  additionalFields: {
    // Momento da última reautenticação (senha ou código) antes de uma ação sensível.
    // input: false impede que o navegador escreva neste campo pela rota /update-session.
    reauthenticatedAt: { type: "date", required: false, input: false },
  },
} as const;

/**
 * O "advanced" do Better Auth. Os atributos dos cookies ficam no padrão dele, que é o que se
 * quer (conferido no teste): HttpOnly, SameSite=Lax, Path=/ e, quando o BETTER_AUTH_URL começa
 * com https://, Secure e o prefixo __Secure-.
 */
export const AUTH_ADVANCED = {
  cookiePrefix: AUTH_COOKIE_PREFIX,
  // ── IP de quem fez a requisição (M05) ───────────────────────────────────────────────
  // O limite de tentativas conta por IP. Em produção, o app não vê o visitante direto: o
  // caminho é visitante → Cloudflare → cloudflared → Caddy → app. O X-Forwarded-For que chega
  // da Cloudflare NÃO é confiável (o cloudflared acrescenta o IP ao que o visitante mandou,
  // então dá para forjar o começo). O confiável é o CF-Connecting-IP, que a Cloudflare sempre
  // sobrescreve. O Caddy lê esse e repassa ao app um X-Forwarded-For com UM endereço só
  // (deploy/caddy/Caddyfile). O Better Auth só aceita X-Forwarded-For de um valor; com vários,
  // ele cai num limite único para todo mundo (e avisa no log). Sem o cabeçalho (pnpm dev),
  // usa 127.0.0.1.
  ipAddress: {
    ipAddressHeaders: ["x-forwarded-for"],
  },
};

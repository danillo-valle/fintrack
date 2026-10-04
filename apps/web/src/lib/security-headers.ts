// Cabeçalhos de segurança do FinTrack: o que o navegador pode ou não pode fazer nas nossas páginas.
//
// Dois grupos:
//   1. A CSP (Content-Security-Policy), que muda a cada requisição porque leva um "nonce":
//      um número aleatório que só o nosso HTML conhece. Ela é montada por buildCsp() e
//      enviada pelo proxy.ts.
//   2. Os cabeçalhos fixos (STATIC_SECURITY_HEADERS), iguais em toda resposta, enviados pelo
//      next.config.ts.
//
// O HSTS ("só me abra por HTTPS") fica no Caddy (deploy/caddy/Caddyfile): ele só faz sentido
// quando a página chega por HTTPS, e quem sabe disso é a porta de entrada, não o app.
//
// Funções puras, sem I/O: testadas em security-headers.test.ts.

/** Cabeçalho interno com o nonce: o proxy.ts grava, o layout raiz lê e entrega ao next-themes. */
export const NONCE_HEADER = "x-nonce";

/** Opções da CSP. */
export type CspOptions = {
  /** Valor aleatório desta requisição (base64). Só scripts com esse nonce rodam. */
  nonce: string;
  /** Em desenvolvimento, o Next.js precisa de eval (recarregamento) e de WebSocket (HMR). */
  dev: boolean;
  /** Com HTTPS, pede ao navegador que troque qualquer http:// da página por https://. */
  https: boolean;
};

/**
 * Monta a Content-Security-Policy.
 *
 * Regra de ouro: tudo é proibido, menos o que está listado. Cada diretiva diz de onde um tipo
 * de recurso pode vir. 'self' = o próprio endereço do FinTrack.
 */
export function buildCsp({ nonce, dev, https }: CspOptions): string {
  const directives: Record<string, string[]> = {
    // Padrão para o que não tiver diretiva própria: só do próprio site
    "default-src": ["'self'"],
    // Scripts: só os que têm o nonce desta resposta. 'strict-dynamic' deixa um script confiável
    // carregar outros (é assim que o Next.js carrega os pedaços da página). Em dev, o Next.js
    // usa eval para o recarregamento rápido; em produção, eval fica proibido.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Estilos: o Next.js, o Sonner (avisos) e o next-themes injetam <style> e style="".
    // 'unsafe-inline' em estilo é um risco bem menor que em script (CSS não executa código)
    // e é o compromisso aceito pela documentação do Next.js. Decisão registrada no ADR-005.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Imagens: do site, data: (o QR code do 2FA é gerado como data:image/png) e blob:
    "img-src": ["'self'", "data:", "blob:"],
    // Fontes: o next/font baixa a Geist no build e serve do próprio site
    "font-src": ["'self'"],
    // Requisições do JavaScript (fetch): só para o próprio app. Em dev, o WebSocket do HMR.
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    // Nenhum <object>/<embed> (Flash, plugins): vetor antigo de ataque
    "object-src": ["'none'"],
    // <base href> mudaria para onde apontam os links relativos: proibido
    "base-uri": ["'none'"],
    // Formulários só enviam para o próprio app
    "form-action": ["'self'"],
    // Ninguém pode colocar o FinTrack dentro de um <iframe> (clickjacking)
    "frame-ancestors": ["'none'"],
    // E o FinTrack não carrega iframes de ninguém
    "frame-src": ["'none'"],
    // O manifesto do app instalável vem do próprio site
    "manifest-src": ["'self'"],
    // Workers (o PWA pode ganhar um no futuro): só do próprio site
    "worker-src": ["'self'", "blob:"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Sem valor: a diretiva vale por estar presente. Fora do HTTPS, ela quebraria o
  // http://localhost (o navegador tentaria https://localhost para cada arquivo).
  if (https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/**
 * Cabeçalhos iguais em toda resposta. O next.config.ts os aplica a todas as rotas.
 * (A CSP não está aqui porque muda a cada requisição: vem do proxy.ts.)
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Não deixa o navegador "adivinhar" o tipo de um arquivo (um .txt executado como script)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Ao clicar num link para fora, o outro site recebe só "fintrack...", nunca o caminho
  // (que poderia ter um id de lançamento ou um token de redefinição de senha)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Recursos do aparelho que o FinTrack não usa ficam desligados para qualquer script
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // Versão antiga do frame-ancestors, para navegadores que não leem CSP
  { key: "X-Frame-Options", value: "DENY" },
  // Uma janela aberta pelo FinTrack (ou que abriu o FinTrack) não consegue mexer nele
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** Gera o nonce da requisição: 16 bytes aleatórios em base64 (Web Crypto, existe no Node e no navegador). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

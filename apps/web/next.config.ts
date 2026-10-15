import path from "node:path";
import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

// As variáveis de ambiente ficam num único .env na raiz do monorepo, lido também pelo Prisma.
// O Next.js, sozinho, só procuraria em apps/web. process.loadEnvFile é do próprio Node (20.12+)
// e não sobrescreve o que já veio do ambiente; no CI e no Docker não há .env, e as variáveis
// vêm do workflow ou do container.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // sem .env na raiz: segue com as variáveis do ambiente
}

const nextConfig: NextConfig = {
  // Em desenvolvimento, aceita conexões vindas do IP do servidor na rede de casa.
  // Sem isso, a página abre pelo IP, mas o recarregamento automático (HMR) é recusado.
  allowedDevOrigins: ["192.168.1.92"],

  // O indicador do Next.js em desenvolvimento fica no canto inferior esquerdo
  // e cobre o primeiro item da barra de navegação do celular. Erros continuam aparecendo.
  devIndicators: false,

  // Os pacotes do monorepo são publicados como TypeScript (sem build próprio): o Next.js os compila
  transpilePackages: ["@fintrack/core", "@fintrack/db", "@fintrack/importers"],

  // ── M05: produção em container ────────────────────────────────────────────────
  // "standalone": o build gera .next/standalone com um server.js e SÓ os arquivos de
  // node_modules que o app usa de fato (rastreados a partir dos imports). A imagem Docker
  // copia essa pasta e não precisa de pnpm install: fica pequena e com menos superfície de ataque.
  output: "standalone",
  // Num monorepo, o rastreamento precisa começar na raiz: o app importa packages/db e
  // packages/core, que ficam fora de apps/web. Sem isso, o server.js não acharia o Prisma.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),

  // Não anuncia "X-Powered-By: Next.js": nenhum motivo para contar a um visitante o que roda aqui
  poweredByHeader: false,

  // Cache Components (M08, ADR-010): liga o "use cache" e a invalidação por etiqueta (updateTag).
  // As somas do painel ficam em cache por lar e caem a cada lançamento salvo
  // (src/lib/finance-cache.ts). O resto do app continua gerado a cada acesso.
  cacheComponents: true,
  experimental: {
    // Importar extrato (M09.3) e a fatura em PDF (M09.4): o arquivo vai numa Server Action. O
    // leitor recusa OFX acima de 2 MB e PDF acima de 5 MB; o limite aqui (o padrão é 1 MB) deixa
    // folga para o resto do formulário.
    serverActions: { bodySizeLimit: "6mb" },
    // A checagem de "navegação instantânea" (só no dev) vale apenas para as telas que pedirem
    // (export const instant = true). Toda tela do app começa pela sessão (requireUser), e o
    // loading.tsx cobre essa espera; sem isto, o log do dev avisaria em todas as páginas.
    instantInsights: { validationLevel: "manual-warning" },
  },

  // Cabeçalhos de segurança fixos em toda resposta (a CSP, que muda a cada requisição,
  // vem do proxy.ts). A lista e o porquê de cada um estão em src/lib/security-headers.ts.
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default nextConfig;

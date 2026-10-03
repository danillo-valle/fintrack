import path from "node:path";
import type { NextConfig } from "next";

// As variáveis de ambiente ficam num único .env na raiz do monorepo, lido também pelo Prisma.
// O Next.js, sozinho, só procuraria em apps/web. process.loadEnvFile é do próprio Node (20.12+)
// e não sobrescreve o que já veio do ambiente; no CI não há .env, e as variáveis vêm do workflow.
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
  transpilePackages: ["@fintrack/core", "@fintrack/db"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Em desenvolvimento, aceita conexões vindas do IP do servidor na rede de casa.
  // Sem isso, a página abre pelo IP, mas o recarregamento automático (HMR) é recusado.
  allowedDevOrigins: ["192.168.1.92"],

  // O indicador do Next.js em desenvolvimento fica no canto inferior esquerdo
  // e cobre o primeiro item da barra de navegação do celular. Erros continuam aparecendo.
  devIndicators: false,
};

export default nextConfig;

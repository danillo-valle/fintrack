import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Em desenvolvimento, aceita conexões vindas do IP do servidor na rede de casa.
  // Sem isso, a página abre pelo IP, mas o recarregamento automático (HMR) é recusado.
  allowedDevOrigins: ["192.168.1.92"],
};

export default nextConfig;

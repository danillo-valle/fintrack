// Informações de saúde do sistema, usadas pela rota /api/health.
// No M05, o deploy consulta essa rota para saber se a nova versão subiu bem.

export type Health = {
  status: "ok";
  service: string;
  version: string;
  time: string;
};

export function getHealth(now: Date = new Date()): Health {
  return {
    status: "ok",
    service: "fintrack-web",
    // Preenchida no build do CI com o hash do commit; em desenvolvimento, "dev"
    version: process.env.APP_VERSION ?? "dev",
    time: now.toISOString(),
  };
}

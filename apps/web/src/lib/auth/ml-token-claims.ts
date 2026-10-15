// Emissor e público do token que o app manda ao serviço Python (M09.4, ADR-014). O serviço
// confere os mesmos valores (services/ml/app/auth.py: ISSUER e AUDIENCE). Arquivo sem
// "server-only": o CLI do Better Auth lê o auth.ts, que importa daqui.
export const ML_TOKEN = { issuer: "fintrack", audience: "fintrack-ml" } as const;

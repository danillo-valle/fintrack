// Cliente único do banco de dados (Prisma ORM 7 + driver adapter do PostgreSQL).
//
// Por que um cliente só: cada PrismaClient abre o próprio pool de conexões. No `pnpm dev`,
// o Next.js recarrega os módulos a cada arquivo salvo; sem o truque do globalThis abaixo,
// cada recarga criaria um pool novo e o Postgres esgotaria as conexões em poucos minutos.
//
// Quem pode importar este pacote: só src/lib e src/features/*/server (regra do ESLint do M01).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida. Confira o arquivo .env na raiz do repositório.");
  }
  // O driver adapter usa o driver "pg" (node-postgres) para falar com o banco,
  // no lugar do motor em Rust das versões anteriores do Prisma.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "./generated/prisma/client";

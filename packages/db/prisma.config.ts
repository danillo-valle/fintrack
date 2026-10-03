// Configuração do Prisma ORM 7 (substitui o bloco "datasource { url }" do schema).
// O Prisma CLI (generate, migrate, studio) lê este arquivo.
import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// As variáveis ficam num único .env na raiz do monorepo
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema", // pasta: o Prisma junta todos os arquivos .prisma dela
  migrations: {
    path: "prisma/migrations",
    // "prisma db seed" roda este comando. No Prisma 7, migrate dev e migrate reset NÃO rodam
    // o seed sozinhos: por isso o atalho pnpm db:reset chama os dois em sequência.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

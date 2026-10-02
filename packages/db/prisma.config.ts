// Configuração do Prisma ORM 7 (substitui o bloco "datasource { url }" do schema).
// O Prisma CLI (generate, migrate, studio) lê este arquivo.
import path from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// As variáveis ficam num único .env na raiz do monorepo
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

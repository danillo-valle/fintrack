import { defineConfig } from "vitest/config";

// Testes unitários do @fintrack/db (não precisam de banco). Os de integração ficam de fora:
// rodam com "pnpm test:integration", que usa o vitest.integration.config.mts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});

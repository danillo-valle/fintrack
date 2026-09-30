import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Faz o Vitest entender o atalho "@/..." definido no tsconfig.json
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});

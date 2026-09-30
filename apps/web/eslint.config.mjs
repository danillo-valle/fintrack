// Configuração do ESLint (formato "flat config", padrão desde o ESLint 9).
// O ESLint lê o código sem executá-lo e aponta erros e padrões proibidos.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Módulos que dão acesso direto ao banco de dados.
// Só o código em features/*/server e lib/ pode importá-los, porque é ali
// que fica a checagem de permissão (requireWalletAccess, a partir do M06).
const DB_MODULES = [
  "@prisma/client",
  "@prisma/client/*",
  "@fintrack/db",
  "@fintrack/db/*",
  "@/generated/prisma",
  "@/generated/prisma/*",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Regras do projeto, válidas para todo o código em src/
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Proíbe acesso ao banco fora das camadas autorizadas
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: DB_MODULES,
              message:
                "Acesso ao banco só em src/features/*/server ou src/lib. Use as funções expostas pela feature, que já checam permissão.",
            },
          ],
        },
      ],
      // Nada de console.log esquecido; console.warn e console.error continuam liberados
      "no-console": ["error", { allow: ["warn", "error"] }],
      // "any" desliga a checagem de tipos: proibido
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // Exceção: nestas pastas o acesso ao banco é permitido
  {
    files: ["src/features/*/server/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  // Arquivos gerados automaticamente: não são analisados
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;

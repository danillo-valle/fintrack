// ESLint compartilhado pelos pacotes do monorepo (packages/core e packages/db).
// O app web tem a própria configuração (eslint-config-next); estes pacotes não usam React.
//
// Uso, no eslint.config.mjs do pacote:
//   import { fintrackBase, moneyGuard } from "@fintrack/config/eslint";
//   export default [...fintrackBase, moneyGuard(["src/**/*.ts"])];
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const SQL_MESSAGE =
  "SQL só parametrizado (OWASP A05, M12.1): use $queryRaw`...${valor}` ou Prisma.sql. As versões " +
  "Unsafe e o Prisma.raw juntam texto no comando e abrem caminho para injeção de SQL.";

/**
 * A trava do SQL (M12.1): proíbe os jeitos de montar SQL com texto. Fica numa lista só porque a
 * regra "no-restricted-properties" também é usada pela trava de dinheiro, e no formato "flat" do
 * ESLint a última definição de uma regra substitui as anteriores: as duas incluem esta lista.
 * O app web (eslint.config.mjs próprio) importa a mesma lista.
 */
export const RAW_SQL_RESTRICTIONS = [
  { property: "$queryRawUnsafe", message: SQL_MESSAGE },
  { property: "$executeRawUnsafe", message: SQL_MESSAGE },
  { object: "Prisma", property: "raw", message: SQL_MESSAGE },
];

/** Regras gerais: as recomendadas do JavaScript e do TypeScript, mais as do CLAUDE.md. */
export const fintrackBase = [
  { ignores: ["**/generated/**", "**/node_modules/**", "**/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Nada de console.log esquecido; console.warn e console.error continuam liberados
      "no-console": ["error", { allow: ["warn", "error"] }],
      // "any" desliga a checagem de tipos: proibido
      "@typescript-eslint/no-explicit-any": "error",
      // SQL só parametrizado (M12.1)
      "no-restricted-properties": ["error", ...RAW_SQL_RESTRICTIONS],
    },
  },
];

const MONEY_MESSAGE =
  "Dinheiro é bigint em centavos (Cents). number perde centavos (0,1 + 0,2) e acima de 2^53. " +
  "Use centsToDecimal/decimalToCents do @fintrack/core.";

/**
 * A trava de dinheiro: proíbe as conversões que fazem um valor monetário virar `number`.
 * Os tipos já impedem misturar bigint com number; esta regra pega o caminho de volta
 * (texto → number) e o arredondamento por toFixed, que é onde os centavos somem.
 *
 * @param {string[]} files arquivos vigiados (globs relativos ao pacote)
 */
export function moneyGuard(files) {
  return {
    files,
    rules: {
      "no-restricted-globals": ["error", { name: "parseFloat", message: MONEY_MESSAGE }],
      // Number(valor) e new Number(valor): convertem texto ou bigint em number
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='Number']", message: MONEY_MESSAGE },
        { selector: "NewExpression[callee.name='Number']", message: MONEY_MESSAGE },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: MONEY_MESSAGE },
        { object: "Math", property: "round", message: MONEY_MESSAGE },
        { property: "toFixed", message: MONEY_MESSAGE },
        { property: "toPrecision", message: MONEY_MESSAGE },
        // A mesma regra carrega a trava do SQL (senão esta definição a apagaria)
        ...RAW_SQL_RESTRICTIONS,
      ],
    },
  };
}
